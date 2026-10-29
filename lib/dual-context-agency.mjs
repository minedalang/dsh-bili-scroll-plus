/**
 * dev.9 Dual-Context Agency / 双域意愿系统.
 * B站主人请求是邀请，不是主 Session 指令。此处只管理意愿，不能授予任何工具权限。
 * No plaintext messages, raw UID, private context, or executable instructions are persisted.
 */
import {createHash,randomUUID} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const FILE='dual-context-agency.json',MAX=200_000,WINDOW=12*3600_000
const UID=/^[1-9]\d{0,18}$/
const BV=/^BV[0-9A-Za-z]{10}$/
const clean=(x,n=140)=>String(x??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n)
const digest=x=>createHash('sha256').update(String(x)).digest('hex').slice(0,24)
const clamp=(x,min,max,fallback)=>Number.isFinite(Number(x))?Math.max(min,Math.min(max,Number(x))):fallback
const blank=()=>({version:1,items:[]})
function read(dir){const file=join(dir,FILE);if(!existsSync(file))return blank()
  const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>MAX)throw Error('双域意愿账本不安全')
  const d=JSON.parse(readFileSync(file,'utf8'));if(d?.version!==1||!Array.isArray(d.items))throw Error('双域意愿账本格式错误')
  return {version:1,items:d.items.slice(-350)}
}
function save(dir,d){mkdirSync(dir,{recursive:true});const file=join(dir,FILE)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝写入符号链接意愿账本')
  const tmp=file+'.'+process.pid+'.'+randomUUID()+'.tmp'
  writeFileSync(tmp,JSON.stringify({version:1,items:d.items.slice(-350)},null,2)+'\n',{mode:0o600});renameSync(tmp,file)
}
const soft=/拜托|求求|求你|好不好|可以嘛|行不行|嘛[～~！!。]?|麻烦你|球球|就一次|真的很想|再考虑|再看看|再帮我|求你了/i
const harsh=/必须|立刻照做|不准拒绝|再不.*就|命令你|强迫|废物|笨蛋|滚|威胁/i
const decline=/^(?:别|不要|不用|取消|算了|不必|先不|停下|停止)|别再|不许|不用你/i
const consent=/以后.{0,12}(?:别|不要|不用).{0,18}(?:推荐|推送)|不(?:想|要).{0,8}(?:收|看).{0,8}(?:推荐|推送)|(?:恢复|重新|可以再).{0,10}(?:推荐|推送)/i
/** Only classify affirmative requests, never pure chat, preference feedback, or pasted negatives. */
export function classifyBiliOwnerRequest(text){
  const s=clean(text,700).replace(/^[@#]?(?:大肥鱼|小肥鱼)[,，:：\s]*/,'').trim()
  if(!s||decline.test(s)||consent.test(s)||/(?:不想|不需要|不必|别|不用|不要).{0,15}(?:赞|评论|关注|收藏|投币|看|搜索)/.test(s))return null
  if(/(?:投个?币|投币)/.test(s))return {intent:'coin'} // still has no execution tool
  const bv=s.match(/BV[0-9A-Za-z]{10}/)?.[0]||''
  if(/(?:点个赞|点赞|赞一个|收藏|关注|取关)/.test(s))return {intent:/点赞|点个赞|赞一个/.test(s)?'like':/收藏/.test(s)?'collect':'follow',target:bv}
  if(/(?:评论|发表|发动态|发布|给.{0,12}发私信|发消息)/.test(s)&&/(?:帮|给|替|请|麻烦|可以|能不能|发|写|生成|发布)/.test(s))return {intent:'publish',target:bv}
  if(/(?:看看?|查看|观看|搜索|搜视频|查一下|找视频|帮我查|调查|来看看|过来看看)/.test(s)&&/(?:帮|替|请|麻烦|拜托|求你|能不能|可以|有空|现在|马上|立刻|来|过来|大肥鱼|BV[0-9A-Za-z]{10})/.test(s))return {intent:'explore',target:bv}
  return null
}
/** Side effects must only occur on an allow decision, AND after original hard permission checks. */
export function createDualContextAgency({dataDir,getEmotion=()=>({}),getRelationship=()=>'',now=Date.now}={}){
  if(!dataDir)throw TypeError('dataDir required')
  function decide({source,uid,messageId,text='',intent='explore',target='',thread='',hardAllowed=true}={}){
    if(source==='main-session')return {decision:hardAllowed?'allow':'blocked',reason:hardAllowed?'main-session-command':'hard-permission-denied',newDecision:true}
    if(!['bili-dm','bili-comment'].includes(source))return {decision:'blocked',reason:'unknown-source',newDecision:false}
    if(!UID.test(String(uid))||!clean(messageId,140))return {decision:'blocked',reason:'unverified-request',newDecision:false}
    if(!hardAllowed)return {decision:'blocked',reason:'hard-permission-denied',newDecision:false}
    const key=digest(source+'|'+uid+'|'+messageId),actor=digest(uid),scene=digest((thread?'comment-thread':'conversation')+'|'+uid+'|'+clean(intent,40)+'|'+(thread?clean(thread,100):(BV.test(target)?target:''))+'|'+(thread?'':'source:'+source))
    const timestamp=now(),d=read(dataDir)
    const existing=d.items.find(x=>x.key===key)
    if(existing)return {decision:existing.decision,reason:existing.reason,score:existing.score,newDecision:false,duplicate:true,attempt:existing.attempt}
    if(intent==='coin'){
      const blocked={key,actor,scene,at:timestamp,source,intent:'coin',decision:'blocked',reason:'coin-not-implemented',score:0,attempt:1,gentle:false}
      d.items.push(blocked);d.items=d.items.filter(x=>x.at>timestamp-7*24*3600_000).slice(-350);save(dataDir,d)
      return {decision:'blocked',reason:'coin-not-implemented',newDecision:true,attempt:1}
    }
    const recent=d.items.filter(x=>x.scene===scene&&x.at>timestamp-WINDOW&&x.at<=timestamp)
    const observedEmotion=getEmotion()||{}
    const effectiveEmotion=observedEmotion.enabled===false?{}:observedEmotion
    const energy=clamp(effectiveEmotion.energy,0,100,56),sociality=clamp(effectiveEmotion.sociality,0,100,45),curiosity=clamp(effectiveEmotion.curiosity,0,100,45)
    const valence=clamp(effectiveEmotion.valence,-100,100,0)
    const gentle=soft.test(text)&&!harsh.test(text),pushy=harsh.test(text)
    const relationship=String(getRelationship(uid)||'')
    const trustBonus=relationship==='regular'?6:relationship==='familiar'?4:relationship==='known'?2:0
    // Neutral mood usually cooperates. Low energy/sociality may refuse or postpone.
    // Separate, genuinely new gentle follow-ups on the SAME request can persuade, but not override hard gates.
    const attempt=Math.min(6,recent.length+1)
    const score=Math.round(22+.22*energy+.24*sociality+.12*curiosity+.08*valence
      +(gentle?8:0)+trustBonus-(pushy?22:0)+Math.min(4,recent.filter(x=>x.gentle).length)*11
      -Math.max(0,recent.length-5)*7)
    const threshold=({chat:39,explore:45,like:52,collect:56,follow:58,publish:61,coin:100})[intent]??54
    const decision=score>=threshold?'allow':score>=threshold-13?'defer':'refuse'
    const reason=decision==='allow'?'willing':decision==='defer'?'low-willingness-defer':'low-willingness-refuse'
    d.items.push({key,actor,scene,at:timestamp,source,intent:clean(intent,32),decision,reason,score,attempt,gentle})
    d.items=d.items.filter(x=>x.at>timestamp-7*24*3600_000).slice(-350)
    save(dataDir,d)
    return {decision,reason,score,attempt,newDecision:true}
  }
  // AI-led trusted social invitations: this records the FIRST model's genuine
  // willingness, instead of running a second local-score decision on its result.
  function context({uid,thread='',target=''}={}){
    if(!UID.test(String(uid)))return {attempts:0,recent:[]}
    const d=read(dataDir),ts=now(),actor=digest(uid)
    const rows=d.items.filter(x=>x.actor===actor&&x.source==='bili-comment'&&x.at>ts-WINDOW
      &&(thread?x.threadKey===digest(thread):x.targetKey===digest(BV.test(target)?target:'')))
    return {attempts:rows.length,recent:rows.slice(-6).map(x=>({intent:x.intent,action:x.action||'',decision:x.decision,at:x.at}))}
  }
  function recordAI({source='bili-comment',uid,messageId,text='',intent='explore',action='',target='',thread='',decision}={}){
    if(source!=='bili-comment'||!UID.test(String(uid))||!clean(messageId,140)||!['allow','defer','refuse'].includes(decision))
      return {decision:'blocked',reason:'invalid-ai-decision',newDecision:false}
    const key=digest(source+'|'+uid+'|'+messageId),actor=digest(uid),ts=now(),d=read(dataDir)
    const existing=d.items.find(x=>x.key===key)
    if(existing)return {decision:existing.decision,reason:existing.reason,score:existing.score,newDecision:false,duplicate:true,attempt:existing.attempt}
    const threadKey=thread?digest(clean(thread,100)):'',targetKey=digest(BV.test(target)?target:'')
    const scene=digest('ai|'+uid+'|'+clean(intent,40)+'|'+(threadKey||targetKey))
    const recent=d.items.filter(x=>x.scene===scene&&x.at>ts-WINDOW)
    const attempt=Math.min(6,recent.length+1),gentle=soft.test(text)&&!harsh.test(text)
    d.items.push({key,actor,scene,at:ts,source,intent:clean(intent,32),action:clean(action,32),decision,
      reason:'ai-'+(decision==='allow'?'willing':decision),score:null,attempt,gentle,mode:'ai',threadKey,targetKey})
    d.items=d.items.filter(x=>x.at>ts-7*24*3600_000).slice(-350);save(dataDir,d)
    return {decision,reason:'ai-'+(decision==='allow'?'willing':decision),score:null,attempt,newDecision:true}
  }
  const status=()=>{const d=read(dataDir);return {ok:true,recent:d.items.slice(-30).map(({actor,scene,key,...row})=>row)}}
  return {decide,recordAI,context,status}
}
export function agencyDeclineMessage(result){
  if(result?.reason==='coin-not-implemented')return '我还没有投币能力哦，这件事做不了～🐟'
  return result?.decision==='defer'?'今天有点懒，先放一放好不好？过会儿再叫我嘛～🐟':'这会儿真不太想动鱼鳍，就让我偷个懒吧～🐟'
}
export const __test={FILE,read,soft,harsh}
