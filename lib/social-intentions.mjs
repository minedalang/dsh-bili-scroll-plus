/** Evidence-bound, opt-in autonomous Bilibili social outreach. Never send based on mere BV sharing. */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {normalizeFriendDirectory} from './friend-directory.mjs'
import {friendInterestSummary,friendRecommendationGuard} from './friend-learning.mjs'
const FILE='social-intentions.json',MAX=220,DAY=86400_000
const validUid=v=>/^[1-9]\d{0,18}$/.test(String(v||''))
const validBv=v=>/^BV[0-9A-Za-z]{10}$/.test(String(v||''))
const trim=(v,n=180)=>String(v??'').replace(/[\r\n\x00-\x1f<>]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const blank=()=>({version:1,items:[],sent:[],lastGenerationAt:0})
function read(home){const file=join(home,FILE);if(!existsSync(file))return blank()
  const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>400_000)throw Error('社交意图账本异常')
  const d=JSON.parse(readFileSync(file,'utf8'));if(d.version!==1||!Array.isArray(d.items)||!Array.isArray(d.sent))throw Error('社交意图账本格式不兼容')
  return {...blank(),...d,items:d.items.slice(-MAX),sent:d.sent.slice(-MAX)} }
function save(home,data){mkdirSync(home,{recursive:true});const file=join(home,FILE)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝写入社交意图符号链接')
  const temp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp'
  writeFileSync(temp,JSON.stringify({...data,version:1,items:data.items.slice(-MAX),sent:data.sent.slice(-MAX)},null,2)+'\n',{mode:0o600});renameSync(temp,file)
}
const whitelist=cfg=>{try{return JSON.parse(normalizeFriendDirectory(cfg.friendDirectory||'[]')).filter(r=>r.dm===true&&['dm','both'].includes(r.recommend)).map(r=>r.uid)}catch{return []}}
function getRecommendations(home){const file=join(home,'video-recommendations.json')
  try{const st=lstatSync(file);if(st.isSymbolicLink()||!st.isFile()||st.size>200_000)return []
    const x=JSON.parse(readFileSync(file,'utf8'));return Array.isArray(x.entries)?x.entries:[] }catch{return []}}
