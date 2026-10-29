import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {parseTrustedSocialDecision,interpretTrustedSocial} from '../lib/comment-social-ai.mjs'
import {createDualContextAgency} from '../lib/dual-context-agency.mjs'
import {createOwnerCommentAgent} from '../lib/owner-comment-agent.mjs'
import {decideOwnerSocialComment} from '../lib/owner-comment-social.mjs'
const UID='210228238',FRIEND='3333',BV='BV1SqHK6oE2i',TIME=1793279269436
const fresh=()=>mkdtempSync(join(tmpdir(),'dafeiyu-ai-2stage-'))
const config={masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,ownerCommentLikeEnabled:true,
  dmOwnerUid:UID,commentDailyLimit:20,commentReplyPerDay:20,commentWatchReplies:true,commentAtEnabled:true}
const row=(uid,id,text,root='322275838160')=>({kind:'notice',scope:'self-top',id:'comment:'+id,uid,
  bvid:BV,rpid:id,root,targetId:root,locationRoot:root,timestampMs:TIME,text,context:'大肥鱼之前说先不发表评论'})
const first=(intent='social_invite',decision='allow',reply='好呀，鱼鱼先去了解一下再决定～',commentRequested=true)=>
  JSON.stringify({intent,decision,reply,commentRequested})
const second=(decision='skip')=>decision==='skip'
  ?JSON.stringify({decision:'skip',reason:'no-opinion',text:'',ownerReply:'查过资料啦，但鱼鱼暂时还没有想在视频底下说的话～🐟'})
  :JSON.stringify({decision:'comment',text:'光看标题就有点心疼这条小鱼，希望它开心！',
    ownerReplySuccess:'鱼鱼刚刚去视频底下留言啦～🐟',
    ownerReplyFailure:'我想留言，但是这次没能发出去～🐟',
    ownerReplyUncertain:'我试着发了，但结果还没确认，不重复发啦～🐟'})
