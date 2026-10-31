import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeReflection} from '../lib/life-reflection.mjs'
import {createPersonalityEvolution} from '../lib/personality-evolution.mjs'
import {createBackup,allowedPath,validateBackup} from '../lib/data-backup.mjs'

const NOW=Date.parse('2026-10-31T02:00:00Z')
const DAY=86400000
const config=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionReflectionAuto:true,mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.25})
const events=Array.from({length:3},(_,i)=>({kind:'watch',key:'watch:personality:'+i,bvid:'BV'+String(i+1).repeat(10),title:'探索不同的视频 '+i,at:NOW-(i+1)*DAY,day:new Date(NOW-(i+1)*DAY).toISOString().slice(0,10)}))
async function withStore(fn){
  const dir=mkdtempSync(join(tmpdir(),'fish-personality-')),clock={value:NOW}
  const gate=createLifeMemoryGateway({dataDir:dir,getConfig:config,now:()=>clock.value})
  const evolution=createPersonalityEvolution({dataDir:dir,memoryGateway:gate,now:()=>clock.value})
  try{return await fn({dir,clock,gate,evolution})}finally{gate.close();rmSync(dir,{recursive:true,force:true})}
}

test('2.6.0-dev.1 默认为关闭；关闭时不添加提示词、不能自动写新特质',()=>withStore(({gate,evolution})=>{
  gate.recordEvents(events)
  assert.equal(evolution.status().enabled,false)
  assert.equal(evolution.context({scene:'comment'}),'')
  const out=evolution.applyProposals([{trait:'curiosity',direction:1,candidateIds:['c-fake']}],[{id:'c-fake',key:events[0].key}])
  assert.equal(out.added,0)
  assert.equal(evolution.status().traits.find(t=>t.id==='curiosity').stage,'seed')
}))

test('2.6.0-dev.1 真实可衰减副本经反思引用后才进入人格；跨日期至少三条才影响风格',()=>withStore(({dir,gate,evolution})=>{
  gate.recordEvents(events);evolution.setEnabled(true)
  const rows=events.map((e,i)=>({id:'c-'+i,key:e.key}))
  assert.equal(evolution.applyProposals([{trait:'curiosity',direction:1,candidateIds:['c-0']}],rows).added,1)
  assert.equal(evolution.context({scene:'dm'}),'')
  assert.equal(evolution.applyProposals([{trait:'curiosity',direction:1,candidateIds:['c-0','c-1','c-2']}],rows).added,2)
  const trait=evolution.status().traits.find(t=>t.id==='curiosity')
  assert.equal(trait.stage,'developing');assert.equal(trait.distinctDays,3)
  assert.match(evolution.context({scene:'dm'}),/更愿意探索新事物/)
  assert.equal(evolution.applyProposals([{trait:'social_openness',direction:1,candidateIds:['c-0','c-1']}],rows).added,0)
  const text=readFileSync(join(dir,'personality-evolution','v1.json'),'utf8')
  assert.doesNotMatch(text,/BV[0-9A-Za-z]{10}|探索不同的视频|watch:personality/)
  assert.equal(evolution.status().timeline.length>=2,true)
  evolution.setEnabled(false)
  assert.equal(evolution.context({scene:'comment'}),'')
  assert.equal(evolution.status().traits.find(t=>t.id==='curiosity').evidenceCount,3)
  assert.equal(allowedPath('personality-evolution/v1.json'),true)
  assert.ok(createBackup({root:dir,config:{}}).files['personality-evolution/v1.json'])
}))

test('2.6.0-dev.1 伪造候选、未知特质、已遗忘经历无法促使人格增长',()=>withStore(({gate,evolution,clock})=>{
  gate.recordEvents(events);evolution.setEnabled(true)
  const rows=events.map((e,i)=>({id:'c-'+i,key:e.key}))
  assert.equal(evolution.applyProposals([{trait:'permissions',direction:1,candidateIds:['c-0']},{trait:'curiosity',direction:1,candidateIds:['fake']}],rows).added,0)
  clock.value+=300*DAY
  assert.deepEqual(gate.reflectionEvidence(events.map(e=>e.key)),[])
  assert.equal(evolution.applyProposals([{trait:'curiosity',direction:1,candidateIds:['c-0','c-1','c-2']}],rows).added,0)
  assert.equal(evolution.context({scene:'comment'}),'')
}))

