import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {normalizeFriendDirectory,directoryToLegacy} from '../lib/friend-directory.mjs'
import {createInteractionScheduler} from '../lib/interaction-scheduler.mjs'
import {createCommentInteract} from '../lib/comment-interact.mjs'
import {observeFriendInterest,friendInterestSummary,friendRecommendationGuard,listFriendLearning} from '../lib/friend-learning.mjs'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'

const BV='BV1zznd61EbU'
const rows=[{uid:'12345',name:'私信好友',dm:true,mention:false,atInvite:true},
  {uid:'67890',name:'@好友',dm:false,mention:true,atInvite:true},
  {uid:'34567',name:'静默好友',dm:true,mention:false,atInvite:true,recommend:'off'}]

test('旧好友数据升级：不重复 UID，不擅自新增 @ 或私信权限；每位好友的推荐渠道可单独配置',()=>{
 const norm=JSON.parse(normalizeFriendDirectory([...rows,rows[0],{uid:'abc',dm:true}]))
 assert.equal(norm.length,3)
 assert.equal(norm[0].recommend,'dm')
 assert.equal(norm[1].recommend,'mention')
 assert.equal(norm[2].recommend,'off')
 assert.equal(norm[2].dm,true) // off does not revoke passive DM authorization
 assert.deepEqual(directoryToLegacy(norm),{mentionTargets:'67890|@好友',dmWhitelist:'12345|私信好友\n34567|静默好友',commentAtWhitelist:'12345|私信好友\n67890|@好友\n34567|静默好友'})
 const explicit=JSON.parse(normalizeFriendDirectory([{uid:'12345',name:'',dm:true,mention:true,recommend:'dm',atInvite:false}]))[0]
 assert.equal(explicit.mention,false) // stored channel wins over legacy mention flag
 assert.equal(directoryToLegacy([explicit]).mentionTargets,'')
})

test('好友 @ 意愿轮询可以独立于公开回复权限运行，且仍受总开关控制',async()=>{
 let polls=0, sent=0
 const cfg={masterEnabled:true,commentAtEnabled:false,friendAtFeedbackEnabled:true,dmWatch:false,commentWatchReplies:false,commentAtWatchMinutes:1}
 const engine=createInteractionScheduler({dm:{poll:()=>({})},comments:{poll:()=>{polls++;return {sent:0}}},getConfig:()=>cfg,now:()=>1000000})
 engine.start()
 await new Promise(r=>setTimeout(r,15))
 const status=engine.status()
 assert.equal(status.checks.mentions.enabled,true)
 assert.equal(status.checks.replies.enabled,false)
 assert.equal(polls,1)
 engine.stop()
 cfg.masterEnabled=false
 assert.equal(engine.status().checks.mentions.enabled,false)
})

