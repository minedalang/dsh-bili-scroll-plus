import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {parseOwnerCommentIntent,createOwnerCommentAgent} from '../lib/owner-comment-agent.mjs'
import {buildOwnerSocialCommentPrompt} from '../lib/owner-comment-social.mjs'
import {createDualContextAgency} from '../lib/dual-context-agency.mjs'
const BV='BV1SqHK6oE2i',OWNER='210228238',NOW=1793279269436
const WORDS='我说这视频里的肥鱼忧郁，又没说你忧郁，你不去他视频底下发条评论安慰安慰她吗'
const cfg={masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,dmOwnerUid:OWNER,commentDailyLimit:20,commentReplyPerDay:20}
const row=(id,text)=>({kind:'notice',scope:'self-top',id,uid:OWNER,bvid:BV,rpid:id.split(':')[1],root:'322275838160',targetId:'322275838160',timestampMs:NOW,text})
test('实际出现的主人自然要求发表评论，使用 publish 意愿而不是 chat',async()=>{
 assert.deepEqual(parseOwnerCommentIntent(WORDS),{type:'social_invite',commentRequested:true})
 const dir=mkdtempSync(join(tmpdir(),'owner-public-comment-'))
 const requests=[],replies=[]
 try{
  const agency=createDualContextAgency({dataDir:dir,now:()=>NOW,getEmotion:()=>({energy:80,sociality:80,curiosity:80})})
  const agent=createOwnerCommentAgent({dataDir:dir,now:()=>NOW,getConfig:()=>cfg,
   decideAgency:p=>agency.decide({source:'bili-comment',uid:p.uid,messageId:p.messageId,text:p.text,intent:p.intent,thread:p.thread,target:p.bvid}),
   generateChat:async()=> '这次先摸会儿鱼',sendReply:async p=>{replies.push(p);return {ok:true,rpid:'987654321'}},
   perform:async p=>{requests.push(p);return {ok:true,summary:'platform accepted top-level comment'}}})
  const chat=await agent.accept(row('comment:322276111111','怎么又叫鱼鱼啦'))
  assert.equal(chat.status,'done');assert.equal(replies.length,1)
  const invite=await agent.accept(row('comment:322276235456',WORDS))
  assert.equal(invite.status,'done');assert.equal(replies.length,1,'不能把发布顶层评论请求吞成聊天回复')
  assert.equal(requests.length,1);assert.equal(requests[0].type,'social_invite')
  assert.equal(requests[0].commentRequested,true)
  assert.equal(requests[0].willingness.decision,'allow')
  assert.equal(agency.status().recent.at(-1).intent,'publish')
  const last=JSON.parse(readFileSync(join(dir,'owner-comment-agent.json'),'utf8')).items.at(-1)
  assert.equal(last.type,'social_invite');assert.equal(last.commentRequested,true)
  assert.equal((await agent.accept(row('comment:322276235456',WORDS))).skipped,'duplicate')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('同评论串温和劝说继续 publish 场景，不会在拒绝后掉回 chat',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'owner-comment-followup-'))
 const requests=[]
 try{
  const agency=createDualContextAgency({dataDir:dir,now:()=>NOW,getEmotion:()=>({energy:80,sociality:80,curiosity:80})})
  const agent=createOwnerCommentAgent({dataDir:dir,now:()=>NOW,getConfig:()=>cfg,
   decideAgency:p=>agency.decide({source:'bili-comment',uid:p.uid,messageId:p.messageId,text:p.text,intent:p.intent,thread:p.thread,target:p.bvid}),
   perform:async p=>{requests.push(p);return {ok:true,skipped:true,summary:'self-chose-not-to-comment:no-opinion'}},
   sendReply:async()=>({ok:true,rpid:'987654321'})})
  assert.equal((await agent.accept(row('comment:322276235456',WORDS))).status,'skipped')
  assert.equal((await agent.accept(row('comment:322276235457','拜托啦，再考虑一下嘛'))).status,'skipped')
  assert.equal(requests.length,2)
  assert.equal(requests[1].commentRequested,true)
  assert.deepEqual(agency.status().recent.map(x=>x.intent),['publish','publish'])
  assert.equal(agency.status().recent[1].attempt,2)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('明确评论邀请提示词传递评论意愿，但不强制公开发布或编造视频事实',()=>{
 const prompt=buildOwnerSocialCommentPrompt({video:{title:'一条关于难过的小鱼的短片'},willingness:{score:88,attempt:2},commentRequested:true})
 assert.match(prompt,/明确邀请你到这条 B站视频下/)
 assert.match(prompt,/意愿已决定愿意考虑公开评论/)
 assert.match(prompt,/是否发布仍由你自主决定/)
 assert.match(prompt,/不得假称看完视频/)
 const chatPrompt=buildOwnerSocialCommentPrompt({video:{title:'一条短片'}})
 assert.match(chatPrompt,/只邀请你了解/)
})
test('自然聊天、否定句和评论区转述不会打开顶层发布路径',()=>{
 for(const message of [
  '这视频评论区也太离谱了，我都不想说话',
  '视频下面有人发条评论安慰她，挺有爱心',
  '你别去这个视频底下发评论',
  '鱼鱼，你今天累了吗？',
 ])assert.equal(parseOwnerCommentIntent(message),null,message)
})
