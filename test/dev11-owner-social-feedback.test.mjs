import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerCommentAgent,ownerSocialSkipReply} from '../lib/owner-comment-agent.mjs'
import {parseOwnerSocialChoice,decideOwnerSocialComment,buildOwnerSocialCommentPrompt} from '../lib/owner-comment-social.mjs'
const BV='BV1zznd61EbU',now=1793260000000
function create(config={},decideAgency=()=>({decision:'allow',score:87,attempt:2}),perform=async()=>({ok:true,skipped:true,summary:'self-chose-not-to-comment:no-opinion'})){
 const dataDir=mkdtempSync(join(tmpdir(),'dev11-owner-'))
 const opts={masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,ownerCommentNaturalAckEnabled:false,dmOwnerUid:'210228238',commentDailyLimit:5,commentReplyPerDay:5,...config}
 let publishes=0,replies=[]
 const agent=createOwnerCommentAgent({dataDir,getConfig:()=>opts,decideAgency,now:()=>now,perform:async a=>{publishes++;return perform(a)},sendReply:async args=>{replies.push(args);return {ok:true}}})
 const row=(id='at:1')=>({id,kind:'at',uid:'210228238',bvid:BV,rpid:'322249158064',timestampMs:now,text:'@大肥鱼 来看看这个视频，你怎么看'})
 return {agent,row,replies,get publishes(){return publishes},opts,dataDir,close:()=>rmSync(dataDir,{force:true,recursive:true})}
}
test('high willingness reaches model prompt but never forces content or leaks private text',async()=>{
 let prompt=''
 const result=await decideOwnerSocialComment({info:{title:'真实公开视频标题'},bvid:BV,willingness:{score:87,attempt:2},invoke:async p=>{prompt=p;return '{"decision":"skip","reason":"no-opinion","text":""}'}})
 assert.match(prompt,/87\/100/);assert.match(prompt,/真实公开视频标题/)
 assert.equal(result.skipped,true);assert.match(result.reason,/no-opinion/)
 assert.doesNotMatch(prompt,/必须发表|不准拒绝/)
 assert.equal(parseOwnerSocialChoice('{"decision":"skip","reason":"something private","text":""}').reason,'self-chose-not-to-comment:no-opinion')
})
test('willingness is passed to actual perform, not just reflected in owner chat',async()=>{
 let received=null
 const m=create({},()=>({decision:'allow',score:89,attempt:3}),async a=>{received=a;return {ok:true,skipped:true,summary:'self-chose-not-to-comment:no-opinion'}})
 try{await m.agent.accept(m.row());assert.equal(received.willingness.score,89);assert.equal(received.willingness.attempt,3);assert.equal(m.replies.length,1)}finally{m.close()}
})
test('low-energy refusal is acknowledged once without a top-level publish',async()=>{
 const m=create({},()=>({decision:'refuse',reason:'low-willingness-refuse',score:10,attempt:1}))
 try{const res=await m.agent.accept(m.row());assert.equal(res.status,'skipped');assert.equal(m.publishes,0);assert.equal(m.replies.length,1);assert.equal(m.replies[0].rpid,'322249158064');assert.match(m.replies[0].text,/不太想评论/);assert.equal((await m.agent.accept(m.row())).skipped,'duplicate');assert.equal(m.replies.length,1)}finally{m.close()}
})
test('comment skip feedback obeys toggles and quota, despite high willingness',async()=>{
 for(const cfg of [{commentReplyPerDay:0},{commentDailyLimit:0}]){
  const m=create(cfg)
  try{const result=await m.agent.accept(m.row());assert.equal(result.status,'skipped');assert.equal(m.replies.length,0);assert.equal(JSON.parse(readFileSync(join(m.dataDir,'owner-comment-agent.json'))).items[0].replyStatus,'blocked')}finally{m.close()}
 }
 const m=create({ownerCommentSocialPublishEnabled:false});try{assert.equal((await m.agent.accept(m.row())).status,'skipped');assert.equal(m.replies.length,0)}finally{m.close()}
})
test('revoked consent before an acknowledgement prevents sending, without retry',async()=>{
 let m
 m=create({},()=>({decision:'allow',score:87}),async()=>{m.opts.ownerCommentSocialPublishEnabled=false;return {ok:true,skipped:true,summary:'self-chose-not-to-comment:no-opinion'}})
 try{await m.agent.accept(m.row());assert.equal(m.replies.length,0);assert.equal((await m.agent.accept(m.row())).skipped,'duplicate')}finally{m.close()}
})
test('uncertain reply remains reserved, is not resent by repeated notification',async()=>{
 const m=create()
 try{m.agent.accept;const r=await m.agent.accept(m.row());assert.equal(r.status,'skipped');assert.equal(m.replies.length,1);await m.agent.accept(m.row());assert.equal(m.replies.length,1)}finally{m.close()}
})
test('skip wording is fixed and never echoes user or model instructions',()=>{
 assert.match(ownerSocialSkipReply('self-chose-not-to-comment:low-energy'),/没精神/)
 assert.match(ownerSocialSkipReply('大肥鱼选择暂不公开评论（self-chose-not-to-comment:no-opinion）'),/具体想说的/)
 assert.doesNotMatch(ownerSocialSkipReply('secret contents:cookie'),/cookie/)
})
test('life panel navigation and diagnostics visualization use real targets and respect reduced motion',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.doesNotMatch(html,/href="#life-social-section"/)
 assert.match(html,/data-nav-tab="social"/)
 assert.match(js,/switchTab\(link.dataset.navTab\)/)
 assert.match(html,/id="emotion-recall-diagnostics" class="records records-scroll recall-diagnostics"/)
 assert.match(html,/id="emotion-recall-overview"/)
 assert.match(html,/id="emotion-trend"/)
 assert.match(html,/prefers-reduced-motion:reduce/)
 assert.match(js,/no-recent-emotion':'最近没有达到触发条件/)
})
