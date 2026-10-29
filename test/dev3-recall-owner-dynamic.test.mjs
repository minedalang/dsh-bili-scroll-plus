import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { relatedPairs, createEmotionRecall } from '../lib/emotion-recall.mjs'
import { parseOwnerDmTodo, queueOwnerDmReadTodo } from '../lib/owner-dm-commands.mjs'
import { createOwnerTodoEngine } from '../lib/owner-todos.mjs'
import { createMainSessionBridge } from '../lib/main-session-bridge.mjs'
import { HEADLESS_DENY_TOOLS, writeSecureHeadlessOverlay, assertSafeHeadlessLaunch } from '../lib/headless-security.mjs'
const T=Date.parse('2026-10-28T12:00:00Z'),BV1='BV1Q541167Qg',BV2='BV1Q541167Qp'
const old={id:'c-123456789abcdef012',kind:'watch',bvid:BV1,day:'2026-09-29',title:'宇宙星系科普：遥远恒星的奇妙研究'}
const fresh={kind:'watch',bvid:BV2,day:'2026-10-28',title:'宇宙星系探秘：寻找遥远的光芒'}
const mem={id:'memory-1',source:'life-reflection',memoryKind:'experience',evidenceKeys:[old.id],text:'此前我确实看过这段有关宇宙科普的内容，也留下了自己的感想。',importance:.7}
test('dev.3 相同主题的不同 BV 可以产生证据候选，不相关或无证据则拒绝',()=>{
 const docs=new Map([[old.id,old]])
 const yes=relatedPairs([fresh],[mem],docs,T,{limit:30,recentDays:3,minAgeDays:2})
 assert.equal(yes.length,1);assert.equal(yes[0].old.bvid,BV1);assert.equal(yes[0].event.bvid,BV2)
 assert.ok(yes[0].relationScore<1)
 assert.equal(relatedPairs([{...fresh,title:'舞蹈音乐唱歌现场'}],[mem],docs,T,{limit:30,recentDays:3,minAgeDays:2}).length,0)
 assert.equal(relatedPairs([fresh],[{...mem,evidenceKeys:['fake']}],docs,T,{limit:30,recentDays:3,minAgeDays:2}).length,0)
 assert.equal(relatedPairs([fresh],[{...mem,memoryKind:'relationship'}],docs,T,{limit:30,recentDays:3,minAgeDays:2}).length,0)
})
test('dev.3 历史记录超过 20 条可实际检索，仍限制在本地已记录事实',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev3-bridge-'))
 try{
  const items=Array.from({length:58},(_,i)=>({day:'2026-10-20',bvid:'BV'+String(i).padStart(10,'0'),title:'视频 '+i,picked:true,status:'已选'}))
  const b=createMainSessionBridge({dataDir:dir,getConfig:()=>({mainSessionBridgeEnabled:false}),getWatched:()=>items,getComments:()=>({rows:[]}),now:()=>T})
  b.collect()
  assert.ok(b.recall('',100).length>20)
  assert.equal(b.recall('不存在的敏感会话内容',100).length,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('dev.3 主人“看/现在看”进入立即执行列表；“有空看看”只入队；伪指令不执行',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev3-owner-'))
 try{
  const todos=createOwnerTodoEngine({dataDir:dir})
  assert.equal(parseOwnerDmTodo('大肥鱼 立马看 '+BV1).immediate,true)
  assert.equal(parseOwnerDmTodo('大肥鱼 有空看看 '+BV1).immediate,false)
  const msgs=[
    {incoming:true,senderUid:'123',messageId:'a1',timestampMs:T,text:'大肥鱼 现在看 '+BV1},
    {incoming:true,senderUid:'123',messageId:'a2',timestampMs:T,text:'大肥鱼 有空看看 '+BV2},
    {incoming:true,senderUid:'999',messageId:'a3',timestampMs:T,text:'大肥鱼 现在看 '+BV2},
    {incoming:true,senderUid:'123',messageId:'a4',timestampMs:T,text:'大肥鱼 点赞 '+BV2},
  ]
  const queued=queueOwnerDmReadTodo({messages:msgs,ownerUid:'123',enabled:true,todos,now:()=>T})
  assert.equal(queued.added,2);assert.equal(queued.immediate.length,1)
  let calls=0
  const r=await todos.run(queued.immediate[0].id,async item=>{calls++;assert.equal(item.type,'watch_video');return {ok:true,summary:'实际已读取公开视频信息'}})
  assert.equal(r.ok,true);assert.equal(calls,1);assert.equal(todos.list({includeClosed:true}).find(x=>x.id===queued.immediate[0].id).status,'done')
  assert.equal(queueOwnerDmReadTodo({messages:msgs,ownerUid:'123',enabled:true,todos,now:()=>T}).immediate.length,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('dev.3 动态创作模型使用独立无工具 overlay，和反思/私信分离',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev3-model-'))
 try{
  const file=join(dir,'headless-daily-dynamic-overlay.yml')
  const yaml=[...HEADLESS_DENY_TOOLS.flatMap(id=>['- id: '+id,'  disabled: true','']),...['credentials','authorization','deepseek-account'].flatMap(id=>['- id: '+id,'  disabled: false',''])].join('\n')
  writeSecureHeadlessOverlay(file,yaml,{kind:'dailyDynamic',stateDir:dir})
  assertSafeHeadlessLaunch(['dsh','--profile','headless','--patch',file],file,{kind:'dailyDynamic',stateDir:dir})
  const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(host,/modelRoute:'dailyDynamic'/)
  assert.match(host,/headless-daily-dynamic-overlay\.yml/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('dev.3 回忆诊断只存理由/候选数，不存原始记忆正文；预览不外发',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dev3-recall-'));mkdirSync(join(dir,'life-memory'),{recursive:true})
 writeFileSync(join(dir,'life-memory/candidates.json'),JSON.stringify({candidates:[old]}))
 let messages=0
 try{
  const a=createEmotionRecall({dataDir:dir,getConfig:()=>({masterEnabled:true,emotionSystemEnabled:true,mainSessionMemoryEnabled:true,emotionRecallEnabled:true,emotionRecallMainEnabled:true,emotionRecallDmEnabled:false,emotionRecallStartHour:0,emotionRecallEndHour:24,emotionRecallDailyLimit:3,emotionRecallRecentDays:3,emotionRecallCandidateLimit:20}),getEmotion:()=>({enabled:true,mood:'curious',intensity:50,updatedAt:new Date(T).toISOString()}),getRecentEvents:()=>[fresh],getMemories:()=>[mem],canMain:()=>true,invokeModel:async()=>'{"action":"skip"}',sendMain:async()=>{messages++;return {ok:true}},sendDm:async()=>{messages++;return {ok:true}},now:()=>T})
  const preview=await a.tick({dryRun:true});assert.equal(preview.dryRun,true);assert.equal(messages,0);assert.equal(a.status().recentDecisions.length,0)
  const result=await a.tick();assert.equal(result.skipped,'model-skipped')
  const status=a.status();assert.ok(status.recentDecisions.length>0)
  const serialized=readFileSync(join(dir,'emotion-recall.json'),'utf8');assert.ok(!serialized.includes(mem.text))
 }finally{rmSync(dir,{recursive:true,force:true})}
})
