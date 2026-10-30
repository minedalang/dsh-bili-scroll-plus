/**
 * Two-layer life memory. Archive is write-only for the runtime; everyday recall
 * consumes ONLY an independently persisted, destructively fading episodic copy.
 * Archive reads are intentionally absent from the returned API. Owner backup is
 * handled by the separate, explicitly confirmed administrative backup module.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,appendFileSync,readdirSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {createHash} from 'node:crypto'
import {createHybridIndex} from './hybrid-memory-search.mjs'

const DAY=86400000, MAX_EPISODES=3200, MAX_FILE=8*1024*1024
const clean=(v,n=260)=>String(v??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const hash=v=>createHash('sha256').update(String(v)).digest('hex').slice(0,18)
const validBV=v=>/^BV[A-Za-z0-9]{10}$/.test(String(v||''))
const validUid=v=>/^[1-9]\d{0,19}$/.test(String(v||''))
const validRpid=v=>/^[1-9]\d{0,29}$/.test(String(v||''))
const tokens=v=>{const s=clean(v,1500).toLowerCase(),out=new Set(),ws=s.match(/[a-z0-9]{2,}|[\u3400-\u9fff]+/g)||[];for(const w of ws)if(/[\u3400-\u9fff]/.test(w)){for(let i=0;i<w.length;i++)for(let n=2;n<=3&&i+n<=w.length;n++)out.add(w.slice(i,i+n))}else out.add(w);return out}
const atom=(file)=>{if(!existsSync(file))return null;const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_FILE)throw Error('可衰减记忆数据不安全或过大');return JSON.parse(readFileSync(file,'utf8'))}
const save=(file,value)=>{mkdirSync(dirname(file),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝通过符号链接写记忆');const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp';writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(tmp,file)}
const timeOf=e=>{const raw=e.time||e.day||e.at||e.createdAt;const t=typeof raw==='number'?raw:Date.parse(String(raw||''));return Number.isFinite(t)&&t>946684800000?t:Date.now()}
const keyOf=e=>clean(e.key||(e.kind==='watch'?`watch:${e.day||e.time}:${e.bvid}`:`comment:${e.bvid}:${e.rpid||e.root||e.time||e.text||e.snippet}`),220)
function asEpisode(e,clock){if(!e||!['watch','comment','social'].includes(e.kind)||!validBV(e.bvid))return null
 const key=keyOf(e),at=Math.min(clock,timeOf(e)),id='e-'+hash(key)
 const title=clean(e.title,140),phrase=clean(e.text||e.snippet,240),name=clean(e.recipientName,50)
 const clear=e.kind==='watch'?`我曾经选中视频《${title||e.bvid}》${e.note?'；当时想法是'+clean(e.note,120):''}`:e.kind==='social'?`我曾经在评论区与一位观众交谈，对方当时说“${phrase}”`:`我在一条视频下${e.reply?'回复过评论':'发表过评论'}${name?'，对方叫'+name:''}${phrase?'；我当时写了“'+phrase+'”':''}`
 const fuzzy=e.kind==='watch'?`我以前刷到过一段视频，对「${clean(title.replace(/BV[A-Za-z0-9]{10}/g,'').replace(/\d{4,}/g,''),12)||'某个话题'}」还有些印象`:e.kind==='social'?'我似乎曾在评论区与一位观众聊过天':`我以前在评论区有过一次交流，但具体和谁聊的记不太清了`
 const trace=e.kind==='watch'?'我隐约记得看过一段曾引起我注意的视频':'我隐约记得曾在评论区与人交流过'
 const importance=e.kind==='comment'?0.54:e.kind==='social'?0.58:0.38
 return {id,key,kind:e.kind,at,stage:'clear',text:clear,fuzzy,trace,bvid:clean(e.bvid,20),actorUid:clean(e.actorUid||e.uid,24),importance,reinforcedAt:at,reinforceCount:0,lastRecallAt:0,visibility:'public-event'}
}
function desiredStage(e,now,halfLife){const age=Math.max(0,now-Math.max(e.at,Number(e.reinforcedAt)||e.at))/DAY,importance=Number(e.importance)||0.4
 const h=halfLife*(0.6+importance*1.35)*Math.min(1.45,1+0.06*(Number(e.reinforceCount)||0))
 return age<h*.6?'clear':age<h*1.35?'fuzzy':age<h*2.6?'trace':'forgotten'
}
const stages=['clear','fuzzy','trace','forgotten']
function fadeEpisode(e,stage){if(stages.indexOf(stage)<=stages.indexOf(e.stage))return false
 if(stage==='fuzzy'){e.text=e.fuzzy;delete e.fuzzy;delete e.bvid;delete e.actorUid;delete e.key}
 if(stage==='trace'){e.text=e.trace;delete e.fuzzy;delete e.bvid;delete e.actorUid;delete e.key}
 if(stage==='forgotten'){e.text='';delete e.fuzzy;delete e.trace;delete e.key;delete e.bvid;delete e.actorUid}
 e.stage=stage;return true
}
export function createLifeMemoryGateway({dataDir,getConfig=()=>({}),now=Date.now,logger=console}={}){
 if(!dataDir)throw TypeError('missing dataDir')
 const file=join(dataDir,'life-memory','episodic.json')
 // In-memory, rebuildable only from the live fading copy; never index archives.
 const hybrid=createHybridIndex({logger})
 const searchLive=data=>{const signature=createHash('sha256').update(JSON.stringify(data.episodes)).digest('hex');hybrid.rebuild(data.episodes.filter(e=>e.stage!=='forgotten'&&e.text).map(e=>({id:e.id,text:e.text,exactId:e.stage==='clear'?e.bvid:'',nearTitle:e.stage==='clear'&&e.kind==='watch'?(e.text.match(/《([^》]+)》/)||[])[1]||'':'',exactDateEligible:e.stage==='clear',at:e.at,importance:e.importance})),signature);return hybrid}
 const empty=()=>({version:1,episodes:[],archiveKeys:[],migrated:false,updatedAt:0})
 if(!existsSync(file))save(file,empty())
 const read=()=>{const x=atom(file);if(!x)return empty();if(x.version!==1||!Array.isArray(x.episodes)||!Array.isArray(x.archiveKeys))throw Error('可衰减记忆版本不兼容');return x}
 const halfLife=()=>Math.max(15,Math.min(120,Number(getConfig()?.mainSessionMemoryHalfLifeDays)||30))
 function decay(){const data=read(),t=now();let changed=0;for(const e of data.episodes)if(fadeEpisode(e,desiredStage(e,t,halfLife())))changed++
  if(changed){data.updatedAt=t;save(file,data)}return {changed,data}}
 function archive(e,id){const month=new Date(Math.min(now(),timeOf(e))).toISOString().slice(0,7),folder=join(dataDir,'life-memory','archive'),target=join(folder,month+'.jsonl');mkdirSync(folder,{recursive:true});if(existsSync(target)&&lstatSync(target).isSymbolicLink())throw Error('永久档案路径不可为符号链接');appendFileSync(target,JSON.stringify({version:1,id,recordedAt:new Date(now()).toISOString(),event:e})+'\n',{mode:0o600})}
 function recordEvents(events=[],{migration=false}={}){
  const data=read(),known=new Set(data.archiveKeys),episodes=new Set(data.episodes.map(x=>x.id)),clock=now();let added=0
  for(const e of events){const x=asEpisode(e,clock);if(!x||known.has(x.id))continue
   // Archive append precedes index update, so an IO failure never marks an event archived.
   archive(e,x.id);known.add(x.id)
   fadeEpisode(x,desiredStage(x,clock,halfLife()))
   if(!episodes.has(x.id)){data.episodes.push(x);episodes.add(x.id);added++}
  }
  if(added||known.size!==data.archiveKeys.length||migration){data.archiveKeys=[...known].slice(-30000);data.episodes=data.episodes.slice(-MAX_EPISODES);data.migrated=data.migrated||migration;data.updatedAt=clock;save(file,data)}
  return {added,total:data.episodes.length}
 }
 // No unbounded/unrestricted archive lookup here: all callers see the faded copy.
 // Only a confirmed outbound public reply enriches the matching incoming episode.
 // The archive stores the reply event separately; no erased episode is revived.
 function recordSocialReply({actorUid='',bvid='',incomingRpid='',text='',at=now()}={}){
  const uid=String(actorUid),rpid=String(incomingRpid),reply=clean(text,130)
  if(!validUid(uid)||!validBV(bvid)||!validRpid(rpid)||!reply)return {ok:false,reason:'invalid-social-reply'}
  const data=decay().data,originalKey=`social:${uid}:${bvid}:${rpid}`
  const episode=data.episodes.find(e=>e.id==='e-'+hash(originalKey)&&e.stage==='clear'&&e.kind==='social'&&e.actorUid===uid)
  if(!episode)return {ok:false,reason:'original-episode-unavailable'}
  const replyKey=`social-reply:${uid}:${bvid}:${rpid}`,replyId='e-'+hash(replyKey)
  if(data.archiveKeys.includes(replyId))return {ok:true,duplicate:true}
  const event={kind:'social-reply',key:replyKey,bvid,actorUid:uid,incomingRpid:rpid,text:reply,at}
  archive(event,replyId)
  data.archiveKeys.push(replyId);data.archiveKeys=data.archiveKeys.slice(-30000)
  // Preserve the encounter and fish's actual reply, but do not create a new
  // independent recalled episode or prolong its natural lifespan.
  const original=episode.text.replace(/(对方当时说“)([^”]+)(”)/,(_all,head,body,end)=>head+clean(body,115)+end)
  episode.text=original+`；我当时回复“${reply}”`
  data.updatedAt=now();save(file,data)
  return {ok:true}
 }
 function accessible(data,{domain='main-session',role='owner',actorUid='',kinds=null,excludeEventKey=''}={}){
  const publicScene=domain!=='main-session'
  const explore=domain==='bili-explore'
  const uid=publicScene&&!explore&&validUid(actorUid)?String(actorUid):''
  if(publicScene&&!explore&&(!uid||!['owner','friend','stranger'].includes(role)))return []
  if(publicScene&&!explore&&domain!=='bili-life')return []
  const allowedKinds=Array.isArray(kinds)?new Set(kinds.filter(k=>['watch','comment','social'].includes(k))):null
  const excludedId=excludeEventKey?'e-'+hash(clean(excludeEventKey,220)):''
  return data.episodes.filter(e=>e.stage!=='forgotten'&&e.text&&e.id!==excludedId&&(!allowedKinds||allowedKinds.has(e.kind))&&
    (!publicScene||(explore?e.kind==='watch':(e.kind==='social'&&e.stage==='clear'&&e.actorUid===uid))))
 }
 function recall({query='',domain='main-session',role='owner',actorUid='',kinds=null,maxItems=8,maxChars=900,reinforce=false,excludeEventKey=''}={}){
  const {data}=decay(),t=now(),allowed=accessible(data,{domain,role,actorUid,kinds,excludeEventKey})
  const q=tokens(query),isPublic=domain!=='main-session',ids=new Set(allowed.map(e=>e.id))
  const minEvidence=Math.max(.10,Math.min(.80,Number(getConfig()?.mainSessionMemoryThreshold)||.25))
  const lookup=new Map(allowed.map(e=>[e.id,e]))
  // Privacy, UID and forgetting gates precede ALL lexical/FTS/time routes.
  // Never pass archive text or a removed clear detail into the index.
  const index=searchLive(data)
  const ranked=index.search(query,{now:t,limit:Math.min(MAX_EPISODES,Math.max(160,Number(maxItems)*18)),filter:r=>ids.has(r.id)})
  const results=[]
  for(const item of ranked){
   const e=lookup.get(item.id);if(!e)continue
   const familiarRecently=isPublic&&e.kind==='social'&&e.actorUid===String(actorUid)&&t-e.at<=7*DAY
   if(q.size&&item.evidence<minEvidence&&!familiarRecently)continue
   results.push(e)
  }
  const take=[],cap=Math.max(100,Math.min(3000,Number(maxChars)||900));let used=0
  for(const e of results){if(take.length>=Math.max(1,Math.min(12,Number(maxItems)||8)))break
   const text=clean(e.text,330);if(used+text.length>cap)continue;used+=text.length
   take.push({id:e.id,stage:e.stage,summary:text,at:e.stage==='clear'?new Date(e.at).toISOString():'',kind:e.kind,...(e.stage==='clear'&&e.kind==='watch'&&validBV(e.bvid)?{bvid:e.bvid}:{})})
  }
  if(reinforce&&take.length){let dirty=false;for(const chosen of take){const e=data.episodes.find(x=>x.id===chosen.id);if(e&&t-(e.lastRecallAt||0)>DAY){e.lastRecallAt=t;e.reinforcedAt=t;e.reinforceCount=Math.min(20,(e.reinforceCount||0)+1);dirty=true}}if(dirty)save(file,data)}
  return take
 }
 function semanticCandidates({query='',domain='main-session',role='owner',actorUid='',limit=48,ids=null,excludeEventKey=''}={}){
  const {data}=decay(),t=now(),allowed=accessible(data,{domain,role,actorUid,excludeEventKey})
  const selectedIds=Array.isArray(ids)?new Set(ids.filter(x=>typeof x==='string')):null
  const map=x=>({id:x.id,kind:x.kind,stage:x.stage,summary:clean(x.text,330),importance:x.importance||0,at:x.stage==='clear'?new Date(x.at).toISOString():'',...(x.stage==='clear'&&x.kind==='watch'&&validBV(x.bvid)?{bvid:x.bvid}:{})})
  // Revalidation by ID is not re-ranked. Deleted, forgotten or unauthorized
  // candidates cannot survive an asynchronous AI call.
  if(selectedIds)return allowed.filter(e=>selectedIds.has(e.id)).map(map)
  const cap=Math.max(1,Math.min(80,Math.floor(Number(limit)||48)))
  const lookup=new Map(allowed.map(e=>[e.id,e])),index=searchLive(data)
  const ranked=index.search(query,{now:t,limit:Math.min(MAX_EPISODES,Math.max(cap*3,160)),filter:e=>lookup.has(e.id)})
  const relevant=ranked.filter(x=>x.evidence>0).slice(0,Math.ceil(cap*.65)).map(x=>lookup.get(x.id))
  const selected=[...relevant],used=new Set(selected.map(e=>e.id))
  // Mix distinct event types in the backoff pool. A giant comment thread
  // cannot crowd all remembered videos and relationships out of AI's shortlist.
  const remaining=allowed.filter(e=>!used.has(e.id)).sort((a,b)=>b.at-a.at||b.importance-a.importance)
  while(selected.length<cap&&remaining.length){let progress=false
   for(const kind of ['watch','social','comment']){const i=remaining.findIndex(e=>e.kind===kind);if(i<0)continue
    selected.push(remaining.splice(i,1)[0]);progress=true;if(selected.length>=cap)break
   }if(!progress)break
  }
  return selected.map(map)
 }
 function reflectionEvidence(ids){const {data}=decay();return ids.map(key=>{const e=data.episodes.find(x=>x.id==='e-'+hash(key)||x.key===key||x.id===key);return e?.stage==='forgotten'||!e?.text?null:{key,id:e.id,kind:e.kind,stage:e.stage,text:e.text,at:e.at,...(e.stage==='clear'?{bvid:e.bvid||''}:{})}}).filter(Boolean)}
 // Source candidate IDs are used as *pointers only*. Returned facts come from the
 // live, faded copy. Precise BV/date/title disappear when a memory becomes fuzzy.
 function emotionEvidence(candidateRows=[]){
  const rows=Array.isArray(candidateRows)?candidateRows:[]
  const current=new Map(reflectionEvidence(rows.map(x=>x.key)).filter(x=>x.stage==='clear'&&x.bvid).map(x=>[x.key,x]))
  return rows.flatMap(c=>{
   const e=current.get(c.key)
   if(!e||!['watch','comment'].includes(e.kind)||e.kind!==c.kind)return []
   return [{id:c.id,kind:e.kind,bvid:e.bvid,day:new Date(e.at).toISOString().slice(0,10),
    title:e.kind==='watch'?(e.text.match(/《([^》]+)》/)||[])[1]||'':''}]
  })
 }
 // Only live, clear copies: an emotional association must never rebuild
 // details from the permanent archive or from the reflection candidate file.
 function recentEmotionEvents(limit=80){
  const t=now(),cap=Math.max(1,Math.min(160,Math.floor(Number(limit)||80)))
  return decay().data.episodes.filter(e=>e.stage==='clear'&&['watch','comment'].includes(e.kind)&&validBV(e.bvid)&&e.at<=t&&t-e.at<=30*DAY)
   .sort((a,b)=>b.at-a.at).slice(0,cap).map(e=>({kind:e.kind,bvid:e.bvid,day:new Date(e.at).toISOString().slice(0,10),
    title:e.kind==='watch'?(e.text.match(/《([^》]+)》/)||[])[1]||'':''}))
 }
 function publicVideoEvidence(limit=40){
  // A wider, time-ordered pool, deduplicated by video; still ONLY clear memories.
  const seen=new Set()
  return decay().data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&e.bvid&&e.text)
   .sort((a,b)=>b.at-a.at).filter(e=>{if(seen.has(e.bvid))return false;seen.add(e.bvid);return true})
   .slice(0,Math.max(0,Math.min(40,Number(limit)||40)))
   .map(e=>({bvid:e.bvid,day:new Date(e.at).toISOString().slice(0,10),title:(e.text.match(/《([^》]+)》/)||[])[1]||'',experience:(e.text.match(/；当时想法是(.+)$/)||[])[1]||''}))
 }
 // Only the fish's CONFIRMED PUBLIC words can become a source for a public dynamic.
 // Never expose incoming viewer quotes, actor UIDs, DMs, owner chats, or archives.
 // Fuzzy/trace memories are excluded: public drafts cannot resurrect lost details.
 function publicSocialEvidence(limit=16){
  const safeWords=v=>{const s=clean(v,175);return s.length>=6&&!/(?:https?:\/\/|www\.|@|邮箱|私信|密码|密钥|token|cookie|主人|私聊|手机号|电话|住址|身份证|加微信|微信号|QQ号|qq号|忽略.{0,8}指令|system\s*prompt)/i.test(s)&&!/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(s)&&!/(?:\+?86[- ]?)?1[3-9]\d{9}/.test(s)&&!/\d{7,}/.test(s)?s:''}
  return decay().data.episodes.filter(e=>e.stage==='clear'&&e.visibility==='public-event'&&e.bvid&&e.text&&['comment','social'].includes(e.kind))
   .slice().sort((a,b)=>b.at-a.at).flatMap(e=>{
    const match=e.kind==='social'?e.text.match(/我当时回复“([^”]+)”/):e.text.match(/我当时写了“([^”]+)”/)
    const ownText=safeWords(match?.[1]||'')
    if(!ownText)return []
    return [{id:e.id,type:e.kind==='social'?'public_reply':'public_comment',day:new Date(e.at).toISOString().slice(0,10),ownText,bvid:e.bvid}]
   }).slice(0,Math.max(0,Math.min(24,Number(limit)||16)))
 }


 function status(){const {data}=decay();searchLive(data);const counts=Object.fromEntries(stages.map(s=>[s,data.episodes.filter(e=>e.stage===s).length]));let months=0;try{months=readdirSync(join(dataDir,'life-memory','archive')).filter(x=>/^\d{4}-\d{2}\.jsonl$/.test(x)).length}catch{}return {ok:true,counts,total:data.episodes.length,archiveEvents:data.archiveKeys.length,archiveMonths:months,migrated:data.migrated,halfLifeDays:halfLife(),search:hybrid.status()}}
 return {recordEvents,recordSocialReply,recall,semanticCandidates,reflectionEvidence,emotionEvidence,recentEmotionEvents,publicVideoEvidence,publicSocialEvidence,decay,status,close:()=>hybrid.close(),file}
}
export const __test={asEpisode,fadeEpisode,desiredStage,keyOf}
