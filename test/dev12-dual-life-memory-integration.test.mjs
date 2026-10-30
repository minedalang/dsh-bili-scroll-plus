import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLifeMemoryGateway } from '../lib/life-memory-gateway.mjs'
import { createBackup, validateBackup, restoreBackupFiles, createLifeMemoryBackup, inspectLifeMemoryBackup, restoreLifeMemoryBackup } from '../lib/data-backup.mjs'
import { validateDailyDraft } from '../lib/daily-dynamic.mjs'
import { createLifeReflection } from '../lib/life-reflection.mjs'
import { createMemoryRetriever } from '../lib/memory-retriever.mjs'

const home=()=>mkdtempSync(join(tmpdir(),'dafeiyu-dual-memory-'))
const BV='BV1234567890'
const t0=Date.parse('2026-10-30T12:00:00.000Z')
const config=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryHalfLifeDays:15,mainSessionMemoryMaxItems:6,mainSessionMemoryMaxChars:1000,
  mainSessionReflectionAuto:true,mainSessionReflectionMinCandidates:2,mainSessionReflectionBatchSize:6,mainSessionReflectionIntervalHours:1,mainSessionReflectionDailyBatches:2})
const event=(at=t0)=>({kind:'watch',bvid:BV,day:'2026-10-30',at,title:'真实的独立游戏制作视频',key:'watch:one',note:'我对这个话题产生了好奇'})

