import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const section=(name)=>html.split(`<section id="panel-${name}" hidden>`)[1]?.split(/<section id="panel-[a-z]+" hidden>/)[0]||''

test('B站生活是导航分组，视频探索、好友、评论、私信和动态创作在同一组',()=>{
 const group=html.match(/<div class="tab-cluster"><span class="tab-cluster-label">📺 B站生活<\/span>(.*?)<\/div>/s)?.[1]||''
 for(const tab of ['bili','social','comments','dm','dynamic'])assert.match(group,new RegExp(`data-tab="${tab}"`))
 assert.match(group,/data-tab="bili"[^>]*>视频探索/)
 assert.match(section('bili'),/视频探索与自主行动/)
 assert.doesNotMatch(html,/data-tab="settings"/)
})

test('人生记忆、主 Session 同步、自主待办在自己版块就地折叠，配置键不复制',()=>{
 const life=section('life'),home=section('home')
 for(const id of ['life-memory-settings','main-memory-enabled','main-memory-save','settings-todo','owner-todo-settings-save'])assert.ok(life.includes(`id="${id}"`),id)
 for(const id of ['home-sync-settings','settings-sync','main-session-sync-save','main-session-id'])assert.ok(home.includes(`id="${id}"`),id)
 assert.ok(life.indexOf('一段经历，怎样变成鱼鱼的记忆？')<life.indexOf('id="life-memory-settings"'))
 assert.match(js,/if\(saved==='settings'\)/,'旧版设置页书签应可兼容跳转')
 for(const id of ['main-memory-enabled','main-session-sync-save','owner-todo-settings-save','bili-daily-draft']){
  assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id)
 }
})

test('动态参数属于动态创作页且单独保存，不被视频探索的保存覆盖',()=>{
 const video=section('bili'),dynamic=section('dynamic')
 for(const id of ['bili-daily-enabled','bili-daily-draft','bili-sync-comment','bili-dynamic-save']){
  assert.ok(dynamic.includes(`id="${id}"`),id)
  assert.ok(!video.includes(`id="${id}"`),`should not be in video: ${id}`)
 }
 assert.match(dynamic,/id="dynamic-publishing-settings" class="contextual-settings"/)
 assert.match(video,/id="bili-video-advanced" class="contextual-settings"/)
 const videoFields=js.split('const biliFields=[')[1].split('const biliDynamicFields=[')[0]
 const dynamicFields=js.split('const biliDynamicFields=[')[1].split('const loadBili=')[0]
 for(const name of ['commentSyncDynamic','dailyDynamicEnabled','dailyDynamicDraftOnly']){
  assert.ok(!videoFields.includes(name),`video settings should not save ${name}`)
  assert.ok(dynamicFields.includes(name))
 }
 assert.match(js,/\$\('bili-dynamic-save'\)\.addEventListener/)
 assert.match(js,/await loadDynamicConfig\(\)/)
})
