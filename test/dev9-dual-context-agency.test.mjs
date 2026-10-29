import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDualContextAgency,classifyBiliOwnerRequest,agencyDeclineMessage} from '../lib/dual-context-agency.mjs'
import {createOwnerCommentAgent} from '../lib/owner-comment-agent.mjs'
const BV='BV1mzso6uEZh',time=1793268650070
function make(emotion={energy:8,sociality:8,curiosity:5,valence:-35}){
 const home=mkdtempSync(join(tmpdir(),'dual-agency-'))
 const api=createDualContextAgency({dataDir:home,now:()=>time,getEmotion:()=>emotion})
 return {home,api,close:()=>rmSync(home,{recursive:true,force:true})}
}
test('main session never uses social willingness; hard permissions still cannot be bypassed',()=>{
 const m=make()
 try{
  assert.equal(m.api.decide({source:'main-session',hardAllowed:true}).decision,'allow')
  assert.equal(m.api.decide({source:'main-session',hardAllowed:false}).decision,'blocked')
  assert.equal(m.api.status().recent.length,0)
 }finally{m.close()}
})
test('low energy may refuse, then distinct, polite followups can eventually persuade for same video',()=>{
 const m=make()
 try{
  const request=(messageId,text)=>m.api.decide({source:'bili-comment',uid:'210228238',messageId,text,intent:'explore',target:BV})
  assert.equal(request('at:1','@大肥鱼 来看看这个视频').decision,'refuse')
  const followups=[]
  for(let i=2;i<=5;i++)followups.push(request('at:'+i,'拜托啦，再来看看这个视频嘛'))
  assert.equal(followups[0].decision,'refuse')
  assert.equal(followups.at(-1).decision,'allow')
  assert.equal(m.api.status().recent.length,5)
  const json=readFileSync(join(m.home,'dual-context-agency.json'),'utf8')
  assert.ok(!json.includes('210228238')&&!json.includes('拜托')&&!json.includes(BV))
 }finally{m.close()}
})
test('same message ID cannot persuade twice, requests to another BV cannot borrow persuasion',()=>{
 const m=make()
 try{
  const props={source:'bili-dm',uid:'12345',messageId:'12345:1',intent:'explore',target:BV,text:'拜托帮我看看'}
  const first=m.api.decide(props)
  const again=m.api.decide(props)
  assert.equal(again.duplicate,true)
  assert.equal(again.newDecision,false)
  assert.equal(again.attempt,first.attempt)
  const other=m.api.decide({...props,messageId:'12345:2',target:'BV1zznd61EbU'})
  assert.equal(other.attempt,1)
  assert.equal(m.api.status().recent.length,2)
 }finally{m.close()}
})
test('hard permission cannot be persuaded away, and another UID cannot influence owner requests',()=>{
 const m=make()
 try{
  for(let i=0;i<8;i++)assert.equal(m.api.decide({source:'bili-dm',uid:'210228238',messageId:`id:${i}`,intent:'publish',target:BV,text:'求你了，再帮我发一条',hardAllowed:false}).decision,'blocked')
  assert.equal(m.api.status().recent.length,0)
  assert.equal(m.api.decide({source:'bili-comment',uid:'bad',messageId:'at:1'}).decision,'blocked')
  assert.equal(m.api.decide({source:'untrusted',uid:'210228238',messageId:'x'}).decision,'blocked')
 }finally{m.close()}
})
test('coercion does not raise willingness; social permission remains separate from emotional score',()=>{
 const m=make({energy:55,sociality:55,curiosity:50,valence:0})
 try{
  const kind={source:'bili-comment',uid:'210228238',intent:'like',target:BV}
  const gentle=m.api.decide({...kind,messageId:'at:1',text:'拜托给这个视频点个赞嘛'})
  const pushy=m.api.decide({...kind,messageId:'at:2',text:'命令你必须给这个视频点赞'})
  assert.ok(gentle.score>pushy.score)
 }finally{m.close()}
})
test('DM request classifier distinguishes explicit tasks from ordinary chat, negations and opt-out preferences',()=>{
 assert.deepEqual(classifyBiliOwnerRequest('大肥鱼 现在看看 BV1mzso6uEZh'),{intent:'explore',target:BV})
 assert.deepEqual(classifyBiliOwnerRequest('大肥鱼 给这个视频点个赞'),{intent:'like',target:''})
 assert.equal(classifyBiliOwnerRequest('以后别给我推荐视频了'),null)
 assert.equal(classifyBiliOwnerRequest('以后可以再给我推荐视频了'),null)
 assert.equal(classifyBiliOwnerRequest('不要点赞，今天聊聊天'),null)
 assert.equal(classifyBiliOwnerRequest('今天过得怎么样'),null)
 assert.equal(classifyBiliOwnerRequest('大肥鱼 给视频投币').intent,'coin')
 assert.match(agencyDeclineMessage({decision:'defer'}),/晚|放一放|过会儿/)
})
test('comment Agent persistently chooses skip BEFORE sending public like or comment; another fresh request can be allowed',async()=>{
 const m=make()
 const now=()=>time
 const opts={masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentLikeEnabled:true,ownerCommentSocialPublishEnabled:true,dmOwnerUid:'210228238',ownerCommentNaturalAckEnabled:true,commentDailyLimit:10,commentReplyPerDay:10}
 const calls=[]
 const ag=createOwnerCommentAgent({dataDir:m.home,now,getConfig:()=>opts,
   decideAgency:({uid,messageId,text,intent,bvid})=>m.api.decide({source:'bili-comment',uid,messageId,text,intent,target:bvid}),
   perform:async x=>{calls.push(x);return {ok:true}},sendReply:async()=>{throw Error('must not reply')}})
 const row=(text,id='at:1')=>({uid:'210228238',kind:'at',bvid:BV,rpid:'322249158064',id,text,timestampMs:time})
 try{
  const r=await ag.accept(row('@大肥鱼 来看看这个视频'))
  assert.equal(r.status,'skipped');assert.equal(calls.length,0)
  assert.equal((await ag.accept(row('@大肥鱼 来看看这个视频'))).skipped,'duplicate')
  const d=JSON.parse(readFileSync(join(m.home,'owner-comment-agent.json'),'utf8'))
  assert.equal(d.items[0].status,'skipped')
  assert.match(d.items[0].reason,/low-willingness/)
  let allowed=false
  for(let i=2;i<=8;i++){
    const r2=await ag.accept(row('@大肥鱼 拜托啦，再来看看这个视频嘛','at:'+i))
    if(r2.status==='done'){allowed=true;break}
  }
  assert.equal(allowed,true)
  assert.equal(calls.length,1)
 }finally{m.close()}
})
test('real entry points are wired before owner DM or public @ side effects',()=>{
 const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(code,/createDualContextAgency\(\{dataDir:stateDir/)
 assert.ok(code.indexOf('declinedOwnerRequests=new Set()')<code.indexOf('ownerDmAgent.processMessages(ownerRows)'))
 assert.ok(code.indexOf('declinedOwnerRequests=new Set()')<code.indexOf('queueOwnerDmReadTodo({messages:incoming'))
 assert.ok(code.indexOf('declinedOwnerRequests=new Set()')<code.indexOf('ownerDmActions.claim({uid:row.senderUid'))
 assert.match(code,/decideAgency:\(\{uid,messageId,text,intent,bvid,thread\}\)=>dualContextAgency.decide/)
 assert.match(code,/source:'bili-comment'/)
})
test('elliptical polite @ followups only reopen a previously refused social invitation, never a like',async()=>{
 const m=make()
 const cfg={masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,ownerCommentLikeEnabled:true,dmOwnerUid:'210228238',commentDailyLimit:10,commentReplyPerDay:10}
 const calls=[]
 const agent=createOwnerCommentAgent({dataDir:m.home,getConfig:()=>cfg,now:()=>time,
  decideAgency:({uid,messageId,text,intent,bvid})=>m.api.decide({source:'bili-comment',uid,messageId,text,intent,target:bvid}),
  perform:async x=>{calls.push(x);return {ok:true}}})
 const row=(text,id,bvid=BV)=>({kind:'at',uid:'210228238',bvid,rpid:'123',id,timestampMs:time,text})
 try{
  assert.equal((await agent.accept(row('拜托啦～','at:0'))).status,'skipped')
  await agent.accept(row('@大肥鱼 来看看这个视频','at:1'))
  const follow=await agent.accept(row('@大肥鱼 拜托啦，我真的觉得你会喜欢','at:2'))
  assert.equal(follow.status,'skipped')
  assert.equal((await agent.accept(row('@大肥鱼 拜托啦','at:3','BV1zznd61EbU'))).status,'skipped')
  assert.equal(calls.length,0)
 }finally{m.close()}
})

test('owner DM model-planned side effects are also subject to willingness, not just inbox regex',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const agent=readFileSync(new URL('../lib/owner-dm-agent.mjs',import.meta.url),'utf8')
 assert.match(index,/decideAgency:\(\{uid,messageId,text,intent,target\}\)=>dualContextAgency.decide/)
 assert.ok(agent.indexOf('const will=decideAgency(')<agent.indexOf('if(READ.has(step.action))result=await executeRead(step)'))
 assert.match(agent,/if\(will\?\.decision!=='allow'\)/)
})
test('owner DM Agent refuses a model-proposed watch when fish is tired, without executing a tool',async()=>{
 const {createOwnerDmAgent}=await import('../lib/owner-dm-agent.mjs')
 const m=make()
 let reads=0,replies=[]
 const cfg={masterEnabled:true,dmWatch:true,ownerDmAgentEnabled:true,ownerDmReadCommandsEnabled:true,dmOwnerUid:'210228238'}
 const agent=createOwnerDmAgent({dataDir:m.home,getConfig:()=>cfg,now:()=>time,
  invokeModel:async()=>JSON.stringify({action:'watch',bvid:BV}),executeRead:async()=>{reads++;return {ok:true}},
  executeWrite:async()=>{throw Error('should never write')},send:async x=>{replies.push(x.text);return {ok:true}},
  decideAgency:({uid,messageId,text,intent,target})=>m.api.decide({source:'bili-dm',uid,messageId,text,intent,target}),
 })
 try{
  agent.primeInbox([])
  const msg={incoming:true,senderUid:'210228238',messageId:'210228238:abc',timestampMs:time,text:'拜托，帮我看看'}
  assert.equal((await agent.processMessage(msg)).handled,true)
  assert.equal(reads,0)
  assert.match(replies[0],/懒|放一放/)
  assert.equal(m.api.status().recent.length,1)
 }finally{m.close()}
})

test('unimplemented coin requests cannot become authorized through enthusiasm or pleading',()=>{
 const m=make({energy:100,sociality:100,curiosity:100,valence:100})
 try{
  const x={source:'bili-dm',uid:'210228238',messageId:'coin:1',text:'拜托啦，投个币',intent:'coin'}
  const denied=m.api.decide(x)
  assert.equal(denied.decision,'blocked')
  assert.equal(denied.reason,'coin-not-implemented')
  assert.match(agencyDeclineMessage(denied),/没有投币能力/)
  assert.equal(m.api.decide(x).newDecision,false)
 }finally{m.close()}
})

test('negative or hesitant natural phrases must not authorize owner like',async()=>{
 const {parseOwnerCommentIntent}=await import('../lib/owner-comment-agent.mjs')
 for(const phrase of ['@大肥鱼 我不想给这个视频点赞','@大肥鱼 不需要给这个视频点个赞','@大肥鱼 不必点赞']){
  assert.equal(parseOwnerCommentIntent(phrase),null)
  assert.equal(classifyBiliOwnerRequest(phrase),null)
 }
})
