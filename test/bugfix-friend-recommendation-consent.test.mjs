import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {explicitInterestStatements,observeFriendInterest,friendInterestSummary,friendRecommendationGuard,listFriendLearning} from '../lib/friend-learning.mjs'
const dir=JSON.stringify([{uid:'123',dm:true,atInvite:true},{uid:'456',dm:true}])
const now=Date.now()
const makeHome=()=>mkdtempSync(join(tmpdir(),'fish-consent-fix-'))
const send=(h,id,text,uid='123')=>observeFriendInterest(h,{uid,text,source:'dm',eventId:id,friendDirectory:dir,now})

test('全局退订不是不喜欢「视频」；恢复后所有非拒绝标题均可推荐',()=>{
 const home=makeHome();try{
  send(home,'like-food','以后多给我推荐美食视频')
  assert.deepEqual(explicitInterestStatements('以后别给我推荐视频了'),[])
  assert.equal(send(home,'stop','以后别给我推荐视频了').added,1)
  assert.deepEqual(friendRecommendationGuard(home,'123',dir,{videoTitle:'猫咪日常',now}).reason,'friend-globally-unsubscribed')
  assert.equal(send(home,'resume','以后可以再给我推荐视频了').added,1)
  for(const title of ['测试视频','测试专用','猫咪日常'])assert.equal(friendRecommendationGuard(home,'123',dir,{videoTitle:title,now}).blocked,false,title)
  assert.ok(friendInterestSummary(home,'123',dir,{now}).some(r=>r.topic==='美食'&&r.stance==='like'))
  assert.equal(friendRecommendationGuard(home,'456',dir,{videoTitle:'测试专用',now}).blocked,false)
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('旧版误写的视频厌恶只在读取时忽略，不改存档且保留真正兴趣',()=>{
 const home=makeHome();try{
  send(home,'like-cats','以后多给我推荐猫咪视频')
  send(home,'stop','以后别给我推荐视频了')
  const p=join(home,'friend-interest-observations.json'),doc=JSON.parse(readFileSync(p,'utf8'))
  doc.records.push({uid:'123',key:'dm:stop',source:'dm',topic:'视频',stance:'dislike',signal:'explicit-recommendation-rejection',at:now})
  writeFileSync(p,JSON.stringify(doc),'utf8')
  send(home,'resume','以后可以再给我推荐视频了')
  const before=readFileSync(p,'utf8')
  assert.ok(!friendInterestSummary(home,'123',dir,{now}).some(r=>r.topic==='视频'&&r.stance==='dislike'))
  assert.ok(listFriendLearning(home,dir)[0].interests.some(r=>r.topic==='猫咪'&&r.stance==='like'))
  for(const title of ['测试视频','测试专用'])assert.equal(friendRecommendationGuard(home,'123',dir,{videoTitle:title,now}).blocked,false)
  assert.equal(readFileSync(p,'utf8'),before,'旧记录应保留以供审计而非静默清理')
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('真正自述不喜欢视频仍被尊重；针对类别的拒绝不影响不相关主题',()=>{
 const home=makeHome();try{
  send(home,'dislike','我不喜欢视频')
  assert.equal(friendRecommendationGuard(home,'123',dir,{videoTitle:'测试专用',now}).blocked,true)
  send(home,'likes','以后多给我推荐美食视频','456')
  send(home,'reject','别给我推这些','456')
  assert.equal(friendRecommendationGuard(home,'456',dir,{videoTitle:'宇宙科普',now}).blocked,false)
 }finally{rmSync(home,{recursive:true,force:true})}
})
test('全局退订与具体拒绝分开保存；单条带视频上下文的退订不制造 avoid-video',()=>{
 const home=makeHome();try{
  const args={uid:'123',text:'以后别给我推荐视频了',source:'comment',eventId:'c1',friendDirectory:dir,bvid:'BV1ignA6REjB',videoTitle:'美食探店',now}
  assert.equal(observeFriendInterest(home,args).added,1)
  assert.equal(observeFriendInterest(home,args).added,0)
  const rows=JSON.parse(readFileSync(join(home,'friend-interest-observations.json'),'utf8')).records
  assert.deepEqual(rows.map(x=>x.kind),['recommendation-consent'])
 }finally{rmSync(home,{recursive:true,force:true})}
})
