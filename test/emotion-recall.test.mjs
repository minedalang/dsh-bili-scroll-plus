import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createEmotionRecall,relatedPairs,parseDecision,__test} from '../lib/emotion-recall.mjs'
const T=Date.parse('2026-10-28T12:00:00Z')
const NEW='BV1Q541167Qg',OLD='BV1Q541167Qp'
const record={id:'m-old-1',source:'life-reflection',memoryKind:'experience',text:'那时候我第一次认真追完这个系列的视频，觉得很有意思。',evidenceKeys:['c-123456789abcdef012'],importance:.8}
const old={id:'c-123456789abcdef012',kind:'watch',bvid:OLD,day:'2026-10-10',title:'这是一套非常特别的系列影片第一集'}
const fresh={kind:'watch',bvid:NEW,day:'2026-10-28',title:'这是一套非常特别的系列影片第二集'}
const config={masterEnabled:true,emotionSystemEnabled:true,mainSessionMemoryEnabled:true,emotionRecallEnabled:true,emotionRecallMainEnabled:true,emotionRecallDmEnabled:true,emotionRecallDailyLimit:1,emotionRecallCooldownHours:24,emotionRecallStartHour:9,emotionRecallEndHour:22,dmOwnerUid:'12345678'}
const feel={enabled:true,mood:'warm',intensity:74,updatedAt:new Date(T-15000).toISOString()}
const setup=(partial={},opts={})=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-emotion-recall-'));mkdirSync(join(dir,'life-memory'),{recursive:true});writeFileSync(join(dir,'life-memory/candidates.json'),JSON.stringify({candidates:[old]}))
 const calls=[],messages=[];let decisions=0
 const x=createEmotionRecall({dataDir:dir,getConfig:()=>({...config,...partial}),getEmotion:()=>opts.emotion||feel,getRecentEvents:()=>opts.events||[fresh],getMemories:()=>opts.memories||[record],canMain:()=>opts.online!==false,now:()=>T,
 invokeModel:async(prompt)=>{decisions++;const found=JSON.parse(prompt.split('<verified_candidates>')[1].split('</verified_candidates>')[0]);return opts.decision?.(found)||JSON.stringify({action:'share',key:found[0].key,memory_id:found[0].memoryId,channel:opts.channel||'dm'})},
 sendDm:async(value)=>{calls.push(value);return opts.dmResult||{ok:true}},sendMain:async(value)=>{messages.push(value);return {ok:true}},logger:{warn:()=>{}}})
 return {dir,x,calls,messages,decisions:()=>decisions,cleanup:()=>rmSync(dir,{recursive:true,force:true})}
}
test('old evidence-backed life experience matches a genuinely recent related video',()=>{
 const pairs=relatedPairs([fresh],[record],new Map([[old.id,old]]),T)
 assert.equal(pairs.length,1);assert.equal(pairs[0].memoryId,record.id)
 assert.equal(relatedPairs([{...fresh,day:'2026-09-01'}],[record],new Map([[old.id,old]]),T).length,0)
 assert.equal(relatedPairs([fresh],[{...record,source:'owner-manual'}],new Map([[old.id,old]]),T).length,0)
 assert.equal(relatedPairs([fresh],[{...record,evidenceKeys:['fake']}],new Map([[old.id,old]]),T).length,0)
})
test('disabled by default sends nothing and does not invoke a model',async()=>{
 const q=setup({emotionRecallEnabled:false});try{assert.equal((await q.x.tick()).skipped,'disabled');assert.equal(q.decisions(),0);assert.equal(q.calls.length,0)}finally{q.cleanup()}
})
test('strict owner UID DM permission, persisted send & no repeat from same emotion',async()=>{
 const q=setup();try{
  const r=await q.x.tick();assert.equal(r.sent,true);assert.equal(r.channel,'dm');assert.equal(q.calls.length,1);assert.equal(q.calls[0].uid,'12345678');assert.match(q.calls[0].text,/那时候我第一次认真追完/)
  assert.equal(q.calls[0].text.includes('主人那天特别开心'),false)
  assert.equal((await q.x.tick()).skipped,'daily-limit');assert.equal(q.x.status().sent,1)
  assert.equal(q.x.status().recentKeys.length,1)
 }finally{q.cleanup()}
})
test('unlimited bypasses positive daily cap but 0 remains explicitly disabled',async()=>{
 const q=setup({emotionRecallUnlimited:true,emotionRecallDailyLimit:1})
 try{
  writeFileSync(join(q.dir,'emotion-recall.json'),JSON.stringify({version:1,day:__test.localDay(T),sent:99,checks:0,lastCheckAt:0,lastEmotionAt:0,recentKeys:[]}))
  const r=await q.x.tick()
  assert.equal(r.sent,true)
  assert.equal(q.x.status().sent,100)
  assert.equal(q.calls.length,1)
 }finally{q.cleanup()}
 const off=setup({emotionRecallUnlimited:true,emotionRecallDailyLimit:0})
 try{assert.equal((await off.x.tick()).skipped,'daily-limit');assert.equal(off.calls.length,0)}finally{off.cleanup()}
})
test('main Session can speak on its own when that channel is enabled',async()=>{
 const q=setup({emotionRecallDmEnabled:false},{channel:'main'});try{const r=await q.x.tick();assert.equal(r.channel,'main');assert.equal(q.calls.length,0);assert.equal(q.messages.length,1)}finally{q.cleanup()}
})
test('model may skip; fabricated memory IDs and unauthorized channels cannot send',async()=>{
 assert.equal(parseDecision('{"action":"share","key":"bad","memory_id":"bad","channel":"dm"}',[],['dm']).action,'skip')
 assert.equal(parseDecision('{"action":"share","key":"x","memory_id":"m","channel":"dm"}',[{key:'x',memoryId:'m'}],['main']).action,'skip')
 const q=setup({}, {decision:()=>'{"action":"skip"}'});try{assert.equal((await q.x.tick()).skipped,'model-skipped');assert.equal(q.calls.length,0)}finally{q.cleanup()}
})
test('dry run never sends or consumes quota, quiet-hours and offline are respected',async()=>{
 const q=setup();try{const r=await q.x.tick({dryRun:true});assert.equal(r.dryRun,true);assert.equal(q.calls.length,0);assert.equal(q.x.status().checks,0);assert.equal(q.x.status().sent,0)}finally{q.cleanup()}
 const hour=new Date(T).getHours();const a=setup({emotionRecallStartHour:(hour+1)%24,emotionRecallEndHour:((hour+2)%24)||24});try{assert.equal((await a.x.tick()).skipped,'quiet-hours')}finally{a.cleanup()}
 const b=setup({emotionRecallDmEnabled:false},{online:false});try{assert.equal((await b.x.tick()).skipped,'offline-or-no-owner')}finally{b.cleanup()}
})
test('emotion alone, private memory or unrelated events do not initiate outbound messages',async()=>{
 const a=setup({}, {emotion:{...feel,intensity:5}});try{assert.equal((await a.x.tick()).skipped,'no-recent-emotion')}finally{a.cleanup()}
 const b=setup({}, {events:[{...fresh,title:'完全无关的另外一段音乐'}]});try{assert.equal((await b.x.tick()).skipped,'no-verified-recurrence')}finally{b.cleanup()}
 const c=setup({}, {memories:[{...record,memoryKind:'relationship'}]});try{assert.equal((await c.x.tick()).skipped,'no-verified-recurrence')}finally{c.cleanup()}
})
test('failed delivery is not recorded as success or retried within the cooldown',async()=>{
 const q=setup({}, {dmResult:{ok:false,error:'no auth'}});try{const r=await q.x.tick();assert.equal(r.ok,false);assert.equal(q.x.status().sent,0);assert.equal((await q.x.tick()).skipped,'cooldown')}finally{q.cleanup()}
})

test('suspicious pseudo-titles cannot be considered a recurrent experience',()=>{
 const fake={...old,title:'[外部标题含疑似指令文本，已省略；精确标题仍保留在插件档案]'}
 const recent={...fresh,title:'[外部标题含疑似指令文本，已省略；精确标题仍保留在插件档案]'}
 assert.equal(relatedPairs([recent],[record],new Map([[fake.id,fake]]),T).length,0)
})
