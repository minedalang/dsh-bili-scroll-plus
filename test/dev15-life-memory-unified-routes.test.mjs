import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'
import {createEmotionRecall} from '../lib/emotion-recall.mjs'

const T=Date.parse('2026-10-28T12:00:00Z')
const video='BV1Q541167Qp',second='BV1Q541167Qg'
const key='watch:2026-10-10:'+video
const candidate={id:'c-123456789abcdef012',key,kind:'watch',bvid:video,day:'2026-10-10',title:'这是一套非常特别的系列影片第一集'}
const memory={id:'m-old',source:'life-reflection',memoryKind:'experience',text:'我从这个视频的系列中学到值得认真观看。',evidenceKeys:[candidate.id],importance:0.9}
const fresh={kind:'watch',bvid:second,day:'2026-10-28',title:'这是一套非常特别的系列影片第二集'}
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'dsh-unified-gateway-'))
 let time=T
 const cfg={mainSessionMemoryEnabled:true,mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.25}
 const gateway=createLifeMemoryGateway({dataDir:dir,getConfig:()=>cfg,now:()=>time,logger:{warn(){}}})
 gateway.recordEvents([{kind:'watch',key,bvid:video,title:candidate.title,day:'2026-10-10'}])
 return {dir,gateway,cfg,setTime:t=>{time=t},now:()=>time,cleanup:()=>{gateway.close();rmSync(dir,{recursive:true,force:true})}}
}

test('情绪回忆旧候选只提供索引 ID；当前清晰副本投影原始可用证据，模糊后不恢复 BV/标题',()=>{
 const f=fixture()
 try{
  const clear=f.gateway.emotionEvidence([candidate]);assert.equal(clear.length,1)
  assert.equal(clear[0].bvid,video)
  assert.match(clear[0].title,/系列影片第一集/)
  f.setTime(T+90*86400000)
  assert.deepEqual(f.gateway.emotionEvidence([candidate]),[])
  assert.deepEqual(f.gateway.recall({query:video,domain:'bili-explore'}),[])
  assert.deepEqual(f.gateway.reflectionEvidence([key]),[])
 }finally{f.cleanup()}
})

test('视频探索只使用自己的公开视频经历，不会拿到某个陌生人的私密共同经历',()=>{
 const f=fixture()
 try{
  f.gateway.recordEvents([{kind:'social',key:'social:123:'+video+':12345',bvid:video,uid:'123',text:'给我私密信息',day:'2026-10-27'}])
  const watches=f.gateway.recall({query:'系列影片',domain:'bili-explore',maxItems:4})
  assert.equal(watches.length,1);assert.equal(watches[0].kind,'watch')
  assert.equal(f.gateway.recall({query:'私密',domain:'bili-life',role:'stranger',actorUid:'456'}).length,0)
  assert.ok(f.gateway.recall({query:'系列影片',domain:'bili-life',role:'friend',actorUid:'123'}).every(e=>e.kind==='social'))
  const retriever=createMemoryRetriever({getMemories:()=>[{id:'private',category:'stable_profile',text:'主人的私人住址',事实键:'主人.地址'}],getConfig:()=>({...f.cfg,mainSessionMemoryMaxItems:3}),
    getEpisodes:(q,o)=>f.gateway.recall({query:q,...o}),getEpisodeCandidates:()=>[]})
  const context=retriever.localContext('系列影片','video')
  assert.match(context,/系列影片/)
  assert.doesNotMatch(context,/私人住址/)
 }finally{f.cleanup()}
})

test('B站公开记忆最终总数上限包含公开知识 + 同一 UID 经历；不同 UID 内容不能串线',()=>{
 const f=fixture()
 try{
  const r1='social:123:'+video+':12345',r2='social:123:'+second+':54321'
  f.gateway.recordEvents([{kind:'social',key:r1,bvid:video,uid:'123',text:'你还记得我吗',day:'2026-10-27'},
   {kind:'social',key:r2,bvid:second,uid:'123',text:'你好我又回来啦',day:'2026-10-28'},
   {kind:'social',key:'social:789:'+second+':33333',bvid:second,uid:'789',text:'其他人的秘密',day:'2026-10-27'}])
  const approved=Array.from({length:5},(_,i)=>({id:'pub'+i,text:'聊天与记忆的公开经验 '+i,source:'owner-public-approved',visibility:'public',publicApproved:true}))
  const retriever=createMemoryRetriever({getMemories:()=>approved,getConfig:()=>({...f.cfg,mainSessionMemoryMaxItems:6}),getEpisodes:(q,o)=>f.gateway.recall({query:q,...o}),getEpisodeCandidates:()=>[]})
  const actual=retriever.socialContext('你好我又回来啦',{actorUid:'123',role:'friend',maxItems:2,maxChars:1000})
  assert.ok(actual.split('\n').filter(s=>s.startsWith('- ')).length<=2,actual)
  assert.match(actual,/回来/)
  assert.doesNotMatch(actual,/其他人的秘密/)
  assert.equal(retriever.socialContext('其他人的秘密',{actorUid:'456',role:'stranger'}),'')
 }finally{f.cleanup()}
})

