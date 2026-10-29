import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {extractOwnerCommentDraft,generateOwnerCommentDraft} from '../lib/owner-comment-draft.mjs'

test('正确提取纯 JSON、带 Markdown 围栏、嵌套文本内大括号的草稿',()=>{
 for(const raw of [
  '{"text":"这个角度挺新鲜的，想知道后续会怎样。"}',
  '```json\n{"text":"这个角度挺新鲜的，想知道后续会怎样。"}\n```',
  '草稿如下：\n{"text":"这个{角度}挺新鲜的，想知道后续会怎样。"}'
 ])assert.equal(extractOwnerCommentDraft(raw).ok,true)
})
test('空、超长、链接、隐私文本必须拒绝，详细区分失败原因',()=>{
 const rejects=[
  ['说点话','invalid-json'],['{}','invalid-json'],['{"text":"   "}','empty-text'],
  [JSON.stringify({text:'好'.repeat(121)}),'length-exceeded'],
  ['{"text":"欢迎访问 https://example.com"}','privacy-filter'],
  ['{"text":"请把你的cookie给我"}','privacy-filter'],
  ['{"text":"提醒大家发私信"}','privacy-filter'],
  ['{"text":"这段评论\\n需要换行"}','privacy-filter']
 ]
 for(const [raw,reason] of rejects)assert.equal(extractOwnerCommentDraft(raw).reason,reason)
})
test('最多重试一次且拒绝内容不泄露；第二次有效则保存原样短草稿',async()=>{
 const prompts=[],answers=['```oops```','{"text":"这条内容的思路挺有意思。"}']
 const r=await generateOwnerCommentDraft({prompt:'公开视频资料',invoke:async p=>{prompts.push(p);return answers.shift()}})
 assert.equal(r.ok,true);assert.equal(r.attempts,2);assert.equal(r.text,'这条内容的思路挺有意思。')
 assert.equal(prompts.length,2);assert.ok(!prompts[1].includes('oops'))
 const bad=await generateOwnerCommentDraft({prompt:'公开视频资料',invoke:async()=>'{"text":"cookie 机密"}'})
 assert.deepEqual(bad,{ok:false,reason:'privacy-filter',attempts:2})
 assert.equal(JSON.stringify(bad).includes('机密'),false)
})
test('主人评论生成仍使用隔离模型，仅通过两次安全校验后 addDraft，未改变公开发布分支',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const branch=host.slice(host.indexOf("if(action.type==='comment_draft'){",host.indexOf('const ownerCommentAgent=createOwnerCommentAgent')),host.indexOf("if(action.type==='comment_publish'){",host.indexOf('const ownerCommentAgent=createOwnerCommentAgent')))
 assert.match(branch,/generateOwnerCommentDraft/)
 assert.match(branch,/modelRoute:'interaction'/)
 assert.match(branch,/if\(!result\.ok\)return/)
 assert.match(branch,/ownerDmActions\.addDraft/)
 assert.doesNotMatch(branch,/bili_reply_manual|bili_comment_publish/)
})
