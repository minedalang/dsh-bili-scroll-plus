import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {normalizeAtNotifications,normalizeReplyNotifications,stripAccountMentions} from '../lib/comment-inbox.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createEmotionalState} from '../lib/emotional-state.mjs'
import {createDualContextAgency} from '../lib/dual-context-agency.mjs'

const BV='BV1234567890',self='900'
const home=()=>mkdtempSync(join(tmpdir(),'dsh-252-'))
const notice=(raw,detail=[{mid:self,uname:'大肥鱼怒了但不说话'}])=>({data:{items:[{id:'10000',user:{mid:'101',nickname:'好友'},item:{business_id:1,subject_id:'12345',source_id:'2000',root_id:'2000',source_content:raw,uri:'https://www.bilibili.com/video/'+BV,at_details:detail}}]}})

test('Bug 01: 完整昵称不被误解为鱼鱼的情绪；@only 不触发回复',()=>{
  assert.equal(stripAccountMentions('@大肥鱼怒了但不说话', [{mid:self,uname:'大肥鱼怒了但不说话'}],self),'')
  assert.equal(normalizeAtNotifications(notice('@大肥鱼怒了但不说话'),self).length,0)
  assert.equal(normalizeAtNotifications(notice('@大肥鱼怒了但不说话 你看看这个视频！'),self)[0].text,'你看看这个视频！')
  assert.equal(stripAccountMentions('@大肥鱼怒了但不说话', [{mid:self,uname:'大肥鱼'}],self),'')
  assert.equal(stripAccountMentions('@大肥鱼怒了但不说话，怎么啦',[],self),'，怎么啦')
  assert.equal(stripAccountMentions('别担心，鱼鱼今天没生气',[],self),'别担心，鱼鱼今天没生气')
  const reply=normalizeReplyNotifications(notice('@大肥鱼怒了但不说话 你好'),self)
  assert.equal(reply[0].text,'你好')
})

test('Bug 02: archive 与 episodic 副本分别统计，提供最早记忆与预计衰减时间',()=>{
  const dir=home();let clock=Date.parse('2026-10-30T10:00:00Z')
  try{
    const g=createLifeMemoryGateway({dataDir:dir,now:()=>clock,getConfig:()=>({mainSessionMemoryHalfLifeDays:15})})
    g.recordEvents([{kind:'social',key:'social:101:'+BV+':2000',bvid:BV,actorUid:'101',at:clock,text:'你好'}])
    g.recordSocialReply({actorUid:'101',bvid:BV,incomingRpid:'2000',text:'鱼鱼你好',at:clock})
    const st=g.status();assert.equal(st.archiveEvents,2);assert.equal(st.total,1);assert.equal(st.counts.clear,1)
    assert.equal(st.oldestEpisodeDays,0);assert.ok(st.nextFuzzyAt)
    clock+=20*86400000
    const later=g.status();assert.equal(later.total,1);assert.equal(later.archiveEvents,2)
    assert.equal(later.counts.clear,0);assert.equal(later.counts.fuzzy,1);assert.equal(later.nextFuzzyAt,'')
    g.close()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('Bug 04: 状态快照只从新事件产生；旧事件不伪造历史',()=>{
  const dir=home(),now=Date.parse('2026-10-30T08:00:00Z');let clock=now
  try{
    const e=createEmotionalState({dataDir:dir,now:()=>clock})
    e.update({mood:'warm',intensity:2,source:'comment'})
    const row=e.snapshot().history[0];assert.equal(row.state.sociality,60);assert.ok(row.state.intensity>0)
    clock+=2*3600_000
    const nowState=e.snapshot();assert.ok(nowState.sociality<=row.state.sociality)
    const oldPath=join(dir,'life-memory','emotional-state.json')
    const old=JSON.parse(readFileSync(oldPath,'utf8'));delete old.history[0].state;writeFileSync(oldPath,JSON.stringify(old))
    assert.equal(e.snapshot().history[0].state,undefined)
    e.update({mood:'curious',intensity:1,source:'comment'})
    const newer=e.snapshot().history;assert.equal(newer[1].state,undefined);assert.ok(newer[0].state)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('Bug 03: 意愿只统计真实决策、不给 AI 伪造实际发送；不泄露 UID、消息内容',()=>{
  const dir=home(),now=Date.parse('2026-10-30T08:00:00Z')
  try{
    const a=createDualContextAgency({dataDir:dir,now:()=>now,getEmotion:()=>({enabled:true,energy:70,sociality:88,curiosity:55,valence:10})})
    assert.equal(a.activity().total,0)
    const d=a.decide({source:'bili-dm',uid:'101',messageId:'200',intent:'explore',text:'能去看看视频吗',hardAllowed:true})
    assert.ok(['allow','defer','refuse'].includes(d.decision))
    const st=a.activity();assert.equal(st.total,1);assert.equal(st.recent[0].socialityAtDecision,88)
    assert.equal(st.decisions.allow+st.decisions.defer+st.decisions.refuse+st.decisions.blocked,1)
    assert.equal('uid' in st.recent[0],false);assert.equal('messageId' in st.recent[0],false);assert.equal('text' in st.recent[0],false)
    assert.equal(st.recent[0].source,'bili-dm')
    a.recordAI({source:'bili-comment',uid:'101',messageId:'300',intent:'explore',decision:'defer'})
    assert.equal(a.activity().total,2)
    assert.equal(a.activity().recent[0].mode,'ai')
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('管理页能展示状态快照和意愿决策；明确区别事件、回复、外发完成',()=>{
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 assert.match(html,/emotion-agency-activity/);assert.match(html,/emotion-trend/);assert.doesNotMatch(html,/emotion-trend-metric/)
 assert.match(js,/activity\.replaceChildren/);assert.match(js,/允许 ≠ 已执行/)
 assert.match(js,/五项指标 · 真实事件快照/);assert.match(js,/trend-legend/);assert.match(js,/x\.state&&Number\.isFinite/)
 for(const metric of ['sociality','intensity','energy','curiosity','valence'])assert.ok(js.includes(`key:'${metric}'`),metric)
 assert.match(js,/归档事件与可衰减记忆不是一一对应/)
})
