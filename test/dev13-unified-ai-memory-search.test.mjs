import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'

const DAY=86400000
const T=Date.parse('2026-10-30T10:00:00Z')
const BV='BV1234567890'
const make=()=>mkdtempSync(join(tmpdir(),'dev13-ai-memory-'))
const cfg={mainSessionMemoryEnabled:true,mainSessionMemorySemanticEnabled:true,mainSessionMemoryMaxItems:6,mainSessionMemoryMaxChars:1200,mainSessionMemoryCandidates:12,mainSessionMemorySearchDailyLimit:2,mainSessionMemoryHalfLifeDays:30}
const event=(at=T)=>({kind:'watch',key:'watch:voice',title:'怎么让你的大肥鱼有可爱的声音2',bvid:BV,at})
function setup(dir,clock,invokeModel,custom={}){
 const getConfig=()=>({...cfg,...custom})
 const gate=createLifeMemoryGateway({dataDir:dir,getConfig,now:()=>clock.value})
 const retriever=createMemoryRetriever({getMemories:()=>[{id:'lesson',text:'我希望表达有耐心，理解别人真正需要什么',source:'life-reflection',importance:.8}],getConfig,
  getEpisodes:(query,opts)=>gate.recall({query,...opts}),getEpisodeCandidates:opts=>gate.semanticCandidates(opts),invokeModel,now:()=>clock.value,logger:{warn(){}}})
 return {gate,retriever}
}
test('低成本 AI 一次调用可同时选择无共同关键词的真实视频经历与长期认识',async()=>{
 const dir=make(),clock={value:T},calls=[]
 try{
  const {gate,retriever}=setup(dir,clock,async prompt=>{
   calls.push(prompt)
   assert.match(prompt,/episode:e-/)
   assert.match(prompt,/怎么让你的大肥鱼有可爱的声音2/)
   assert.match(prompt,/我希望表达有耐心/)
   const ids=[...prompt.matchAll(/"id":"(episode:[^"]+)"/g)].map(x=>x[1])
   assert.equal(ids.length,1)
   return JSON.stringify({memory_ids:[ids[0],'lesson']})
  })
  gate.recordEvents([event()])
  const result=await retriever.retrieve('昨天那个教我配音的视频你还记得吗','manual')
  assert.equal(result.reason,'semantic')
  assert.equal(result.usedModel,true)
  assert.equal(calls.length,1)
  assert.equal(result.episodes.length,1)
  assert.match(result.context,/怎么让你的大肥鱼有可爱的声音2/)
  assert.match(result.context,/我希望表达有耐心/)
  assert.deepEqual(result.memories.map(x=>x.id),['lesson'])
  assert.equal(result.episodeIds[0],result.episodes[0].id)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('模型返回永久档案 ID 或其他不存在的候选被拒，自动退回本地检索',async()=>{
 const dir=make(),clock={value:T}
 try{
  const {gate,retriever}=setup(dir,clock,async()=>'{"memory_ids":["episode:archive-secret"]}')
  gate.recordEvents([event()])
  const result=await retriever.retrieve('昨天给鱼鱼配音的教程','chat')
  assert.equal(result.reason,'fallback')
  assert.equal(result.usedModel,true)
  assert.equal(result.episodes.length,0)
  assert.doesNotMatch(result.context,/archive-secret/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('模型运行期间发生真实遗忘，不能利用旧候选恢复已删除细节',async()=>{
 const dir=make(),clock={value:T}
 try{
  const {gate,retriever}=setup(dir,clock,async prompt=>{
   const id=prompt.match(/"id":"(episode:[^"]+)"/)[1]
   clock.value+=260*DAY
   return JSON.stringify({memory_ids:[id]})
  })
  gate.recordEvents([event()])
  const result=await retriever.retrieve('昨天那个给鱼鱼配音的教程','chat')
  assert.equal(result.reason,'semantic')
  assert.equal(result.episodes.length,0)
  assert.doesNotMatch(result.context,/可爱的声音/)
  const saved=JSON.parse(readFileSync(gate.file,'utf8')).episodes[0]
  assert.equal(saved.stage,'forgotten')
  assert.equal(saved.text,'')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('语义候选严格限制已衰减细节、平台 UID 及陌生人隐私',()=>{
 const dir=make(),clock={value:T}
 try{
  const {gate}=setup(dir,clock,async()=>'{"memory_ids":[]}')
  gate.recordEvents([event(),{kind:'social',key:'social:101:one',bvid:BV,actorUid:'101',text:'我的秘密暗号是灯笼',at:T},{kind:'social',key:'social:202:two',bvid:BV,actorUid:'202',text:'我喜欢看鸭子',at:T}])
  assert.equal(gate.semanticCandidates({domain:'bili-life',role:'stranger',actorUid:''}).length,0)
  const own=gate.semanticCandidates({domain:'bili-life',role:'stranger',actorUid:'101'})
  assert.equal(own.length,1)
  assert.match(own[0].summary,/灯笼/)
  assert.doesNotMatch(JSON.stringify(own),/鸭子|可爱的声音/)
  clock.value+=85*DAY
  const aged=gate.semanticCandidates({query:'配音',domain:'main-session'})
  assert.doesNotMatch(JSON.stringify(aged),/BV1234567890|可爱的声音|灯笼/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('禁用模型或额度用完不触发 AI；普通 B站社交始终本地召回',async()=>{
 const dir=make(),clock={value:T},count={n:0}
 try{
  const {gate,retriever}=setup(dir,clock,async()=>{count.n++;return '{"memory_ids":[]}'},{mainSessionMemorySearchDailyLimit:1})
  gate.recordEvents([event(),{kind:'social',key:'social:101:one',bvid:BV,actorUid:'101',text:'我是小鱼干',at:T}])
  assert.match(retriever.socialContext('我又来了',{actorUid:'101',role:'stranger'}),/小鱼干/)
  assert.equal(count.n,0)
  await retriever.retrieve('昨天配音的教程','manual')
  await retriever.retrieve('帮鱼鱼找声音教学','chat')
  assert.equal(count.n,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('日常搜索 UI 复用现有检索路由与设置，不增加新模型字段',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(js,/searchFishMemory=async/)
 assert.match(js,/request\('\/main-session\/memory\/recall',\{query\}\)/)
 assert.match(index,/getEpisodeCandidates:\(options\)=>lifeMemory\?\.semanticCandidates\(options\)/)
 assert.match(html,/当前还记得的经历与认识/)
})
test('每日 AI 检索任务上限沿用持久化统计，重启不会把额度重置',async()=>{
 const dir=make(),clock={value:T},calls=[]
 try{
  let dayUsed=1
  const setupWithUsage=()=>{
   const getConfig=()=>({...cfg,mainSessionMemorySearchDailyLimit:1})
   const gate=createLifeMemoryGateway({dataDir:dir,getConfig,now:()=>clock.value})
   return createMemoryRetriever({getMemories:()=>[],getConfig,getEpisodes:(q,o)=>gate.recall({query:q,...o}),getEpisodeCandidates:o=>gate.semanticCandidates(o),
    getDailyUsage:()=>({day:'2026-10-30',used:dayUsed}),invokeModel:async()=>{calls.push('called');return '{"memory_ids":[]}'},now:()=>clock.value,logger:{warn(){}}})
  }
  const gate=createLifeMemoryGateway({dataDir:dir,getConfig:()=>cfg,now:()=>clock.value})
  gate.recordEvents([event()])
  assert.equal(setupWithUsage().status().usedToday,1)
  await setupWithUsage().retrieve('昨天那段配音教学','manual')
  assert.equal(calls.length,0)
  dayUsed=0
  await setupWithUsage().retrieve('昨天那段配音教学','manual')
  assert.equal(calls.length,1)
  dayUsed=1
  await setupWithUsage().retrieve('昨天那段配音教学','manual')
  assert.equal(calls.length,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('AI 等待期间主人删除了长期认识，不能返回已经撤销的文字',async()=>{
 const dir=make(),clock={value:T},items=[{id:'private-lesson',text:'主人删除的特别认识',source:'life-reflection',importance:.8}]
 try{
  const getConfig=()=>({...cfg,mainSessionMemorySearchDailyLimit:5})
  const gate=createLifeMemoryGateway({dataDir:dir,getConfig,now:()=>clock.value})
  gate.recordEvents([event()])
  const retriever=createMemoryRetriever({getMemories:()=>items,getConfig,getEpisodes:(q,o)=>gate.recall({query:q,...o}),getEpisodeCandidates:o=>gate.semanticCandidates(o),
   invokeModel:async()=>{items.splice(0,items.length);return '{"memory_ids":["private-lesson"]}'},logger:{warn(){}},now:()=>clock.value})
  const result=await retriever.retrieve('帮我回忆不认识的过去说法','manual')
  assert.equal(result.reason,'semantic')
  assert.deepEqual(result.memories,[])
  assert.doesNotMatch(result.context,/主人删除的特别认识/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
