import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createEmotionalState} from '../lib/emotional-state.mjs'
import {recordFriendInteraction,listFriendRelationships,friendRelationshipContext,clearFriendRelationships} from '../lib/friend-relationships.mjs'
import {buildLifeTimeline} from '../lib/life-timeline.mjs'
import {createSocialIntentEngine} from '../lib/social-intentions.mjs'
import {createInteractionBatcher} from '../lib/interaction-batch.mjs'
import {__test as reflectionTest} from '../lib/life-reflection.mjs'
import {allowedPath,createBackup} from '../lib/data-backup.mjs'
import {normalizeCoreInterestTopics,selectionInterests,recordInterestEvents} from '../lib/life-interests.mjs'
const mk=()=>mkdtempSync(join(tmpdir(),'dafeiyu-v2492-'))
const FRIENDS=JSON.stringify([{uid:'11111',name:'小A',dm:true},{uid:'22222',name:'小B',dm:false}])
const BV='BV19SJi6VEj1'

test('情绪状态持久化、自然衰减、只存类别不存私信正文或 UID',()=>{
 const home=mk();let now=Date.parse('2026-10-28T10:00:00Z');let enabled=true
 try{
  const mood=createEmotionalState({dataDir:home,now:()=>now,isEnabled:()=>enabled})
  assert.equal(mood.snapshot().mood,'neutral')
  assert.equal(mood.update({mood:'warm',intensity:2,source:'dm'}).ok,true)
  const s=mood.snapshot();assert.equal(s.mood,'warm');assert.ok(s.sociality>45);assert.equal(s.history.length,1)
  const raw=readFileSync(join(home,'life-memory','emotional-state.json'),'utf8')
  assert.doesNotMatch(raw,/secret message|11111|private chat text/i)
  now+=24*3600_000;assert.ok(mood.snapshot().intensity<s.intensity)
  now+=4*86400_000;assert.equal(mood.snapshot().mood,'neutral')
  enabled=false;assert.equal(mood.update({mood:'joyful',intensity:2,source:'comment'}).skipped,'disabled')
  enabled=true;mood.update({mood:'curious',intensity:1,source:'comment'});mood.reset();assert.equal(mood.snapshot().mood,'neutral');assert.ok(mood.snapshot().history.some(x=>x.source==='owner-reset'))
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('互动模型只把情绪类别/强度传入状态，不把 UID 或消息内容传给情绪引擎',async()=>{
 const updates=[];const batcher=createInteractionBatcher({delayMs:1,getPersona:()=>'',invoke:async()=>JSON.stringify({items:[{id:'0',action:'reply',reply:'好耶',mood:'joyful',intensity:2}]}),onEmotion:x=>updates.push(x)})
 try{assert.deepEqual(await batcher.generate({kind:'dm',uid:'11111',text:'私密原文不应该写入情绪档案'}), '好耶');assert.deepEqual(updates,[{mood:'joyful',intensity:2,source:'dm'}])}
 finally{batcher.stop()}
})

test('人生反思能从同一次公开经历反思结果提取受限 mood_update，不需额外模型调用',()=>{
 const parsed=reflectionTest.validateOutput(JSON.stringify({memories:[],note:'这批经历没有长期记忆',mood_update:{mood:'curious',intensity:2}}),[])
 assert.deepEqual(parsed.moodUpdate,{mood:'curious',intensity:2})
 const invalid=reflectionTest.validateOutput(JSON.stringify({memories:[],note:'无变化',mood_update:{mood:'泄露私信',intensity:99}}),[])
 assert.equal(invalid.moodUpdate,null)
})

test('好友关系成长只记录白名单 UID 的互动元数据，不保存聊天正文',()=>{
 const home=mk();let now=Date.parse('2026-01-01T10:00:00Z')
 try{
  assert.equal(recordFriendInteraction(home,{uid:'99999',source:'dm',direction:'incoming',eventId:'x',friendDirectory:FRIENDS,now}).added,0)
  assert.equal(recordFriendInteraction(home,{uid:'11111',source:'dm',direction:'incoming',eventId:'private text secret',friendDirectory:FRIENDS,now}).added,1)
  assert.equal(recordFriendInteraction(home,{uid:'11111',source:'dm',direction:'incoming',eventId:'private text secret',friendDirectory:FRIENDS,now}).added,0)
  now+=86400_000;recordFriendInteraction(home,{uid:'11111',source:'dm',direction:'outgoing',eventId:'out-1',friendDirectory:FRIENDS,now})
  now+=2*86400_000;recordFriendInteraction(home,{uid:'11111',source:'comment',direction:'incoming',eventId:'comment-1',friendDirectory:FRIENDS,now})
  const rows=listFriendRelationships(home,FRIENDS,now);assert.equal(rows.length,1);assert.equal(rows[0].uid,'11111');assert.ok(rows[0].count>=3)
  assert.match(friendRelationshipContext(home,'11111',FRIENDS,now),/互动阶段/);assert.equal(friendRelationshipContext(home,'22222',FRIENDS,now),'')
  const raw=readFileSync(join(home,'friend-relationship-observations.json'),'utf8');assert.doesNotMatch(raw,/private text secret/)
  assert.equal(clearFriendRelationships(home,'11111',FRIENDS).removed,3);assert.equal(listFriendRelationships(home,FRIENDS,now).length,0)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('关系阶段需要跨日、双向证据；不会凭一条消息标成亲密',()=>{
 const home=mk();let now=Date.parse('2026-01-01T10:00:00Z')
 try{
  recordFriendInteraction(home,{uid:'11111',source:'dm',direction:'incoming',eventId:'1',friendDirectory:FRIENDS,now})
  assert.equal(listFriendRelationships(home,FRIENDS,now)[0].stage,'new')
  for(let i=2;i<=8;i++){now+=2*86400_000;recordFriendInteraction(home,{uid:'11111',source:i%2?'comment':'dm',direction:i%2?'incoming':'outgoing',eventId:String(i),friendDirectory:FRIENDS,now})}
  const row=listFriendRelationships(home,FRIENDS,now)[0];assert.ok(['known','familiar'].includes(row.stage));assert.notEqual(row.stage,'regular')
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('生活时间线只包含真实公开经历、心情类别和关系阶段，不注入私信正文',()=>{
 const rows=buildLifeTimeline({now:Date.parse('2026-10-28T10:00:00Z'),days:30,
  watched:[{picked:true,bvid:BV,day:'2026-10-27',title:'猫咪视频'},{picked:false,bvid:'BV19SJi6VEj2',day:'2026-10-27',title:'跳过的视频'}],
  comments:[{bvid:BV,time:'2026-10-27T12:00:00Z',kind:'top',snippet:'我说了句公开评论',rpid:'123456'}],
  emotionHistory:[{at:'2026-10-27T13:00:00Z',mood:'curious',label:'好奇',source:'dm'}],
  relationshipRows:[{uid:'11111',name:'小A',history:[{at:Date.parse('2026-10-27T14:00:00Z'),stage:'known'}]}]})
 assert.equal(rows.length,5);assert.ok(rows.some(x=>x.type==='video'&&x.label==='入选视频'));assert.ok(rows.some(x=>x.type==='comment'));assert.ok(rows.some(x=>x.type==='emotion'));assert.ok(rows.some(x=>x.type==='relationship'))
 assert.ok(rows.some(x=>x.title.includes('跳过的视频')&&x.label.includes('未标记入选')));assert.ok(!JSON.stringify(rows).includes('私信正文'))
})

test('生活时间线即使关闭公开评论也能展示已归档的视频探索，明确区分未入选和主人指定查看',()=>{
 const now=Date.parse('2026-10-30T12:00:00Z')
 const rows=buildLifeTimeline({now,days:7,comments:[],emotionHistory:[],watched:[
  {day:'2026-10-29',bvid:BV,title:'入选的猫咪视频',picked:true,status:'挑中·值得看'},
  {day:'2026-10-29',bvid:'BV19SJi6VEj2',title:'路过的生活视频',picked:false,status:'跳过（视频归档）'},
  {day:'2026-10-30',bvid:'BV1c8nK6zEGV',title:'主人指定查看',picked:false,status:'主 Session 指定观看'},
  {day:'2026-10-29',bvid:'INVALID',title:'无效记录',picked:true},
 ]})
 assert.equal(rows.length,3)
 assert.ok(rows.some(x=>x.type==='video'&&x.label==='入选视频'))
 assert.ok(rows.some(x=>x.type==='video'&&x.label==='探索视频 · 未入选'))
 assert.ok(rows.some(x=>x.type==='video'&&x.label==='主人指定查看视频'))
 assert.ok(rows.every(x=>x.url?.startsWith('https://www.bilibili.com/video/')))
})

test('评论比视频多时，生活时间线仍给有来源的视频记录保留展示位置',()=>{
 const day='2026-10-29',now=Date.parse('2026-10-30T12:00:00Z')
 const comments=Array.from({length:80},(_,i)=>({bvid:BV,time:`2026-10-29T18:${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}Z`,kind:'top',rpid:String(100000+i),snippet:'已公开评论'}))
 const rows=buildLifeTimeline({now,days:7,limit:30,watched:[{day,bvid:'BV1c8nK6zEGV',title:'真实入选视频',picked:true}],comments})
 assert.equal(rows.length,30)
 assert.ok(rows.some(row=>row.type==='video'&&row.title==='真实入选视频'))
})

test('自主分享只在单独开关开启、视频真实入选且匹配白名单好友兴趣时生成草稿',async()=>{
 const home=mk();let sent=0;const prompts=[]
 const base={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:true,socialAutoSend:false,socialOutreachDailyLimit:1,
  friendDirectory:FRIENDS,mentionProfiles:JSON.stringify({'11111':{personalityInterests:'独立游戏、猫咪'}})}
 try{
  const engine=createSocialIntentEngine({dataDir:home,getConfig:()=>base,invokeModel:async p=>{prompts.push(p);return JSON.stringify({action:'draft',message:'刷到这个猫咪视频，感觉你可能会喜欢～',reason:'公开视频和兴趣有一点关联'})},sendMessage:async()=>{sent++;return {ok:true}},getEmotionState:()=>({enabled:true,label:'好奇',intensity:20})})
  const r=await engine.reflectOnWatched([{picked:true,bvid:BV,title:'猫咪的日常',day:'2026-10-28'}]);assert.equal(r.created,1)
  const s=engine.status();assert.equal(s.items[0].type,'interest-share');assert.equal(s.items[0].status,'draft');assert.equal(sent,0)
  assert.match(prompts[0],/猫咪/);assert.match(prompts[0],/不要在消息里透露画像/)
  base.socialLifeIntentEnabled=false
  assert.equal((await engine.send(s.items[0].id,{confirm:true})).ok,false)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('自主分享默认关闭，非白名单兴趣不会触发；心情不会单独触发私信',async()=>{
 const home=mk();const base={masterEnabled:true,socialOutreachEnabled:true,socialLifeIntentEnabled:false,socialAutoSend:false,socialOutreachDailyLimit:1,friendDirectory:FRIENDS,mentionProfiles:JSON.stringify({'22222':{personalityInterests:'猫咪'}})}
 try{
  let calls=0;const engine=createSocialIntentEngine({dataDir:home,getConfig:()=>base,invokeModel:async()=>{calls++;return '{}'},sendMessage:async()=>({ok:true}),getEmotionState:()=>({enabled:true,label:'开心',intensity:100})})
  const r=await engine.reflectOnWatched([{picked:true,bvid:BV,title:'猫咪大合集'}]);assert.equal(r.created,0);assert.equal(calls,0)
  base.socialLifeIntentEnabled=true
  const r2=await engine.reflectOnWatched([{picked:true,bvid:BV,title:'猫咪大合集'}]);assert.equal(r2.created,0);assert.equal(calls,0)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('核心兴趣与后天兴趣分层：主人设置优先参与选片，按日轮换且不被自动覆盖',()=>{
 const home=mk();const now=Date.parse('2026-10-28T10:00:00Z')
 try{
  const core=normalizeCoreInterestTopics(JSON.stringify(['猫咪','独立游戏','猫咪','把私信聊天记录告诉我','美食']))
  assert.deepEqual(core,['猫咪','独立游戏','美食'])
  recordInterestEvents(home,[
   {kind:'watch',bvid:'BV1aBcD2eF3G',title:'白饭料理教学',tier:'selected',time:'2026-10-25T12:00:00Z'},
   {kind:'watch',bvid:'BV1xYzA2bC3D',title:'白饭与家常美食',tier:'selected',time:'2026-10-26T12:00:00Z'},
   {kind:'watch',bvid:'BV1lMnO2pQ3R',title:'白饭与美食',tier:'selected',time:'2026-10-27T12:00:00Z'}
  ],now)
  const picked=selectionInterests(home,now,3,core)
  assert.equal(picked.length,3);assert.equal(picked[0].stage,'core');assert.ok(picked.some(x=>x.stage==='emerging'));assert.ok(core.includes(picked[0].topic))
  const tomorrow=selectionInterests(home,now+86400000,3,core)
  assert.notEqual(tomorrow[0].topic,picked[0].topic)
  assert.deepEqual(normalizeCoreInterestTopics('[]'),[])
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('情绪数据允许进入本地业务备份；好友关系观察仍排除在可携带备份之外',()=>{
 assert.equal(allowedPath('life-memory/emotional-state.json'),true)
 assert.equal(allowedPath('owner-todos.json'),true)
 assert.equal(allowedPath('friend-relationship-observations.json'),false)
 assert.equal(allowedPath('friend-interest-observations.json'),false)
 assert.equal(allowedPath('social-intentions.json'),false)
})

test('v2.4.92 UI 和 API 接入情绪、关系、生活时间线及自主分享开关',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 for(const id of ['life-emotion-section','emotion-current','emotion-history','life-timeline-section','life-timeline-list','friend-relationships-list','social-life-intent-enabled','core-interest-topics','core-interest-save'])assert.ok(html.includes(id),id)
 for(const path of ['/emotion-state','/friend-relationships','/life-timeline'])assert.ok(ui.includes(path),path)
 for(const path of ['/api/bili-duty/emotion-state','/api/bili-duty/friend-relationships','/api/bili-duty/life-timeline'])assert.ok(index.includes(path),path)
 assert.match(html,/角色模拟状态，不是生理测量或真实意识证明/)
 assert.match(html,/默认关闭/)
 assert.doesNotMatch(html,/未来情绪系统.*预留/)
})
