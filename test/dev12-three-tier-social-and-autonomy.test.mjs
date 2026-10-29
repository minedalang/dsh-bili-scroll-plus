import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {socialTier,commentThreadId} from '../lib/social-tier.mjs'
import {createOwnerCommentAgent,parseOwnerCommentIntent} from '../lib/owner-comment-agent.mjs'
import {createDualContextAgency} from '../lib/dual-context-agency.mjs'
import {createOwnerTodoEngine} from '../lib/owner-todos.mjs'
import {receiveRecommendations} from '../lib/video-recommendations.mjs'
import {createAutonomousPlanner} from '../lib/autonomous-planner.mjs'

const BV='BV1zznd61EbU',otherBV='BV19SJi6VEj1',CLOCK=Date.parse('2026-10-29T14:00:00Z')
const home=()=>mkdtempSync(join(tmpdir(),'dafeiyu-dev12-'))
const config={masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,
 dmOwnerUid:'210228238',commentDailyLimit:12,commentReplyPerDay:12,ownerCommentNaturalAckEnabled:false}
const makeOwner=(dir,opts={})=>{
 const actions=[],replies=[],agency=createDualContextAgency({dataDir:dir,now:()=>CLOCK,getEmotion:()=>({energy:80,sociality:80,curiosity:80})})
 const engine=createOwnerCommentAgent({dataDir:dir,getConfig:()=>config,now:()=>CLOCK,
  decideAgency:x=>agency.decide({source:'bili-comment',uid:x.uid,messageId:x.messageId,text:x.text,intent:x.intent,target:x.bvid,thread:x.thread}),
  perform:async x=>{actions.push(x);return opts.perform?opts.perform(x):{ok:true,skipped:true,summary:'self-chose-not-to-comment:no-opinion'}},
  generateChat:async x=>opts.generateChat?.(x)??'哎呀，鱼鱼在哦～',
  sendReply:async x=>{replies.push(x);return {ok:true,rpid:'90009'}},deferWatch:async x=>{actions.push({type:'deferred',...x});return {ok:true}}})
 const row=(id,kind,text,scope='self-top',root='2222',rpid='4444')=>({id,kind,uid:config.dmOwnerUid,scope,bvid:BV,rpid,root,targetId:'2222',timestampMs:CLOCK,text})
 return {engine,agency,row,actions,replies}
}
test('身份来自可信 UID，陌生人不会凭昵称冒充主人或好友',()=>{
 const dir=[{uid:'3333',name:'小朋友',atInvite:true}]
 assert.equal(socialTier(config.dmOwnerUid,config.dmOwnerUid,dir),'owner')
 assert.equal(socialTier('3333',config.dmOwnerUid,dir),'friend')
 assert.equal(socialTier('7777',config.dmOwnerUid,dir),'stranger')
 assert.equal(socialTier('bad',config.dmOwnerUid,dir),'unverified')
 assert.equal(commentThreadId({bvid:BV,root:'1234',rpid:'9999'}),BV+':1234')
 assert.notEqual(commentThreadId({bvid:BV,root:'1234'}),commentThreadId({bvid:BV,root:'5678'}))
})
test('没有 @ 的第一次主人评论回复仍进入意愿系统，并且只回复一次',async()=>{
 const dir=home()
 try{
  const x=makeOwner(dir)
  const row=x.row('comment:101','notice','大肥鱼，你今天开心吗')
  const one=await x.engine.accept(row)
  assert.equal(one.status,'done');assert.equal(x.replies.length,1);assert.equal(x.replies[0].kind,'social-chat')
  assert.equal(x.agency.status().recent.length,1);assert.equal(x.agency.status().recent[0].intent,'chat')
  assert.equal((await x.engine.accept(row)).skipped,'duplicate');assert.equal(x.replies.length,1)
  assert.equal((await x.engine.accept({...x.row('comment:102','notice','hi','notice')})).reason,'not-verified-owner-comment')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('拒绝评论后同线程温和劝说，重新评价社会意愿；不同线程绝不沿用拒绝',async()=>{
 const dir=home()
 try{
  const x=makeOwner(dir)
  const a=await x.engine.accept(x.row('at:11','at','@大肥鱼 你觉得这个视频怎么样'))
  assert.equal(a.status,'skipped')
  const b=await x.engine.accept(x.row('comment:12','notice','拜托啦，再评论一下嘛'))
  assert.equal(b.status,'skipped');assert.equal(x.actions.length,2)
  assert.equal(x.actions[1].type,'social_invite')
  assert.equal(x.agency.status().recent.at(-1).attempt,2)
  const c=await x.engine.accept(x.row('comment:13','notice','拜托啦，再评论一下嘛','self-top','3333','5555'))
  assert.equal(c.status,'done');assert.equal(x.actions.length,2,'不同线程是 chat，不能继承发表评论请求')
  assert.equal(x.replies.at(-1).kind,'social-chat')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('“现在看”走即时动作，“有空看”仅记录待办；投币仍不可凭评论执行',async()=>{
 const dir=home()
 try{
  const todo=createOwnerTodoEngine({dataDir:dir,now:()=>CLOCK})
  const x=makeOwner(dir,{perform:async a=>{
    if(a.type==='watch_later')return todo.add({type:'watch_video',bvid:a.bvid,sourceKey:'later:'+a.messageId},{source:'owner'}).ok?{ok:true}:{ok:false}
    return {ok:true,summary:'read'}
  }})
  assert.deepEqual(parseOwnerCommentIntent('肥鱼 现在看看这个视频'),{type:'watch_now'})
  assert.deepEqual(parseOwnerCommentIntent('肥鱼 有空看看这个视频'),{type:'watch_later'})
  assert.equal((await x.engine.accept(x.row('at:21','at','肥鱼 现在看看这个视频'))).status,'done')
  assert.equal(todo.list().length,0);assert.equal(x.actions[0].type,'watch_now')
  assert.equal((await x.engine.accept(x.row('at:22','at','肥鱼 有空看看这个视频'))).status,'done')
  assert.equal(todo.list().length,1);assert.equal(x.actions[1].type,'watch_later')
  assert.equal((await x.engine.accept(x.row('at:23','at','肥鱼 给这个视频投币'))).skipped,'coin-not-implemented')
  assert.equal(x.actions.length,2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('陌生人和好友推荐同 BV 只建一个自主待办，并保留不同来源',()=>{
 const dir=home()
 try{
  const todos=createOwnerTodoEngine({dataDir:dir,now:()=>CLOCK})
  const a=receiveRecommendations(dir,[{incoming:true,senderUid:'7777',senderName:'陌生人',messageId:'m1',text:BV,source:'B站评论分享',timestampMs:CLOCK}],{now:CLOCK})
  const b=receiveRecommendations(dir,[{incoming:true,senderUid:'3333',senderName:'朋友',messageId:'m2',text:BV,source:'B站私信分享',timestampMs:CLOCK}],{now:CLOCK})
  assert.equal(todos.syncRecommendations(a.entries).added,1)
  assert.equal(todos.syncRecommendations(b.entries).added,0)
  const rows=todos.list({includeClosed:true})
  assert.equal(rows.length,1);assert.equal(rows[0].type,'watch_video')
  assert.deepEqual(rows[0].recommendationSources.map(x=>x.channel).sort(),['comment','dm'])
  todos.update(rows[0].id,'dismiss')
  todos.syncRecommendations(b.entries)
  assert.equal(todos.list({includeClosed:true}).length,1,'大肥鱼拒绝后不能被相同推荐重新建待办')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('自主 AI 调度第 13 次仍合法；每日 quota=13 在第 14 次才停止',async()=>{
 const dir=home();let now=CLOCK,calls=0
 try{
  const todo=createOwnerTodoEngine({dataDir:dir,now:()=>now})
  todo.add({type:'watch_video',bvid:otherBV})
  const planner=createAutonomousPlanner({dataDir:dir,now:()=>now,
   getConfig:()=>({masterEnabled:true,autonomousPlannerEnabled:true,autonomousPlannerDailyLimit:13,autonomousPlannerMinutes:5,autonomousPlannerStartHour:0,autonomousPlannerEndHour:24}),
   getTodos:()=>todo.context(8),invokeModel:async()=>{calls++;return '{"action":"skip"}'},executeRead:async()=>({ok:true}),
   updateTodo:(...args)=>todo.update(...args),reflect:async()=>({ok:false})})
  for(let i=0;i<13;i++){assert.equal((await planner.tick()).action,'skip');now+=5*60_000}
  assert.equal(calls,13);assert.equal((await planner.tick()).skipped,'quota')
  assert.equal(planner.status().runs,13)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('陌生人的评论回复至多一次模型生成，不进行热评二次调用',async()=>{
 const {createCommentInteract}=await import('../lib/comment-interact.mjs')
 const dir=home();let rows=[],models=0,hot=[],sent=0
 const notice={user:{mid:7777},item:{business_id:1,subject_id:456,source_id:131313,root_id:4444,
  source_content:'你觉得这个怎么样？',content:'你觉得这个怎么样？',subject_bvid:BV}}
 try{
  const engine=createCommentInteract({dataDir:dir,selfUid:async()=> '900',now:()=>CLOCK,
   socialTier:()=> 'stranger',getConfig:()=>({watchReplies:true,watchAt:false,watchTop:false,replyPerPoll:5,replyPerDay:15,globalDailyLimit:20}),
   getNotifications:async()=>({data:{items:rows}}),getOwnComments:async()=>({top:new Set(),nested:new Set()}),
   getVideoContext:async(_bv,args)=>{hot.push(args.includeHot);return {text:'上下文',usable:true,counts:{hotProvided:3}}},
   generateReply:async()=>{models++;return '这次我有点想聊聊呢。'},send:async()=>{sent++;return {ok:true}},logger:{warn(){},error(){}}})
  await engine.poll();rows=[notice];await engine.poll()
  assert.deepEqual(hot,[false]);assert.equal(models,1);assert.equal(sent,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('BUG-004 实际回复通知入口：主人未 @ 也被消费，旧普通 AI 路径不再重复回复',async()=>{
 const {createCommentInteract}=await import('../lib/comment-interact.mjs')
 const dir=home();let messages=[],incoming=0,ai=0,publicSend=0
 try{
  const engine=createCommentInteract({dataDir:dir,selfUid:async()=> '900',now:()=>CLOCK,
   getConfig:()=>({watchReplies:true,allowGeneralReplies:false,watchTop:false,watchAt:false,replyPerPoll:5,replyPerDay:100,globalDailyLimit:100}),
   getNotifications:async()=>({data:{items:messages}}),getOwnComments:async()=>({top:new Set(['4444']),nested:new Set()}),
   onIncoming:async row=>{incoming++;assert.equal(row.kind,'notice');assert.equal(row.scope,'self-top');return {consumed:true,reason:'owner_social_agent'}},
   generateReply:async()=>{ai++;return '不能进入旧回复路径'},send:async()=>{publicSend++;return {ok:true}},
   logger:{warn(){},error(){}}})
  await engine.poll()
  messages=[{user:{mid:Number(config.dmOwnerUid)},item:{business_id:1,subject_id:456,source_id:131515,root_id:4444,
   target_id:4444,source_time:Math.floor((CLOCK-12000)/1000),source_content:'大肥鱼，你今天在做什么？',subject_bvid:BV}}]
  await engine.poll();await engine.poll()
  assert.equal(incoming,1);assert.equal(ai,0);assert.equal(publicSend,0)
  const state=JSON.parse(readFileSync(join(dir,'comment-interact-state.json'),'utf8'))
  assert.equal(state.seen['comment:131515'],'owner-comment-agent')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
