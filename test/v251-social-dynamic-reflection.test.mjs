import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createDailyDynamic,validateDailyDraft,pickDiverseSources,dynamicManualReviewReason} from '../lib/daily-dynamic.mjs'

const BV='BV1234567890',t0=Date.parse('2026-10-30T12:00:00Z')
const makeHome=()=>mkdtempSync(join(tmpdir(),'dafeiyu-public-dynamic-'))
const socialText='今天和大家聊了一会儿，我发现能一起慢慢讨论一个问题，似乎比急着给出标准答案更有意思。'
const validSocial=id=>({should_post:true,text:socialText,source_bvids:[],source_memory_ids:[id],evidence_claims:[{type:'public_conversation',id}]})
const cfg=()=>({masterEnabled:true,dailyDynamicEnabled:true,dailyDynamicDraftOnly:false,dailyDynamicDailyLimit:2,mainSessionMemoryHalfLifeDays:15})

test('只有确认发出的公开回复/评论才提供给动态；未回复来信、UID、原话、私聊不可见',()=>{
 const dir=makeHome();let now=t0
 try{
  const g=createLifeMemoryGateway({dataDir:dir,getConfig:cfg,now:()=>now})
  g.recordEvents([
   {kind:'social',bvid:BV,actorUid:'101',key:`social:101:${BV}:900`,text:'我的手机号码是 13900123456，别告诉别人',at:t0},
   {kind:'social',bvid:BV,actorUid:'202',key:`social:202:${BV}:901`,text:'你还记得我们谈过的问题吗',at:t0},
   {kind:'comment',bvid:BV,key:'comment:public:one',text:'我觉得慢慢讨论比急着给标准答案更有意思，这个话题我还想继续想想。',at:t0},
   {kind:'comment',bvid:BV,key:'comment:public:private',text:'我的微信号和地址在这，大家可以联系我。',at:t0}
  ])
  assert.equal(g.recordSocialReply({actorUid:'202',bvid:BV,incomingRpid:'901',text:'我想下次遇到这个话题，还能认真听听大家怎么想。',at:t0}).ok,true)
  const out=g.publicSocialEvidence()
  assert.equal(out.length,2)
  assert.ok(out.some(x=>x.ownText.includes('认真听听')))
  assert.ok(out.some(x=>x.ownText.includes('慢慢讨论')))
  assert.doesNotMatch(JSON.stringify(out),/13900123456|手机号码|微信号|你还记得|actorUid/)
  assert.deepEqual(g.publicSocialEvidence(1).length,1)
  now+=240*86400000
  assert.deepEqual(g.publicSocialEvidence(),[])
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('没有任何视频，也可根据已确认公开交流形成生活感受，模拟情绪只影响风格',async()=>{
 const dir=makeHome();let prompt='',sent=0
 try{
  const memory=[{id:'e-1234567890abcdefab',day:'2026-10-30',ownText:'我想多听听大家的想法，不必急着得出唯一的答案。'}]
  const engine=createDailyDynamic({dataDir:dir,getConfig:cfg,getPublicVideos:()=>[],getPublicSocial:()=>memory,getEmotion:()=>({enabled:true,label:'好奇',intensity:50}),invokeModel:async p=>{prompt=p;return JSON.stringify(validSocial(memory[0].id))},publish:async()=>{sent++;return{status:'api_accepted_unverified'}}})
  const r=await engine.createDraft();assert.equal(r.ok,true)
  assert.equal(r.draft.requiresManualReview,false)
  assert.deepEqual(r.draft.source_bvids,[])
  assert.deepEqual(r.draft.source_memory_ids,[memory[0].id])
  assert.match(prompt,/确认发出的公开评论/)
  assert.match(prompt,/好奇/)
  assert.doesNotMatch(prompt,/"actorUid"|"uid"|13900123456/)
  assert.equal(r.draft.sourcePool.consideredSocial,1)
  assert.equal((await engine.sendDraft(r.draft.id)).ok,true)
  assert.equal(sent,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('模型未引用有效事实证据、擅自编造创作经历或凭空引用记忆时拒绝',()=>{
 const id='e-1234567890abcdefab',conv=[{id,fishText:'一起慢慢讨论'}]
 assert.equal(validateDailyDraft(validSocial(id),[],conv).requiresManualReview,false)
 assert.throws(()=>validateDailyDraft(validSocial('e-aaaaaaaaaaaaaaaaaa'),[],conv),/公开交流记忆/)
 assert.throws(()=>validateDailyDraft({...validSocial(id),source_memory_ids:[id],evidence_claims:[]},[],conv),/事实类型与证据/)
 assert.throws(()=>validateDailyDraft({...validSocial(id),text:'最近把自己做过的视频从选题到剪辑又全部复习了一遍，忍不住想和大家聊一聊。'},[],conv),/未被来源证实/)
 assert.throws(()=>validateDailyDraft({...validSocial(id),text:'今天有人把主人的手机号告诉我了，真的非常惊讶，想和大家说说这个事情。'},[],conv),/安全/)
})

test('异步模型生成期间，交流记忆消失则拒绝草稿，不准读取永久档案恢复',async()=>{
 const dir=makeHome();let alive=true
 const id='e-1234567890abcdefab'
 try{
  const engine=createDailyDynamic({dataDir:dir,getConfig:cfg,getPublicVideos:()=>[],getPublicSocial:()=>alive?[{id,ownText:'我觉得能互相倾听真的很重要。'}]:[],invokeModel:async()=>{alive=false;return JSON.stringify(validSocial(id))},publish:async()=>{throw Error('must not publish')}})
  await assert.rejects(engine.createDraft(),/公开交流记忆/)
  assert.deepEqual(engine.list(),[])
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('视频来源仍可生成旧格式草稿；没有素材时不强行生成',async()=>{
 const dir=makeHome()
 try{
  const engine=createDailyDynamic({dataDir:dir,getConfig:cfg,getPublicVideos:()=>[{bvid:BV,title:'节目'}],invokeModel:async()=>JSON.stringify({should_post:true,text:'今天看到有人分享自己的创作过程，才发现一个小小的点子，也可以让人琢磨很久。',source_bvids:[BV],evidence_claims:[{type:'selected_video',bvid:BV}]}),publish:async()=>({status:'api_accepted_unverified'})})
  const result=await engine.createDraft();assert.equal(result.ok,true);assert.equal(result.draft.requiresManualReview,false)
  const empty=createDailyDynamic({dataDir:makeHome(),getConfig:cfg,getPublicVideos:()=>[],invokeModel:async()=>{throw Error('model should not run')},publish:async()=>{throw Error('should not publish')}})
  assert.equal((await empty.createDraft()).skipped,'no-public-events')
 }finally{rmSync(dir,{recursive:true,force:true})}
})


test('多日期素材池优先探索未使用的记忆，并可以整合数条真实交流',async()=>{
 const dir=makeHome();let prompt=''
 const ids=Array.from({length:24},(_,i)=>'e-'+String(i+1).padStart(18,'0'))
 const social=ids.map((id,i)=>({id,day:`2026-10-${String(30-Math.floor(i/3)).padStart(2,'0')}`,ownText:`我和大家聊到第${i+1}个想法，慢慢形成自己的态度。`}))
 const vids=Array.from({length:40},(_,i)=>({bvid:'BV'+String(i).padStart(10,'0'),day:`2026-10-${String(30-Math.floor(i/3)).padStart(2,'0')}`,title:`主题${i}`,experience:'一段已记录的选片经历'}))
 const cfg2=()=>({...cfg(),dailyDynamicDraftOnly:true})
 try{
  const eng=createDailyDynamic({dataDir:dir,getConfig:cfg2,getPublicVideos:()=>vids,getPublicSocial:()=>social,invokeModel:async p=>{prompt=p;return JSON.stringify({...validSocial(ids[0]),source_memory_ids:[ids[0],ids[3]],evidence_claims:[{type:'public_conversation',id:ids[0]},{type:'public_conversation',id:ids[3]}]})},publish:async()=>{throw Error('draft-only mode must not publish')}})
  const result=await eng.createDraft();assert.equal(result.ok,true)
  assert.equal(result.draft.sourcePool.videoCount,40)
  assert.equal(result.draft.sourcePool.socialCount,24)
  assert.equal(result.draft.sourcePool.consideredVideos,20)
  assert.equal(result.draft.sourcePool.consideredSocial,16)
  assert.match(prompt,/不同日期/)
  assert.match(prompt,/2–3 个真实来源/)
  const selected=JSON.parse(prompt.match(/鱼鱼本人确认发出的公开评论\/回复（不含观众来信与私信）：([^\n]+)/)?.[1]||'[]')
  assert.ok(new Set(selected.map(x=>x.day)).size>1)
  assert.equal((await eng.sendDraft(result.draft.id)).skipped,'draft-only')
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('已明确授权自动发布时，匿名公共交流草稿无需主人逐条审核；高风险引述仍拦截',async()=>{
 const dir=makeHome(),id='e-1234567890abcdefab';let calls=0
 const social=[{id,day:'2026-10-30',ownText:'我觉得一起认真聊想法很有意思'}]
 try{
  const eng=createDailyDynamic({dataDir:dir,getConfig:cfg,getPublicVideos:()=>[],getPublicSocial:()=>social,
   invokeModel:async()=>JSON.stringify(validSocial(id)),publish:async()=>{calls++;return {status:'api_accepted_unverified'}}})
  const first=await eng.createDraft()
  assert.equal(first.draft.requiresManualReview,false)
  assert.equal((await eng.sendDraft(first.draft.id)).ok,true)
  assert.equal(calls,1)
  assert.equal(dynamicManualReviewReason('我想多听听大家的想法，不必急着得出唯一的答案。'),'')
  assert.match(dynamicManualReviewReason('那位观众说自己生病了，我想安慰她'),/需要人工确认/)
  assert.match(dynamicManualReviewReason('有位观众说“今天很难过”，我想分享一下。'),/需要确认/)
  const risky={...validSocial(id),text:'有位观众说“今天太累了”，我突然觉得认真倾听真的比急着下结论更加重要。'}
  const checked=validateDailyDraft(risky,[],social)
  assert.equal(checked.requiresManualReview,true)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('草稿生成后公开交流已不在可衰减记忆里时，自动与手动发布均阻止',async()=>{
 const dir=makeHome(),id='e-1234567890abcdefab';let exists=true,sent=0
 try{
  const eng=createDailyDynamic({dataDir:dir,getConfig:cfg,getPublicVideos:()=>[],getPublicSocial:()=>exists?[{id,ownText:'认真倾听很重要'}]:[],invokeModel:async()=>JSON.stringify(validSocial(id)),publish:async()=>{sent++;return {status:'api_accepted_unverified'}}})
  const r=await eng.createDraft();assert.equal(r.ok,true)
  exists=false
  assert.equal((await eng.sendDraft(r.draft.id)).skipped,'evidence-expired')
  assert.equal((await eng.sendDraft(r.draft.id,{manual:true})).skipped,'evidence-expired')
  assert.equal(sent,0)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('多路候选在旧素材已发过动态时，优先挑选新来源且兼顾多个日期',()=>{
 const rows=Array.from({length:16},(_,i)=>({id:`x${i}`,day:`day${Math.floor(i/3)}`}))
 const chosen=pickDiverseSources(rows,9,x=>x.id,['x0','x1','x2','x3'])
 assert.equal(chosen.length,9)
 assert.ok(chosen.some(x=>x.id==='x5'))
 assert.ok(new Set(chosen.map(x=>x.day)).size>=3)
 assert.ok(chosen.filter(x=>['x0','x1','x2','x3'].includes(x.id)).length<2)
})
