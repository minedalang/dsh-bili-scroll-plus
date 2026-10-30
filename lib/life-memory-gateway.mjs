/**
 * Two-layer life memory. Archive is write-only for the runtime; everyday recall
 * consumes ONLY an independently persisted, destructively fading episodic copy.
 * Archive reads are intentionally absent from the returned API. Owner backup is
 * handled by the separate, explicitly confirmed administrative backup module.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,appendFileSync,readdirSync} from 'node:fs'
import {join,dirname} from 'node:path'
import {createHash} from 'node:crypto'

const DAY=86400000, MAX_EPISODES=3200, MAX_FILE=8*1024*1024
const clean=(v,n=260)=>String(v??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const hash=v=>createHash('sha256').update(String(v)).digest('hex').slice(0,18)
const validBV=v=>/^BV[A-Za-z0-9]{10}$/.test(String(v||''))
const tokens=v=>{const s=clean(v,1500).toLowerCase(),out=new Set(),ws=s.match(/[a-z0-9]{2,}|[\u3400-\u9fff]+/g)||[];for(const w of ws)if(/[\u3400-\u9fff]/.test(w)){for(let i=0;i<w.length;i++)for(let n=2;n<=3&&i+n<=w.length;n++)out.add(w.slice(i,i+n))}else out.add(w);return out}
const atom=(file)=>{if(!existsSync(file))return null;const s=lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.size>MAX_FILE)throw Error('可衰减记忆数据不安全或过大');return JSON.parse(readFileSync(file,'utf8'))}
const save=(file,value)=>{mkdirSync(dirname(file),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝通过符号链接写记忆');const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp';writeFileSync(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});renameSync(tmp,file)}
const timeOf=e=>{const raw=e.time||e.day||e.at||e.createdAt;const t=typeof raw==='number'?raw:Date.parse(String(raw||''));return Number.isFinite(t)&&t>946684800000?t:Date.now()}
const keyOf=e=>clean(e.key||(e.kind==='watch'?`watch:${e.day||e.time}:${e.bvid}`:`comment:${e.bvid}:${e.rpid||e.root||e.time||e.text||e.snippet}`),220)
function asEpisode(e,clock){if(!e||!['watch','comment','social'].includes(e.kind)||!validBV(e.bvid))return null
 const key=keyOf(e),at=Math.min(clock,timeOf(e)),id='e-'+hash(key)
 const title=clean(e.title,140),phrase=clean(e.text||e.snippet,240),name=clean(e.recipientName,50)
 const clear=e.kind==='watch'?`我曾经选中视频《${title||e.bvid}》${e.note?'；当时想法是'+clean(e.note,120):''}`:e.kind==='social'?`我曾经在评论区与一位观众交谈，对方当时说“${phrase}”`:`我在一条视频下${e.reply?'回复过评论':'发表过评论'}${name?'，对方叫'+name:''}${phrase?'；我当时写了“'+phrase+'”':''}`
 const fuzzy=e.kind==='watch'?`我以前刷到过关于「${clean(title,36)||'某个话题'}」的视频`:e.kind==='social'?'我似乎曾在评论区与一位观众聊过天':`我以前在评论区有过一次交流${name?'，似乎与'+name+'有关':''}`
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
 function recall({query='',domain='main-session',role='owner',actorUid='',kinds=null,maxItems=8,maxChars=900,reinforce=false}={}){
  const {data}=decay(),q=tokens(query),isPublic=domain!=='main-session';let rows=[]
  const minEvidence=Math.max(.10,Math.min(.80,Number(getConfig()?.mainSessionMemoryThreshold)||.25))
  const allowedKinds=Array.isArray(kinds)?new Set(kinds.filter(k=>['watch','comment','social'].includes(k))):null
  for(const e of data.episodes){if(e.stage==='forgotten'||!e.text||(allowedKinds&&!allowedKinds.has(e.kind)))continue
   // Public messages may only use their own verified joint episodes; no guessing identity from nickname.
   if(isPublic&&(role==='stranger'||!actorUid||e.stage!=='clear'||e.actorUid!==String(actorUid)||e.kind!=='social'))continue
   const term=tokens(e.text),hits=[...q].filter(k=>term.has(k)).length,score=q.size?hits/Math.sqrt(q.size*Math.max(1,term.size)):0
   // A real, still-clear episode must be findable by its exact BV, even when
   // the natural-language summary does not contain the identifier. Fuzzy and
   // trace memories have already had the BV deleted and may not recover it.
   const needle=clean(query,180).toLowerCase().replace(/\s+/g,'')
   const literal=e.stage==='clear'&&needle.length>=2&&(
     (validBV(e.bvid)&&needle===e.bvid.toLowerCase())||
     clean(e.text,400).toLowerCase().replace(/\s+/g,'').includes(needle))
   const evidence=literal?1:score
   // Verified returning friends may naturally remember recent encounters even when
   // the new greeting shares no literal words with the previous conversation.
   const familiarRecently=isPublic&&role!=='stranger'&&e.kind==='social'&&e.actorUid===String(actorUid)&&now()-e.at<=7*DAY
   if(q.size&&evidence<minEvidence&&!familiarRecently)continue
   const age=Math.max(0,now()-e.at)/DAY,recency=1/(1+age/halfLife())
   rows.push({e,score:evidence*.72+recency*.2+e.importance*.08})
  }
  // Browsing recent life without a query is chronological; keyword search
  // remains relevance-ranked. A busy comment day must not dominate simply
  // because comment episodes carry slightly higher importance.
  rows.sort((a,b)=>q.size?(b.score-a.score||b.e.at-a.e.at):(b.e.at-a.e.at||b.score-a.score))
  const take=[],cap=Math.max(100,Math.min(3000,Number(maxChars)||900))
  for(const {e} of rows){if(take.length>=Math.max(1,Math.min(12,Number(maxItems)||8)))break;const text=clean(e.text,330);if(take.reduce((n,x)=>n+x.summary.length,0)+text.length>cap)continue;take.push({id:e.id,stage:e.stage,summary:text,at:e.stage==='clear'?new Date(e.at).toISOString():'',kind:e.kind,...(e.stage==='clear'&&e.kind==='watch'&&validBV(e.bvid)?{bvid:e.bvid}:{})})}
  if(reinforce&&take.length){let dirty=false;for(const chosen of take){const e=data.episodes.find(x=>x.id===chosen.id);if(e&&now()-(e.lastRecallAt||0)>DAY){e.lastRecallAt=now();e.reinforcedAt=now();e.reinforceCount=Math.min(20,(e.reinforceCount||0)+1);dirty=true}}if(dirty)save(file,data)}
  return take
 }
 function reflectionEvidence(ids){const {data}=decay();return ids.map(key=>{const e=data.episodes.find(x=>x.id==='e-'+hash(key)||x.key===key||x.id===key);return e?.stage==='forgotten'||!e?.text?null:{key,id:e.id,kind:e.kind,stage:e.stage,text:e.text,at:e.at}}).filter(Boolean)}
 function publicVideoEvidence(limit=20){return decay().data.episodes.filter(e=>e.kind==='watch'&&e.stage==='clear'&&e.bvid&&e.text).slice(-Math.max(1,Math.min(40,limit))).reverse().map(e=>({bvid:e.bvid,day:new Date(e.at).toISOString().slice(0,10),title:(e.text.match(/《([^》]+)》/)||[])[1]||'',experience:e.text}))}

 function status(){const {data}=decay(),counts=Object.fromEntries(stages.map(s=>[s,data.episodes.filter(e=>e.stage===s).length]));let months=0;try{months=readdirSync(join(dataDir,'life-memory','archive')).filter(x=>/^\d{4}-\d{2}\.jsonl$/.test(x)).length}catch{}return {ok:true,counts,total:data.episodes.length,archiveEvents:data.archiveKeys.length,archiveMonths:months,migrated:data.migrated,halfLifeDays:halfLife()}}
 return {recordEvents,recall,reflectionEvidence,publicVideoEvidence,decay,status,file}
}
export const __test={asEpisode,fadeEpisode,desiredStage,keyOf}
