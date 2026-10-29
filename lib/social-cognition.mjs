/** dev.5: social intentions are evidence, never authority. No raw stranger text/UID is persisted. */
import {createHash} from 'node:crypto'
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {normalizeFriendDirectory} from './friend-directory.mjs'
import {parseVideoWishes,wishHardRejection} from './video-wishes.mjs'

const FILE='social-cognition.json', SIZE=240_000, LIMIT=350, DAY=86_400_000
const ID=/^[1-9]\d{0,18}$/, BV=/^BV[0-9A-Za-z]{10}$/
const short=(x,n=90)=>String(x??'').replace(/[\x00-\x1f<>`{}\\]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const digest=x=>createHash('sha256').update(String(x)).digest('hex').slice(0,32)
const initial=()=>({version:1,items:[],lastReviewAt:0})
function read(home){const file=join(home,FILE);if(!existsSync(file))return initial();const st=lstatSync(file)
  if(!st.isFile()||st.isSymbolicLink()||st.size>SIZE)throw Error('社会意愿记录文件不安全')
  const d=JSON.parse(readFileSync(file,'utf8'));if(d?.version!==1||!Array.isArray(d.items))throw Error('社会意愿记录格式异常')
  return {version:1,items:d.items.slice(-LIMIT),lastReviewAt:Number(d.lastReviewAt)||0}}
function save(home,d){mkdirSync(home,{recursive:true});const file=join(home,FILE)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝覆盖社会意愿符号链接')
  d.items=d.items.slice(-LIMIT);const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp'
  writeFileSync(tmp,JSON.stringify(d,null,2)+'\n',{mode:0o600});renameSync(tmp,file)}
export function parseFriendWatchInvitation(text,{bvid='',source='dm'}={}){
  const s=short(text,480)
  // Mere sharing of a BV or a preference is not an invitation to inspect a video.
  if(!/(?:有空|有时间|闲了|什么时候|哪天|抽空|可以|能不能|想让你|希望你|帮我).{0,28}(?:看看|看一下|看一眼|了解|浏览|瞧瞧)|(?:看看|看一下|瞧瞧).{0,24}(?:这个|这条|视频|BV)/.test(s))return ''
  if(/(?:不要|别|取消|停止).{0,12}(?:看|浏览|查看)/.test(s))return ''
  const fromText=s.match(/BV[0-9A-Za-z]{10}/)?.[0]||''
  // In a public @, "this video" means the platform verified video, not a BV injected into text.
  if(source==='comment')return BV.test(bvid)?bvid:''
  return BV.test(fromText)?fromText:''
}
export function createSocialCognition({dataDir,getConfig=()=>({}),getEmotion=()=>({}),inspectVideo=async()=>({ok:false}),now=Date.now,logger=console}={}){
  if(!dataDir)throw TypeError('dataDir required')
  let busy=false
  const expire=d=>{for(const x of d.items)if(x.status==='candidate'&&x.expiresAt<=now())x.status='expired'}
  function trusted(uid,cfg){try{return JSON.parse(normalizeFriendDirectory(cfg.friendDirectory||'[]')).find(x=>x.uid===uid)}catch{return null}}
  function observe({uid,text,source='dm',eventId='',timestampMs=now(),bvid=''}={}){
    const cfg=getConfig(),actor=String(uid||'')
    if(!ID.test(actor)||!['dm','comment'].includes(source)||!short(eventId,150))return {ok:false,reason:'invalid-evidence'}
    const ts=Number(timestampMs)
    if(!Number.isSafeInteger(ts)||ts>now()+60_000||ts<now()-DAY)return {ok:false,reason:'stale-evidence'}
    const owner=String(cfg.dmOwnerUid||'')===actor
    if(owner)return {ok:true,skipped:'owner-managed-separately'}
    const f=trusted(actor,cfg)
    const kind=f?'friend-invitation':'stranger-inspiration'
    if(kind==='stranger-inspiration'&&(source!=='dm'||cfg.strangerInspirationEnabled!==true))return {ok:true,skipped:'not-eligible'}
    if(kind==='friend-invitation'&&cfg.socialInvitationEnabled!==true)return {ok:true,skipped:'disabled'}
    if(kind==='friend-invitation'&&source==='comment'&&f.atInvite!==true)return {ok:true,skipped:'at-not-authorized'}
    const target=kind==='friend-invitation'?parseFriendWatchInvitation(text,{source,bvid}):''
    const wish=kind==='stranger-inspiration'?parseVideoWishes(text):null
    if(kind==='friend-invitation'&&!target)return {ok:true,skipped:'not-a-watch-invitation'}
    if(kind==='stranger-inspiration'&&(!wish?.topics?.length||wishHardRejection(text)))return {ok:true,skipped:'not-a-safe-inspiration'}
    const d=read(dataDir);expire(d)
    const key=digest(source+':'+actor+':'+short(eventId,150))
    if(d.items.some(x=>x.key===key))return {ok:true,skipped:'duplicate'}
    // Small limits by day and by source, including rejected/expired; no nonfriend profile.
    if(kind==='stranger-inspiration'){
      const from=digest(actor),today=d.items.filter(x=>x.kind===kind&&x.at>now()-DAY)
      if(today.length>=35||today.filter(x=>x.from===from).length>=2)return {ok:true,skipped:'inspiration-quota'}
    }
    if(kind==='friend-invitation'&&d.items.some(x=>x.kind===kind&&x.uid===actor&&x.bvid===target&&x.status==='candidate'))return {ok:true,skipped:'already-invited'}
    const row={key,kind,status:'candidate',at:ts,expiresAt:ts+(kind==='stranger-inspiration'?7:14)*DAY,source}
    if(kind==='friend-invitation'){row.uid=actor;row.bvid=target}
    else {row.from=digest(actor);row.topics=wish.topics.slice(0,3)}
    d.items.push(row);save(dataDir,d)
    return {ok:true,created:true,kind}
  }
  function inspirationKeywords(){const d=read(dataDir),topics=[];for(const x of d.items){if(x.kind==='stranger-inspiration'&&x.status==='candidate'&&x.expiresAt>now())for(const t of x.topics||[])if(!topics.includes(t))topics.push(t)}
    return topics.slice(0,2)}
  function status(){const d=read(dataDir);expire(d);return {ok:true,items:d.items.slice(-75).reverse().map(x=>({...x,from:undefined,key:undefined})),lastReviewAt:d.lastReviewAt,inspirations:inspirationKeywords()}}
  async function tick({dryRun=false}={}){
    if(busy)return {ok:false,reason:'busy'}
    const cfg=getConfig()
    if(cfg.masterEnabled!==true||cfg.socialInvitationEnabled!==true)return {ok:true,skipped:'disabled'}
    if(!dryRun&&cfg.socialInvitationAutoInspectEnabled!==true)return {ok:true,skipped:'manual-only'}
    const d=read(dataDir);expire(d)
    if(now()-d.lastReviewAt<4*3_600_000)return {ok:true,skipped:'cooldown'}
    const emotion=getEmotion()||{},curiosity=Number(emotion.curiosity)||0,energy=Number(emotion.energy)||0
    const ready=emotion.enabled!==false&&curiosity>=70&&energy>=35
    const list=d.items.filter(x=>x.kind==='friend-invitation'&&x.status==='candidate'&&x.expiresAt>now()&&trusted(x.uid,cfg))
      .sort((a,b)=>b.at-a.at)
    if(!list.length)return {ok:true,skipped:'no-candidates'}
    if(!ready)return {ok:true,skipped:'not-curious',curiosity,energy}
    // Candidate remains a read-only invitation; never create an owner task or send a message.
    const pick=list[0]
    if(dryRun)return {ok:true,candidate:{bvid:pick.bvid,uid:pick.uid},curiosity,energy}
    busy=true
    try{
      pick.status='inspecting';pick.inspectAt=now();d.lastReviewAt=now();save(dataDir,d) // durable claim before reading
      let r;try{r=await inspectVideo(pick.bvid)}catch(e){r={ok:false,error:String(e?.message||e).slice(0,100)}}
      const latest=read(dataDir),current=latest.items.find(x=>x.key===pick.key)
      if(current){current.status=r?.ok===true?'inspected-metadata':'inspect-failed';current.result=short(r?.error||r?.result?.summary||'只读查看完成（不代表完整播放）',100)}
      save(dataDir,latest);return {ok:r?.ok===true,status:current?.status||'uncertain',bvid:pick.bvid}
    }finally{busy=false}
  }
  return {observe,inspirationKeywords,status,tick}
}
