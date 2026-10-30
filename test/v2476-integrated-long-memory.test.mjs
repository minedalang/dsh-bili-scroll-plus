import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLongTermMemory,__test} from '../lib/long-term-memory.mjs'
import {allowedPath,createBackup,restoreBackupFiles} from '../lib/data-backup.mjs'
import {createMainSessionBridge} from '../lib/main-session-bridge.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-memory-'))
const cfg=()=>({mainSessionId:'abc',mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.35,mainSessionMemoryMaxItems:6,mainSessionMemoryMaxChars:800,mainSessionMemoryDailyQuota:8,mainSessionMemoryFactsMax:2})

function fakeAgent(){
  const handlers={},contexts=[],sections=[],tools=[]
  const ctx={on:(name,fn)=>{handlers[name]=fn;return()=>{delete handlers[name]}},systemPrompt:{section:spec=>{sections.push(spec);return()=>{}},context:spec=>{contexts.push(spec);return()=>{}}},tools:{register:spec=>{tools.push(spec);return()=>{}}}}
  return {agent:{id:'abc',session:{id:'abc',snapshotEvents:()=>[]},ctx},handlers,contexts,sections,tools}
}
const defineTool=x=>x

test('Claude/Anthropic 可见的长期记忆工具 schema 只有 ASCII 参数名',async()=>{
  const dir=temp(),dsh=temp();const f=fakeAgent();
  try{
    const mem=createLongTermMemory({dataDir:dir,dshHome:dsh,agents:{get:()=>f.agent,list:()=>[f.agent]},getConfig:cfg,defineTool})
    mem.start();assert.equal(f.tools.length,7)
    assert.equal(f.tools[1].name,'dafeiyu_memory_recall');
    assert.deepEqual(f.tools.slice(2).map(x=>x.name),['dafeiyu_life_recall','dafeiyu_todo_list','dafeiyu_todo_add','dafeiyu_todo_update','dafeiyu_todo_execute']);assert.deepEqual(Object.keys(f.tools[1].parameters),['query'])
    const tool=f.tools[0];assert.equal(tool.name,'dafeiyu_remember')
    assert.deepEqual(Object.keys(tool.parameters),['text','importance','tags','supersedes','fact_key'])
    for(const k of Object.keys(tool.parameters))assert.match(k,/^[a-zA-Z0-9_-]{1,64}$/)
    assert.equal('取代' in tool.parameters,false);assert.equal('事实键' in tool.parameters,false)
    mem.stop()
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(dsh,{recursive:true,force:true})}
})

test('身份级 remember 可保存、事实键自动淘汰旧值并按当前话题召回',async()=>{
  const dir=temp(),dsh=temp();const f=fakeAgent();
  try{
    const mem=createLongTermMemory({dataDir:dir,dshHome:dsh,agents:{get:()=>f.agent,list:()=>[f.agent]},getConfig:cfg,defineTool})
    mem.start();const tool=f.tools[0]
    let r=await tool.execute({text:'主人喜欢把大肥鱼叫白饭鱼',importance:1,tags:['主人','称呼'],fact_key:'主人.称呼'});assert.equal(r.ok,true)
    r=await tool.execute({text:'主人以后改叫我肥鱼队长',importance:1,tags:['主人','称呼'],fact_key:'主人.称呼'});assert.equal(r.ok,true)
    const rows=mem.list('主人');assert.equal(rows.length,2);assert.equal(rows.filter(x=>!x.已被取代).length,1);assert.match(rows.find(x=>!x.已被取代).text,/肥鱼队长/)
    f.handlers['agent/inbox/inserted']({message:{content:[{type:'text',text:'你还记得我平时怎么叫你吗？'}]}})
    const injected=f.contexts[0].text();assert.match(injected,/长期记忆/);assert.match(injected,/肥鱼队长/);assert.doesNotMatch(injected,/白饭鱼/)
    mem.stop()
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(dsh,{recursive:true,force:true})}
})

test('v2.4.81 B站新经历不再逐条直写长期记忆，旧入口只返回 deferred',()=>{
  const dir=temp(),dsh=temp();try{
    const mem=createLongTermMemory({dataDir:dir,dshHome:dsh,agents:{get:()=>null,list:()=>[]},getConfig:cfg,defineTool})
    const ev=[{kind:'watch',day:'2026-10-27',time:'2026-10-27',bvid:'BV1234567890',title:'Claude 和 DeepSeek',note:'很好笑',key:'watch:x'}]
    const r=mem.importBiliEvents('abc',ev);assert.equal(r.added,0);assert.equal(r.deferred,true)
    assert.equal(mem.list('Claude').length,0)
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(dsh,{recursive:true,force:true})}
})

