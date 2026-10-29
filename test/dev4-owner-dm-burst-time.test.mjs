import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOwnerDmAgent, groupOwnerDmBursts } from '../lib/owner-dm-agent.mjs'
import { formatLocalLogTimestamp } from '../lib/log-time.mjs'

const bv='BV1xx411c7mD'
const time=Date.now()
const row=(text,id,t)=>({incoming:true,senderUid:'123',messageId:id,timestampMs:t,text})
const cfg=()=>({masterEnabled:true,dmWatch:true,ownerDmAgentEnabled:true,dmOwnerUid:'123',ownerDmActionsEnabled:true,ownerDmLikeEnabled:true,ownerDmReadCommandsEnabled:true})

// The second and third texts are one owner's fragmented clarification, not two tasks.
test('主人短时间连续发来的句子碎片，只执行一次点赞并回复一次',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dm-burst-'))
  try{
    let modelCalls=0,writeCalls=0
    const replies=[]
    const agent=createOwnerDmAgent({dataDir:dir,getConfig:cfg,now:()=>time+40_000,
      invokeModel:async()=>{modelCalls++;return JSON.stringify({action:'like',bvid:bv})},
      executeRead:async()=>{throw Error('no read')},
      executeWrite:async()=>{writeCalls++;return {ok:true,summary:'已确认点赞 '+bv}},
      send:async r=>{replies.push(r.text);return {ok:true}},
    })
    agent.primeInbox([])
    const msgs=[row('给 '+bv+' 点个赞','one',time),row('这个事情','two',time+2000),row('视频','three',time+4500)]
    const result=await agent.processMessages([...msgs].reverse())
    assert.equal(result.length,1)
    assert.equal(result[0].merged,3)
    assert.equal(writeCalls,1)
    assert.equal(modelCalls,1)
    assert.deepEqual(replies,['已确认点赞 '+bv])
    const d=JSON.parse(readFileSync(join(dir,'owner-dm-agent.json'),'utf8'))
    assert.deepEqual(d.items.map(r=>r.status),['done','done','done'])
    assert.equal((await agent.processMessages(msgs)).length,0)
    // Different poll, but another vague fragment immediately after the successful write.
    const later=await agent.processMessages([row('这个视频','four',time+5000)])
    assert.equal(later[0].skipped,'continuation-muted')
    assert.equal(replies.length,1)
    assert.equal(writeCalls,1)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('两条各自明确的新命令即使靠得近也不能合并；非主人不能进入主人 Agent',()=>{
  const group=groupOwnerDmBursts([row('给这个点赞','1',time),row('现在收藏这个视频','2',time+1000),row('这个视频','3',time+1100)])
  assert.deepEqual(group.map(g=>g.length),[1,2])
})

test('duty.log 时间使用带偏移的本地 ISO 8601 时间，表示的时刻不变',()=>{
  const d=new Date('2026-10-29T04:31:11.880Z')
  const text=formatLocalLogTimestamp(d)
  assert.match(text,/^2026-10-\d{2}T\d{2}:\d{2}:\d{2}\.880[+-]\d{2}:\d{2}$/)
  assert.equal(new Date(text).getTime(),d.getTime())
  assert.throws(()=>formatLocalLogTimestamp(new Date('invalid')),/无效/)
})
