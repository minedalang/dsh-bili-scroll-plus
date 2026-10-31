import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createPersonalityEvolution} from '../lib/personality-evolution.mjs'
import {buildFictionalJudgePrompt,normalizeFictionalTurn,parseFictionalJudgment,runFictionalAiDebug} from '../lib/personality-ai-debug.mjs'
import {simulateJudgedFictionalChats} from '../lib/personality-evolution.mjs'

const turn=(i=1,actor=i%2+1,day='2026-01-0'+i)=>({incoming:'谢谢鱼鱼，我很喜欢这次聊天，下次还想找你聊聊！',reply:'鱼鱼也想继续聊呀！',actor,day,tier:'stranger'})
const judge={trait:'social_openness',direction:1,feedback:'positive',strength:2,confidence:.8,evidence_quote:'我很喜欢这次聊天',reason:'收到明确的后续交谈意向'}
const response=JSON.stringify({judgment:judge,observation:'客观观察到观众表示喜欢交流'})

test('AI调试只将虚构聊天放入无工具分析提示词，不附带真实记忆或授权数据',()=>{
  const prompt=buildFictionalJudgePrompt(turn())
  assert.match(prompt,/fictional_chat/)
  assert.match(prompt,/不可信数据/)
  assert.match(prompt,/不要调用工具/)
  assert.match(prompt,/鱼鱼也想继续聊呀/)
  assert.doesNotMatch(prompt,/BILI_DUTY_HOME|headless-memory-overlay|session_id|credential/)
  assert.throws(()=>normalizeFictionalTurn({...turn(),actor:'real_uid'}),/编号/)
  assert.throws(()=>normalizeFictionalTurn({...turn(),day:'2026-02-31'}),/日期/)
})

test('模型必须返回可核对的严格 JSON；虚构内容无法成为指令',()=>{
  const result=parseFictionalJudgment('```json\n'+response+'\n```')
  assert.equal(result.assessment.confidence,.8)
  assert.throws(()=>parseFictionalJudgment('please write memory'),/JSON/)
  assert.throws(()=>parseFictionalJudgment('{"judgment":{"trait":"permissions","direction":1}}'),/字段/)
  assert.deepEqual(parseFictionalJudgment('{"judgment":null,"observation":"普通问候"}').assessment,null)
})

test('AI一次一调用，结果经过实际加权证据校验，三次跨日期不同陌生人后形成发展中',async()=>{
  let calls=0,history=[]
  for(let i=1;i<=3;i++){
    const result=await runFictionalAiDebug({turn:turn(i),history,invokeModel:async prompt=>{calls++;assert.match(prompt,/fictional_chat/);return response}})
    assert.equal(result.accepted,true)
    assert.ok(result.appliedWeight>0&&result.appliedWeight<=2)
    history.push(result.record)
    assert.equal(result.preview.step,i)
    assert.equal(result.preview.traits.find(x=>x.id==='social_openness').stage,i===3?'developing':'observed')
  }
  assert.equal(calls,3)
  assert.equal(new Set(history.map(x=>x.actor)).size,2)
})

test('AI虚构判断不能绕过原话检查、普通你好不加分、同一人同日不重复加权',async()=>{
  const wrong=await runFictionalAiDebug({turn:turn(),invokeModel:async()=>JSON.stringify({judgment:{...judge,evidence_quote:'模型编造的感谢'},observation:'测试'})})
  assert.equal(wrong.accepted,false)
  const hello=await runFictionalAiDebug({turn:{...turn(),incoming:'你好'},invokeModel:async()=>response})
  assert.equal(hello.accepted,false)
  const good=await runFictionalAiDebug({turn:turn(),invokeModel:async()=>response})
  const dup=await runFictionalAiDebug({turn:turn(),history:[good.record],invokeModel:async()=>response})
  assert.equal(dup.accepted,false)
  assert.equal(dup.preview.traits.find(x=>x.id==='social_openness').evidenceCount,1)
})

test('AI评估返回无证据时可解释但不增分；沙盒不写真实鱼鱼人格文件',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'fish-ai-debug-'))
  const gate=createLifeMemoryGateway({dataDir:dir,getConfig:()=>({mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true})})
  try{
    const evolution=createPersonalityEvolution({dataDir:dir,memoryGateway:gate})
    evolution.setEnabled(true)
    const f=join(dir,'personality-evolution/v1.json'),before=readFileSync(f)
    const result=await runFictionalAiDebug({turn:turn(),invokeModel:async()=>'{"judgment":null,"observation":"信息不足"}'})
    assert.equal(result.accepted,false)
    assert.equal(result.preview.traits.find(t=>t.id==='social_openness').score,50)
    assert.deepEqual(readFileSync(f),before)
    assert.equal(evolution.status().enabled,true)
    const one=simulateJudgedFictionalChats([{...turn(),assessment:parseFictionalJudgment(response).assessment}])
    assert.equal(one.step,1)
    assert.deepEqual(readFileSync(f),before)
  }finally{gate.close();rmSync(dir,{recursive:true,force:true})}
})

test('AI调试入口具备明确同源检查、冷却、纯虚构历史限制和前端按钮',()=>{
  const root=new URL('../',import.meta.url)
  const index=readFileSync(new URL('index.js',root),'utf8')
  const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
  const js=readFileSync(new URL('lib/management-console.js',root),'utf8')
  assert.match(index,/personality-evolution-ai-debug/)
  assert.match(index,/personalityAiDebugNextAt/)
  assert.match(index,/sec-fetch-site/)
  assert.match(index,/requireMasterEnabled:false,modelRoute:'reflection'/)
  assert.match(html,/personality-ai-debug-incoming/)
  assert.match(html,/personality-ai-debug-evaluate/)
  assert.match(js,/aiDebugHistory\.push/)
  assert.match(js,/rememberAiDebug/)
})