test('主 Session 记忆桥只把新入队经历送给内置长期记忆；首次基线不灌旧历史',()=>{
  const dir=temp();let watched=[{day:'2026-10-26',bvid:'BV1234567890',title:'旧视频',picked:true}];const got=[]
  try{
    const bridge=createMainSessionBridge({dataDir:dir,agents:{list:()=>[]},getConfig:()=>({mainSessionBridgeEnabled:true,mainSessionId:'abc',mainSessionAutoSync:true,mainSessionSyncMinutes:60,mainSessionDailyBatches:4,mainSessionBatchSize:8,mainSessionIncludeComments:false}),getWatched:()=>watched,getComments:()=>({rows:[]}),onNewEvents:(sid,events)=>got.push([sid,events])})
    bridge.collect();assert.equal(got.length,0)
    watched=[...watched,{day:'2026-10-27',bvid:'BV0987654321',title:'新视频',picked:true}];bridge.collect();assert.equal(got.length,1);assert.equal(got[0][0],'abc');assert.equal(got[0][1][0].bvid,'BV0987654321')
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('可从原 dsh-fish-memory 同 Session JSON 合并旧记忆，不删除上游文件',()=>{
  const dir=temp(),dsh=temp();try{
    mkdirSync(join(dsh,'fish-memory'),{recursive:true});const old=join(dsh,'fish-memory','abc.json')
    writeFileSync(old,JSON.stringify({version:2,policy:{baseHalfLifeDays:45},memories:[{id:'old1',text:'主人以前答应陪我看烟花',at:'2026-10-01T00:00:00.000Z',importance:.9,category:'event',tags:['主人'],事实键:'约定.烟花'}],traces:[],deleted:[]}), 'utf8')
    const mem=createLongTermMemory({dataDir:dir,dshHome:dsh,agents:{get:()=>null,list:()=>[]},getConfig:cfg,defineTool})
    assert.equal(mem.status().externalFishMemoryAvailable,true);const r=mem.importExternal();assert.equal(r.ok,true);assert.equal(r.added,1);assert.equal(mem.status().policy.baseHalfLifeDays,30);assert.match(mem.list('烟花')[0].text,/烟花/);assert.match(readFileSync(old,'utf8'),/陪我看烟花/)
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(dsh,{recursive:true,force:true})}
})

test('内置长期记忆随大肥鱼业务备份恢复，外部 fish-memory 不在备份路径白名单',()=>{
  const dir=temp(),dst=temp();try{
    mkdirSync(join(dir,'long-term-memory'));writeFileSync(join(dir,'long-term-memory','dafeiyu.json'),JSON.stringify({version:3,scope:'dafeiyu-identity',policy:{},memories:[],traces:[],deleted:[]}))
    assert.equal(allowedPath('long-term-memory/dafeiyu.json'),true);assert.equal(allowedPath('fish-memory/abc.json'),false)
    const b=createBackup({root:dir,config:{mainSessionMemoryEnabled:true},sqlite:{},version:'2.4.79'});assert.ok(b.files['long-term-memory/dafeiyu.json']);restoreBackupFiles(dst,b);assert.match(readFileSync(join(dst,'long-term-memory','dafeiyu.json'),'utf8'),/"version":3/)
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(dst,{recursive:true,force:true})}
})

test('源码保留 dsh-fish-memory MIT 署名并在管理中心提供内置记忆入口',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8'),html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8'),notice=readFileSync(new URL('../THIRD_PARTY_NOTICES.md',import.meta.url),'utf8'),license=readFileSync(new URL('../vendor/fish-memory/LICENSE',import.meta.url),'utf8')
  assert.match(index,/createLongTermMemory/);assert.match(index,/systemPrompt/);assert.match(html,/大肥鱼长期记忆/);assert.match(html,/<details class="memory-legacy-details">[\s\S]*?dsh-fish-memory/);assert.match(html,/id="memory-flow-recorded"/);assert.match(notice,/Yuuyuko-uu\/dsh-fish-memory/);assert.match(license,/Copyright \(c\) 2026 Yuuyuko/)
  assert.match(readFileSync(new URL('../package.json',import.meta.url),'utf8'),/"version": "2\.\d+\.\d+(?:-dev\.\d+)?"/)
})
