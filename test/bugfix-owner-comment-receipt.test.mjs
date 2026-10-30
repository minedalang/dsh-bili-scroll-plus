import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {confirmedOwnerCommentReceipt} from '../lib/owner-comment-receipt.mjs'
import {createOwnerCommentAgent} from '../lib/owner-comment-agent.mjs'

const BV='BV1SqHK6oE2i', UID='210228238', TIME=1793279059125
const reply={ok:true,action:'reply',bvid:BV,receipt:{success:true,rpid_str:'322276993125',root:'322275838160'}}

test('Python MCP real successful reply shape is recognized and captures nested reply ID',()=>{
 assert.deepEqual(confirmedOwnerCommentReceipt(reply,'reply'),{ok:true,rpid:'322276993125'})
 assert.deepEqual(confirmedOwnerCommentReceipt({ok:true,action:'comment',receipt:{success:true,rpid:987654321}},'comment'),{ok:true,rpid:'987654321'})
 assert.deepEqual(confirmedOwnerCommentReceipt({ok:true,action:'reply',receipt:{success:true}},'reply'),{ok:true,rpid:''},'API acceptance with no ID cannot invent one')
})

test('missing, failed, wrong-action, and non-boolean receipt never count as confirmed success',()=>{
 for (const raw of [null,{}, {ok:true,action:'reply'}, {ok:true,action:'reply',sent:true},
  {ok:true,action:'reply',receipt:{success:false,rpid:'123'}},
  {ok:true,action:'reply',receipt:{success:'true',rpid:'123'}},
  {ok:false,action:'reply',receipt:{success:true,rpid:'123'}},
  {ok:true,action:'comment',receipt:{success:true,rpid:'123'}},
  {ok:true,action:'reply',receipt:{success:true,rpid:'0'}}]) {
   const r=confirmedOwnerCommentReceipt(raw,'reply')
   if(raw?.receipt?.rpid==='0')assert.deepEqual(r,{ok:true,rpid:''})
   else assert.equal(r.ok,false,JSON.stringify(raw))
 }
})

test('owner chat records sent, stores real reply ID, and never sends duplicate notification',async()=>{
 const dataDir=mkdtempSync(join(tmpdir(),'dafeiyu-receipt-'))
 let posted=0
 try{
  const agent=createOwnerCommentAgent({dataDir,
   getConfig:()=>({ownerCommentAgentEnabled:true,masterEnabled:true,ownerCommentSocialPublishEnabled:true,dmOwnerUid:UID,commentDailyLimit:6,commentReplyPerDay:6}),
   now:()=>TIME,
   decideAgency:()=>({decision:'allow',score:88,attempt:1}),
   perform:async()=>{throw Error('chat should not perform public top-level comment')},
   generateChat:async()=> '才没有忧郁，就是有点犯懒啦',
   sendReply:async()=>{posted++;return confirmedOwnerCommentReceipt(reply,'reply')}
  })
  const row={kind:'notice',scope:'self-top',id:'comment:322276235456',uid:UID,bvid:BV,rpid:'322276235456',root:'322275838160',timestampMs:TIME,text:'我说这视频里的肥鱼忧郁'}
  const out=await agent.accept(row)
  assert.equal(out.status,'done');assert.equal(out.replyStatus,'sent')
  const record=JSON.parse(readFileSync(join(dataDir,'owner-comment-agent.json'),'utf8')).items[0]
  assert.equal(record.status,'done');assert.equal(record.replyStatus,'sent')
  assert.equal(record.replyRpid,'322276993125');assert.equal(record.thread,BV+':322275838160')
  assert.equal((await agent.accept(row)).skipped,'duplicate')
  assert.equal(posted,1)
 } finally{rmSync(dataDir,{recursive:true,force:true})}
})

test('index.js verifies nested comment tool receipt on all three publisher paths',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(source,/confirmedOwnerCommentReceipt\(result, Number\(task\.rpid\)>0\?'reply':'comment'\)\.ok/)
 assert.match(source,/confirmedOwnerCommentReceipt\(r,'comment'\)\.ok/)
 assert.match(source,/const receipt=confirmedOwnerCommentReceipt\(r,'reply'\)/)
 assert.match(source,/if\(receipt\?\.ok===true\)/)
 assert.match(source,/return receipt/)
 assert.doesNotMatch(source,/r\?\.ok===true&&r\?\.sent===true/)
})
