import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDailyDynamic,validateDailyDraft} from '../lib/daily-dynamic.mjs'
import {createMemeLearning} from '../lib/meme-learning.mjs'
import {allowedPath} from '../lib/data-backup.mjs'
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const videos=[{bvid:'BV1234567890',title:'料理视频',day:'2026-10-27'},{bvid:'BV0987654321',title:'做饭视频',day:'2026-10-26'}]
test('生活动态必须有真实 BV 来源、合格正文，不允许编造来源或泄露私密',()=>{
 const text='今天又看到一个认真做饭的视频，看着食材慢慢变成一顿饭，我真的很想试试这种感觉。'
 assert.deepEqual(validateDailyDraft({should_post:true,text,source_bvids:['BV1234567890'],evidence_claims:[{type:'selected_video',bvid:'BV1234567890'}]},videos).source_bvids,['BV1234567890'])
 assert.throws(()=>validateDailyDraft({should_post:true,text,source_bvids:['BV0000000000']},videos),/真实/)
 assert.throws(()=>validateDailyDraft({should_post:true,text:'我刚刚看到主人的密码 password，非常有趣值得分享。',source_bvids:['BV1234567890'],evidence_claims:[{type:'selected_video',bvid:'BV1234567890'}]},videos),/安全/)
 assert.equal(validateDailyDraft({should_post:false,reason:'没什么新鲜事'},videos).skip,true)
})
test('自主动态默认不发布，草稿与公开发布必须分离且每日限额生效',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'daily-v2485-'));let posts=0
 const cfg={masterEnabled:true,dailyDynamicEnabled:false,dailyDynamicDraftOnly:true,dailyDynamicDailyLimit:1}
 const text='今天又看到一个认真做饭的视频，看着食材慢慢变成一顿饭，我真的很想试试这种感觉。'
 const service=createDailyDynamic({dataDir:dir,getConfig:()=>cfg,getPublicVideos:()=>videos,invokeModel:async()=>JSON.stringify({should_post:true,text,source_bvids:['BV1234567890'],evidence_claims:[{type:'selected_video',bvid:'BV1234567890'}]}),publish:async()=>{posts++;return{status:'api_accepted_unverified'}}})
 try{
  const d=await service.createDraft();assert.equal(d.ok,true);assert.equal(posts,0)
  assert.equal((await service.sendDraft(d.draft.id,{manual:true})).ok,false)
  cfg.dailyDynamicEnabled=true
  assert.equal((await service.sendDraft(d.draft.id,{manual:true})).ok,true)
  assert.equal(posts,1)
  assert.equal((await service.sendDraft(d.draft.id,{manual:true})).ok,false)
  assert.equal(service.status().drafts[0].status,'published')
 }finally{service.stop();rmSync(dir,{recursive:true,force:true})}
})
test('跨视频梗反思只接受两个不同 BV 的真实线索 ID',async()=>{
 const entries=[{id:1,name:'奶蛙',bvid:'BV1234567890',evidence:'奶蛙又出现了',evidence_type:'评论'},
  {id:2,name:'奶蛙',bvid:'BV0987654321',evidence:'奶蛙的小剧场',evidence_type:'字幕'}]
 let saved
 const svc=createMemeLearning({getConfig:()=>({masterEnabled:true,memeMemoryEnabled:true}),read:async()=>({ok:true,rows:entries}),invokeModel:async()=>JSON.stringify({entries:[{name:'奶蛙',kind:'角色',meaning:'一种在不同视频中出现的网络二创形象，具体来源尚待核实。',observation_ids:[1,2]}]}),commit:async d=>{saved=d;return {ok:true,created:1}}})
 assert.equal((await svc.reflect({force:true})).created,1)
 assert.deepEqual(saved.entries[0].observation_ids,[1,2])
})
test('单个视频不足以形成跨视频梗知识',async()=>{
 let called=false
 const svc=createMemeLearning({getConfig:()=>({masterEnabled:true,memeMemoryEnabled:true}),read:async()=>({rows:[{id:1,name:'奶蛙',bvid:'BV1234567890'}]}),invokeModel:async()=>{called=true},commit:async()=>{throw Error('should not commit')}})
 const result=await svc.reflect({force:true});assert.equal(result.skipped,'insufficient-cross-video-evidence');assert.equal(called,false)
})
test('原生设置只显示日常，保留时段、间隔和作者致谢',()=>{
 const s=source('client.js')
 assert.match(s,/const tab = 'daily'/)
 assert.doesNotMatch(s,/\[\['daily', '日常'\], \['taste'/)
 assert.match(s,/刷视频间隔（分钟）/)
 assert.match(s,/自定义时段自动刷/)
 assert.match(s,/开源来源与致谢/)
 assert.match(s,/space\.bilibili\.com\/210228238/)
})
test('模型和 B站生活设置只在管理中心集中显示',()=>{
 const html=source('lib/management-console.html'),js=source('lib/management-console.js')
 for(const x of ['panel-models','panel-bili','panel-dynamic','models-memory','bili-auto-like','bili-daily-enabled','daily-dynamic-list'])assert.ok(html.includes(x),x)
 assert.match(js,/modelDefs/);assert.match(js,/loadModels/);assert.match(js,/loadBili/)
})
test('可配置点赞每日上限由宿主传给 Python 工具，工具不能绕过',()=>{
 const host=source('index.js'),py=source('vendor/bilibili-mcp/mcp_server.py')
 assert.match(host,/autoVideoLikeDailyLimit: z\.natural\(\)\.default\(10\)/)
 assert.match(host,/BILI_AUTO_VIDEO_LIKE_DAILY_LIMIT/)
 assert.match(py,/os\.environ\.get\('BILI_AUTO_VIDEO_LIKE_DAILY_LIMIT'/)
 assert.match(py,/_claim_video_action\(uid,bv,'like',limit\)/)
})
test('完整业务备份包含动态草稿与独立发布配额数据库',()=>{
 assert.equal(allowedPath('daily-dynamic/drafts.json'),true)
 assert.equal(allowedPath('daily-dynamic/bili_credential.json'),false)
 assert.match(source('lib/data-backup-sqlite.py'),/daily-dynamic\/publish-quota\.sqlite3/)
})

test('新增动态开关与每日上限可通过管理中心接口保存，默认不公开发布',async()=>{
 const {apply}=await import('../index.js')
 const {Readable}=await import('node:stream')
 const dir=mkdtempSync(join(tmpdir(),'v2485-config-'));let handler
 const ctx={get:k=>k==='dshHomePath'?(...p)=>join(dir,...p):undefined,
  logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(spec){handler=spec.handler;return{dispose(){}}}},
  effect:x=>x(),settings:{describe(){return[]}},slots:{register(){},inject(){}}}
 try{
  apply(ctx,{})
  const call=async(method,body)=>{
   const req=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[])
   req.method=method;req.url='/api/bili-duty/config';req.headers={host:'localhost'}
   let code=0,data;const res={writeHead(n){code=n},end(x){data=JSON.parse(x)}}
   await handler(req,res);assert.equal(code,200);return data.config
  }
  const before=await call('GET');assert.equal(before.dailyDynamicEnabled,true);assert.equal(before.dailyDynamicDraftOnly,true)
  const after=await call('POST',{autoVideoLikeDailyLimit:17,dailyDynamicEnabled:true,dailyDynamicDraftOnly:false,dailyDynamicDailyLimit:3})
  assert.equal(after.autoVideoLikeDailyLimit,17);assert.equal(after.dailyDynamicEnabled,true)
  assert.equal(after.dailyDynamicDraftOnly,false);assert.equal(after.dailyDynamicDailyLimit,3)
  const bounded=await call('POST',{autoVideoLikeDailyLimit:999,dailyDynamicDailyLimit:999})
  assert.equal(bounded.autoVideoLikeDailyLimit,100);assert.equal(bounded.dailyDynamicDailyLimit,10)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
