import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
const panel=(name)=>html.split(`<section id="panel-${name}" hidden>`)[1]?.split(/<section id="panel-[a-z]+" hidden>/)[0]||'';

test('dev.15 家 / 人生记忆 / 插件设置区分生活与技术管理，全部配置 ID 唯一',()=>{
  for(const name of ['home','life','settings','social','models','comments','dm'])assert.match(html,new RegExp(`data-tab="${name}"`));
  const home=panel('home'),settings=panel('settings'),life=panel('life');
  for(const id of ['main-session-id','main-session-save','home-overview-memory','home-overview-mood','home-overview-social'])assert.ok(home.includes(`id="${id}"`),id);
  for(const id of ['main-memory-enabled','main-memory-semantic','main-memory-half-life','main-reflection-daily','main-session-minutes','main-session-sync-save','owner-todo-settings-save']){
    assert.ok(settings.includes(`id="${id}"`),id);
    assert.ok(!home.includes(`id="${id}"`),`technical control ${id} was left in house`);
  }
  for(const id of ['main-session-history','main-memory-list','emotion-current','owner-todo-list','life-timeline-list'])assert.ok(life.includes(`id="${id}"`),id);
  const ids=[...html.matchAll(/\bid="([\w-]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,'do not duplicate original DOM settings or access controls');
  assert.match(html,/tab-cluster-label">生活与成长/);
  assert.match(html,/tab-cluster-label">角色与系统配置/);
  assert.match(html,/tab-cluster-label">知识与维护/);
});

test('高风险权限移动到社交页但默认禁用且保存控件独立',()=>{
  const social=panel('social'),life=panel('life'),settings=panel('settings');
  for(const id of ['emotion-recall-enabled','emotion-recall-main','emotion-recall-dm','emotion-recall-save','owner-dm-agent-enabled','owner-comment-publish']){
    assert.ok(social.includes(`id="${id}"`),id);
    assert.ok(!life.includes(`id="${id}"`),`outbound capability ${id} remains in life view`);
    assert.ok(!settings.includes(`id="${id}"`),`outbound capability ${id} was put with benign system settings`);
  }
  for(const id of ['emotion-recall-enabled','emotion-recall-main','emotion-recall-dm'])assert.match(social,new RegExp(`id="${id}" type="checkbox"|type="checkbox" id="${id}"`));
  assert.match(js,/const loadSocial=async\(\)=>\{await Promise\.all\(\[loadSocialFriends\(\),loadSocialIntents\(\),loadOwnerDmAgentSettings\(\),loadCommentSettings\(\),renderEmotion\(\)\]\)\}/);
  assert.match(js,/emotionRecallDmEnabled/);
  assert.match(js,/ownerCommentAgentEnabled/);
});

test('保存当前房间时不会越过页面边界覆盖同步频率；同步配置有独立保存',()=>{
  const homeSave=js.split("$('main-session-save').addEventListener('click'")[1].split("$('main-session-sync-save').addEventListener")[0];
  assert.match(homeSave,/mainSessionBridgeEnabled/);
  assert.doesNotMatch(homeSave,/mainSessionSyncMinutes|mainSessionDailyBatches|mainSessionBatchSize|mainSessionIncludeComments/);
  const syncSave=js.split("$('main-session-sync-save').addEventListener('click'")[1].split("$('main-session-test').addEventListener")[0];
  for(const field of ['mainSessionSyncMinutes','mainSessionDailyBatches','mainSessionBatchSize','mainSessionIncludeComments'])assert.ok(syncSave.includes(field),field);
  assert.doesNotMatch(syncSave,/mainSessionId|mainSessionBridgeEnabled|mainSessionAutoSync/);
  assert.match(js,/settings:loadPluginSettings/);
  assert.match(js,/home:loadHome/);
});

test('评论/私信提供记录、审批、规则分区；模型输入框只搬移不复制',()=>{
  const c=panel('comments'),dm=panel('dm');
  for(const id of ['comments-configuration','comments-records','comments-settings-save'])assert.ok(c.includes(`id="${id}"`),id);
  for(const id of ['dm-settings-section','dm-requests','dm-recent-conversations','dm-settings-save'])assert.ok(dm.includes(`id="${id}"`),id);
  assert.match(js,/for\(const id of \['main-memory-model-provider','main-memory-model-id','main-memory-model-effort'\]\)/);
  assert.match(html,/data-tab="diagnostics" aria-selected="false">运行诊断/);
});
