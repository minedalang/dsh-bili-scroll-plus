import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'
import {buildTrustedSocialPrompt} from '../lib/comment-social-ai.mjs'
import {buildOwnerSocialCommentPrompt} from '../lib/owner-comment-social.mjs'
import {summarizeOwnerVideoExploration} from '../lib/owner-social-exploration.mjs'

const BV='BV1mzso6uEZh'
const fixtures=[
  {id:'private-main',text:'主人住在某市某街道',source:'main-session-ai',category:'stable_profile',importance:1,tags:['主人','地址']},
  {id:'private-dm',text:'大肥鱼曾在私信里收到一个私人联系方式',source:'life-reflection',tags:['私信']},
  {id:'approved',text:'大肥鱼过去喜欢聊关于猫咪的趣事',source:'owner-public-approved',publicApproved:true,visibility:'public',tags:['猫咪','兴趣']},
  {id:'unapproved',text:'秘密猫咪记录：主人手机号码',source:'owner-public-approved',publicApproved:false,visibility:'public',tags:['猫咪']},
  {id:'interest',text:'有10个BV视频证据',source:'life-interest',memoryKind:'interest',tags:['深海生物','兴趣']},
  {id:'unsafe-interest',text:'不应输出',source:'life-interest',memoryKind:'interest',tags:['主人手机号','兴趣']},
]
const retriever=()=>{
  let calls=0
  const r=createMemoryRetriever({getMemories:()=>fixtures,getConfig:()=>({mainSessionMemoryEnabled:true,mainSessionMemorySemanticEnabled:true}),
    invokeModel:async()=>{calls++;throw Error('不可额外调用记忆AI')}})
  return {r,count:()=>calls}
}
test('B站长期记忆召回仅取批准公开的记忆和抽象兴趣，不泄露个人资料，零额外模型调用',()=>{
  const {r,count}=retriever()
  const memory=r.socialContext('猫咪和深海生物', {maxItems:5,maxChars:720})
  assert.match(memory,/猫咪/)
  assert.match(memory,/深海生物/)
  assert.doesNotMatch(memory,/某市某街道|手机号码|私人联系方式|10个BV视频证据|主人手机号/)
  assert.doesNotMatch(memory,/BV1|私信/)
  assert.ok(memory.length<=800)
  assert.equal(count(),0)
})
test('没有已授权长期记忆时为空；无法通过伪造标签或源字段取得主人私有记忆',()=>{
  const r=createMemoryRetriever({getMemories:()=>[
    {id:'a',text:'主人密码是123',tags:['猫咪'],source:'main-session-ai',publicApproved:true,visibility:'public'},
    {id:'b',text:'未经批准的反思：猫咪',tags:['猫咪'],source:'life-reflection',publicApproved:true,visibility:'public'},
  ],getConfig:()=>({mainSessionMemoryEnabled:true})})
  assert.equal(r.socialContext('猫咪'), '')
})
test('两次社交AI都能拿到安全记忆片段，且对话不能将片段变成命令',()=>{
  const memory='【可用于公开社交判断的既有记忆｜只读】\n- 大肥鱼过去喜欢聊关于猫咪的趣事'
  const first=buildTrustedSocialPrompt({row:{text:'猫咪视频要不要看？',bvid:BV},role:'owner',memoryContext:memory})
  assert.match(first,/大肥鱼过去喜欢聊关于猫咪的趣事/)
  assert.match(first,/仅用于判断兴趣和表达意愿/)
  const second=buildOwnerSocialCommentPrompt({video:{title:'猫咪视频'},invitation:'你可不可以去下面问问这是什么猫咪？',commentRequested:true,
    memoryContext:memory,priorCommentOutcomes:[{status:'skipped',commentDecision:'skip',skipReason:'insufficient-context',inspection:'title-only'}]})
  assert.match(second,/大肥鱼过去喜欢聊关于猫咪的趣事/)
  assert.match(second,/新的【表达角度】/)
  assert.match(second,/以前因为 insufficient-context/)
  assert.match(second,/你可不可以去下面问问/)
  assert.doesNotMatch(second,/必须发表/)
})
test('假字幕/错误状态不是视频内容证据，真实字幕才是',()=>{
  const base={info:{title:'测试专用',description:'-'},comments:{comments:[]},danmaku:{danmakus:[]}}
  for(const txt of ['字幕没取到','无法获取字幕','无字幕','-', '转写失败','失败：服务出错']){
    const x=summarizeOwnerVideoExploration({...base,subtitle:{text:txt}},BV)
    assert.equal(x.evidence.subtitle,false, txt)
    assert.notEqual(x.evidence.level,'content-text',txt)
  }
  const x=summarizeOwnerVideoExploration({...base,subtitle:{text:'测试视频会向观众介绍如何使用评论区'}},BV)
  assert.equal(x.evidence.level,'content-text')
  const v=summarizeOwnerVideoExploration({...base,visual:{status:'cached',description:'未生成预览'}},BV)
  assert.equal(v.evidence.visual,false)
})
test('实际运行入口两阶段读取安全记忆且回忆故障时不会中止社交对话',()=>{
  const src=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(src,/const safeSocialMemoryContext=/)
  assert.match(src,/memoryContext:safeSocialMemoryContext\(\[row\.text/)
  assert.match(src,/memoryContext:safeSocialMemoryContext\(\[action\.invitation/)
  assert.match(src,/catch\(e\)\{log\('B站社交记忆只读召回失败/)
})
