import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createDailyDynamic,validateDailyDraft,dynamicContentIssue,extractVideoReaction} from '../lib/daily-dynamic.mjs'

const BV='BV1234567890',NOW=Date.parse('2026-10-30T12:00:00Z')
const title='我要刷贴吧！'
const events=[{bvid:BV,day:'2026-10-30',title,experience:'我曾经选中视频《我要刷贴吧！》'}]
const text='看到自己选中的“我要刷贴吧！”突然有点想去贴吧逛逛，又有点懒，先挂着吧。'
const config=()=>({masterEnabled:true,dailyDynamicEnabled:true,dailyDynamicDraftOnly:true,dailyDynamicDailyLimit:1,mainSessionMemoryHalfLifeDays:60})
const modelDraft=t=>({should_post:true,text:t,source_bvids:[BV],source_memory_ids:[],evidence_claims:[{type:'selected_video',bvid:BV}]})
const temporary=()=>mkdtempSync(join(tmpdir(),'dafeiyu-dev4-'))

test('可衰减视频来源不再暴露内部“我曾经选中视频”叙述，只保留已发生的本人反应',()=>{
 const dir=temporary()
 try{
  const g=createLifeMemoryGateway({dataDir:dir,now:()=>NOW,getConfig:config})
  g.recordEvents([{kind:'watch',bvid:BV,title,day:'2026-10-30'}])
  assert.deepEqual(g.publicVideoEvidence(1).map(x=>x.experience),[''])
  g.recordEvents([{kind:'watch',bvid:'BV1234567891',title:'睡懒觉是不是坏习惯',day:'2026-10-30',note:'好羡慕这种可以睡到自然醒的节奏'}])
  assert.equal(g.publicVideoEvidence(2).find(x=>x.bvid==='BV1234567891').experience,'好羡慕这种可以睡到自然醒的节奏')
  assert.equal(extractVideoReaction('我曾经选中视频《标题》'), '')
  assert.equal(extractVideoReaction('我曾经选中视频《标题》；当时想法是有点想看看'), '有点想看看')
  g.close()
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('用户截图的动态被拒绝，内部选片机制和照搬视频标题都不会入草稿',()=>{
 assert.match(dynamicContentIssue(text,events,[],[BV],[]),/内部流程/)
 assert.throws(()=>validateDailyDraft(modelDraft(text),events),/内部流程/)
 const echo='哎呀，“我要刷贴吧！”听着好热闹，可是我今天就想安安静静地偷个懒。'
 assert.throws(()=>validateDailyDraft(modelDraft(echo),events),/标题/)
})

test('只有选片标题，没有自己真实的想法时不能编造去其他平台做事的愿望',()=>{
 const future='突然有点想去贴吧逛逛，不过又懒得动弹了，还是先歇一下吧。'
 assert.throws(()=>validateDailyDraft(modelDraft(future),events),/编造想去做/)
 const okay='今天有点懒，好像一条小鱼在水里随便漂一漂，也不错嘛。'
 assert.equal(validateDailyDraft(modelDraft(okay),events).text,okay)
 // A *real*, already recorded response can justify a future plan. It is not
 // enough for the title or the model itself to simply assert it happened.
 assert.equal(validateDailyDraft(modelDraft(future),[{...events[0],experience:'之前确实想去贴吧看看'}]).text,future)
})

test('被质量门槛拦截的动态不保存、不重试模型、不发布，并且素材提示词不暴露旧记忆选片原话',async()=>{
 const dir=temporary();let models=0,publishes=0,prompt=''
 try{
  const engine=createDailyDynamic({dataDir:dir,getConfig:config,getPublicVideos:()=>events,invokeModel:async p=>{models++;prompt=p;return JSON.stringify(modelDraft(text))},publish:async()=>{publishes++;return {status:'api_accepted_unverified'}}})
  const r=await engine.createDraft()
  assert.equal(r.skipped,'quality-gate')
  assert.equal(r.ok,true)
  assert.equal(models,1)
  assert.equal(publishes,0)
  assert.deepEqual(engine.list(),[])
  assert.doesNotMatch(prompt,/我曾经选中视频《我要刷贴吧/)
  assert.match(prompt,/标题仅提供话题线索|已选公开视频话题线索|入选视频只是提供一个话题/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('dev.3 遗留的可疑草稿，手动确认也不能绕过质量闸门；普通短动态仍可发布',async()=>{
 const dir=temporary();let count=0
 try{
  mkdirSync(join(dir,'daily-dynamic'),{recursive:true})
  const old={id:'old',day:'2026-10-30',createdAt:'2026-10-30T12:00:00Z',status:'draft',...modelDraft(text),style:'mumble'}
  writeFileSync(join(dir,'daily-dynamic','drafts.json'),JSON.stringify({drafts:[old]}))
  const engine=createDailyDynamic({dataDir:dir,getConfig:()=>({...config(),dailyDynamicDraftOnly:false}),getPublicVideos:()=>events,invokeModel:async()=>JSON.stringify({should_post:false}),publish:async()=>{count++;return {status:'api_accepted_unverified'}}})
  assert.equal((await engine.sendDraft('old',{manual:true})).skipped,'quality-gate')
  assert.equal((await engine.sendDraft('old',{manual:false})).skipped,'quality-gate')
  assert.equal(count,0)
  assert.equal(engine.list()[0].status,'draft')
  assert.match(engine.list()[0].qualityIssue,/内部流程/)
  assert.equal(engine.deleteDraft('old').ok,true)
  assert.equal(engine.list().length,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('管理页会显示被拦截的旧草稿原因，并隐藏发布按钮，只保留删除操作',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(js,/if\(d\.qualityIssue\)evidenceInfo\.push\('已阻止发布/)
 assert.match(js,/if\(!d\.qualityIssue\)add\(actions,btn\('确认公开发布这条动态'/)
})
