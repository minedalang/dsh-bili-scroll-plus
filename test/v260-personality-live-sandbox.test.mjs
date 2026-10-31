import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createPersonalityEvolution} from '../lib/personality-evolution.mjs'

function withSandbox(fn){
  const dataDir=mkdtempSync(join(tmpdir(),'dafeiyu-live-sandbox-'))
  let reads=0
  const evolution=createPersonalityEvolution({dataDir,memoryGateway:{reflectionEvidence:()=>{reads++;throw Error('Must never load actual episodes')}}})
  try{return fn({dataDir,evolution,reads:()=>reads})}finally{rmSync(dataDir,{recursive:true,force:true})}
}
const trait=(status,id)=>status.traits.find(row=>row.id===id)

test('连续沙盒从空白开始，逐步形成萌芽、发展、矛盾和反向倾向',()=>withSandbox(({evolution})=>{
  const zero=evolution.simulate(0)
  assert.equal(zero.step,0);assert.equal(zero.latest,null)
  assert.ok(zero.traits.every(t=>t.stage==='seed'))
  for(const n of [1,2,3,4,6,7,8,9,12,13,15,18,21,24,25,48,97,140]){
    const state=evolution.simulate(n)
    assert.equal(state.step,n)
    assert.equal(state.latest.number,n)
    assert.ok(state.timeline.length<=16)
    assert.match(state.latest.detail,/^模拟：/)
    assert.ok(state.traits.every(t=>t.score>=20&&t.score<=80))
  }
  assert.equal(trait(evolution.simulate(1),'social_openness').stage,'observed')
  assert.equal(trait(evolution.simulate(3),'social_openness').stage,'developing')
  assert.equal(trait(evolution.simulate(9),'social_openness').stage,'mixed')
  assert.equal(trait(evolution.simulate(12),'social_openness').direction,-1)
  assert.equal(trait(evolution.simulate(15),'assertiveness').stage,'developing')
  assert.equal(trait(evolution.simulate(18),'patience').stage,'developing')
  assert.equal(trait(evolution.simulate(21),'boundaries').stage,'developing')
  assert.equal(evolution.simulate(25).cycle,2)
  assert.equal(evolution.simulate(140).timeline.length,16)
}))

test('重复步数无重复叠加，刷新重算仍得到相同阶段',()=>withSandbox(({evolution})=>{
  for(const step of [0,1,3,9,12,24,58,110]){
    const first=evolution.simulate(step),again=evolution.simulate(step)
    assert.deepEqual(first,again)
  }
}))

test('播放100步也不触碰真实成长数据、真实人生记忆',()=>withSandbox(({evolution,dataDir,reads})=>{
  const file=join(dataDir,'personality-evolution','v1.json')
  evolution.setEnabled(true)
  const before=readFileSync(file)
  for(let i=0;i<120;i+=5)evolution.simulate(i)
  assert.deepEqual(readFileSync(file),before)
  assert.equal(reads(),0)
  assert.equal(evolution.status().enabled,true)
}))

test('新的子页位于生活与成长下，旧表达规则保持原位置；浏览器可暂停、单步、刷新恢复',()=>{
  const root=new URL('../',import.meta.url)
  const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
  const js=readFileSync(new URL('lib/management-console.js',root),'utf8')
  const index=readFileSync(new URL('index.js',root),'utf8')
  assert.match(html,/<span class="tab-cluster-label">🏠 生活与成长<\/span>[\s\S]*?data-tab="personality"/)
  assert.match(html,/<section id="panel-personality" hidden>[\s\S]*?id="personality-evolution-card"[\s\S]*?<\/section>\s*<section id="panel-growth" hidden>/)
  assert.match(html,/<section id="panel-growth" hidden>[\s\S]*?行为与表达改进 · 直接附加到 AI 提示词/)
  for(const name of ['pause','next','reset','speed','progress','latest','timeline-details'])assert.ok(html.includes('personality-evolution-sandbox-'+name)||name==='timeline-details'&&html.includes('personality-evolution-timeline-details'))
  assert.match(js,/sessionStorage\.setItem\(sandboxStorageKey/)
  assert.match(js,/sandboxTimer=setInterval/)
  assert.match(js,/sandboxBusy/)
  assert.match(js,/personality:async\(\)=>/)
  assert.match(js,/growth:growthList/)
  assert.match(index,/url\.searchParams\.get\('step'\)/)
  assert.match(index,/personalityEvolution\.simulate\(raw===null\?12:Number\(raw\)\)/)
  assert.doesNotMatch(index,/req\.method==='POST'&&path==='\/api\/bili-duty\/personality-evolution-sandbox'/)
})
