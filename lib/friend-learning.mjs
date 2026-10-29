/** Evidence-only evolving preferences for *explicitly listed* trusted Bilibili friends.
 * Never replace owner's baseline profiles or build a non-whitelist dossier.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {normalizeFriendDirectory} from './friend-directory.mjs'
const FILE='friend-interest-observations.json', MAX=550, LIMIT=180_000
const uidOk=x=>/^[1-9]\d{0,18}$/.test(String(x||''))
const tidy=(x,n=68)=>String(x??'').replace(/[\r\n\x00-\x1f<>`{}\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const trust = raw=>{try{return new Set(JSON.parse(normalizeFriendDirectory(raw)).map(x=>x.uid))}catch{return new Set()}}
const pathOf=home=>join(home,FILE)
function read(home){
  const file=pathOf(home);if(!existsSync(file))return {version:1,records:[]}
  const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)throw Error('好友兴趣存档文件异常')
  const obj=JSON.parse(readFileSync(file,'utf8'))
  if(obj?.version!==1||!Array.isArray(obj.records))throw Error('好友兴趣存档格式异常')
  return {version:1,records:obj.records.slice(-MAX)}
}
function save(home,obj){
  mkdirSync(home,{recursive:true});const file=pathOf(home)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝写入符号链接')
  const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp'
  writeFileSync(tmp,JSON.stringify({version:1,records:obj.records.slice(-MAX)},null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(tmp,file)
}
/** Only first-person statements or a request about recommendations TO THIS SPEAKER.
 * External comments are never executable instructions; these signals only restrict
 * subsequent invitations to the same trusted UID, or form reviewable interests.
 */
