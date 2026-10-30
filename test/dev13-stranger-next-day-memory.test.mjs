import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'

const DAY=86400000
const BV='BV1234567890'
const T0=Date.parse('2026-10-29T12:00:00Z')
const config=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.35})
const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-stranger-nextday-'))
const comment=(uid,rpid,text,at)=>({kind:'social',key:`social:${uid}:${BV}:${rpid}`,actorUid:uid,bvid:BV,text,at})
function system(dir,clock){
 const gate=createLifeMemoryGateway({dataDir:dir,getConfig:config,now:()=>clock.value})
 const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:config,getEpisodes:(query,opts)=>gate.recall({query,...opts})})
 return {gate,retriever}
}

test('陌生人第二天回来：仅凭平台 UID 找到仍清晰的昨天互动；不靠相同关键词',()=>{
 const dir=temp(),clock={value:T0}
 try{
  const {gate,retriever}=system(dir,clock)
  gate.recordEvents([comment('101','1001','我叫小鱼干，明天会记得我吗？',T0)])
  clock.value+=DAY
  gate.recordEvents([comment('101','1002','鱼鱼，我又来了！',clock.value)])
  const query='鱼鱼，我又来了！',excludeEventKey=`social:101:${BV}:1002`
  const context=retriever.socialContext(query,{role:'stranger',actorUid:'101',excludeEventKey})
  assert.match(context,/小鱼干/)
  assert.match(context,/当前仍记得的同一位观众的公开互动/)
  assert.doesNotMatch(context,/我又来了/,'当前消息不能伪装成回忆')
  assert.equal(gate.recall({query,domain:'bili-life',role:'stranger',actorUid:'101',excludeEventKey}).length,1)
  assert.equal(retriever.socialContext(query,{role:'stranger',actorUid:'202',excludeEventKey}),'')
  assert.equal(retriever.socialContext(query,{role:'stranger',actorUid:'小鱼干'}),'')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('第一次见面的陌生人：当前这条消息不能被当成过去经历',()=>{
 const dir=temp(),clock={value:T0}
 try{
  const {gate,retriever}=system(dir,clock)
  gate.recordEvents([comment('101','1001','你好鱼鱼，第一次见面',T0)])
  assert.equal(retriever.socialContext('你好',{role:'stranger',actorUid:'101',excludeEventKey:`social:101:${BV}:1001`}), '')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('不同 UID 隔离、身份无效拒绝、主 Session 私有信息不流入公开记忆',()=>{
 const dir=temp(),clock={value:T0}
 try{
  const {gate}=system(dir,clock)
  gate.recordEvents([comment('101','1001','我们的猫咪秘密暗号是小灯笼',T0),comment('202','1002','我们聊的是红烧鱼',T0)])
  for(const role of ['stranger','friend','owner']){
   const first=gate.recall({query:'',domain:'bili-life',role,actorUid:'101'})
   assert.equal(first.length,1)
   assert.match(first[0].summary,/小灯笼/)
   assert.doesNotMatch(first[0].summary,/红烧鱼/)
  }
  assert.deepEqual(gate.recall({query:'',domain:'bili-life',role:'stranger',actorUid:''}),[])
  assert.deepEqual(gate.recall({query:'',domain:'bili-life',role:'stranger',actorUid:'101 OR 1=1'}),[])
  assert.deepEqual(gate.recall({query:'',domain:'bili-life',role:'unverified',actorUid:'101'}),[])
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('只有真实发送回执才能追加我说过的话；重复通知不重复归档',()=>{
 const dir=temp(),clock={value:T0}
 try{
  const {gate}=system(dir,clock)
  gate.recordEvents([comment('101','1001','明天你还记得我吗',T0)])
  assert.equal(gate.recordSocialReply({actorUid:'202',bvid:BV,incomingRpid:'1001',text:'冒充回复'}).ok,false)
  const initial=gate.recall({query:'',domain:'bili-life',role:'stranger',actorUid:'101'})
  assert.doesNotMatch(initial[0].summary,/我当时回复/)
  assert.equal(gate.recordSocialReply({actorUid:'101',bvid:BV,incomingRpid:'1001',text:'鱼鱼会努力记住你的'}).ok,true)
  const updated=gate.recall({query:'',domain:'bili-life',role:'stranger',actorUid:'101'})
  assert.match(updated[0].summary,/我当时回复“鱼鱼会努力记住你的”/)
  assert.equal(gate.recordSocialReply({actorUid:'101',bvid:BV,incomingRpid:'1001',text:'重复'}).duplicate,true)
  const archives=readFileSync(join(dir,'life-memory','archive','2026-10.jsonl'),'utf8').trim().split('\n')
  assert.equal(archives.length,2,'原始来信与实际发送回复各一条永久事实记录')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('自然遗忘后不能靠同 UID、相似文字或新回复从永久档案找回',()=>{
 const dir=temp(),clock={value:T0}
 try{
  const {gate,retriever}=system(dir,clock)
  gate.recordEvents([comment('101','1001','我是小鱼干，记得我的专属暗号吧',T0)])
  clock.value+=48*DAY
  assert.equal(gate.recall({query:'鱼鱼我又来了',domain:'bili-life',role:'stranger',actorUid:'101'}).length,0)
  assert.equal(gate.recordSocialReply({actorUid:'101',bvid:BV,incomingRpid:'1001',text:'我记得秘密暗号'}).ok,false)
  assert.equal(retriever.socialContext('专属暗号',{role:'stranger',actorUid:'101'}),'')
  const after=JSON.parse(readFileSync(gate.file,'utf8')).episodes[0]
  assert.equal(after.actorUid,undefined)
  assert.doesNotMatch(JSON.stringify(after),/小鱼干|专属暗号/)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('真实社交记忆注入普通评论生成器：不额外调用记忆模型，也不放开陌生人权限',()=>{
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const interact=readFileSync(new URL('../lib/comment-interact.mjs',import.meta.url),'utf8')
 assert.match(index,/prepareMemoryContexts: async\(batch\)=>batch\.map\(item=>/)
 assert.match(index,/if\(!\['comment','dm'\]\.includes\(item\.kind\)\|\|!\/\^\[1-9\]/)
 assert.match(index,/item\.incomingRpid&&item\.bvid/)
 assert.match(index,/recordSocialReply\(\{actorUid:req\.uid,bvid:req\.bvid,incomingRpid:req\.rpid,text:req\.text\}\)/)
 assert.match(interact,/rpid:x\.rpid,memeSourceText/)
 assert.match(interact,/root:x\.root,uid:x\.uid,text:reply/)
})
