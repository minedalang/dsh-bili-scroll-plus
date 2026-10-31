import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createLifeReflection,__test as reflTest} from '../lib/life-reflection.mjs'
import {createPersonalityEvolution} from '../lib/personality-evolution.mjs'

const DAY=86400000, NOW=Date.parse('2026-10-31T00:00:00Z')
const cfg=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionMemoryHalfLifeDays:90,mainSessionReflectionMinCandidates:2,mainSessionReflectionBatchSize:10})
async function withStore(fn){
  const dataDir=mkdtempSync(join(tmpdir(),'fish-quality-'))
  const clock={at:NOW}
  const gate=createLifeMemoryGateway({dataDir,getConfig:cfg,now:()=>clock.at})
  const growth=createPersonalityEvolution({dataDir,memoryGateway:gate,now:()=>clock.at})
  try{return await fn({dataDir,clock,gate,growth})}finally{gate.close();rmSync(dataDir,{recursive:true,force:true})}
}
function incoming(i,uid='10001',delta=i){
  const at=NOW-(6-delta)*DAY
  return {kind:'social',key:`social:${uid}:BV1234567890:${20001+i}`,bvid:'BV1234567890',actorUid:uid,
    text:'鱼鱼，谢谢你认真回复！以后还想和你聊天',socialTier:'stranger',at}
}
function proposal(rows,confidence=.8,strength=2,quote='谢谢你认真回复'){
  return {trait:'social_openness',direction:1,candidateIds:rows.map(r=>r.id),feedback:'positive',strength,confidence,evidenceQuote:quote}
}
function rows(events){return events.map(e=>({id:reflTest.candidateId(e),key:e.key}))}

test('真实公开社交记录接入反思候选；候选文件不保存观众的原话',()=>withStore(({dataDir,gate,growth})=>{
  const ev=incoming(1);gate.recordEvents([ev]);growth.setEnabled(true)
  const life=createLifeReflection({dataDir,getConfig:cfg,memoryGateway:gate,invokeModel:async()=>'{"memories":[]}',commitMemories:()=>({added:0,rows:[]})})
  assert.equal(life.addEvents([ev]).added,1)
  assert.equal(life.list('pending').length,1)
  assert.equal(life.list('pending')[0].kind,'social')
  const candidateFile=readFileSync(join(dataDir,'life-memory','candidates.json'),'utf8')
  assert.doesNotMatch(candidateFile,/谢谢你认真回复/)
  assert.equal(gate.reflectionEvidence([ev.key])[0].confirmedReply,false)
}))

test('没有确认回执或模型未给出精确证据，不能形成交朋友人格变化',()=>withStore(({gate,growth})=>{
  const ev=incoming(1);gate.recordEvents([ev]);growth.setEnabled(true)
  const r=rows([ev]);const p=proposal(r)
  assert.equal(growth.applyProposals([p],r).added,0)
  assert.equal(growth.applyProposals([proposal(r,1,3,'完全捏造的愉快聊天')],r).added,0)
  assert.equal(growth.status().traits.find(t=>t.id==='social_openness').score,50)
  assert.equal(gate.recordSocialReply({actorUid:ev.actorUid,bvid:ev.bvid,incomingRpid:'20002',text:'鱼鱼也想和你聊！'}).ok,true)
  assert.equal(growth.applyProposals([{...p,confidence:.2}],r).added,0)
  assert.equal(growth.applyProposals([p],r).added,1)
  assert.equal(growth.status().traits.find(t=>t.id==='social_openness').score,55)
}))

test('3次正向交流跨2天但只有同一个观众，只算熟人互动，不宣称整体社交人格发展',()=>withStore(({gate,growth})=>{
  const e=[incoming(1,'10001',1),incoming(2,'10001',2),incoming(3,'10001',3)]
  gate.recordEvents(e);growth.setEnabled(true)
  for(const item of e)gate.recordSocialReply({actorUid:item.actorUid,bvid:item.bvid,incomingRpid:item.key.split(':').at(-1),text:'已回复'})
  assert.equal(growth.applyProposals([proposal(rows(e))],rows(e)).added,3)
  const t=growth.status().traits.find(t=>t.id==='social_openness')
  assert.equal(t.stage,'observed');assert.equal(t.supportivePeople,1)
  assert.equal(growth.context({scene:'comment'}),'')
}))