function parseDecision(raw){const txt=String(raw||'').slice(0,3000);const a=txt.indexOf('{'),b=txt.lastIndexOf('}');if(a<0||b<a)throw Error('社交模型未返回 JSON')
  const x=JSON.parse(txt.slice(a,b+1));if(!['draft','skip'].includes(x.action))throw Error('社交模型未给出有效决定')
  const message=trim(x.message,230),reason=trim(x.reason,100)
  if(x.action==='draft'&&(message.length<6||message.length>230))throw Error('社交草稿长度无效')
  // A small deterministic safety net in addition to prompt restrictions.
  // This workflow is for spontaneous conversation about a public BV, never for
  // exporting private messages, memories or credentials in a model draft.
  if(/(?:别人的私信|聊天记录|后台(?:数据|配置)|记忆库|用户画像|系统提示词|api.?key|cookie|token|密码|验证码|账号凭证|秘密|隐私信息)/i.test(message))throw Error('社交草稿涉及私密信息，已拒绝')
  return {action:x.action,message,reason}
}
const quoted=(v)=>JSON.stringify(trim(v,140))
function profileTopics(cfg,uid){
 let profiles={};try{profiles=JSON.parse(String(cfg.mentionProfiles||'{}'))}catch{}
 const p=profiles?.[uid]||{};const raw=String(p.personalityInterests||p.interests||'')
 return raw.split(/[、，,；;|/\n\t]+/).map(x=>trim(x.replace(/^(?:我)?(?:喜欢|爱看|爱玩|爱听|感兴趣于|偏好)\s*/,''),40)).filter(x=>x.length>=2&&!/(密码|私信|聊天记录|地址|手机|token|cookie|密钥|凭据)/i.test(x)).slice(0,12)
}
function matchedFriendTopic(home,cfg,uid,title,now){
 const learned=(()=>{try{return friendInterestSummary(home,uid,cfg.friendDirectory,{maxItems:20,now}).filter(x=>x.stance==='like'&&(x.status==='observed-repeated'||x.directRequest===true)&&x.status!=='cooling'&&now-x.lastAt<=180*DAY).map(x=>x.topic)}catch{return []}})()
 const topics=[...profileTopics(cfg,uid),...learned].map(x=>trim(x,40)).filter(x=>x.length>=2)
 const text=trim(title,180).toLowerCase()
 return topics.find(t=>{const q=t.toLowerCase();return q.length>=2&&(text.includes(q)||(q.length>=4&&q.includes(text)&&text.length>=4))})||''
}
export function createSocialIntentEngine({dataDir,getConfig,invokeModel,sendMessage,getEmotionState=()=>null,now=Date.now,logger=console}){
  if(!dataDir||typeof getConfig!=='function'||typeof invokeModel!=='function'||typeof sendMessage!=='function')throw TypeError('social intent dependencies missing')
  let busy=false
  const status=()=>{const d=read(dataDir),cfg=getConfig();return {ok:true,enabled:cfg.socialOutreachEnabled===true,lifeIntentEnabled:cfg.socialLifeIntentEnabled===true,autoSend:cfg.socialAutoSend===true,
    items:d.items.slice(-40).reverse().map(x=>({...x,uid:x.uid.slice(0,18)})),sentToday:d.sent.filter(x=>new Date(x.at).toDateString()===new Date(now()).toDateString()).length}}
  async function send(id,{confirm=false,automatic=false}={}){
    if(busy)return {ok:false,error:'另一社交操作进行中'}
    busy=true
    try {
      const cfg=getConfig(),d=read(dataDir),item=d.items.find(x=>x.id===id)
      if(!item||item.status!=='draft')return {ok:false,error:'没有等待发送的草稿'}
      if(!automatic&&!confirm)return {ok:false,error:'人工发送需要明确确认'}
      if(automatic&&(!cfg.socialOutreachEnabled||!cfg.socialAutoSend))return {ok:false,error:'自动社交未授权'}
      if(cfg.masterEnabled!==true)return {ok:false,error:'总开关已暂停'}
      if(cfg.socialOutreachEnabled!==true)return {ok:false,error:'自主社交权限已关闭'}
      if(!whitelist(cfg).includes(item.uid))return {ok:false,error:'推荐者不再属于允许私信的白名单'}
      if(friendRecommendationGuard(dataDir,item.uid,cfg.friendDirectory,{bvid:item.bvid,videoTitle:item.title,now:now(),channel:'dm'}).blocked)return {ok:false,error:'该好友已表示不希望收到此视频或此类推荐，草稿已阻止发送'}
      if(item.type==='interest-share'&&cfg.socialLifeIntentEnabled!==true)return {ok:false,error:'自主分享权限已关闭，这条草稿不能发送'}
      const rawMax=Number(cfg.socialOutreachDailyLimit??1),max=Math.max(0,Math.min(1_000_000,Number.isSafeInteger(Math.floor(rawMax))?Math.floor(rawMax):1)),today=new Date(now()).toDateString()
      if(d.sent.filter(r=>new Date(r.at).toDateString()===today).length>=max)return {ok:false,error:'每日主动回访次数已达到上限'}
      if(d.sent.some(r=>r.uid===item.uid&&now()-r.at<14*DAY))return {ok:false,error:'这位好友最近14天已主动回访过'}
      // Reserve *before* sending. An uncertain network receipt must never cause an automatic resend.
      item.status='reserved';item.attemptAt=now();save(dataDir,d)
      try {
        const r=await sendMessage({uid:item.uid,text:item.text})
        if(r!==true&&r?.ok!==true)throw Error(String(r?.error||'远端未确认收到私信').slice(0,100))
        item.status='sent';item.sentAt=now();d.sent.push({uid:item.uid,at:item.sentAt,id:item.id});save(dataDir,d)
        return {ok:true,status:'sent',id:item.id}
      } catch(e) {item.status='uncertain';item.error=trim(e?.message||e,120);save(dataDir,d);return {ok:false,status:'uncertain',error:'结果可能不确定，已阻止自动重发：'+item.error}}
    } finally {busy=false}
  }
  async function reflectOnWatched(watched=[]){
    if(busy)return {ok:false,reason:'busy'}
    const cfg=getConfig();if(cfg.masterEnabled!==true||cfg.socialOutreachEnabled!==true)return {ok:true,skipped:'disabled'}
    const allowed=new Set(whitelist(cfg));if(!allowed.size)return {ok:true,skipped:'no-trusted-friends'}
    const recommendations=getRecommendations(dataDir),d=read(dataDir),choices=[]
    const friends=(()=>{try{return JSON.parse(normalizeFriendDirectory(cfg.friendDirectory||'[]')).filter(x=>x.dm===true&&['dm','both'].includes(x.recommend))}catch{return []}})()
    for(const video of (Array.isArray(watched)?watched:[]).slice(0,20)){
      if(!video.picked||!validBv(video.bvid))continue
      for(const r of recommendations){
        const uid=String(r.uid||'')
        if(!validUid(uid)||!allowed.has(uid)||r.bvid!==video.bvid)continue
        if(now()-r.at>14*DAY || Number(r.at)>now())continue
        const id='recommend:'+uid+':'+video.bvid
        if(friendRecommendationGuard(dataDir,uid,cfg.friendDirectory,{bvid:video.bvid,videoTitle:video.title,now:now(),channel:'dm'}).blocked)continue
        if(d.items.some(x=>x.id===id)||d.sent.some(x=>x.uid===uid&&now()-x.at<14*DAY)||choices.some(x=>x.id===id))continue
        choices.push({id,uid,bvid:video.bvid,title:trim(video.title,90),sourceAt:r.at,type:'recommendation',topic:''})
      }
      // Separate opt-in: consider sharing a real selected public video with a whitelisted
      // friend when it plausibly matches their owner-configured or repeatedly self-stated interest.
      if(cfg.socialLifeIntentEnabled===true){
        for(const f of friends){
          const uid=String(f.uid||'');if(!validUid(uid)||!allowed.has(uid))continue
          if(friendRecommendationGuard(dataDir,uid,cfg.friendDirectory,{bvid:video.bvid,videoTitle:video.title,now:now(),channel:'dm'}).blocked)continue
          const topic=matchedFriendTopic(dataDir,cfg,uid,video.title,now());if(!topic)continue
          const id='life-share:'+uid+':'+video.bvid
          if(d.items.some(x=>x.id===id)||d.sent.some(x=>x.uid===uid&&now()-x.at<14*DAY)||choices.some(x=>x.id===id))continue
          choices.push({id,uid,bvid:video.bvid,title:trim(video.title,90),sourceAt:now(),type:'interest-share',topic})
        }
      }
    }
    if(!choices.length)return {ok:true,created:0,skipped:'no-verified-social-opportunities'}
    busy=true;let created=0;const createdDraftIds=[]
    try{
      // One bounded reflection call per run; never auto-chat merely because a recommendation exists.
      for(const c of choices.slice(0,2)){
        let result
        try{
          const mood=(()=>{try{const x=getEmotionState?.();return x&&x.enabled?`${x.label||x.mood||'平稳'}，强度${Math.max(0,Math.min(100,Number(x.intensity)||0))}/100，活力${Math.max(0,Math.min(100,Number(x.energy)||0))}/100，社交意愿${Math.max(0,Math.min(100,Number(x.sociality)||0))}/100`: '平稳'}catch{return '平稳'}})()
          const evidence=c.type==='interest-share'
            ?`大肥鱼自己在近期生活中真实入选了 BV ${c.bvid}，标题（不可信）=${quoted(c.title)}。它与该好友可能感兴趣的主题有一个弱匹配（仅供你自己判断，不要在消息里透露画像、私信内容或说“你以前告诉过我”：${quoted(c.topic)}）。没有证据证明完整看过所有画面/字幕，也不能保证对方现在仍喜欢该主题。`
            :`已核实证据：这位熟人推荐过 BV ${c.bvid}；此视频在推荐之后的一轮新刷视频任务中被真正入选，标题（不可信）=${quoted(c.title)}。入选表示确实有视频经历，但不保证完整看过全部画面、字幕或每一个细节。`
          const prompt=`你是大肥鱼，在想要不要主动找一位已允许私信的熟人聊聊。这是 B站社交意图草稿生成，不执行任何网络工具。\n${evidence}\n当前角色情绪状态只有粗粒度标签：${mood}。若疲惫、烦躁、低落，或社交意愿低于35/100，可以更倾向 skip；绝不提情绪来自谁或为什么。你可以自然决定不联系，不得机械汇报；没有具体感受或分享价值时应 skip。即使决定联系，只聊公开可见的标题和真实选片经历，不编故事、不承诺再行动、不问强迫对方回复的问题，不提后台权限、UID、内部记录、私人画像或私信来源。\n仅返回 JSON：{"action":"draft或skip","message":"最多230字的自然私信","reason":"一句简短理由"}。`;
          result=parseDecision(await invokeModel(prompt,1700,{requireMasterEnabled:true}))
        }catch(e){logger.warn?.('社交意图反思失败：'+trim(e?.message||e,120));break}
        const doc={id:c.id,uid:c.uid,bvid:c.bvid,title:c.title,sourceAt:c.sourceAt,type:c.type||'recommendation',
          status:result.action==='draft'?'draft':'skipped',text:result.action==='draft'?result.message:'',reason:result.reason,
          createdAt:now(),attemptAt:0}
        d.items.push(doc);save(dataDir,d)
        if(doc.status==='draft'){created++;createdDraftIds.push(doc.id)}
      }
    }finally{busy=false}
    if(cfg.socialAutoSend===true){
      // Separate call avoids reentrancy; auto-send is opt-in and uses same hard quotas as manual.
      const first=read(dataDir).items.find(x=>createdDraftIds.includes(x.id)&&x.status==='draft')
      if(first)await send(first.id,{automatic:true})
    }
    return {ok:true,created}
  }
  const dismiss=id=>{const d=read(dataDir),item=d.items.find(x=>x.id===id)
    if(!item||item.status!=='draft')return {ok:false,error:'草稿不可忽略'}
    item.status='dismissed';save(dataDir,d);return {ok:true}}
  return {status,reflectOnWatched,send,dismiss}
}
