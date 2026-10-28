import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {recordInterestEvents,listLifeInterests,interestMemoryRows} from '../lib/life-interests.mjs'
import {__test as retrieverTest,createMemoryRetriever} from '../lib/memory-retriever.mjs'
const h=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const j=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
const client=readFileSync(new URL('../client.js',import.meta.url),'utf8')
const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))

test('升级后保留人生记忆独立页；记忆内容独立页，原家页只管理记忆设置',()=>{
 assert.match(pkg.version,/^2\.(?:[5-9]|[1-9]\d+)\.\d+(?:-dev\.\d+)?$/)
 assert.match(h,/data-tab="life"/)
 const house=h.split('<section id="panel-home"')[1].split('<section id="panel-life"')[0]
 const life=h.split('<section id="panel-life"')[1].split('<section id="panel-diagnostics"')[0]
 assert.match(house,/人生记忆与检索设置/)
 assert.doesNotMatch(house,/id="main-interests-list"/)
 for (const id of ['main-interests-list','main-legacy-growth-list','main-memory-list','main-reflection-list'])assert.ok(life.includes('id="'+id+'"'))
 assert.match(life,/行为与表达改进/)
})
test('兴趣卡有阶段主题色、可访问进度条和真实证据说明',()=>{
 assert.match(h,/\.interest-meter-fill/)
 assert.match(h,/\.interest-emerald/)
 assert.match(h,/\.interest-sky/)
 assert.match(h,/\.interest-slate/)
 assert.match(h,/\.life-action/)
 assert.match(j,/aria-valuenow/)
 assert.match(j,/证据成熟度/)
 assert.match(j,/不是兴趣强弱分数/)
})
test('关于页附作者 B站主页链接，安全新窗口',()=>{
 assert.match(client,/https:\/\/space\.bilibili\.com\/210228238/)
 assert.match(client,/长条动物/)
 assert.match(client,/noopener noreferrer/)
})
test('兴趣档案使用真实不同BV和跨日门槛，不能从单次观看推断长期兴趣',()=>{
 const dir=mkdtempSync(join(tmpdir(),'v2482-int-'))
 try{
  const now=Date.parse('2026-10-27T11:00:00Z')
  const make=(bvid,day)=>({kind:'watch',bvid,title:'今天做白米饭料理啦',tier:'selected',time:day+'T12:00:00Z'})
  recordInterestEvents(dir,[make('BV1aBcD2eF3G','2026-10-24')],now)
  assert.equal(listLifeInterests(dir,now).length,0)
  recordInterestEvents(dir,[make('BV1xYzA2bC3D','2026-10-25'),make('BV1lMnO2pQ3R','2026-10-26')],now)
  const rows=listLifeInterests(dir,now)
  assert.equal(rows.find(x=>x.topic==='白饭与美食').stage,'emerging')
  assert.ok(interestMemoryRows(dir,now).some(x=>x.memoryKind==='interest'))
  recordInterestEvents(dir,[make('BV1lMnO2pQ3R','2026-10-26')],now)
  assert.equal(listLifeInterests(dir,now).find(x=>x.topic==='白饭与美食').rolling90,3)
 } finally {rmSync(dir,{force:true,recursive:true})}
})
test('主人已批准旧关系优先于相矛盾的自动关系，同一事实去重',()=>{
 const a={id:'A',source:'legacy-growth-approved',memoryKind:'relationship',subject:'Claude',text:'Claude是大肥鱼熟悉的AI朋友。',importance:.9}
 const b={id:'B',source:'life-reflection',category:'stable_profile',fact_key:'关系.Claude',text:'Claude与大肥鱼并不熟悉。'}
 const rows=retrieverTest.resolveSourceConflicts([a,b,{...a,id:'C'}])
 assert.deepEqual(rows.map(x=>x.id),['A'])
})
