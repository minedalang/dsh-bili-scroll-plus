import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, mkdtempSync, rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDailyDynamic, validateDailyDraft} from '../lib/daily-dynamic.mjs'
const project=new URL('../', import.meta.url)
const read=(n)=>readFileSync(new URL('../'+n,import.meta.url),'utf8')
const BV='BV1ab2345678'
const content='今天刷到的料理视频让我突然好奇，为什么每次看到热腾腾的米饭，都忍不住多看两眼。'
const valid={should_post:true,text:content,source_bvids:[BV],evidence_claims:[{type:'selected_video',bvid:BV}]}
test('原生设置只有日常面板，刷视频间隔和多时段保持可编辑，底部含作者与开源致谢',()=>{
  const source=read('client.js')
  assert.match(source,/const tab = 'daily'/)
  assert.match(source,/刷视频间隔（分钟）/)
  assert.match(source,/保存时间段/)
  assert.match(source,/记忆、反思、情绪与主 Session 工具独立运行/);assert.match(source,/定时自主刷视频（可选）/)
  assert.match(source,/href:'https:\/\/space\.bilibili\.com\/210228238'/)
  assert.match(source,/长条动物/)
  assert.match(source,/开源来源与致谢/)
  assert.match(source,/c1overzz\/dsh-bili-scroll/)
  assert.match(source,/adoresever\/bilibili-mcp/)
})
test('管理中心集中配置全部 AI 模型、辅助开关、B站互动与每日额度',()=>{
  const html=read('lib/management-console.html'),js=read('lib/management-console.js'), host=read('index.js')
  for(const x of ['panel-models','models-video','models-interaction','models-vision','models-memory','models-vision-mode','models-vision-enabled','panel-bili','bili-dm-mode','bili-dm-uid','bili-report-level','bili-transcribe','bili-comment-memes','bili-asr-model','meme-auto-enabled','quota-daily-dynamic','quota-like-daily']) assert.ok(html.includes('id="'+x+'"'),x)
  for(const x of ['visionMode','visionEnabled','dmMode','dmUid','reportLevel','asrModel','commentMemesEnabled','mainSessionMemoryModelId','dailyDynamicDailyLimit','autoVideoLikeDailyLimit']) assert.ok(js.includes(x)||host.includes(x),x)
  assert.match(host,/"?2\.4\.86"?/)
})
test('生活动态不接受未在真实选片记录中的 BV 或不安全链接',()=>{
  assert.deepEqual(validateDailyDraft({should_post:false},[{bvid:BV}]).skip,true)
  assert.equal(validateDailyDraft(valid,[{bvid:BV}]).text,content)
  assert.throws(()=>validateDailyDraft({...valid,source_bvids:['BV1234567890']},[{bvid:BV}]),/真实已选/)
  assert.throws(()=>validateDailyDraft({...valid,text:content+' https://site.example'},[{bvid:BV}]),/安全/)
})
test('生活动态先写草稿；默认不发布；主人确认后受每日限额和跨轮防重复保护',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dyn-test-'))
  try{
    let invocations=0,posts=0
    let cfg={masterEnabled:true,dailyDynamicEnabled:true,dailyDynamicDraftOnly:true,dailyDynamicDailyLimit:1}
    const engine=createDailyDynamic({dataDir:dir,getConfig:()=>cfg,getPublicVideos:()=>[{bvid:BV,title:'煮饭过程',day:'2026-10-27'}],invokeModel:async()=>{invocations++;return JSON.stringify(valid)},publish:async()=>{posts++;return {status:'api_accepted_unverified'}}})
    assert.equal(engine.status().draftOnly,true)
    const a=await engine.createDraft()
    assert.equal(a.ok,true)
    assert.equal(engine.status().drafts[0].status,'draft')
    assert.equal(posts,0)
    assert.equal((await engine.createDraft()).skipped,'duplicate')
    assert.equal((await engine.sendDraft(a.draft.id)).ok,false) // 草稿模式禁止自动发布
    assert.equal((await engine.sendDraft(a.draft.id,{manual:true})).ok,true)
    assert.equal(posts,1)
    assert.equal((await engine.sendDraft(a.draft.id)).ok,false)
    assert.equal((await engine.createDraft()).skipped,'duplicate')
    assert.equal(invocations,3)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
test('生活动态公开发布在未启用或总开关关闭时必须拒绝',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dyn-off-'))
  try{
    const config={masterEnabled:false,dailyDynamicEnabled:true,dailyDynamicDailyLimit:1}
    const engine=createDailyDynamic({dataDir:dir,getConfig:()=>config,getPublicVideos:()=>[{bvid:BV,title:'A'}],invokeModel:async()=>JSON.stringify(valid),publish:async()=>{throw Error('should not publish')}})
    const r=await engine.createDraft()
    assert.equal(r.ok,true)
    assert.equal((await engine.sendDraft(r.draft.id)).ok,false)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
test('生活动态可以读取基于真实观看形成的兴趣趋势，而非私人记忆',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dyn-interest-'))
  try{
    let prompt=''
    const engine=createDailyDynamic({dataDir:dir,getConfig:()=>({masterEnabled:true,dailyDynamicEnabled:true,dailyDynamicDailyLimit:1}),
      getPublicVideos:()=>[{bvid:BV,title:'制作白饭的视频',day:'2026-10-27'}],
      getInterests:()=>[{topic:'白饭与美食',label:'兴趣持续增强',stage:'growing'}],
      invokeModel:async p=>{prompt=p;return JSON.stringify({should_post:false})},
      publish:async()=>{throw Error('not allowed')}})
    assert.equal((await engine.createDraft()).skipped,'ai-silence')
    assert.match(prompt,/白饭与美食/)
    assert.match(prompt,/兴趣持续增强/)
    assert.doesNotMatch(prompt,/主人UID|聊天历史/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
