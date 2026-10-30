import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {apply} from '../index.js'

function fixture(){
 const home=mkdtempSync(join(tmpdir(),'bili-console-'))
 let handler=null
 const ctx={get:k=>k==='dshHomePath'?(...xs)=>join(home,...xs):undefined,
   logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handler=x.handler;return {dispose(){}}}},effect:f=>f(),settings:{describe(){return []}}}
 apply(ctx,{})
 async function call(method,path,body,headers={host:'127.0.0.1:7012'}){
   const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
   req.url='/api/bili-duty/'+path;req.method=method;req.headers=headers
   let code,headersOut,payload
   const res={writeHead(c,h){code=c;headersOut=h},end(x){payload=String(x??'')}}
   await handler(req,res)
   return {code,headers:headersOut,text:payload,json(){return JSON.parse(payload)}}
 }
 return {home,call,close:()=>rmSync(home,{recursive:true,force:true})}
}

test('manage HTML and JS are served from same DSH route without extra port or process',async()=>{
 const fx=fixture();try{
   const h=await fx.call('GET','manage')
   assert.equal(h.code,200)
   assert.match(h.headers['content-type'],/text\/html/)
   assert.match(h.headers['content-security-policy'],/script-src 'self'/)
   assert.match(h.headers['content-security-policy'],/img-src 'self'/,'same-origin image previews must be allowed by CSP')
   assert.match(h.text,/成长记忆/)
   assert.match(h.text,/梗知识库/)
   assert.match(h.text,/限额聊天申请/)
   assert.match(h.text,/manage\.js/)
   assert.match(h.text,/运行诊断/)
   assert.match(h.text,/每日报告/)
   assert.match(h.text,/后台私信/)
   assert.match(h.text,/最近评论/)
   assert.match(h.text,/测试私信接口连接/)
   const js=await fx.call('GET','manage.js')
   assert.equal(js.code,200)
   assert.match(js.headers['content-type'],/javascript/)
   assert.match(js.text,/meme-memory\/review/)
   assert.match(js.text,/dm-approvals/)
   assert.match(js.text,/mention-diagnostics/)
   assert.match(js.text,/meme-diagnostics/)
   assert.match(js.text,/recent-comments/)
   assert.match(js.text,/dm-recent/)
   assert.ok(!js.text.includes('.innerHTML ='))
   assert.ok(!h.text.includes('18763'))
   const recentComments=await fx.call('GET','recent-comments?limit=20')
   assert.equal(recentComments.code,200)
   assert.equal(recentComments.json().ok,true)
   assert.ok(Array.isArray(recentComments.json().rows))
   const dmRecent=await fx.call('GET','dm-recent')
   assert.equal(dmRecent.code,200)
   assert.equal(dmRecent.json().ok,true)
   assert.ok(Array.isArray(dmRecent.json().conversations))
   const dmNetwork=await fx.call('POST','dm-network-check',{})
   assert.equal(dmNetwork.code,200)
   assert.equal(dmNetwork.json().ok,false)
   assert.match(dmNetwork.json().error,/登录凭证/)
   const client=await import('node:fs').then(m=>m.readFileSync(new URL('../client.js',import.meta.url),'utf8'))
   assert.match(client,/jpost\('\/open', \{ what: 'manage' \}\)/)
 }finally{fx.close()}
})


test('最近评论 API 只返回判重表中保存的 BV/rpid/时间/短摘要',async()=>{
 const fx=fixture();try{
   const seen=join(fx.home,'bili-duty','seen.md')
   writeFileSync(seen,[
     '# 视频判重表',
     '## 评论记录',
     '| BV | rpid | root | 时间 | 正文前20字 |',
     '|---|---:|---:|---|---|',
     '| BV1234567890 | 321798740304 | 0 | 2026-10-25T10:00:00 | 白米饭都拿出来了 |',
     '## 看过的视频',
   ].join('\n'),'utf8')
   const res=await fx.call('GET','recent-comments?limit=10')
   assert.equal(res.code,200)
   assert.equal(res.json().rows.length,1)
   assert.equal(res.json().rows[0].bvid,'BV1234567890')
   assert.equal(res.json().rows[0].rpid,'321798740304')
   assert.match(res.json().rows[0].snippet,/白米饭都拿出来了/)
 }finally{fx.close()}
})

test('management page API rejects different localhost port and hostile web origin',async()=>{
 const fx=fixture();try{
   const hostile=await fx.call('GET','manage',undefined,{host:'127.0.0.1:7012',origin:'https://evil.example'})
   assert.equal(hostile.code,403)
   const otherPort=await fx.call('POST','persona-growth',{action:'add',type:'style',text:'明显可用的主人纠正经验'},
    {host:'127.0.0.1:7012',origin:'http://127.0.0.1:9812'})
   assert.equal(otherPort.code,403)
   const okay=await fx.call('POST','persona-growth',{action:'add',type:'style',text:'明显可用的主人纠正经验'},
    {host:'127.0.0.1:7012',origin:'http://127.0.0.1:7012'})
   assert.equal(okay.code,200)
 }finally{fx.close()}
})

test('meme moderation invalid writes are rejected; empty library is safe',async()=>{
 const fx=fixture();try{
   const listing=await fx.call('GET','meme-memory?q=奶蛙')
   assert.equal(listing.code,200)
   assert.equal(listing.json().total,0)
   const bad=await fx.call('POST','meme-memory/review',{id:-3,status:'approved'})
   assert.equal(bad.code,400)
 }finally{fx.close()}
})


test('管理中心复用原生设置接口修改限额申请开关和额度',async()=>{
 const fx=fixture();try{
  const initial=(await fx.call('GET','config')).json();
  assert.equal(initial.ok,true);
  const change=await fx.call('POST','config',{dmApprovalEnabled:true,dmApprovalPhrase:'白饭🍚',dmApprovedDailyLimit:3,dmApprovedTotalLimit:12});
  assert.equal(change.code,200);
  assert.equal(change.json().ok,true);
  const saved=(await fx.call('GET','config')).json().config;
  assert.equal(saved.dmApprovalEnabled,true);
  assert.equal(saved.dmApprovedDailyLimit,3);
  assert.equal(saved.dmApprovedTotalLimit,12);
 }finally{fx.close()}
});
