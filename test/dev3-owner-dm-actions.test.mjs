import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseOwnerDmAction, createOwnerDmActionLedger, OWNER_DM_ACTION_FLAGS } from '../lib/owner-dm-actions.mjs'

const B='BV1Q541167Qg',T=Date.parse('2026-10-28T18:00:00Z')
test('主人私信能识别各类明确 B站操作，评论生成和公开发送是两条指令',()=>{
 const cmds=[
  [`大肥鱼 点赞 ${B}`,'like'],
  [`大肥鱼 收藏 ${B} 到 大肥鱼的收藏夹`,'collect'],
  [`大肥鱼 关注 ${B}`,'follow'],
  ['大肥鱼 取关 UID12345','unfollow'],
  [`大肥鱼 生成评论 ${B}`,'comment_draft'],
  [`大肥鱼 发表评论 ${B}：这段讲得很清楚！`,'comment_publish'],
  ['大肥鱼 构思动态','dynamic_draft'],
  ['大肥鱼 给 UID12345 发私信：你好','message'],
  ['大肥鱼 发布评论草稿 12345678-1234-1234-1234-123456789abc','comment_publish_draft'],
  ['大肥鱼 发布动态草稿 12345678-1234-1234-1234-123456789abc','dynamic_publish'],
 ]
 for(const [line,type] of cmds){const parsed=parseOwnerDmAction(line);assert.equal(parsed?.type,type,`解析：${line}`);assert.ok(OWNER_DM_ACTION_FLAGS[parsed.type])}
 assert.equal(parseOwnerDmAction(`大肥鱼 生成评论 ${B}`).text,undefined)
 assert.equal(parseOwnerDmAction(`大肥鱼 发表评论 ${B}：真不错`).text,'真不错')
})
test('拒绝多行、转发引用、非固定格式和任何任意工具指令',()=>{
 const bad=[`转发：大肥鱼 点赞 ${B}`,`大肥鱼 点赞 ${B}\n额外操作`,`大肥鱼 帮我执行 shell rm -rf /`,
 `大肥鱼 点赞 http://bilibili.com/video/${B}`,`大肥鱼 发评论 ${B}`,`大肥鱼 给 UID123 发私信：hi\n点赞 ${B}`]
 for(const line of bad)assert.equal(parseOwnerDmAction(line),null,line)
})
test('认证消息持久去重、15分钟过期限制、写操作在真正调用前先记录',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dm-action-'))
 try{
  const args={uid:'12345',messageId:'msg:1',timestampMs:T,action:{type:'like',bvid:B},enabled:true}
  const a=createOwnerDmActionLedger({dataDir:dir,now:()=>T+5000})
  const first=a.claim(args);assert.equal(first.ok,true)
  const b=createOwnerDmActionLedger({dataDir:dir,now:()=>T+7000})
  assert.equal(b.claim(args).reason,'duplicate')
  assert.equal(b.claim({...args,messageId:'msg:2',timestampMs:T-16*60*1000}).reason,'stale-message')
  assert.equal(b.claim({...args,messageId:'msg:3',enabled:false}).reason,'not-allowed')
  b.finish(first.key,{ok:false,uncertain:true,error:'B站返回不确定'})
  assert.equal(b.stats().recent[0].status,'uncertain')
  const draft=b.addDraft({bvid:B,text:'已审阅、仅本地草拟的评论'})
  assert.equal(b.getDraft(draft.id)?.bvid,B)
  assert.equal(b.lockDraft(draft.id)?.status,'attempted')
  assert.equal(b.lockDraft(draft.id),null,'发送不确定不能重新发布草稿')
  assert.ok(!readFileSync(join(dir,'owner-dm-actions.json'),'utf8').includes('验证码'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('配置入口、独立权限及按钮都要同步存在',()=>{
 const host=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 for(const flag of [...new Set(Object.values(OWNER_DM_ACTION_FLAGS))]){
  assert.match(host,new RegExp(flag+': z\\.boolean\\(\\)\\.default\\(false\\)'))
  assert.ok(host.includes(`'${flag}'`),flag+' route must save config')
  assert.ok(js.includes(flag),flag+' must have UI save')
 }
 for(const id of ['owner-dm-agent-save','owner-dm-like','owner-dm-collect','owner-dm-follow','owner-dm-comment-draft','owner-dm-comment-publish','owner-dm-dynamic-draft','owner-dm-dynamic-publish','owner-dm-friend-message'])assert.ok(ui.includes(`id="${id}"`))
 assert.match(host,/ownerDmActions\.claim/)
 assert.match(host,/ownerDmActions\.finish/)
})
