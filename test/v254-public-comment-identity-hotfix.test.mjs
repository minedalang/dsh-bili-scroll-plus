import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {recentComments} from '../lib/recent-comments.mjs'
import {createOwnerCommentAgent} from '../lib/owner-comment-agent.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'

const BV='BV1234567890',TIME=Date.parse('2026-10-31T02:30:00Z')
function fixture(){const dir=mkdtempSync(join(tmpdir(),'v254-identity-'));return {dir,close:()=>rmSync(dir,{recursive:true,force:true})}}
function seen(dir,rows){writeFileSync(join(dir,'seen.md'),'# 评论判重表\n## 评论记录\n'+rows.map(([rpid,root])=>`| ${BV} | ${rpid} | ${root} | 2026-10-31 10:50:00 | 已保存的回复正文 |`).join('\n')+'\n')}

// The owner/friend Agent is a separate reply path: previously no labels were read here.
test('v2.5.4: outgoing owner/friend receipt fills identity without creating a new public comment',async()=>{
 const fx=fixture();try{
  seen(fx.dir,[['322430862000','322430844288'],['322436448640','322436561248']])
  const sent=[]
  const agent=createOwnerCommentAgent({dataDir:fx.dir,now:()=>TIME,getRole:uid=>uid==='123'?'owner':'friend',
    getConfig:()=>({masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,
      commentAtEnabled:true,commentWatchReplies:true,dmOwnerUid:'123',commentDailyLimit:10,commentReplyPerDay:10}),
    decideAgency:()=>({decision:'allow'}),perform:async()=>({ok:true}),generateChat:async()=> '记得啦～🐟',
    sendReply:async args=>{sent.push(args);return {ok:true,rpid:sent.length===1?'322430862000':'322436448640'}}})
  for(const [uid,name,id] of [['123','主人昵称','at:1'],['456','好友昵称','at:2']]){
    const x=await agent.accept({id,kind:'at',scope:'self-top',uid,name,bvid:BV,rpid:'322430844288',root:'322430844288',timestampMs:TIME,text:'@大肥鱼 你记得这个视频吗？'})
    assert.equal(x.replyStatus,'sent')
  }
  const result=recentComments(fx.dir,{limit:20})
  assert.equal(result.total,2,'only seen.md determines which published rows exist')
  const [first,second]=result.rows.map(r=>({id:r.rpid,uid:r.recipientUid,name:r.recipientName,comment:r.recipientComment})).sort((a,b)=>a.id.localeCompare(b.id))
  assert.equal(first.uid,'123');assert.equal(first.name,'主人昵称');assert.match(first.comment,/记得这个视频/)
  assert.equal(second.uid,'456');assert.equal(second.name,'好友昵称')
  const persisted=JSON.parse(readFileSync(join(fx.dir,'owner-comment-agent.json'),'utf8'))
  assert.equal(persisted.items[0].recipientUid,'123')
  assert.equal(persisted.items[1].replyRpid,'322436448640')
 }finally{fx.close()}
})

test('v2.5.4: old confirmed owner record recovers only recorded UID, never invents nickname',()=>{
 const fx=fixture();try{
  seen(fx.dir,[['322430862000','322430844288'],['322436448640','322436561248'],['322436448641','322436561248']])
  writeFileSync(join(fx.dir,'owner-comment-agent.json'),JSON.stringify({version:1,items:[
   {key:'123:at:7',bvid:BV,replyRpid:'322430862000',replyStatus:'sent'},
   {key:'456:at:8',bvid:BV,replyRpid:'322436448640',replyStatus:'uncertain',recipientName:'假昵称'},
   {key:'789:at:9',bvid:BV,replyRpid:'322436448641',replyStatus:'sent',recipientUid:'111',recipientName:'不匹配'},
   {key:'123:at:10',bvid:BV,replyStatus:'sent',recipientName:'没有回执 ID'}
  ]}))
  const rows=recentComments(fx.dir).rows
  const old=rows.find(r=>r.rpid==='322430862000')
  assert.equal(old.recipientUid,'123');assert.equal(old.recipientName,'')
  assert.equal(rows.find(r=>r.rpid==='322436448640').recipientUid,'')
  assert.equal(rows.find(r=>r.rpid==='322436448641').recipientUid,'')
  assert.equal(rows.length,3)
 }finally{fx.close()}
})

test('v2.5.4: a missing generic state file must not block valid owner identity',()=>{
 const fx=fixture();try{
  seen(fx.dir,[['322430862000','322430844288']])
  writeFileSync(join(fx.dir,'owner-comment-agent.json'),JSON.stringify({version:1,items:[{key:'123:at:1',bvid:BV,replyRpid:'322430862000',replyStatus:'sent',recipientName:'甲'}]}))
  assert.deepEqual(recentComments(fx.dir).rows.map(r=>[r.recipientUid,r.recipientName]),[['123','甲']])
  writeFileSync(join(fx.dir,'comment-interact-state.json'),'{broken json')
  assert.deepEqual(recentComments(fx.dir).rows.map(r=>[r.recipientUid,r.recipientName]),[['123','甲']])
 }finally{fx.close()}
})

test('v2.5.4: date-only video timeline marks dateOnly instead of implying exact 20:00 time',()=>{
 const items=buildLifeTimeline({now:Date.parse('2026-10-31T09:00:00Z'),watched:[{bvid:BV,day:'2026-10-30',title:'旧视频'}]})
 assert.equal(items.length,1)
 assert.equal(items[0].dateOnly,true)
 assert.equal(items[0].day,'2026-10-30')
 const script=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(script,/row\.dateOnly.*仅记录日期/)
})