// Absolute data separation: no exported archive-recall API, no old details in
// the fading copy once decay has advanced, and no restore-based reanimation.
test('真实档案永久留存；可用记忆丢细节且遗忘不可逆',()=>{
 const dir=home();let clock=t0
 try{
  const gateway=createLifeMemoryGateway({dataDir:dir,getConfig:config,now:()=>clock})
  gateway.recordEvents([event()]);assert.equal(gateway.recall({query:''})[0].stage,'clear')
  assert.equal(typeof gateway.readArchive,'undefined')
  const archive=join(dir,'life-memory','archive','2026-10.jsonl')
  assert.ok(existsSync(archive));assert.match(readFileSync(archive,'utf8'),/真实的独立游戏制作视频/)
  clock+=15*86400000
  let episodes=JSON.parse(readFileSync(gateway.file,'utf8'))
  assert.equal(gateway.recall({query:''})[0].stage,'fuzzy')
  episodes=JSON.parse(readFileSync(gateway.file,'utf8'))
  assert.equal(episodes.episodes[0].key,undefined)
  assert.equal(episodes.episodes[0].bvid,undefined)
  assert.doesNotMatch(JSON.stringify(episodes.episodes[0]),/BV1234567890/)
  clock+=240*86400000
  assert.deepEqual(gateway.recall({query:''}),[])
  const faded=JSON.parse(readFileSync(gateway.file,'utf8')).episodes[0]
  assert.equal(faded.stage,'forgotten');assert.equal(faded.text,'');assert.equal(faded.fuzzy,undefined)
  clock+=10*86400000
  assert.deepEqual(gateway.recall({query:''}),[])
  assert.match(readFileSync(archive,'utf8'),/真实的独立游戏制作视频/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('经过验证的 UID 只能回忆自己的公开互动，陌生人不获得他人经历',()=>{
 const dir=home()
 try{
  const gate=createLifeMemoryGateway({dataDir:dir,getConfig:config,now:()=>t0})
  gate.recordEvents([{kind:'social',bvid:BV,key:'social:101:thread:1',actorUid:'101',at:t0,text:'你明天还记得我吗？'},
    {kind:'social',bvid:BV,key:'social:202:thread:1',actorUid:'202',at:t0,text:'一起聊聊料理吧'}])
  const a=gate.recall({query:'',domain:'bili-life',role:'friend',actorUid:'101'})
  assert.equal(a.length,1);assert.match(a[0].summary,/明天还记得/);assert.doesNotMatch(a[0].summary,/料理/)
  assert.equal(gate.recall({query:'',domain:'bili-life',role:'stranger',actorUid:'101'}).length,0)
  // A returning friend may say only 'I'm back'; a safe, recent UID match
  // should recall yesterday's exchange even without shared keywords.
  assert.equal(gate.recall({query:'我又来啦！',domain:'bili-life',role:'friend',actorUid:'101'}).length,1)
  assert.equal(gate.recall({query:'',domain:'bili-life',role:'friend',actorUid:'999'}).length,0)
  const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:config,getEpisodes:(query,opts)=>gate.recall({query,...opts})})
  assert.match(retriever.socialContext('你明天还记得我吗？',{role:'friend',actorUid:'101'}),/明天还记得/)
  assert.doesNotMatch(retriever.socialContext('你明天还记得我吗？',{role:'friend',actorUid:'202'}),/明天还记得/)
  assert.equal(retriever.socialContext('你明天还记得我吗？',{role:'stranger',actorUid:'101'}),'')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('新完整备份有永久档案清单和 SHA-256，篡改与路径伪造都会拒绝',()=>{
 const dir=home(),target=home()
 try{
  const gate=createLifeMemoryGateway({dataDir:dir,getConfig:config,now:()=>t0});gate.recordEvents([event()])
  const backup=createBackup({root:dir,config:{mainSessionMemoryEnabled:true},sqlite:{}})
  assert.equal(backup.schema,2)
  assert.ok(backup.files['life-memory/archive/2026-10.jsonl'])
  assert.ok(backup.files['life-memory/episodic.json'])
  assert.equal(validateBackup(backup).integrity,'sha256-verified')
  const bad=structuredClone(backup)
  bad.files['life-memory/archive/2026-10.jsonl']+='tampered'
  assert.throws(()=>validateBackup(bad),/完整性校验失败/)
  const badPath=structuredClone(backup)
  badPath.files['../credential.json']='evil'
  assert.throws(()=>validateBackup(badPath),/完整性校验失败/)
  restoreBackupFiles(target,backup)
  assert.equal(readFileSync(join(target,'life-memory','archive','2026-10.jsonl'),'utf8'),backup.files['life-memory/archive/2026-10.jsonl'])
 }finally{rmSync(dir,{recursive:true,force:true});rmSync(target,{recursive:true,force:true})}
})

test('恢复旧的清晰备份，不能让当前已遗忘细节复活；人生记忆独立备份有校验',()=>{
 const dir=home();let clock=t0
 try{
  const gate=createLifeMemoryGateway({dataDir:dir,getConfig:config,now:()=>clock})
  gate.recordEvents([event()])
  const older=createBackup({root:dir,config:{},sqlite:{}})
  const standalone=createLifeMemoryBackup(dir)
  assert.equal(inspectLifeMemoryBackup(standalone).integrity,'sha256-verified')
  assert.equal(standalone.files['long-term-memory/dafeiyu.json']!==undefined,true)
  clock+=250*86400000;assert.deepEqual(gate.recall({query:''}),[])
  restoreBackupFiles(dir,older)
  assert.deepEqual(gate.recall({query:''}),[])
  restoreLifeMemoryBackup(dir,standalone)
  assert.deepEqual(gate.recall({query:''}),[])
  assert.equal(gate.status().counts.forgotten,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('反思只能使用衰减证据，并要求领悟 + 行为变化，不会强行生成流水账',async()=>{
 const dir=home();let clock=t0,usedPrompt='',committed=[]
 try{
  const gate=createLifeMemoryGateway({dataDir:dir,getConfig:config,now:()=>clock})
  gate.recordEvents([event()]);const reflect=createLifeReflection({dataDir:dir,getConfig:config,memoryGateway:gate,now:()=>clock,
   invokeModel:async prompt=>{usedPrompt=prompt;return JSON.stringify({memories:[{candidate_ids:[reflect.list('pending')[0].id],insight:'我发现真实交流比重复流水账更有意义。',behavior:'以后我希望更珍惜新的共同经历。',importance:.7,tags:['理解']}],note:'形成了认识'})},
   commitMemories:items=>{committed=items;return {added:1,rows:items.map((i,n)=>({id:'m'+n,candidateIds:i.candidateIds}))}}})
  reflect.addEvents([event()])
  const result=await reflect.reflect({force:true})
  assert.equal(result.ok,true);assert.equal(result.created,1)
  assert.match(committed[0].text,/以后我希望/)
  assert.doesNotMatch(usedPrompt,/"bvid":"BV1234567890"/)
  assert.equal(reflect.status().manualRunsToday,1)
  assert.equal(reflect.status().runsToday,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('真实选片不支持虚构自己制作、剪辑视频的动态',()=>{
 const basis=[{bvid:BV,day:'2026-10-30',title:'测试'}]
 const claims={should_post:true,text:'最近刷到一些讲视频制作的内容，开始有点好奇创作者怎么安排节奏，也想慢慢学习他们的思路。',source_bvids:[BV],evidence_claims:[{type:'selected_video',bvid:BV}]}
 assert.equal(validateDailyDraft(claims,basis).skip,false)
 assert.throws(()=>validateDailyDraft({...claims,text:'最近把自己做过的视频又翻了一遍，从选题到剪辑，每一步都比我想象得慢很多，真是挺有意思的。'},basis),/未被来源证实/)
 assert.throws(()=>validateDailyDraft({...claims,evidence_claims:[]},basis),/事实类型与证据/)
})
