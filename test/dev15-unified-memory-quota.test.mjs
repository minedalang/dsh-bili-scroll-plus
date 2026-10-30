import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'

const facts=Array.from({length:10},(_,i)=>({id:'fact-'+i,category:'stable_profile',事实键:'主人.偏好.'+i,text:'主人长期偏好 '+i,importance:1-i*.03}))
const insights=Array.from({length:5},(_,i)=>({id:'insight-'+i,category:'event',source:'life-reflection',text:'与观众讨论音乐后形成的领悟 '+i,importance:.85}))
const episodes=Array.from({length:8},(_,i)=>({id:'episode-'+i,summary:'今天与观众讨论音乐的真实互动 '+i,stage:'clear',importance:.8}))
const cfg=(other={})=>({mainSessionMemoryEnabled:true,mainSessionMemorySemanticEnabled:false,
  mainSessionMemoryMaxItems:6,mainSessionMemoryFactsMax:2,mainSessionMemoryMaxChars:800,...other})
const make=(settings={},rows=[...facts,...insights],events=episodes,invokeModel=async()=>'{"memory_ids":[]}')=>createMemoryRetriever({
  getMemories:()=>rows,getConfig:()=>cfg(settings),getEpisodes:()=>events,getEpisodeCandidates:()=>events.map(e=>({...e,at:'2026-10-30'})),invokeModel
})
const lines=context=>context.split('\n').filter(line=>line.startsWith('- '))

test('主 Session 自动召回：事实、反思、经历总数与字符都受同一上限约束',async()=>{
 const retriever=make()
 for(const context of [retriever.localContext('音乐 观众','chat'),(await retriever.retrieve('音乐 观众','manual')).context]){
  assert.ok(lines(context).length<=6,context)
  assert.ok(context.length<=800)
  assert.ok(lines(context).filter(s=>s.includes('主人长期偏好')).length<=2)
  assert.match(context,/真实互动/)
  assert.match(context,/形成的领悟/)
 }
 const result=await retriever.retrieve('音乐 观众','manual')
 assert.equal(result.ids.length+result.episodes.length,lines(result.context).length)
 assert.equal(result.episodeIds.length,result.episodes.length)
})

test('长期事实设为 0，常驻身份与所有稳定事实都不能注入，但反思、经历仍可召回',async()=>{
 const retriever=make({mainSessionMemoryFactsMax:0,mainSessionMemoryMaxItems:3})
 for(const context of [retriever.localContext('音乐 观众','chat'),(await retriever.retrieve('音乐 观众','manual')).context]){
  assert.doesNotMatch(context,/主人长期偏好|常驻身份记忆/)
  assert.ok(lines(context).length<=3)
  assert.match(context,/真实互动|形成的领悟/)
 }
})

test('只有常驻事实时不丢失身份；有具体经历且只有一个名额时优先保留经历',()=>{
 const lone=make({mainSessionMemoryMaxItems:1,mainSessionMemoryFactsMax:6},facts,[])
 assert.equal(lines(lone.localContext('天气','chat')).length,1)
 const contextual=make({mainSessionMemoryMaxItems:1,mainSessionMemoryFactsMax:6},facts,episodes)
 const text=contextual.localContext('音乐','chat')
 assert.doesNotMatch(text,/长期偏好/)
 assert.match(text,/真实互动/)
 assert.equal(lines(text).length,1)
})

test('字符上限包括标题与换行，低成本模型重排也不得突破份额或绕过事实 0',async()=>{
 const rows=[...facts,...insights]
 const retriever=make({mainSessionMemorySemanticEnabled:true,mainSessionMemoryMaxChars:200,mainSessionMemoryMaxItems:2,mainSessionMemoryFactsMax:0},rows,episodes,
  async prompt=>{
    const ids=[...prompt.matchAll(/"id":"([^"]+)"/g)].map(x=>x[1])
    return JSON.stringify({memory_ids:ids.slice(0,8)})
  })
 const r=await retriever.retrieve('完全不同的概念','manual')
 assert.equal(r.usedModel,true)
 assert.ok(lines(r.context).length<=2)
 assert.ok(r.context.length<=200,r.context)
 assert.doesNotMatch(r.context,/主人长期偏好/)
 assert.ok(r.ids.length+r.episodeIds.length<=2)
})

test('既有 B站 UID 社交召回、私密隔离不受主 Session 配额调整影响',()=>{
 const privateFacts=[{id:'secret',text:'主人的私人地址不可外传',category:'stable_profile',事实键:'主人.偏好.地址'}]
 const retriever=make({mainSessionMemoryFactsMax:0},privateFacts,[])
 assert.equal(retriever.socialContext('主人的私人地址',{actorUid:'222',role:'stranger'}),'')
})

test('配置处理必须保留显式的 0 值，界面必须说明模型只做可选重排',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(host,/mainSessionMemoryFactsMax=Number\.isFinite\(n\)/)
 assert.match(html,/设为 0 则不注入长期事实/)
 assert.match(html,/默认本地检索，启用后可选 AI 重排/)
})

test('等待 AI 时主人关闭记忆或把事实配额改成 0，必须按最新设置返回',async()=>{
 let settings=cfg({mainSessionMemorySemanticEnabled:true})
 const retriever=createMemoryRetriever({getMemories:()=>[...facts,...insights],getConfig:()=>settings,
  getEpisodes:()=>episodes,getEpisodeCandidates:()=>episodes.map(e=>({...e,at:'2026-10-30'})),invokeModel:async()=>{
   settings={...settings,mainSessionMemoryFactsMax:0}
   return JSON.stringify({memory_ids:['fact-0','insight-0']})
  }})
 const first=await retriever.retrieve('没有关键词的提问','manual')
 assert.equal(first.usedModel,true)
 assert.doesNotMatch(first.context,/主人长期偏好/)
 assert.match(first.context,/领悟/)
 settings={...settings,mainSessionMemoryEnabled:false}
 const second=await retriever.retrieve('音乐','manual')
 assert.equal(second.context,'')
})

test('模型失败回退时如经历已经自然遗忘，不能使用调用前保存的旧副本',async()=>{
 let available=[...episodes]
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:()=>cfg({mainSessionMemorySemanticEnabled:true}),
  getEpisodes:()=>available,getEpisodeCandidates:()=>available.map(e=>({...e,at:'2026-10-30'})),
  logger:{warn(){}},invokeModel:async()=>{available=[];throw Error('offline')}})
 const result=await retriever.retrieve('陌生问题','manual')
 assert.equal(result.reason,'fallback')
 assert.equal(result.episodes.length,0)
 assert.doesNotMatch(result.context,/真实互动/)
})
