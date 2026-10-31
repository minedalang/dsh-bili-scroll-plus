import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,existsSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createPersonalityEvolution} from '../lib/personality-evolution.mjs'

const TIME=Date.parse('2026-10-31T02:00:00.000Z')
function withInstance(fn){
  const dataDir=mkdtempSync(join(tmpdir(),'fish-personality-sandbox-'))
  let memoryReadCount=0
  const memoryGateway={reflectionEvidence:()=>{memoryReadCount++;throw Error('sandbox must never query real memory')}}
  const personality=createPersonalityEvolution({dataDir,memoryGateway,now:()=>TIME})
  try{return fn({dataDir,personality,getMemoryReadCount:()=>memoryReadCount})}
  finally{rmSync(dataDir,{recursive:true,force:true})}
}

test('沙盒独立于真实存储、真实 Life Memory、模型及其他业务副作用',()=>withInstance(({dataDir,personality,getMemoryReadCount})=>{
  const file=join(dataDir,'personality-evolution','v1.json')
  assert.equal(existsSync(file),false)
  const simulated=personality.simulate()
  assert.equal(simulated.ok,true)
  assert.equal(simulated.sandbox,true)
  assert.equal(simulated.enabled,false)
  assert.equal(personality.status().enabled,false)
  assert.equal(existsSync(file),false)
  assert.equal(getMemoryReadCount(),0)
  assert.equal(personality.context({scene:'comment'}),'')
  assert.doesNotMatch(JSON.stringify(simulated),/BV[0-9A-Za-z]{10}/)
}))

test('沙盒复用真实成长阈值，演示萌芽、发展中、矛盾与反向形成',()=>withInstance(({personality})=>{
  const out=personality.simulate()
  assert.equal(out.timeline.length,12)
  const ordered=[...out.timeline].reverse()
  assert.equal(ordered[0].stage,'observed')
  assert.equal(ordered[2].stage,'developing')
  assert.equal(ordered[5].stage,'developing')
  assert.equal(ordered[8].stage,'mixed')
  assert.equal(ordered[11].stage,'developing')
  assert.equal(ordered[11].direction,-1)
  assert.equal(out.traits.find(t=>t.id==='social_openness').meaning,'面对不熟悉的人更加谨慎')
  assert.equal(out.traits.find(t=>t.id==='curiosity').stage,'developing')
  assert.match(out.previewContext,/面对不熟悉的人更加谨慎/)
  assert.match(out.previewContext,/更愿意探索新事物/)
  assert.ok(out.timeline.every(t=>t.detail.startsWith('模拟：')))
}))

test('模拟前后已保存的真实成长文件逐字节不变，真实开启状态不受影响',()=>withInstance(({dataDir,personality,getMemoryReadCount})=>{
  personality.setEnabled(true)
  const file=join(dataDir,'personality-evolution','v1.json')
  const before=readFileSync(file)
  personality.simulate()
  personality.simulate()
  const after=readFileSync(file)
  assert.deepEqual(after,before)
  assert.equal(personality.status().enabled,true)
  assert.equal(getMemoryReadCount(),0)
}))

test('管理页沙盒有明确退出入口，模拟视图禁用真实清除与设置，服务端提供只读路由',()=>{
  const root=new URL('../',import.meta.url)
  const html=readFileSync(new URL('lib/management-console.html',root),'utf8')
  const js=readFileSync(new URL('lib/management-console.js',root),'utf8')
  const index=readFileSync(new URL('index.js',root),'utf8')
  assert.match(html,/personality-evolution-sandbox-run/)
  assert.match(html,/personality-evolution-sandbox-exit/)
  assert.match(html,/纯虚构经历/)
  assert.match(js,/personality-evolution-sandbox-area/)
  assert.match(js,/t\.evidenceCount&&!isSandbox/)
  assert.match(js,/personality-evolution-save'\)\.disabled=isSandbox/)
  assert.match(index,/req\.method==='GET'&&path==='\/api\/bili-duty\/personality-evolution-sandbox'/)
  assert.doesNotMatch(index,/req\.method==='POST'&&path==='\/api\/bili-duty\/personality-evolution-sandbox'/)
})
