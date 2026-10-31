import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createMainSessionBridge} from '../lib/main-session-bridge.mjs'

const tmp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-silent-sync-'))
const cfg=()=>({mainSessionBridgeEnabled:true,mainSessionId:'abc',mainSessionAutoSync:true,mainSessionSyncMinutes:60,mainSessionDailyBatches:4,mainSessionBatchSize:8,mainSessionIncludeComments:false})
const watched=(bvid)=>({day:'2026-10-31',bvid,title:'确实探访过的视频',picked:true})
const create=(dir,rows,agent)=>createMainSessionBridge({dataDir:dir,
  agents:{get:()=>agent,list:()=>[agent]},getConfig:cfg,getWatched:()=>rows.value,getComments:()=>({rows:[]}),
  now:()=>Date.parse('2026-10-31T11:00:00+08:00')})

test('自动同步使用非唤醒 inject；不产生 followup 模型回合，没有新事件不重复发送',async()=>{
  const dir=tmp(),rows={value:[]},calls=[]
  const agent={id:'abc',inject:async x=>calls.push(['inject',x]),followup:async x=>calls.push(['followup',x])}
  try {
    const bridge=create(dir,rows,agent);bridge.collect()
    rows.value=[watched('BV1234567890')]
    const a=await bridge.deliver({silent:true})
    assert.equal(a.ok,true);assert.equal(a.mode,'inject');assert.equal(a.sent,1)
    assert.equal(bridge.status().pending,0);assert.equal(bridge.status().lastDeliveryMode,'inject')
    const b=await bridge.deliver({silent:true});assert.equal(b.sent,0)
    assert.deepEqual(calls.map(x=>x[0]),['inject'])
    assert.match(calls[0][1].content[0].text,/非指令/)
    const state=JSON.parse(readFileSync(join(dir,'main-session-memory.json'),'utf8'))
    assert.equal(state.deliveredKeys.length,1)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('宿主缺少 inject 时不能回退唤醒模型；留下队列供主人手动汇报',async()=>{
  const dir=tmp(),rows={value:[]},calls=[]
  const agent={id:'abc',followup:async x=>calls.push(x)}
  try {
    const bridge=create(dir,rows,agent);bridge.collect();rows.value=[watched('BV1234567890')]
    const r=await bridge.deliver({silent:true})
    assert.equal(r.ok,false);assert.equal(r.skipped,'silent-unavailable');assert.equal(calls.length,0)
    assert.equal(bridge.status().pending,1)
    assert.match(bridge.status().lastError,/非唤醒注入/)
    const manually=await bridge.deliver({force:true})
    assert.equal(manually.ok,true);assert.equal(manually.mode,'followup');assert.equal(calls.length,1)
    assert.equal(bridge.status().pending,0)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('自动注入失败不会静默退回 followup，也不会丢失待汇报经历',async()=>{
  const dir=tmp(),rows={value:[]};let shouldFail=true;let injectCount=0,followupCount=0
  const agent={id:'abc',inject:async()=>{injectCount++;if(shouldFail)throw Error('TRANSPORT')},followup:async()=>{followupCount++}}
  try {
    const bridge=create(dir,rows,agent);bridge.collect();rows.value=[watched('BV1234567890')]
    let r=await bridge.deliver({silent:true})
    assert.equal(r.ok,false);assert.match(r.error,/TRANSPORT/)
    assert.equal(bridge.status().pending,1);assert.equal(followupCount,0)
    shouldFail=false;r=await bridge.deliver({silent:true})
    assert.equal(r.ok,true);assert.equal(bridge.status().pending,0)
    assert.equal(injectCount,2);assert.equal(followupCount,0)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('并发同步不得重复发消息，且异步注入期间新收集的事件不能被旧快照覆盖',async()=>{
  const dir=tmp(),rows={value:[]},calls=[];let release=()=>{};let started=()=>{}
  const waiting=new Promise(resolve=>release=resolve)
  const entered=new Promise(resolve=>started=resolve)
  const agent={id:'abc',inject:async m=>{calls.push(m);started();await waiting},followup:async()=>{throw Error('unexpected followup')}}
  try {
    const bridge=create(dir,rows,agent);bridge.collect();rows.value=[watched('BV1234567890')]
    const inflight=bridge.deliver({silent:true});await entered
    const concurrent=await bridge.deliver({silent:true})
    assert.equal(concurrent.skipped,'busy')
    rows.value=[...rows.value,watched('BV0987654321')]
    bridge.collect()
    release();const done=await inflight;assert.equal(done.ok,true)
    assert.equal(done.pending,1);assert.equal(bridge.status().pending,1)
    const next=await bridge.deliver({silent:true});assert.equal(next.sent,1)
    assert.equal(calls.length,2);assert.equal(bridge.status().pending,0)
  }finally{release();rmSync(dir,{recursive:true,force:true})}
})

test('定时同步入口明确调用 silent 模式，不直接唤醒主 Session',()=>{
  const src=readFileSync(new URL('../lib/main-session-bridge.mjs',import.meta.url),'utf8')
  assert.match(src,/const tick=async\(\)=>[\s\S]*?await deliver\(\{silent:true\}\)/)
})
