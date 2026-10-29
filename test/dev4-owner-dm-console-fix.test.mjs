import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const html=source('lib/management-console.html'),js=source('lib/management-console.js'),host=source('index.js')
test('主人私信 Agent 从人生记忆待办移到私信与好友专属区域',()=>{
 const life=html.indexOf('id="panel-life"'),dm=html.indexOf('id="panel-dm"'),widget=html.indexOf('id="owner-dm-control-section"')
 assert.ok(life>0&&dm>life&&widget>dm)
 assert.equal(html.slice(life,dm).includes('id="owner-dm-agent-enabled"'),false)
 assert.ok(html.includes('id="owner-dm-agent-save"'))
 assert.ok(html.includes('id="owner-dm-agent-reload"'))
 assert.equal(html.includes('id="owner-dm-actions"'),false,'不需要暴露重复的总开关')
})
test('独立保存不再受待办参数影响，保存后回读验证',()=>{
 const todo=js.slice(js.indexOf("$('owner-todo-settings-save').addEventListener"),js.indexOf("$('owner-todo-add').addEventListener"))
 const owner=js.slice(js.indexOf("$('owner-dm-agent-save').addEventListener"),js.indexOf('  const loadDmSettings=async()=>'))
 assert.ok(!todo.includes('ownerDmAgentEnabled')&&!todo.includes('ownerDmActionsEnabled'))
 assert.ok(owner.includes("await request('/config',patch)"))
 assert.ok(owner.includes("await request('/config')"),'保存后重新读取配置')
 assert.ok(owner.includes('ownerDmActionsEnabled=ownerDmPermissionInputs.some'))
 assert.ok(owner.includes('Object.keys(patch).filter'))
 assert.ok(js.includes('loadOwnerDmAgentSettings(),loadDmStatus()'),'进入私信页自动读取')
})
test('内部双重权限闸门继续存在，不能通过 UI 简化绕开写权限',()=>{
 assert.match(host,/cfg\.ownerDmActionsEnabled!==true/)
 assert.match(host,/cfg\[flag\]!==true/)
 assert.match(source('lib/owner-dm-agent.mjs'),/config\.ownerDmActionsEnabled!==true\|\|config\[flag\]!==true/)
})
