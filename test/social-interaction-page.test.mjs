import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const between=(a,b)=>html.split(a)[1]?.split(b)[0]||''

test('社交互动作为独立标签，所有主要社交控件只出现一次且被归于此页',()=>{
 assert.match(html,/data-tab="social"/)
 const social=between('<section id="panel-social" hidden>','<section id="panel-reports"')
 const life=between('<section id="panel-life"','<section id="panel-diagnostics"')
 const persona=between('<section id="panel-persona"','<section id="panel-social"')
 const dm=between('<section id="panel-dm"','</main>')
 const comments=between('<section id="panel-comments"','<section id="panel-')
 for(const id of ['unified-friends','social-dev5-records','friend-learning-list','social-outreach-section','owner-dm-control-section','owner-comment-agent-enabled','owner-comment-settings-save']){
  assert.ok(social.includes('id="'+id+'"'),id)
  assert.equal(html.split('id="'+id+'"').length-1,1,'only one control: '+id)
 }
 for(const other of [life,persona,dm,comments]){
  assert.ok(!other.includes('id="owner-dm-agent-enabled"'))
  assert.ok(!other.includes('id="social-stranger-inspiration"'))
  assert.ok(!other.includes('id="owner-comment-agent-enabled"'))
 }
})
test('社交页自动加载原有设置，主人公开评论与普通评论保存互不覆盖',()=>{
 assert.match(js,/'social'[,\]]/)
 assert.match(js,/social:loadSocial/)
 assert.match(js,/loadSocialFriends\(\),loadSocialIntents\(\),loadOwnerDmAgentSettings\(\),loadCommentSettings\(\)/)
 const commentSave=js.split("$('comments-settings-save').addEventListener")[1].split("$('owner-comment-settings-reload')")[0]
 assert.doesNotMatch(commentSave,/ownerCommentAgentEnabled|ownerCommentDraftEnabled/)
 const ownerSave=js.split("$('owner-comment-settings-save').addEventListener")[1].split("$('comments-load')")[0]
 assert.match(ownerSave,/ownerCommentAgentEnabled/)
 assert.match(ownerSave,/Object.keys\(patch\)/)
})
