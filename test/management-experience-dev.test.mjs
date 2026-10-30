import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync, rmSync, readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDailyDynamic} from '../lib/daily-dynamic.mjs'

const BV='BV1ab2345678'
const text='今天重新看到一段有趣的烹饪视频，才发现自己依然很喜欢观察热气腾腾的饭菜。'
const src=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const make=dir=>createDailyDynamic({dataDir:dir,getConfig:()=>({masterEnabled:true,dailyDynamicEnabled:true,dailyDynamicDailyLimit:2,dailyDynamicDraftOnly:true}),
  getPublicVideos:()=>[{bvid:BV,title:'料理记录'}],
  invokeModel:async()=>JSON.stringify({should_post:true,text,source_bvids:[BV],evidence_claims:[{type:'selected_video',bvid:BV}]}),
  publish:async()=>({status:'api_accepted_unverified'})})

test('未发布草稿可删除、可重新生成；已发布记录不可删除且保留事实账本',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dyn-delete-'))
 try{
  const engine=make(dir)
  const a=await engine.createDraft()
  assert.equal(a.ok,true)
  assert.equal(engine.status().drafts.length,1)
  assert.equal(engine.deleteDraft(a.draft.id).ok,true)
  assert.equal(engine.status().drafts.length,0)
  assert.equal(engine.deleteDraft(a.draft.id).ok,false)
  const b=await engine.createDraft()
  assert.equal(b.ok,true)
  assert.equal((await engine.sendDraft(b.draft.id,{manual:true})).ok,true)
  assert.match(engine.deleteDraft(b.draft.id).error,/只能删除/)
  assert.equal(engine.status().drafts[0].status,'published')
  assert.equal(engine.deleteDraft('bad').ok,false)
 }finally{rmSync(dir,{recursive:true,force:true})}
})

test('管理中心包含真正的删除路由、明确信息反馈、按钮忙碌态和刷新保留页面',()=>{
 const h=src('lib/management-console.html'),ui=src('lib/management-console.js'),host=src('index.js')
 for(const id of ['daily-dynamic-action-status','action-confirm-dialog','request-indicator','action-toast','legacy-growth-details'])assert.ok(h.includes(`id="${id}"`),id)
 assert.match(ui,/request\('\/daily-dynamic\/delete'/)
 assert.match(host,/path === '\/api\/bili-duty\/daily-dynamic\/delete'/)
 assert.match(ui,/url\.searchParams\.set\('tab',tab\)/)
 assert.match(ui,/searchParams\.get\('tab'\)/)
 assert.match(ui,/aria-busy/)
 assert.match(ui,/confirmAction\(\{title:full\?/)
 assert.match(h,/\.action-confirm-dialog::backdrop/)
 assert.match(h,/\.action-feedback\[data-tone=error\]/)
 assert.match(h,/\.legacy-archive/)
})