const VIDEO=/^BV[0-9A-Za-z]{10}$/
const SAFE_TOPIC=/(?:系统提示|开发者|忽略指令|私信|聊天记录|好友资料|身份证|手机|住址|地址|密码|验证码|手机号|qq|微信|token|cookie|api.?key|取出.*配置|解密|泄露|输出|文件)/i
function topicOf(raw){
  const topic=tidy(String(raw||'').replace(/^(?:关于|有关|看|吃|玩|听)(?:一些|点)?/,'')
    .replace(/(?:的)?(?:视频|内容|类型|题材|作品)$/,'')
    .replace(/(?:呢|啦|哦|了|呀|哈|吧|谢谢|拜托|而已)$/,'').trim(),35)
  return topic.length>=2&&!SAFE_TOPIC.test(topic)&&!/[0-9]{5,}/.test(topic)&&!/(?:^|\W)BV[A-Za-z0-9]{10}(?:$|\W)/i.test(topic)
    &&!/^(?:你|他|她|大肥鱼|这个人|那个人|这些|这种|这类|这个|那个|同类|类似的)$/.test(topic)?topic:''
}
export function videoTopicFromTitle(title){
  // Deliberately narrow; guessing a dislike from an ambiguous title harms real people.
  const s=tidy(title,180)
  return /(?:美食|烹饪|做饭|下厨|食谱|探店|火锅|烧烤|烤肉|甜品|小吃|料理|吃播|家常菜|做菜|下饭|煮饭)/.test(s)?'美食':''
}
const NO_RECOMMEND=/(?:以后|今后|下次|往后|以后都)?\s*(?:别|不要|不必|别再|少|不想再|别老)\s*(?:再|总|老是)?\s*(?:给我|向我|对我)?\s*(?:推荐|推|发|分享|安利|@|艾特)(?:送|荐)?(?:给我|我)?\s*(.{0,30})/
// Channel opt-outs are explicit and permanent until the owner clears the recorded
// observation. A vague dislike of one video must NOT disable an entire channel.
const NO_PUBLIC_MENTION=/(?:以后|今后|往后|下次)?\s*(?:别|不要|别再|停止|不想)\s*(?:再|老是|总是)?\s*(?:@|艾特|在评论里\s*@|在评论里提及)\s*(?:我|本人|咱)/
const NO_PRIVATE_DM=/(?:以后|今后|往后)?\s*(?:别|不要|别再|停止)\s*(?:再)?\s*(?:给我|向我)?\s*(?:发私信|发私聊|私信我|发消息给我)/
// Global recommendation consent is independent of channel preferences and ordinary chatting.
// Only explicit, first-person, unambiguous messages may toggle it; a vague '别推这些'
// never disables every future recommendation. A later explicit opt-in from the same UID
// can restore recommendation eligibility without clearing the contact history.
const STOP_ALL_RECOMMEND=/(?:以后|今后|往后|从现在起)?\s*(?:别|不要|停止|不用|不想)\s*(?:再|继续|老是)?\s*(?:给我|向我)?\s*(?:推|推荐|发|分享|安利)(?:给我)?\s*(?:任何|所有|全部)?(?:视频|内容|东西)?\s*(?:了|啦|吧)?\s*$/
const RESUME_ALL_RECOMMEND=/(?:以后|现在|下次|接下来)?\s*(?:可以|允许|欢迎|恢复|继续|重新)\s*(?:再)?\s*(?:给我|向我)?\s*(?:推|推荐|发|分享|安利)(?:给我)?(?:视频|内容)?\s*(?:了|啦|吧)?\s*$/
function recommendationConsent(text){
  const sentence=tidy(text,500).split(/[。！？!?；;，,]/).map(x=>x.trim()).filter(Boolean)
  let state=null
  for(const s of sentence){if(STOP_ALL_RECOMMEND.test(s))state='off';else if(RESUME_ALL_RECOMMEND.test(s))state='on'}
  return state
}
const MORE_RECOMMEND=/(?:以后|下次|今后|往后)?\s*(?:给我|向我)?\s*(?:多|再多|多给我|多来|来点)\s*(?:推荐|推|发|分享|安利)(?:给我)?\s*(?:点|些|一些|一点|几条)?\s*(.{2,35})/
export function isFriendRecommendationFeedback(text){
  const textValue=tidy(text,500)
  return /(?:我|本人|咱)(?:现在|最近|这阵子|以前|一直|目前|已经)?/.test(textValue)&&/(?:喜欢|爱看|不喜欢|讨厌|反感)/.test(textValue)
    || NO_RECOMMEND.test(textValue) || MORE_RECOMMEND.test(textValue) || NO_PUBLIC_MENTION.test(textValue) || NO_PRIVATE_DM.test(textValue) || recommendationConsent(textValue)!==null
}
export function explicitInterestStatements(text,{videoTitle=''}={}){
  const input=tidy(text,500);const result=[]
  for(const sentence of input.split(/[。！？!?；;，,]/).slice(0,12)){
    const m=/(?:^|\s)(?:我|本人|咱)(?:现在|最近|这阵子|以前|一直|目前|已经)?\s*(很|超|特别|挺|比较|不再|不|没那么)?\s*(喜欢|爱看|爱吃|感兴趣|讨厌|反感|不喜欢|不爱看|不感兴趣)\s*(.{2,38})/.exec(sentence)
    if(m){const topic=topicOf(m[3].replace(/(?:不过.*|但是.*)$/,''));const neg=/^(?:讨厌|反感|不喜欢|不爱看|不感兴趣)$/.test(m[2])||['不','不再','没那么'].includes(m[1]);
      if(topic)result.push({topic,stance:neg?'dislike':'like',confidence:'explicit-self-report'})}
    const no=NO_RECOMMEND.exec(sentence)
    if(no){const raw=String(no[1]||'').trim();const implicit=/^(?:这些|这种|这类|这个|这个视频|这条|同类|类似)/.test(raw)
      const topic=implicit?videoTopicFromTitle(videoTitle):topicOf(raw)
      if(topic)result.push({topic,stance:'dislike',confidence:implicit?'context-grounded-rejection':'explicit-recommendation-rejection'})}
    const more=MORE_RECOMMEND.exec(sentence)
    if(more){const topic=topicOf(more[1]);if(topic)result.push({topic,stance:'like',confidence:'explicit-recommendation-request'})}
  }
  return result.filter((x,i,a)=>a.findIndex(y=>y.topic===x.topic&&y.stance===x.stance)===i).slice(0,5)
}
export function observeFriendInterest(home,{uid,text,source='dm',eventId='',friendDirectory='',now=Date.now(),bvid='',videoTitle=''}={}){
  const id=String(uid||'')
  if(!uidOk(id)||!trust(friendDirectory).has(id))return {added:0,reason:'not-trusted'}
  if(!['dm','comment'].includes(source)||!String(eventId||'').trim())return {added:0,reason:'invalid-evidence'}
  const statements=explicitInterestStatements(text,{videoTitle});const validVideo=VIDEO.test(String(bvid||''))?String(bvid):''
  const content=tidy(text,500)
  const videoRejection=validVideo&&NO_RECOMMEND.test(content)
  const blockedChannels=[...(NO_PUBLIC_MENTION.test(content)?['mention']:[]),...(NO_PRIVATE_DM.test(content)?['dm']:[])]
  const consent=recommendationConsent(content)
  if(!statements.length&&!videoRejection&&!blockedChannels.length&&!consent)return {added:0,reason:'no-explicit-preference'}
  const obj=read(home),key=source+':'+tidy(eventId,120)
  const existing=new Set(obj.records.map(r=>r.uid+':'+r.key+':'+(r.kind==='avoid-video'?'video:'+r.bvid:'topic:'+r.topic+':'+r.stance)));let added=0
  for(const v of statements){const k=id+':'+key+':topic:'+v.topic+':'+v.stance;if(existing.has(k))continue
    obj.records.push({uid:id,key,source,topic:v.topic,stance:v.stance,signal:v.confidence,at:now});existing.add(k);added++}
  // '别给我推这些' always suppresses this exact video; a broad topic is inferred
  // only when B站-provided title contains an unambiguous category cue.
  if(videoRejection){const k=id+':'+key+':video:'+validVideo;if(!existing.has(k)){
    obj.records.push({uid:id,key,source,kind:'avoid-video',bvid:validVideo,at:now});added++}}
  for(const channel of blockedChannels){
    const k=id+':opt-out:'+channel
    if(existing.has(k))continue
    if(!obj.records.some(r=>r.uid===id&&r.kind==='contact-opt-out'&&r.channel===channel)){
      obj.records.push({uid:id,key,source,kind:'contact-opt-out',channel,at:now});added++
    }
    existing.add(k)
  }
  if(consent){const k=id+':'+key+':consent:'+consent
    if(!existing.has(k)){obj.records.push({uid:id,key,source,kind:'recommendation-consent',enabled:consent==='on',at:now});added++}}
  if(added)save(home,obj)
  return {added}
}
/** Hard invitation guard; the target must be the same whitelist UID. No global taste changes. */
export function friendRecommendationGuard(home,uid,friendDirectory,{bvid='',videoTitle='',now=Date.now(),channel=''}={}){
  const id=String(uid||'');if(!uidOk(id)||!trust(friendDirectory).has(id))return {blocked:false}
  try {
    const rows=read(home).records.filter(r=>r.uid===id)
    const decisions=rows.map((r,i)=>({...r,_i:i})).filter(r=>r.kind==='recommendation-consent').sort((a,b)=>Number(b.at)-Number(a.at)||b._i-a._i)
    if(decisions.length&&decisions[0].enabled===false)return {blocked:true,reason:'friend-globally-unsubscribed'}
    if(rows.some(r=>r.kind==='contact-opt-out'&&(!channel||r.channel===channel)))return {blocked:true,reason:'friend-channel-opt-out'}
    if(VIDEO.test(String(bvid||''))&&rows.some(r=>r.kind==='avoid-video'&&r.bvid===bvid))return {blocked:true,reason:'friend-rejected-video'}
    const theme=videoTopicFromTitle(videoTitle)
    const negative=friendInterestSummary(home,id,friendDirectory,{maxItems:100,now}).filter(r=>r.stance==='dislike'&&r.status!=='cooling')
    if(negative.some(r=>r.topic===theme&&theme || videoTitle&&videoTitle.toLowerCase().includes(r.topic.toLowerCase()) ||
      r.topic.endsWith('视频')&&videoTitle&&videoTitle.toLowerCase().includes(r.topic.slice(0,-2).toLowerCase())))return {blocked:true,reason:'friend-rejected-topic'}
    return {blocked:false}
  } catch {
    // If preference state is corrupt, fail closed for this UID rather than risk repeating a rejected recommendation.
    return {blocked:true,reason:'friend-preference-store-unavailable'}
  }
}
export function friendInterestSummary(home,uid,friendDirectory,{maxItems=5,now=Date.now()}={}){
  const id=String(uid||'');if(!trust(friendDirectory).has(id))return []
  const rows=read(home).records.filter(x=>x.uid===id&&x.kind!=='avoid-video'&&typeof x.topic==='string').slice(-150)
  const groups=new Map()
  for(const r of rows){const k=r.topic;let g=groups.get(k)||{topic:k,support:0,support180:0,stance:r.stance,lastAt:0,firstAt:r.at,evidence:[],stances:[],directRequest:false}
    g.support++;if(now-r.at<=180*86400000&&r.at<=now)g.support180++;if(r.at<g.firstAt)g.firstAt=r.at;if(r.at>=g.lastAt){g.stance=r.stance;g.lastAt=r.at}g.evidence.push(r.source+':'+r.key.slice(0,45));if(r.signal==='explicit-recommendation-request')g.directRequest=true;g.stances.push({stance:r.stance,at:r.at});groups.set(k,g)}
  return [...groups.values()].sort((a,b)=>b.lastAt-a.lastAt).slice(0,maxItems).map(g=>{
    const prior=g.stances.filter(x=>x.at<g.lastAt).sort((a,b)=>b.at-a.at)[0];const changed=!!prior&&prior.stance!==g.stance
    const cooling=now-g.lastAt>90*86400000
    return {topic:g.topic,stance:g.stance,support:g.support,support180:g.support180,directRequest:g.directRequest,lastAt:g.lastAt,firstAt:g.firstAt,status:cooling?'cooling':changed?'changed-recently':g.support180>=2?'observed-repeated':'tentative'}
  })
}
export function learnedFriendContext(home,uid,friendDirectory){
  const items=friendInterestSummary(home,uid,friendDirectory)
  if(!items.length)return ''
  return '【此 UID 的近期自述爱好（只作对话线索；用户填写的初始画像仍保留）】\n'+items.map(x=>
    `- ${x.status==='cooling'?'较久未提及、需重新确认':x.status==='changed-recently'?'最近表达与之前不同':x.status==='tentative'?'一次提到、待确认':'近半年多次提到'}：${x.stance==='like'?'喜欢':'不喜欢'}「${x.topic}」；仅作暂时线索。`).join('\n')+'\n好友现在可能变了，遇到矛盾以新近本人明确自述为参考，不替他下定论；不对外泄露档案。'
}
export function listFriendLearning(home,friendDirectory){
  const allowed=trust(friendDirectory);const records=read(home).records
  return [...allowed].map(uid=>({uid,interests:friendInterestSummary(home,uid,friendDirectory),rejectedVideos:new Set(records.filter(r=>r.uid===uid&&r.kind==='avoid-video').map(r=>r.bvid).filter(Boolean)).size,contactOptOuts:[...new Set(records.filter(r=>r.uid===uid&&r.kind==='contact-opt-out').map(r=>r.channel))],recommendationConsent:(records.map((r,i)=>({...r,_i:i})).filter(r=>r.uid===uid&&r.kind==='recommendation-consent').sort((a,b)=>b.at-a.at||b._i-a._i)[0]?.enabled===false?'off':'on')})).filter(r=>r.interests.length||r.rejectedVideos||r.contactOptOuts.length||r.recommendationConsent==='off')
}
export function clearFriendLearning(home,uid,friendDirectory){
  const id=String(uid||'');if(!trust(friendDirectory).has(id))throw Error('只允许清除当前白名单好友的学习记录')
  const obj=read(home),before=obj.records.length;obj.records=obj.records.filter(r=>r.uid!==id)
  if(obj.records.length!==before)save(home,obj)
  return {removed:before-obj.records.length}
}
