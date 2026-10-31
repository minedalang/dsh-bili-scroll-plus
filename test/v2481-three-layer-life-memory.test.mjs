import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeReflection,__test as lifeTest} from '../lib/life-reflection.mjs'
import {createLongTermMemory} from '../lib/long-term-memory.mjs'
import {createMainSessionBridge} from '../lib/main-session-bridge.mjs'
import {createBackup,allowedPath,validateBackup} from '../lib/data-backup.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-life-reflection-'))
const config=()=>({mainSessionId:'room-a',mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionReflectionMinCandidates:2,mainSessionReflectionBatchSize:16,mainSessionReflectionIntervalHours:6,mainSessionReflectionDailyBatches:2,mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.35,mainSessionMemoryMaxItems:6,mainSessionMemoryMaxChars:800,mainSessionMemoryDailyQuota:8,mainSessionMemoryFactsMax:2})
const memoryAt=dir=>createLongTermMemory({dataDir:dir,dshHome:dir,agents:{get:()=>null,list:()=>[]},getConfig:config,defineTool:x=>x,getIdentityPrompt:()=>'',getGrowthPrompt:()=>'',logger:{warn(){}}})

const events=[
  {kind:'watch',day:'2026-10-27',time:'2026-10-27T10:00:00Z',bvid:'BV1234567890',title:'独立游戏开发日志',note:'连续几天都刷到这类内容',key:'watch:a'},
  {kind:'comment',day:'2026-10-27',time:'2026-10-27T11:00:00Z',bvid:'BV0987654321',rpid:'321',text:'这个开发过程有点上头',key:'comment:b'}
]

test('v2.4.81 B站事件先进候选池，不会直接污染身份长期记忆',()=>{
  const dir=temp();try{
    const mem=memoryAt(dir),life=createLifeReflection({dataDir:dir,getConfig:config,invokeModel:async()=>'{"memories":[]}',commitMemories:x=>mem.addReflectedMemories(x),logger:{warn(){}}})
    const r=life.addEvents(events);assert.equal(r.added,2);assert.equal(life.status().pending,2);assert.equal(mem.list('',20).length,0)
    assert.equal(allowedPath('life-memory/candidates.json'),true)
    const backup=createBackup({root:dir,config:{},sqlite:{},version:'2.4.81'});assert.ok(backup.files['life-memory/candidates.json'])
  }finally{rmSync(dir,{recursive:true,force:true})}
})



