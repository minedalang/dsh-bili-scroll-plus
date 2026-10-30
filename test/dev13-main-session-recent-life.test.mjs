import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'

const now=Date.parse('2026-10-30T12:00:00Z')
test('关键词能搜到的入选视频，不再被最近列表中的大量评论挤出',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dev13-recent-'))
 try{
  const memory=createLifeMemoryGateway({dataDir:dir,now:()=>now,getConfig:()=>({mainSessionMemoryHalfLifeDays:30})})
  const video={kind:'watch',bvid:'BV1234567890',day:'2026-10-30',title:'昨天看过的显卡视频',time:'2026-10-30'}
  const comments=Array.from({length:28},(_,i)=>({kind:'comment',bvid:'BV1234567890',time:`2026-10-30T10:${String(i).padStart(2,'0')}:00Z`,snippet:`发表评论 ${i}`,rpid:String(100001+i)}))
  memory.recordEvents([video,...comments])
  assert.ok(memory.recall({query:'昨天看过的显卡视频',kinds:['watch']}).some(x=>x.kind==='watch'))
  const videoRows=memory.recall({query:'',kinds:['watch'],maxItems:12})
  const commentRows=memory.recall({query:'',kinds:['comment','social'],maxItems:12})
  assert.equal(videoRows.length,1)
  assert.equal(commentRows.length,12)
  assert.ok(videoRows[0].summary.includes('显卡视频'))
  assert.ok(readFileSync(memory.file,'utf8').includes('clear'))
 }finally{rmSync(dir,{recursive:true,force:true})}
})
test('无关键词按发生时间排序，关键词仍按相关性筛选',()=>{
 const dir=mkdtempSync(join(tmpdir(),'dafeiyu-dev13-recent-'))
 try{
  const memory=createLifeMemoryGateway({dataDir:dir,now:()=>now,getConfig:()=>({mainSessionMemoryHalfLifeDays:30})})
  memory.recordEvents([
    {kind:'watch',bvid:'BV1234567890',day:'2026-10-30',title:'今年的新视频'},
    {kind:'comment',bvid:'BV1234567890',time:'2026-10-29T10:00:00Z',snippet:'老评论',rpid:'100002'},
  ])
  assert.equal(memory.recall({query:'',maxItems:2})[0].kind,'watch')
  assert.equal(memory.recall({query:'老评论',maxItems:2})[0].kind,'comment')
 }finally{rmSync(dir,{recursive:true,force:true})}
})
