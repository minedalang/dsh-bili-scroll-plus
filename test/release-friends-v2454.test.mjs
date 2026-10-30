import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {normalizeFriendDirectory,directoryToLegacy} from '../lib/friend-directory.mjs'
import {parseMentionTargets} from '../lib/mentions.mjs'
import {buildMentionProfilePrompt} from '../lib/character-social.mjs'

test('三套 UID 权限由同一名册生成，昵称仅备注，主人可多人',()=>{
 const rows=[{uid:'210228238',name:'长条动物',dm:true,mention:true,atInvite:false},{uid:'87654321',name:'',dm:true,mention:false,atInvite:true}]
 const norm=JSON.parse(normalizeFriendDirectory(rows));assert.equal(norm.length,2)
 const lists=directoryToLegacy(rows)
 assert.equal(lists.mentionTargets,'210228238|长条动物')
 assert.equal(lists.dmWhitelist,'210228238|长条动物\n87654321')
 assert.equal(lists.commentAtWhitelist,'87654321')
 assert.deepEqual(parseMentionTargets(lists.mentionTargets),[{name:'长条动物',uid:'210228238'}]);assert.deepEqual(parseMentionTargets('','旧昵称'),[])
 const prof=JSON.stringify({'210228238':{role:'owner',personalityInterests:'爱看技术视频',peerRelationships:[{uid:'87654321',relationship:'认识'}]},'87654321':{role:'owner',personalityInterests:'喜欢旅行'}})
 const prompt=buildMentionProfilePrompt({targetsText:'210228238|长条动物',friendDirectory:JSON.stringify(rows),profiles:prof})
 assert.match(prompt,/主人/);assert.match(prompt,/喜欢|爱看技术视频/)
 assert.doesNotMatch(prompt,/管理权限已赋予/)
})
test('发布默认人设不覆盖定制，公开评论不涉政',()=>{
 const persona=readFileSync(new URL('../lib/persona-default.mjs',import.meta.url),'utf8')
 assert.match(persona,/禁止讨论涉政话题/);assert.match(persona,/发送涉政评论/)
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.ok(html.indexOf('data-tab="persona"')<html.indexOf('data-tab="diagnostics"'))
 for(const id of ['friend-add','friend-save-all','friend-directory-editor','friend-new-uid'])assert.ok(html.includes('id="'+id+'"'))
 for(const id of ['peerRelationships','personalityInterests','friendDirectory','atInvite'])assert.ok(js.includes(id))
 assert.match(js,/switchTab\('home'\)/)
})
