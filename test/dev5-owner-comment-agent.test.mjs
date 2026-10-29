import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseOwnerCommentIntent,createOwnerCommentAgent} from '../lib/owner-comment-agent.mjs'
const BV='BV1zznd61EbU'
const make=(extras={})=>{const home=mkdtempSync(join(tmpdir(),'dev5-owner-comment-'))
  const cfg={masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentLikeEnabled:true,ownerCommentDraftEnabled:false,ownerCommentPublishEnabled:false,ownerCommentNaturalAckEnabled:false,commentDailyLimit:10,commentReplyPerDay:10,dmOwnerUid:'999',...extras}
  const performed=[],replies=[];const now=()=>1_790_000_000_000
  const agent=createOwnerCommentAgent({dataDir:home,getConfig:()=>cfg,perform:async action=>{performed.push(action);return {ok:true,summary:'confirmed'}},sendReply:async x=>{replies.push(x);return {ok:true}},now})
  return {home,cfg,agent,performed,replies,close:()=>rmSync(home,{recursive:true,force:true}),row:(id='at:1',uid='999')=>({kind:'at',id,uid,bvid:BV,rpid:'12345',root:'',timestampMs:now(),text:'@大肥鱼 这条视频帮我点个赞'})}
}
test('natural owner like is recognized; command denies cancellation',()=>{
 assert.deepEqual(parseOwnerCommentIntent('@大肥鱼 给这个视频点个赞'),{type:'like'})
 assert.equal(parseOwnerCommentIntent('@大肥鱼 别给这个视频点赞'),null)
 assert.deepEqual(parseOwnerCommentIntent('@大肥鱼 发评论：这条视频讲得不错'),{type:'comment_publish',text:'这条视频讲得不错'})
})
test('owner UID must be platform verified, nickname and comment text cannot impersonate',async()=>{
 const t=make();try{
  assert.equal((await t.agent.accept(t.row('at:1','888'))).reason,'not-verified-owner-comment')
  assert.equal(t.performed.length,0)
  assert.equal((await t.agent.accept({...t.row(),bvid:'',id:'at:2'})).reason,'not-verified-owner-comment')
  assert.equal(t.performed.length,0)
  assert.equal((await t.agent.accept({...t.row(),timestampMs:1,id:'at:3'})).reason,'stale')
 }finally{t.close()}
})
test('one verified owner @ executes once and stays deduplicated across engine restarts',async()=>{
 const t=make();try{
  assert.equal((await t.agent.accept(t.row())).status,'done')
  assert.deepEqual(t.performed,[{type:'like',bvid:BV,actorUid:'999'}])
  assert.equal(t.replies.length,0)
  assert.equal((await t.agent.accept(t.row())).skipped,'duplicate')
  assert.equal(t.performed.length,1)
  const disk=readFileSync(join(t.home,'owner-comment-agent.json'),'utf8');assert.ok(!disk.includes('聊天记录'))
 }finally{t.close()}
})
test('separate publish permission and natural response are both opt-in',async()=>{
 const t=make({ownerCommentNaturalAckEnabled:true});try{
  const ok=await t.agent.accept(t.row());assert.equal(ok.ack,'sent')
  assert.equal(t.replies.length,1);assert.ok(t.replies[0].text.length<35)
  assert.equal(t.replies[0].bvid,BV)
  assert.equal((await t.agent.accept({...t.row('at:2'),text:'@大肥鱼 发评论：你好'})).reason,'action-disabled')
 }finally{t.close()}
})
test('write outcome uncertain is never retried',async()=>{
 const t=make();try{
  const agent=createOwnerCommentAgent({dataDir:t.home,getConfig:()=>t.cfg,perform:async()=>{throw Error('network unknown')},now:()=>1_790_000_000_000})
  assert.equal((await agent.accept(t.row())).status,'uncertain')
  assert.equal((await agent.accept(t.row())).skipped,'duplicate')
 }finally{t.close()}
})

test('owner agent has independent @ scheduler and suppresses ordinary public AI reply',async()=>{
 const {createInteractionScheduler}=await import('../lib/interaction-scheduler.mjs')
 const {createCommentInteract}=await import('../lib/comment-interact.mjs')
 const home=mkdtempSync(join(tmpdir(),'dev5-owner-routing-'))
 const clock=Date.now();let polls=0,ownerAccepted=0,generated=0,sent=0
 const settings={masterEnabled:true,commentAtEnabled:false,friendAtFeedbackEnabled:false,ownerCommentAgentEnabled:true,dmWatch:false,commentWatchReplies:false,commentAtWatchMinutes:1}
 const sched=createInteractionScheduler({dm:{poll:async()=>({})},comments:{poll:async()=>{polls++;return {sent:0}}},getConfig:()=>settings,now:()=>clock})
 try{
  sched.start();await new Promise(r=>setTimeout(r,15));assert.equal(sched.status().checks.mentions.enabled,true);assert.equal(polls,1);sched.stop()
  const messages=[]
  const comment=createCommentInteract({dataDir:home,now:()=>clock,selfUid:()=> '666',getConfig:()=>({watchAt:true,replyAt:true,atMode:'all',globalDailyLimit:10,ownerCommentAgent:true,ownerUid:'999',replyPerPoll:1,replyPerDay:5}),
   getAtNotifications:async()=>({at:{code:0,data:{items:messages}}}),getOwnComments:()=>({top:[],nested:[]}),
   onIncoming:async()=>{ownerAccepted++},generateReply:async()=>{generated++;return '多余公开回复'},send:async()=>{sent++;return {ok:true}}})
  await comment.poll({notifications:false,mentions:true})
  messages.push({id:11,at_time:Math.floor(clock/1000),user:{mid:'999',nickname:'主人'},item:{business_id:1,subject_id:'777',source_id:'333',root_id:'0',source_content:'@大肥鱼 给这个视频点个赞',uri:`https://www.bilibili.com/video/${BV}`,at_details:[{mid:'666'}]}})
  await comment.poll({notifications:false,mentions:true})
  assert.equal(ownerAccepted,1);assert.equal(generated,0);assert.equal(sent,0)
 }finally{sched.stop();rmSync(home,{recursive:true,force:true})}
})