test('情绪回忆在 AI 决策过程中遗忘，则不外发旧候选细节',async()=>{
 const f=fixture()
 let called=0,sent=0
 try{
  mkdirSync(join(f.dir,'life-memory'),{recursive:true})
  writeFileSync(join(f.dir,'life-memory','candidates.json'),JSON.stringify({candidates:[candidate]}))
  const engine=createEmotionRecall({dataDir:f.dir,getConfig:()=>({...f.cfg,masterEnabled:true,emotionSystemEnabled:true,emotionRecallEnabled:true,
   emotionRecallMainEnabled:true,emotionRecallDmEnabled:false,emotionRecallStartHour:0,emotionRecallEndHour:24,
   emotionRecallDailyLimit:1,emotionRecallRecentDays:3,emotionRecallMinAgeDays:2}),
   getEmotion:()=>({enabled:true,mood:'curious',intensity:60,updatedAt:new Date(f.now()-120000).toISOString()}),
   getRecentEvents:()=>[fresh],getMemories:()=>[memory],getEvidenceRows:rows=>f.gateway.emotionEvidence(rows),
   canMain:()=>true,now:f.now,invokeModel:async(prompt)=>{called++;const x=JSON.parse(prompt.split('<verified_candidates>')[1].split('</verified_candidates>')[0]);
    f.setTime(T+90*86400000);return JSON.stringify({action:'share',key:x[0].key,memory_id:x[0].memoryId,channel:'main'})},
   sendMain:async()=>{sent++;return {ok:true}},sendDm:async()=>{sent++;return {ok:true}},logger:{warn(){}}})
  const result=await engine.tick()
  assert.equal(called,1)
  assert.equal(sent,0)
  assert.equal(result.skipped,'memory-no-longer-available')
 }finally{f.cleanup()}
})

test('主 Session 主动回忆共用一次动态召回结果，不再叠加无配额的经历列表',async()=>{
 const {createLongTermMemory}=await import('../lib/long-term-memory.mjs')
 const dir=mkdtempSync(join(tmpdir(),'dsh-unified-session-'))
 const tools=[]
 const agent={id:'test-room',sessionId:'test-room',session:{snapshotEvents:()=>[]},ctx:{
  on(){return ()=>{}},systemPrompt:{section(){return ()=>{}},context(){return ()=>{}}},
  tools:{register(t){tools.push(t);return ()=>{}}}
 }}
 let calls=0,sideChannel=0
 const retriever={localContext:()=>'',retrieve:async()=>{calls++;return {context:'【统一配额】\n- 一条事实\n- 一次经历',episodes:[{id:'event-1',kind:'watch',summary:'一次经历'}]}}}
 const mem=createLongTermMemory({dataDir:dir,dshHome:dir,agents:{get:()=>agent,list:()=>[agent]},
  getConfig:()=>({mainSessionId:'test-room',mainSessionMemoryEnabled:true}),defineTool:x=>x,
  getRetriever:()=>retriever,getExperienceRecall:()=>{sideChannel++;return Array.from({length:15},(_,i)=>({summary:'未计配额经历 '+i}))},logger:{warn(){}}})
 try{
  mem.start()
  const result=await tools.find(x=>x.name==='dafeiyu_life_recall').execute({query:'上次聊什么',limit:20})
  assert.equal(calls,1)
  assert.equal(sideChannel,0)
  assert.equal(result.experiences.length,1)
  assert.doesNotMatch(JSON.stringify(result),/未计配额经历/)
 }finally{mem.stop();rmSync(dir,{recursive:true,force:true})}
})
