import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createPersonalityEvolution} from '../lib/personality-evolution.mjs'
import {parseFictionalJudgment,runFictionalAiDebug} from '../lib/personality-ai-debug.mjs'
import {simulateJudgedFictionalChats} from '../lib/personality-evolution.mjs'
const now=Date.parse('2026-10-31T12:00:00Z')
const cfg=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionMemoryHalfLifeDays:90})
const replyBase={incoming:'我不想再和你聊天了，别来找我！',reply:'',actor:1,day:'2026-01-02',tier:'stranger',outcome:'declined',declineReason:'respect-request'}
const boundary={trait:'boundaries',direction:1,feedback:'negative',strength:3,confidence:.35,feedback_confidence:.98,personality_confidence:.35,evidence_quote:'别来找我',reason:'鱼鱼明确尊重对方边界'}
const social={trait:'social_openness',direction:-1,feedback:'negative',strength:3,confidence:.35,feedback_confidence:.98,personality_confidence:.35,evidence_quote:'不想再和你聊天',reason:'单次拒绝'}

test('反馈是否恶意和人格变化证据分开；同一次经历可有多项候选但逐项核验',async()=>{
 const result=await runFictionalAiDebug({turn:replyBase,invokeModel:async()=>JSON.stringify({judgments:[boundary,social],observation:'对方明确拒绝交流',feedback_assessment:{valence:'negative',strength:3,confidence:.99}})})
 assert.equal(result.judgments.length,2)
 assert.equal(result.feedbackAssessment.confidence,.99)
 assert.equal(result.accepted,true)
 assert.ok(result.evaluations.some(x=>x.trait==='boundaries'&&x.accepted))
 assert.ok(result.evaluations.some(x=>x.trait==='social_openness'&&!x.accepted))
 assert.ok(result.preview.traits.find(x=>x.id==='boundaries').score>50)
 assert.equal(result.preview.traits.find(x=>x.id==='social_openness').score,50)
 assert.equal(result.record.reply,'')
})
test('尚未处理、发送失败、普通沉默均不直接构成人格证据',()=>{
 for(const outcome of ['unprocessed','failed','declined']){
   const row={...replyBase,outcome,declineReason:'general',assessments:[{...boundary,feedbackConfidence:.98,personalityConfidence:.9,evidenceQuote:'别来找我'}]}
   assert.equal(simulateJudgedFictionalChats([row]).traits.find(x=>x.id==='boundaries').evidenceCount,0)
 }
})
test('模型恶意高置信度但对人格低置信度只能是很小的候选变化',()=>{
 const a={...social,feedbackConfidence:.99,personalityConfidence:.25,evidenceQuote:'不想再和你聊天'}
 const row={...replyBase,outcome:'replied',reply:'好吧，我们到此为止',assessments:[a]}
 const result=simulateJudgedFictionalChats([row])
 const trait=result.traits.find(x=>x.id==='social_openness')
 assert.equal(trait.evidenceCount,1)
 assert.ok(trait.impactScore<0&&trait.impactScore>-.5)
 assert.equal(trait.stage,'observed')
})
test('主人和好友影响不能被当成跨不同陌生人的一般外向程度',()=>{
 const candidates=Array.from({length:3},(_,i)=>({incoming:'谢谢你，我很喜欢这次聊天！',reply:'鱼鱼也觉得有意思',actor:i+1,day:'2026-01-0'+(i+2),tier:i===0?'owner':'friend',outcome:'replied',assessments:[{trait:'social_openness',direction:1,feedback:'positive',strength:2,confidence:.9,feedbackConfidence:.9,personalityConfidence:.9,evidenceQuote:'我很喜欢这次聊天'}]}))
 const result=simulateJudgedFictionalChats(candidates)
 const trait=result.traits.find(x=>x.id==='social_openness')
 assert.notEqual(trait.stage,'developing')
 assert.equal(trait.supportiveStrangers,0)
 assert.equal(trait.evidenceCount,2)
})
test('真实明确拒绝被保存为可衰减决定，重复记录幂等；遗忘不能复活',()=>{
 const dir=mkdtempSync(join(tmpdir(),'personality-decline-'))
 const gate=createLifeMemoryGateway({dataDir:dir,getConfig:cfg,now:()=>now})
 const growth=createPersonalityEvolution({dataDir:dir,memoryGateway:gate,now:()=>now})
 const incoming={kind:'social',key:'social:10001:BV1234567890:20001',bvid:'BV1234567890',actorUid:'10001',socialTier:'stranger',text:'我不想再和你聊天了，别来找我！',at:now-86400000}
 try{
   gate.recordEvents([incoming]);growth.setEnabled(true)
   assert.equal(gate.recordSocialDecline({actorUid:'10001',bvid:incoming.bvid,incomingRpid:'20001',reason:'respect-request'}).ok,true)
   assert.equal(gate.recordSocialDecline({actorUid:'10001',bvid:incoming.bvid,incomingRpid:'20001',reason:'respect-request'}).duplicate,true)
   assert.equal(gate.reflectionEvidence([incoming.key])[0].deliberateSilence,true)
   assert.equal(growth.applyProposals([{trait:'boundaries',direction:1,candidateIds:['c-1'],feedback:'negative',strength:3,confidence:.4,feedbackConfidence:.99,personalityConfidence:.4,evidenceQuote:'别来找我'}],[{id:'c-1',key:incoming.key}]).added,1)
   assert.equal(growth.applyProposals([{trait:'social_openness',direction:-1,candidateIds:['c-1'],feedback:'negative',strength:3,confidence:.4,feedbackConfidence:.99,personalityConfidence:.4,evidenceQuote:'别来找我'}],[{id:'c-1',key:incoming.key}]).added,0)
   assert.ok(readFileSync(join(dir,'personality-evolution','v1.json'),'utf8').indexOf('别来找我')<0)
 }finally{gate.close();rmSync(dir,{recursive:true,force:true})}
})
test('单个虚构原话和单个AI返回不能绕过最多三项特质及原话验证',()=>{
 assert.throws(()=>parseFictionalJudgment(JSON.stringify({judgments:[boundary,boundary]})),/重复/)
 assert.throws(()=>parseFictionalJudgment(JSON.stringify({judgments:[boundary,social,social,boundary]})),/最多三项/)
})