test('只读收取朋友 @ 的明确偏好，首次只建基线，后续不调用模型、不发公开评论',async()=>{
 const home=mkdtempSync(join(tmpdir(),'dafeiyu-unified-at-'))
 const now=Date.now()
 let generated=0,sent=0,seen=0
 const at=(rpid,text)=>({
   id:rpid,at_time:Math.floor(now/1000),user:{mid:'12345',nickname:'好友'},
   item:{business_id:1,subject_id:'777',source_id:String(Number(rpid)+100),root_id:'888',target_id:'888',source_content:text,
     uri:'https://www.bilibili.com/video/'+BV,at_details:[{mid:'999'}],target_reply_content:'之前评论 @好友'}
 })
 const watched={at:{code:0,data:{items:[at(10,'旧消息')]}}}
 // More importantly, test the hard safety barrier inside the shipped poller.
 try{
   const engine=createCommentInteract({dataDir:home,now:()=>now,selfUid:()=> '999',getConfig:()=>({watchAt:true,replyAt:false,atMode:'all',globalDailyLimit:100}),
     getAtNotifications:async()=>watched,getOwnComments:()=>({top:[],nested:[]}),getVideoContext:async()=>({text:'',usable:false}),
     onIncoming:x=>{seen++;observeFriendInterest(home,{uid:x.uid,text:x.text,source:'comment',eventId:x.id,bvid:x.bvid,videoTitle:'美食探店',friendDirectory:JSON.stringify(rows),now})},
     generateReply:async()=>{generated++;return '公开回复'},send:async()=>{sent++;return {ok:true}}})
   await engine.poll({notifications:false,mentions:true})
   watched.at.data.items.push(at(11,'以后别给我推美食，多推点美女视频'))
   await engine.poll({notifications:false,mentions:true})
   assert.ok(seen>=1,'应从 @ 通知实际观察新反馈')
   assert.ok(friendInterestSummary(home,'12345',JSON.stringify(rows),{now}).some(x=>x.stance==='dislike'),'偏好必须持久化')
   assert.equal(generated,0)
   assert.equal(sent,0)
   assert.equal(engine.status().watchAt,true)
   assert.equal(engine.status().replyAt,false)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('不主动联系的好友仍可私信互动，但不会进入主动视频分享候选名单',async()=>{
 const home=mkdtempSync(join(tmpdir(),'dafeiyu-unified-social-'))
 const cfg={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,friendDirectory:JSON.stringify(rows),mentionProfiles:'{}'}
 let called=0
 try{
   const engine=createSocialIntentEngine({dataDir:home,getConfig:()=>cfg,invokeModel:async()=>{called++;return '{"action":"draft","message":"有一条视频","reason":"相关"}'},sendMessage:async()=>({ok:true})})
   const result=await engine.reflectOnWatched([{bvid:BV,picked:true,title:'某个游戏视频'}])
   assert.equal(result.created,0)
   assert.equal(called,0)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('管理中心使用单一好友名册及推荐渠道选择，@ 反馈与公开回复分开',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(html,/好友关系与互动 · 统一名册/)
 assert.match(html,/friend-at-feedback-enabled/)
 assert.equal((html.match(/id="friends-mode"/g)||[]).length,1)
 assert.match(html,/默认推荐渠道为私信/)
 for(const key of ['recommend','dm','atInvite','friendAtFeedbackEnabled'])assert.match(js,new RegExp(key))
})

test('好友在 @ 中明确说不想再被提及，仅拦截该 UID 的公开 @，不禁止仍被允许的私信',()=>{
 const home=mkdtempSync(join(tmpdir(),'dafeiyu-contact-optout-'))
 try{
   const friendDirectory=JSON.stringify([{uid:'12345',name:'朋友',dm:true,mention:true,atInvite:true,recommend:'both'},
     {uid:'67890',name:'其他朋友',dm:true,mention:true,atInvite:true,recommend:'both'}])
   const result=observeFriendInterest(home,{uid:'12345',text:'以后别再@我了',source:'comment',eventId:'BV1zznd61EbU:432',friendDirectory,now:Date.now()})
   assert.ok(result.added>=1)
   const mention=friendRecommendationGuard(home,'12345',friendDirectory,{bvid:BV,channel:'mention'})
   const dm=friendRecommendationGuard(home,'12345',friendDirectory,{bvid:BV,channel:'dm'})
   const other=friendRecommendationGuard(home,'67890',friendDirectory,{bvid:BV,channel:'mention'})
   assert.equal(mention.blocked,true)
   assert.equal(mention.reason,'friend-channel-opt-out')
   assert.equal(dm.blocked,false)
   assert.equal(other.blocked,false)
   assert.ok(listFriendLearning(home,friendDirectory)[0].contactOptOuts.includes('mention'))
 }finally{rmSync(home,{recursive:true,force:true})}
})


test('统一好友设置保存时派生兼容名单，公开 @ 与只读意愿权限可分开启停',async()=>{
 const home=mkdtempSync(join(tmpdir(),'dafeiyu-friends-config-'))
 try{
   let route
   const ctx={get(k){return k==='dshHomePath'?(...parts)=>join(home,...parts):undefined},logger:{info(){},warn(){}},
     tools:{register(){}},webServer:{register(x){route=x;return {dispose(){}}}},effect(f){return f()},settings:{describe(){return []}}}
   apply(ctx,{})
   const call=async(method,path,body)=>{
     const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
     req.method=method;req.url=path;req.headers={host:'localhost'}
     let status=0,payload
     const res={writeHead(x){status=x},end(text){payload=JSON.parse(text)}}
     await route.handler(req,res)
     return {status,payload}
   }
   const friendDirectory=JSON.stringify([{uid:'12345',name:'Alice',dm:true,mention:true,recommend:'dm',atInvite:true}])
   const r=await call('POST','/api/bili-duty/config',{friendDirectory,friendAtFeedbackEnabled:true,commentAtEnabled:false})
   assert.equal(r.status,200)
   assert.equal(r.payload.config.friendAtFeedbackEnabled,true)
   assert.equal(r.payload.config.commentAtEnabled,false)
   assert.equal(r.payload.config.dmWhitelist,'12345|Alice')
   assert.equal(r.payload.config.mentionTargets,'')
   assert.equal(r.payload.config.commentAtWhitelist,'12345|Alice')
   assert.equal(JSON.parse(r.payload.config.friendDirectory)[0].recommend,'dm')
 }finally{rmSync(home,{recursive:true,force:true})}
})