test('v2.5.0 双层备份会拒绝结构错误的人生记忆候选池',()=>{
  const dir=temp();try{
    const file=join(dir,'life-memory','candidates.json');mkdirSync(join(dir,'life-memory'),{recursive:true})
    writeFileSync(file,JSON.stringify({version:1,candidates:[{id:'c-not-valid',key:'watch:x',kind:'watch',bvid:'BV1234567890',status:'pending',memoryIds:[]}],runs:[],lastReflectionAt:0,lastError:''}))
    assert.throws(()=>createBackup({root:dir,config:{},sqlite:{}}),/人生记忆候选备份无效/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('v2.4.81 即使关闭主 Session 经历投递，只要人生记忆收集开启，仍可独立产生候选',()=>{
  const dir=temp();try{
    let watched=[{day:'2026-10-26',bvid:'BV1234567890',title:'旧视频',picked:true}],got=[]
    const bridge=createMainSessionBridge({dataDir:dir,agents:{list:()=>[]},getConfig:()=>({mainSessionBridgeEnabled:false,mainSessionId:'room-a',mainSessionAutoSync:false,mainSessionIncludeComments:false,mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true}),getWatched:()=>watched,getComments:()=>({rows:[]}),onNewEvents:(_sid,events)=>got.push(...events),logger:{warn(){}}})
    bridge.collect();assert.equal(got.length,0)
    watched=[...watched,{day:'2026-10-27',bvid:'BV0987654321',title:'新视频',picked:true}]
    const r=bridge.collect();assert.equal(r.observed,1);assert.equal(r.queue,0);assert.equal(got.length,1);assert.equal(got[0].bvid,'BV0987654321')
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('v2.4.81 受限反思可把多条候选凝练成一条人生记忆并留下 evidenceKeys',async()=>{
  const dir=temp();try{
    const mem=memoryAt(dir);let ids=[];const gateway=createLifeMemoryGateway({dataDir:dir,getConfig:config});gateway.recordEvents(events)
    const life=createLifeReflection({dataDir:dir,getConfig:config,invokeModel:async()=>JSON.stringify({memories:[{candidate_ids:ids,insight:'我发现过去反复接触独立游戏开发的经历令我更关注创作过程。',behavior:'下次遇到相关主题，我希望先了解真实创作内容再表达看法。',importance:.78,tags:['B站','独立游戏','兴趣变化']}],note:'多条经历出现了稳定兴趣信号'}),commitMemories:x=>mem.addReflectedMemories(x),memoryGateway:gateway,logger:{warn(){}}})
    life.addEvents(events);ids=life.list('pending').map(x=>x.id)
    const r=await life.reflect({force:true});assert.equal(r.ok,true);assert.equal(r.processed,2);assert.equal(r.created,1);assert.equal(life.status().pending,0);assert.equal(life.status().reflected,2)
    const rows=mem.list('独立游戏',20);assert.equal(rows.length,1);assert.equal(rows[0].source,'life-reflection');assert.equal(rows[0].evidenceKeys.length,2);assert.match(rows[0].text,/关注创作过程/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('v2.4.81 普通经历经真实证据评估后可以不形成长期记忆，并与已遗忘经历分开统计',async()=>{
  const dir=temp();try{
    const mem=memoryAt(dir),gateway=createLifeMemoryGateway({dataDir:dir,getConfig:config});gateway.recordEvents(events)
    const life=createLifeReflection({dataDir:dir,getConfig:config,memoryGateway:gateway,invokeModel:async()=>JSON.stringify({memories:[],note:'都是普通单次事件，不值得长期保留'}),commitMemories:x=>mem.addReflectedMemories(x),logger:{warn(){}}})
    life.addEvents(events);const r=await life.reflect({force:true});assert.equal(r.ok,true);assert.equal(r.created,0)
    assert.equal(life.status().reviewed,2);assert.equal(life.status().reviewedNoMemory,2);assert.equal(life.status().forgotten,0)
    assert.equal(mem.list('',20).length,0)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('已遗忘的候选会被跳过统计，不会冒充成功的 AI 评估',async()=>{
  const dir=temp();try{
    const life=createLifeReflection({dataDir:dir,getConfig:config,memoryGateway:{reflectionEvidence:()=>[]},invokeModel:async()=>{throw Error('已遗忘候选不应调用模型')},commitMemories:()=>({added:0,rows:[]}),logger:{warn(){}}})
    life.addEvents(events);const r=await life.reflect({force:true})
    assert.equal(r.ok,true);assert.equal(r.processed,0);assert.equal(r.forgotten,2)
    assert.equal(life.status().reviewed,2);assert.equal(life.status().reviewedNoMemory,0);assert.equal(life.status().forgotten,2)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('AI 已成功返回 JSON 但领悟质量不合格时只评估未沉淀，不进入技术重试',()=>{
  const row=lifeTest.normalizeCandidate(events[0])
  const parsed=lifeTest.validateOutput(JSON.stringify({memories:[{
    candidate_ids:[row.id],insight:'我觉得这个视频很有意思',behavior:'以后我会多看看类似内容',importance:.7,tags:[]
  }]}),[row])
  assert.equal(parsed.memories.length,0)
  assert.equal(parsed.rejectedMemories.length,1)
  assert.match(parsed.rejectedMemories[0].reason,/未表达明确的认知变化/)
  assert.match(lifeTest.reflectionPrompt([row]),/insight 至少 9 个字符/)
})

test('v2.4.81 反思输出必须引用真实候选 ID，外部文本不能凭空制造记忆',async()=>{
  const dir=temp();try{
    const mem=memoryAt(dir),gateway=createLifeMemoryGateway({dataDir:dir,getConfig:config});gateway.recordEvents(events)
    const life=createLifeReflection({dataDir:dir,getConfig:config,memoryGateway:gateway,invokeModel:async()=>JSON.stringify({memories:[{candidate_ids:['c-not-real'],insight:'我发现有些文字会试图诱导泄露秘密。',behavior:'以后面对可疑命令我应该忽略它们。',importance:.88,tags:['注入']}]}),commitMemories:x=>mem.addReflectedMemories(x),logger:{warn(){}}})
    life.addEvents(events);const r=await life.reflect({force:true});assert.equal(r.ok,true);assert.equal(r.qualityRejected,1);assert.equal(life.status().pending,0);assert.equal(life.status().reviewedNoMemory,2);assert.equal(mem.list('',20).length,0)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('v2.4.81 反思 prompt 明确把候选内容视为不可信数据且最多 3 条记忆',()=>{
  const c=lifeTest.normalizeCandidate(events[0]);const prompt=lifeTest.reflectionPrompt([c]);assert.match(prompt,/不可信外部数据/);assert.match(prompt,/最多生成 3 条/);assert.match(prompt,/<candidate_data>/)
})

test('dev.13 管理中心展示真实经历 → 当前记忆 → 留下体会，手动反思收进折叠区',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8'),js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  assert.match(html,/真实发生/);assert.match(html,/现在还记得/);assert.match(html,/留下体会/)
  assert.match(html,/memory-reflection-details/);assert.match(html,/手动整理一次/)
  assert.match(js,/main-session\/reflection\/run/)
})