test('2.6.0-dev.1 正负证据冲突不能固定一种方向，主人可以清除单项',()=>withStore(({gate,evolution})=>{
  gate.recordEvents(events);evolution.setEnabled(true)
  const rows=events.map((e,i)=>({id:'c-'+i,key:e.key}))
  evolution.applyProposals([{trait:'patience',direction:1,candidateIds:['c-0','c-1']}],rows)
  evolution.applyProposals([{trait:'patience',direction:-1,candidateIds:['c-2']}],rows)
  assert.equal(evolution.status().traits.find(t=>t.id==='patience').stage,'observed')
  evolution.resetTrait('patience')
  assert.equal(evolution.status().traits.find(t=>t.id==='patience').stage,'seed')
  assert.throws(()=>evolution.resetTrait('unknown'),/未知/)
}))

test('2.6.0-dev.1 复用现有反思模型调用且模型候选 ID 必须有真实对应',async()=>withStore(async({gate,evolution,dir})=>{
  gate.recordEvents(events);evolution.setEnabled(true)
  let calls=0,committed=0
  const life=createLifeReflection({dataDir:dir,getConfig:config,memoryGateway:gate,
    getPersonalityEnabled:()=>evolution.status().enabled,
    onPersonalityProposals:(proposals,batch)=>evolution.applyProposals(proposals,batch),
    invokeModel:async(prompt)=>{
      calls++
      assert.match(prompt,/trait_proposals/)
      const rows=JSON.parse(prompt.match(/<candidate_data>\n([^\n]+)\n<\/candidate_data>/)[1])
      return JSON.stringify({memories:[],note:'普通经历，无需道理',trait_proposals:[{trait:'curiosity',direction:1,candidate_ids:rows.map(x=>x.id)},{trait:'boundaries',direction:1,candidate_ids:['c-fake']}]})
    },commitMemories:items=>{committed++;return {added:0,rows:[]}}})
  life.addEvents(events)
  const result=await life.reflect({force:true})
  assert.equal(result.ok,true);assert.equal(calls,1);assert.equal(committed,1)
  assert.equal(evolution.status().traits.find(t=>t.id==='curiosity').stage,'developing')
  assert.equal(evolution.status().traits.find(t=>t.id==='boundaries').evidenceCount,0)
}))

test('2.6.0-dev.1 人格文件被篡改时拒绝读取，备份验证也拒绝非法证据',()=>withStore(({dir,evolution})=>{
  evolution.setEnabled(true)
  const backup=createBackup({root:dir,config:{}})
  assert.doesNotThrow(()=>validateBackup(backup))
  const evil={version:1,enabled:true,traits:{permissions:{evidence:[{id:'not-a-hash',day:'2026-10-30',direction:1}]}},timeline:[]}
  writeFileSync(join(dir,'personality-evolution','v1.json'),JSON.stringify(evil))
  assert.equal(evolution.status().traits.length,5) // unknown traits are ignored by reader
  const modified={...backup,files:{...backup.files,'personality-evolution/v1.json':JSON.stringify(evil)}}
  assert.throws(()=>validateBackup(modified),/完整性/)
}))

test('2.6.0-dev.1 UI 与插件入口包括角色成长开关、路线图和安全路由',()=>{
  const root=new URL('../',import.meta.url)
  const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
  const js=readFileSync(new URL('lib/management-console.js',root),'utf8')
  const index=readFileSync(new URL('index.js',root),'utf8')
  assert.match(html,/personality-evolution-timeline/)
  assert.match(js,/loadPersonalityEvolution/)
  assert.match(index,/personalityEvolution\?\.applyProposals/)
  assert.match(index,/getPersonalityEnabled/)
  assert.match(index,/path==='\/api\/bili-duty\/personality-evolution'/)
})