test('多个观众跨日的真实回应才可发展；影响取决于证据强度且重复当天不会刷分',()=>withStore(({dataDir,gate,growth})=>{
  const e=[incoming(1,'10001',1),incoming(2,'10002',2),incoming(3,'10003',3)]
  const extra=incoming(4,'10001',1)
  gate.recordEvents([...e,extra]);growth.setEnabled(true)
  for(const item of [...e,extra])gate.recordSocialReply({actorUid:item.actorUid,bvid:item.bvid,incomingRpid:item.key.split(':').at(-1),text:'回应'})
  assert.equal(growth.applyProposals([proposal(rows([...e,extra]),.8,1)],rows([...e,extra])).added,3)
  assert.equal(growth.applyProposals([proposal(rows(e),.8,3)],rows(e)).added,0)
  const t=growth.status().traits.find(t=>t.id==='social_openness')
  assert.equal(t.stage,'developing');assert.equal(t.supportivePeople,3)
  assert.equal(t.impactScore,1.8);assert.equal(t.score,59)
  assert.match(growth.context({scene:'comment'}),/更愿意结识新朋友/)
  const bytes=readFileSync(join(dataDir,'personality-evolution','v1.json'),'utf8')
  assert.doesNotMatch(bytes,/10001|10002|10003|谢谢你认真回复|BV1234567890/)
  assert.match(bytes,/participantSalt/)
}))

test('普通你好和伪造高强度不能作为愉快证据，单条回复的强度封顶',()=>withStore(({gate,growth})=>{
  const ev=incoming(1);gate.recordEvents([ev]);growth.setEnabled(true)
  gate.recordSocialReply({actorUid:ev.actorUid,bvid:ev.bvid,incomingRpid:'20002',text:'回应'})
  const r=rows([ev])
  assert.equal(growth.applyProposals([proposal(r,1,3,'鱼鱼')],r).added,0)
  assert.equal(growth.applyProposals([proposal(r,1,3,'谢谢你认真回复')],r).added,1)
  const t=growth.status().traits.find(t=>t.id==='social_openness')
  assert.equal(t.impactScore,1.25) // 单条回复不能证明完整多轮交流
}))

test('仅与朋友交谈或主人说好话不能宣称鱼鱼对陌生人更外向',()=>withStore(({gate,growth})=>{
  const e=[incoming(1,'10001',1),incoming(2,'10002',2),incoming(3,'10003',3)]
  e[0].socialTier='owner';e[1].socialTier='friend';e[2].socialTier='friend'
  gate.recordEvents(e);growth.setEnabled(true)
  for(const item of e)gate.recordSocialReply({actorUid:item.actorUid,bvid:item.bvid,incomingRpid:item.key.split(':').at(-1),text:'回复'})
  assert.equal(growth.applyProposals([proposal(rows(e))],rows(e)).added,2)
  const t=growth.status().traits.find(t=>t.id==='social_openness')
  assert.equal(t.stage,'observed');assert.equal(t.supportiveStrangers,0)
}))

test('社交评估随真实可衰减副本遗忘而停止，不从永久档案恢复或追溯人格',()=>withStore(({clock,gate,growth})=>{
  const ev=incoming(1);gate.recordEvents([ev]);growth.setEnabled(true)
  gate.recordSocialReply({actorUid:ev.actorUid,bvid:ev.bvid,incomingRpid:'20002',text:'回应'})
  clock.at+=400*DAY
  assert.equal(gate.reflectionEvidence([ev.key]).length,0)
  assert.equal(growth.applyProposals([proposal(rows([ev]))],rows([ev])).added,0)
}))

test('模型单次反思输出社交质量评价；未授权的候选 ID 或外部指令不影响人格',async()=>withStore(async({dataDir,gate,growth})=>{
  const ev=incoming(1);gate.recordEvents([ev]);growth.setEnabled(true)
  gate.recordSocialReply({actorUid:ev.actorUid,bvid:ev.bvid,incomingRpid:'20002',text:'鱼鱼也很开心'})
  let calls=0
  const life=createLifeReflection({dataDir,getConfig:cfg,memoryGateway:gate,
    getPersonalityEnabled:()=>true,onPersonalityProposals:(proposals,batch)=>growth.applyProposals(proposals,batch),
    invokeModel:async prompt=>{calls++;assert.match(prompt,/evidence_quote/);return JSON.stringify({memories:[],trait_proposals:[{trait:'social_openness',direction:1,candidate_ids:[reflTest.candidateId(ev),'c-fake'],feedback:'positive',strength:2,confidence:.8,evidence_quote:'谢谢你认真回复'}]})},
    commitMemories:()=>({added:0,rows:[]})})
  life.addEvents([ev]);assert.equal((await life.reflect({force:true})).ok,true)
  assert.equal(calls,1);assert.equal(growth.status().traits.find(t=>t.id==='social_openness').evidenceCount,1)
}))


test('主入口只在成功出站回复后安排社交反思，而不是收到陌生人留言就加人格证据',()=>{
  const file=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(file,/lifeMemory\.recordEvents\(\[socialEvent\]\)/)
  assert.match(file,/if\(recorded\?\.ok\)lifeReflection\?\.addEvents\(\[\{kind:'social'/)
  assert.doesNotMatch(file,/recordEvents\(\[socialEvent\]\);lifeReflection\?\.addEvents/)
})
