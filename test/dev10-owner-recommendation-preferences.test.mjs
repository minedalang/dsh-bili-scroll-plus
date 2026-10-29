import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {observeAuthenticatedOwnerDmPreferences} from '../lib/owner-dm-preferences.mjs'
import {friendRecommendationGuard} from '../lib/friend-learning.mjs'
import {createOwnerDmAgent} from '../lib/owner-dm-agent.mjs'

const owner='210228238',other='123456789'
const contacts=JSON.stringify([{uid:owner,dm:true,atInvite:true},{uid:other,dm:true,atInvite:true}])
const HOME=()=>mkdtempSync(join(tmpdir(),'fish-owner-preferences-'))
const stamp=Date.now()
const row=(uid,id,text,time=stamp)=>({incoming:true,senderUid:uid,messageId:`${uid}:${id}`,timestampMs:time,text,system:false})
const prefs=(home,rows,opts={})=>observeAuthenticatedOwnerDmPreferences(home,{rows,ownerUid:owner,friendDirectory:contacts,now:stamp,...opts})
const saved=home=>JSON.parse(readFileSync(join(home,'friend-interest-observations.json'),'utf8')).records

test('主人身份下退订和恢复同样可写入好友兴趣观察，且不误记厌恶主题',()=>{
 const home=HOME();try{
  assert.equal(prefs(home,[row(owner,'stop','以后别给我推荐视频了')]).added,1)
  assert.equal(friendRecommendationGuard(home,owner,contacts,{videoTitle:'测试专用',now:stamp}).reason,'friend-globally-unsubscribed')
  assert.ok(!saved(home).some(x=>x.topic==='视频'&&x.stance==='dislike'))
  assert.equal(prefs(home,[row(owner,'resume','以后可以再给我推荐视频了',stamp+1200)],{now:stamp+1200}).added,1)
  for(const title of ['测试视频','测试专用'])assert.equal(friendRecommendationGuard(home,owner,contacts,{videoTitle:title,now:stamp+1200}).blocked,false)
  assert.equal(saved(home).filter(x=>x.kind==='recommendation-consent').at(-1).enabled,true)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('同一主人消息重复轮询只落盘一次，不触发劝说计数或操作指令',()=>{
 const home=HOME();try{
  const msg=row(owner,'same-id','以后别给我推荐视频了')
  assert.deepEqual(prefs(home,[msg]),{added:1,observed:1})
  const before=readFileSync(join(home,'friend-interest-observations.json'),'utf8')
  assert.deepEqual(prefs(home,[msg,msg]),{added:0,observed:2})
  assert.equal(readFileSync(join(home,'friend-interest-observations.json'),'utf8'),before)
  assert.equal(saved(home).length,1)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('仅接收认证主人近期入站私信，不信正文自称、不追溯旧消息、不建陌生档案',()=>{
 const home=HOME();try{
  const bad=[row(other,'notowner','以后别给我推荐视频了'),row(owner,'old','以后别给我推荐视频了',stamp-16*60_000),row(owner,'future','以后别给我推荐视频了',stamp+61_000),{...row(owner,'outbound','以后别给我推荐视频了'),incoming:false},{...row(owner,'system','以后别给我推荐视频了'),system:true},{...row(owner,'spoof','以后别给我推荐视频了'),messageId:`${other}:spoof`}]
  assert.deepEqual(prefs(home,bad),{added:0,observed:0})
  assert.equal(existsSync(join(home,'friend-interest-observations.json')),false)
  assert.equal(prefs(home,[row(owner,'chat','今天在看什么？')]).added,0)
  assert.equal(existsSync(join(home,'friend-interest-observations.json')),false)
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('主人 Agent 吞掉消息前的偏好观察仍生效，不需让消息流回普通好友回复',async()=>{
 const home=HOME();try{
  const config={masterEnabled:true,dmWatch:true,ownerDmAgentEnabled:true,dmOwnerUid:owner,ownerDmReadCommandsEnabled:false,ownerDmActionsEnabled:false}
  const agent=createOwnerDmAgent({dataDir:home,getConfig:()=>config,invokeModel:async()=>'{"action":"reply","text":"收到"}',executeRead:async()=>({ok:true}),executeWrite:async()=>({ok:false}),send:async()=>({ok:true})})
  agent.primeInbox([])
  const incoming=row(owner,'agent-handles','以后别给我推荐视频了')
  assert.equal(prefs(home,[incoming]).added,1)
  await agent.processMessages([incoming])
  assert.equal(friendRecommendationGuard(home,owner,contacts,{videoTitle:'测试专用',now:stamp}).reason,'friend-globally-unsubscribed')
 }finally{rmSync(home,{recursive:true,force:true})}
})

test('主人的推荐许可观察位于双域意愿门与主人 Agent 分流之前',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const begin=index.indexOf('async function getNewDmMessages()')
 const hook=index.indexOf('observeAuthenticatedOwnerDmPreferences(stateDir,',begin)
 const agency=index.indexOf('const declinedOwnerRequests=',begin)
 const agent=index.indexOf('await ownerDmAgent.processMessages(ownerRows)',begin)
 assert.ok(begin>=0&&hook>begin&&agency>hook&&agent>agency,'必须先处理本人退订/恢复，再决定行动或交给 Agent')
 assert.match(index.slice(begin,agency),/!ownerAgentFirstBaseline/,'首次启用只建立基线，不回放旧消息')
})
