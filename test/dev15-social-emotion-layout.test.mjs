import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')

test('迁移后的情绪回忆流程继续使用原始卡片、统计和时间线样式',()=>{
  for(const key of ['recall-flow','recall-step','recall-overview','recall-summary','recall-event','recall-diagnostics']){
    assert.match(html,new RegExp(`#panel-social \\.${key}\\b`),key)
  }
  assert.doesNotMatch(html,/#panel-life \.recall-flow\b/)
  const social=html.split('id="social-emotion-authorization"')[1].split('id="social-outreach-section"')[0]||''
  assert.match(social,/id="emotion-recall-flow"/)
  assert.ok(social.indexOf('id="emotion-recall-flow"')<social.indexOf('<details class="life-subdetails emotion-options"'), '状态和回忆可视化应在高级设置折叠栏之外')
  assert.match(html,/@media\(max-width:550px\)\{#panel-social \.recall-flow\{/)
  assert.match(html,/#panel-life \.emotion-trend/,'生活页的心情曲线应保持独立')
  assert.match(js,/\['💗','情绪变化'/)
  assert.match(js,/const grouped=\[\]/)
})

test('唯一授权主人必须由 UID 决定、置顶并突出显示；好友详情默认折叠',()=>{
  assert.match(js,/const displayRows=\[\.\.\.friendsDirectory\]\.sort/)
  assert.match(js,/selectedOwnerUid===row\.uid/)
  assert.match(js,/selectedOwnerUid===savedOwnerUid\?'👑 唯一授权主人':'👑 主人身份待保存'/)
  assert.match(js,/const editor=node\('details','','friend-editor'\)/)
  assert.match(html,/#panel-social \.friend-directory-card\.is-owner/)
  assert.match(html,/#panel-social \.friend-editor/)
  assert.match(js,/dmOwnerUid:selectedOwnerUid\?Number\(selectedOwnerUid\):0/)
  assert.equal((html.match(/class="context-jump" aria-label="社交互动分区"/g)||[]).length,1)
  assert.equal((html.match(/class="social-jump" aria-label="社交功能导航"/g)||[]).length,0)
})
