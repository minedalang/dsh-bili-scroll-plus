import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {apply} from '../index.js'
import {createEmotionRecall,__test as recallTest} from '../lib/emotion-recall.mjs'

function apiFixture(){
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dev2-api-'))
  let handle
  const ctx={get:k=>k==='dshHomePath'?(...args)=>join(dir,...args):undefined,
    logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){handle=x.handler;return {dispose(){}}}},effect:fn=>fn(),settings:{describe(){return []}}}
  apply(ctx,{})
  const call=async(method,path,body)=>{
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))])
    req.method=method;req.url='/api/bili-duty/'+path;req.headers={host:'127.0.0.1:7012'}
    let status=0,output='';const res={writeHead(n){status=n},end(x){output=String(x??'')}}
    await handle(req,res)
    return {status,json:JSON.parse(output)}
  }
  return {dir,call,cleanup:()=>rmSync(dir,{force:true,recursive:true})}
}

test('开发版允许不限次数与高于3的每日次数；评估间隔按1–48小时钳制',async()=>{
  const f=apiFixture()
  try{
    let r=await f.call('POST','config',{emotionRecallDailyLimit:86,emotionRecallUnlimited:true,emotionRecallCooldownHours:1})
    assert.equal(r.status,200,JSON.stringify(r.json))
    assert.equal(r.json.config.emotionRecallDailyLimit,86)
    assert.equal(r.json.config.emotionRecallUnlimited,true)
    assert.equal(r.json.config.emotionRecallCooldownHours,1)
    r=await f.call('GET','emotion-recall')
    assert.equal(r.status,200);assert.equal(r.json.config.unlimited,true)
    assert.equal(r.json.config.daily,86);assert.equal(r.json.config.cooldown,1)
    r=await f.call('POST','config',{emotionRecallUnlimited:false,emotionRecallDailyLimit:0,emotionRecallCooldownHours:168})
    assert.equal(r.json.config.emotionRecallUnlimited,false)
    assert.equal(r.json.config.emotionRecallDailyLimit,0)
    assert.equal(r.json.config.emotionRecallCooldownHours,48)
  }finally{f.cleanup()}
})

test('不限次数时旧的每日计数不会阻止发送；未授权与无真实记忆仍不能发',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dev2-unlimited-'))
 try{
   const when=Date.parse('2026-10-28T11:00:00')
   const day=recallTest.localDay(when)
   writeFileSync(join(dir,'emotion-recall.json'),JSON.stringify({version:1,day,checks:0,sent:900,lastCheckAt:0,lastEmotionAt:0,recentKeys:[]}))
   let models=0,sends=0
   const getConfig=()=>({masterEnabled:true,emotionSystemEnabled:true,mainSessionMemoryEnabled:true,emotionRecallEnabled:true,
     emotionRecallMainEnabled:true,emotionRecallDmEnabled:false,emotionRecallDailyLimit:1,emotionRecallUnlimited:true,emotionRecallCooldownHours:1,emotionRecallStartHour:0,emotionRecallEndHour:24})
   const x=createEmotionRecall({dataDir:dir,getConfig,getEmotion:()=>({enabled:true,mood:'warm',intensity:70,updatedAt:new Date(when-60_000).toISOString()}),
     getRecentEvents:()=>[],getMemories:()=>[],invokeModel:async()=>{models++;return '{"action":"skip"}'},
     sendDm:async()=>{sends++;return {ok:true}},sendMain:async()=>{sends++;return {ok:true}},canMain:()=>true,now:()=>when,logger:{warn(){}}})
   assert.equal((await x.tick()).skipped,'no-verified-recurrence')
   assert.equal(models,0);assert.equal(sends,0)
   assert.equal(x.status().config.unlimited,true)
   const z=createEmotionRecall({dataDir:dir,getConfig:()=>({...getConfig(),emotionRecallUnlimited:false}),getEmotion:()=>({enabled:true,mood:'warm',intensity:70,updatedAt:new Date(when-60_000).toISOString()}),
     getRecentEvents:()=>[],getMemories:()=>[],invokeModel:async()=>{models++;return '{}'},sendDm:async()=>({ok:true}),sendMain:async()=>({ok:true}),canMain:()=>true,now:()=>when})
   assert.equal((await z.tick()).skipped,'daily-limit')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('真实 HTTP 删除路由仅删除未发布草稿，拒绝无确认和已发布记录',async()=>{
 const f=apiFixture()
 try{
   const file=join(f.dir,'bili-duty','daily-dynamic','drafts.json')
   mkdirSync(join(file,'..'),{recursive:true})
   writeFileSync(file,JSON.stringify({drafts:[{id:'local-only',status:'draft',text:'可删除的本地草稿'},
     {id:'sent',status:'published',text:'已发表记录'}, {id:'uncertain',status:'uncertain',text:'发送状态不确定'}]}))
   const status=await f.call('GET','daily-dynamic')
   assert.equal(status.status,200);assert.equal(status.json.canDeleteDraft,true)
   let r=await f.call('POST','daily-dynamic/delete',{id:'local-only'})
   assert.equal(r.status,400)
   r=await f.call('POST','daily-dynamic/delete',{id:'sent',confirm:true})
   assert.equal(r.status,409)
   r=await f.call('POST','daily-dynamic/delete',{id:'uncertain',confirm:true})
   assert.equal(r.status,409)
   r=await f.call('POST','daily-dynamic/delete',{id:'local-only',confirm:true})
   assert.equal(r.status,200,JSON.stringify(r.json));assert.equal(r.json.deletedId,'local-only')
   const rows=JSON.parse(readFileSync(file,'utf8')).drafts
   assert.deepEqual(rows.map(x=>x.id),['sent','uncertain'])
 }finally{f.cleanup()}
})

test('人生记忆每项设置都有可阅读的浅色效果说明，旧版后端提示对用户可见',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const home=html.split('<h4>3. 人生记忆与检索设置</h4>')[1].split('id="main-memory-save"')[0]
 const controls=[...home.matchAll(/<input\b[^>]*\bid="(main-memory-[^"]+|main-reflection-[^"]+)"[^>]*>/g)]
 assert.ok(controls.length>=18)
 for(const m of controls){
   const tail=home.slice(m.index+m[0].length,m.index+m[0].length+380)
   assert.match(tail,/^<small class="setting-note">.{4,}<\/small>/,m[1])
 }
 assert.match(html,/\.setting-note\{/)
 assert.match(html,/emotion-recall-unlimited/)
 assert.match(js,/运行中的 DSH 插件后端仍是旧版/)
 assert.match(js,/canDeleteDraft/)
})