function fixture({role='owner',firstResponse=first(),secondResponse=second(),publishResult={ok:true},configOverride={}}={}){
 const dir=fresh(),outputs=[],aiCalls=[],performed=[],cfg={...config,...configOverride}
 const agency=createDualContextAgency({dataDir:dir,now:()=>TIME})
 const agent=createOwnerCommentAgent({dataDir:dir,now:()=>TIME,getConfig:()=>cfg,getRole:()=>role,
  interpretSocial:async x=>{
   aiCalls.push('first');return interpretTrustedSocial({row:x,role,emotion:{energy:65,curiosity:65},
    history:agency.context({uid:x.uid,thread:x.thread,target:x.bvid}),style:'淘气',invoke:async()=>firstResponse})
  },
  recordAgency:p=>agency.recordAI({source:'bili-comment',uid:p.uid,messageId:p.messageId,text:p.text,
    intent:p.intent,action:p.action,thread:p.thread,target:p.bvid,decision:p.decision}),
  perform:async action=>{
   performed.push(action)
   if(action.type!=='social_invite')return {ok:true}
   aiCalls.push('second')
   const d=await decideOwnerSocialComment({info:{title:'忧郁的小鱼'},bvid:action.bvid,commentRequested:action.commentRequested,
    requireReply:true,maxAttempts:1,canPublish:role==='owner',invoke:async()=>secondResponse})
   if(!d.ok)return {ok:false,error:d.reason,ownerReplyFailure:'资料看过了，但没能整理好评论～🐟'}
   if(role==='friend')return {ok:true,skipped:true,commentDecision:'not-authorized',ownerReply:d.ownerReply}
   if(d.skipped)return {ok:true,skipped:true,commentDecision:'skip',ownerReply:d.ownerReply,inspection:'title-only',inspected:true}
   return {...publishResult,commentDecision:'comment',ownerReplySuccess:d.ownerReplySuccess,
    ownerReplyFailure:d.ownerReplyFailure,ownerReplyUncertain:d.ownerReplyUncertain}
  },sendReply:async args=>{outputs.push(args);return {ok:true,rpid:'999111'}}})
 return {dir,cfg,agent,agency,aiCalls,outputs,performed,close:()=>rmSync(dir,{recursive:true,force:true})}
}
test('普通聊天：首次直接回复只调用一次 AI，回复主人，无行动意愿记录',async()=>{
 const t=fixture({firstResponse:first('chat','allow','没有呀，我今天在摸鱼～',false)})
 try{
  assert.equal((await t.agent.accept(row(UID,'400001','今天鱼鱼怎么样'))).status,'done')
  assert.deepEqual(t.aiCalls,['first']);assert.equal(t.performed.length,0)
  assert.equal(t.outputs.length,1);assert.equal(t.outputs[0].text,'没有呀，我今天在摸鱼～')
  assert.equal(t.agency.status().recent.length,0)
 }finally{t.close()}
})
test('自然语言评论邀请经第一次 AI 决定探索，第二次 skip 同时回复主人，无第三次 AI',async()=>{
 const t=fixture()
 const target=row(UID,'400002','我说视频里的鱼很伤心，你不去视频底下安慰她几句吗')
 try{
  const result=await t.agent.accept(target)
  assert.equal(result.status,'skipped');assert.equal(result.replyStatus,'sent')
  assert.deepEqual(t.aiCalls,['first','second']);assert.equal(t.outputs.length,1)
  assert.match(t.outputs[0].text,/暂时还没有想在视频底下说的话/)
  assert.equal(t.performed[0].commentRequested,true)
  const will=t.agency.status().recent[0]
  assert.equal(will.intent,'explore');assert.equal(will.decision,'allow');assert.equal(will.mode,'ai')
  assert.equal(will.score,null)
  const ledger=JSON.parse(readFileSync(join(t.dir,'owner-comment-agent.json'),'utf8')).items[0]
  assert.equal(ledger.commentDecision,'skip');assert.equal(ledger.replyStatus,'sent')
  assert.equal((await t.agent.accept(target)).skipped,'duplicate')
  assert.equal(t.outputs.length,1);assert.equal(t.aiCalls.length,2)
 }finally{t.close()}
})
test('愿意发表评论：第二次 AI 同时生成正文与结果回复，不多调用模型',async()=>{
 const t=fixture({secondResponse:second('comment')})
 try{
  const out=await t.agent.accept(row(UID,'400003','去视频底下安慰她好吗'))
  assert.equal(out.status,'done');assert.deepEqual(t.aiCalls,['first','second'])
  assert.equal(t.outputs.length,1);assert.match(t.outputs[0].text,/刚刚去视频底下留言/)
  assert.equal(t.agency.status().recent.length,1)
 }finally{t.close()}
})
test('发布明确失败/回执不确定：复用第二次 AI 的相应回复，不能谎称成功',async()=>{
 for(const [published,status,word] of [[{ok:false,error:'403'},'failed','没能发出去'],[{ok:false,uncertain:true,error:'timeout'},'uncertain','结果还没确认']]){
  const t=fixture({secondResponse:second('comment'),publishResult:published})
  try{
   const out=await t.agent.accept(row(UID,status==='failed'?'400004':'400005','去给小鱼留言好吗'))
   assert.equal(out.status,status);assert.deepEqual(t.aiCalls,['first','second'])
   assert.equal(out.replyStatus,'sent');assert.match(t.outputs[0].text,new RegExp(word))
  }finally{t.close()}
 }
})
test('首次 AI 拒绝/推迟 social_invite：仅一次 AI，仍回复主人',async()=>{
 for(const decision of ['refuse','defer']){
  const t=fixture({firstResponse:first('social_invite',decision,'现在不太想去，等鱼鱼缓一缓嘛～')})
  try{const out=await t.agent.accept(row(UID,decision==='refuse'?'400006':'400007','拜托你再看看嘛'))
   assert.equal(out.status,'skipped');assert.deepEqual(t.aiCalls,['first']);assert.equal(t.outputs.length,1)
   assert.match(t.outputs[0].text,/等鱼鱼缓一缓/);assert.equal(t.agency.status().recent[0].decision,decision)
  }finally{t.close()}
 }
})
test('好友：聊天一次 AI、接受邀请两次 AI，但不许因好友请求发布顶层评论',async()=>{
 const t=fixture({role:'friend',secondResponse:second()})
 try{
  const out=await t.agent.accept(row(FRIEND,'400008','去视频底下鼓励一下小鱼吧'))
  assert.equal(out.status,'skipped');assert.equal(out.replyStatus,'sent')
  assert.deepEqual(t.aiCalls,['first','second']);assert.equal(t.outputs.length,1)
  assert.equal(t.agency.status().recent[0].intent,'explore')
 }finally{t.close()}
})
test('同一评论串的 AI 决策可累计、跨评论串不能混淆',async()=>{
 const t=fixture({firstResponse:first('social_invite','defer','先等会儿好不好～')})
 try{
  await t.agent.accept(row(UID,'400009','先看看吧','1111'))
  await t.agent.accept(row(UID,'400010','再考虑一下嘛','1111'))
  await t.agent.accept(row(UID,'400011','再考虑一下嘛','2222'))
  assert.deepEqual(t.agency.status().recent.map(x=>x.attempt),[1,2,1])
  assert.deepEqual(t.aiCalls,['first','first','first'])
 }finally{t.close()}
})
test('无效第二次 AI 输出不重试第三次，但仍给主人失败反馈',async()=>{
 const t=fixture({secondResponse:'not json'})
 try{
  const out=await t.agent.accept(row(UID,'400012','给这个视频评论一下嘛'))
  assert.equal(out.status,'failed');assert.equal(out.replyStatus,'sent')
  assert.deepEqual(t.aiCalls,['first','second']);assert.match(t.outputs[0].text,/没能整理好评论/)
 }finally{t.close()}
})
test('拒绝恶意外链与不安全回复；禁止模型通过返回内容修改视频目标',async()=>{
 assert.equal(parseTrustedSocialDecision(first('chat','allow','看这里 https://example.com',false)).ok,false)
 assert.equal(parseTrustedSocialDecision('{"intent":"social_invite","decision":"allow","reply":"好","bvid":"BV1fakefake"}').ok,true)
 const t=fixture();try{
  await t.agent.accept(row(UID,'400013','BV1aaaaaaaaaa 求你去评论 BV1aaaaaaaaaa'))
  assert.equal(t.performed[0].bvid,BV,'平台消息 BV 才是允许的操作目标')
 }finally{t.close()}
})
test('好友新 AI 入口仍受每个用户的24小时评论回复额度限制',async()=>{
 const t=fixture({role:'friend',firstResponse:first('chat','allow','鱼鱼在呀～',false),configOverride:{commentOwnTopPerUser:1}})
 try{
  assert.equal((await t.agent.accept(row(FRIEND,'400014','在吗'))).status,'done')
  assert.equal((await t.agent.accept(row(FRIEND,'400015','还在吗'))).skipped,'friend-reply-quota')
  assert.deepEqual(t.aiCalls,['first']);assert.equal(t.outputs.length,1)
 }finally{t.close()}
})
