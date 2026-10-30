import test from 'node:test'
import assert from 'node:assert/strict'
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLongTermMemory,__test} from '../lib/long-term-memory.mjs'

const temp=()=>mkdtempSync(join(tmpdir(),'dafeiyu-v2479-'))
const defineTool=x=>x
const sleep=ms=>new Promise(r=>setTimeout(r,ms))
function fakeAgent(id){
  const handlers={},contexts=[],sections=[],tools=[]
  const ctx={on:(name,fn)=>{handlers[name]=fn;return()=>{delete handlers[name]}},systemPrompt:{section:spec=>{sections.push(spec);return()=>{}},context:spec=>{contexts.push(spec);return()=>{}}},tools:{register:spec=>{tools.push(spec);return()=>{}}}}
  return {agent:{id,session:{id,snapshotEvents:()=>[]},ctx},handlers,contexts,sections,tools}
}
function config(id='room-a'){
  return {mainSessionId:id,mainSessionMemoryEnabled:true,mainSessionMemoryAutoBili:true,mainSessionMemoryHalfLifeDays:30,mainSessionMemoryThreshold:.35,mainSessionMemoryMaxItems:6,mainSessionMemoryMaxChars:800,mainSessionMemoryDailyQuota:8,mainSessionMemoryFactsMax:3}
}

test('v2.4.80 不再用本地正则直接生成长期事实，改为 AI 语义判断 + 本地安全闸',()=>{
  assert.equal(__test.isPureMemoryQuery('我现在最喜欢喝什么？'),true)
  assert.equal(__test.isPureMemoryQuery('你还记得我平时喜欢喝什么吗？'),true)
  assert.equal(__test.isPureMemoryQuery('记住：我现在最喜欢喝冰美式。'),false)
  assert.equal(__test.proposedMemoryHasPlaceholder('主人目前最喜欢喝「什么」。'),true)
  assert.equal(__test.proposedMemoryHasPlaceholder('主人目前最喜欢喝「冰美式」。'),false)
  let r=__test.validateSemanticMemoryProposal({text:'主人目前最喜欢喝「什么」。',importance:.98,fact_key:'主人.偏好.饮料'},'我现在最喜欢喝什么？')
  assert.equal(r.ok,false)
  r=__test.validateSemanticMemoryProposal({text:'主人目前最喜欢喝「冰美式」。',importance:.98,fact_key:'主人.偏好.饮料'},'我现在最喜欢喝冰美式。')
  assert.equal(r.ok,true);assert.equal(r.value.fact_key,'主人.偏好.饮料')
})

test('收到主人消息本身不再直接写记忆；同一次模型回复通过 remember 语义落盘并支持 fact_key 更新',async()=>{
  const dir=temp(),f=fakeAgent('room-a')
  try{
    const mem=createLongTermMemory({dataDir:dir,dshHome:dir,agents:{get:()=>f.agent,list:()=>[f.agent]},getConfig:()=>config(),defineTool})
    mem.start();const tool=f.tools[0]
    f.handlers['agent/inbox/inserted']({message:{content:[{type:'text',text:'以后叫我浪哥'}]}})
    assert.equal(mem.list('称呼').length,0)
    let r=await tool.execute({text:'主人希望我以后使用称呼「浪哥」。',importance:.99,tags:['主人','称呼'],fact_key:'主人.称呼'})
    assert.equal(r.ok,true);let rows=mem.list('称呼');assert.equal(rows.filter(x=>!x.已被取代).length,1);assert.match(rows.find(x=>!x.已被取代).text,/浪哥/);assert.equal(rows[0].source,'main-session-ai')
    f.handlers['agent/inbox/inserted']({message:{content:[{type:'text',text:'以后还是叫我主人吧'}]}})
    r=await tool.execute({text:'主人现在希望我使用称呼「主人」。',importance:.99,tags:['主人','称呼'],fact_key:'主人.称呼'})
    assert.equal(r.ok,true);rows=mem.list('称呼');assert.equal(rows.filter(x=>!x.已被取代).length,1);assert.match(rows.find(x=>!x.已被取代).text,/「主人」/)
    assert.equal(existsSync(join(dir,'long-term-memory','dafeiyu.json')),true);assert.equal(existsSync(join(dir,'long-term-memory','room-a.json')),false)
    mem.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('切换主 Session 后读取同一份身份记忆；召回问题不能反向污染记忆',async()=>{
  const dir=temp(),a=fakeAgent('room-a'),b=fakeAgent('room-b');let room='room-a'
  try{
    const mem=createLongTermMemory({dataDir:dir,dshHome:dir,agents:{get:id=>id.replace(/^session-/,'')==='room-a'?a.agent:b.agent,list:()=>[a.agent,b.agent]},getConfig:()=>config(room),defineTool})
    mem.start();a.handlers['agent/inbox/inserted']({message:{content:[{type:'text',text:'我现在最喜欢喝可乐。'}]}})
    let r=await a.tools[0].execute({text:'主人目前最喜欢喝「可乐」。',importance:.98,tags:['主人','饮料'],fact_key:'主人.偏好.饮料'});assert.equal(r.ok,true)
    room='room-b';await sleep(900);assert.equal(typeof b.handlers['agent/inbox/inserted'],'function')
    b.handlers['agent/inbox/inserted']({message:{content:[{type:'text',text:'我现在最喜欢喝什么？'}]}})
    r=await b.tools[0].execute({text:'主人目前最喜欢喝「什么」。',importance:.98,tags:['主人','饮料'],fact_key:'主人.偏好.饮料'});assert.equal(r.ok,false)
    assert.equal(mem.list('饮料').filter(x=>!x.已被取代).length,1);assert.match(mem.list('饮料').find(x=>!x.已被取代).text,/可乐/)
    const recall=b.contexts.find(x=>x.name==='dafeiyu-memory')?.text?.()||'';assert.match(recall,/可乐/)
    assert.equal(mem.status().sessionId,'room-b');assert.equal(mem.status().scope,'identity');mem.stop()
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('v2.4.78 的多个 Session 记忆文件首次升级自动合并，旧文件保留',()=>{
  const dir=temp(),memDir=join(dir,'long-term-memory');mkdirSync(memDir,{recursive:true})
  try{
    writeFileSync(join(memDir,'room-a.json'),JSON.stringify({version:2,policy:{},memories:[{id:'a1',text:'主人希望我叫他浪哥',importance:1,category:'stable_profile',事实键:'主人.称呼',createdAt:'2026-10-26T01:00:00.000Z'}],traces:[],deleted:[]}))
    writeFileSync(join(memDir,'room-b.json'),JSON.stringify({version:2,policy:{},memories:[{id:'b1',text:'主人后来希望我叫他主人',importance:1,category:'stable_profile',事实键:'主人.称呼',createdAt:'2026-10-27T01:00:00.000Z'},{id:'b2',text:'主人最近在研究 DSH',importance:.9,category:'event',createdAt:'2026-10-27T02:00:00.000Z'}],traces:[],deleted:[]}))
    const mem=createLongTermMemory({dataDir:dir,dshHome:dir,agents:{get:()=>null,list:()=>[]},getConfig:()=>config('room-b'),defineTool})
    const st=mem.status();assert.equal(st.scope,'identity');assert.deepEqual(st.legacySessionFiles.sort(),['room-a.json','room-b.json'])
    assert.equal(existsSync(join(memDir,'dafeiyu.json')),true);assert.equal(existsSync(join(memDir,'room-a.json')),true);assert.equal(existsSync(join(memDir,'room-b.json')),true)
    const rows=mem.list('称呼');assert.equal(rows.filter(x=>!x.已被取代).length,1);assert.match(rows.find(x=>!x.已被取代).text,/主人/)
    assert.match(mem.list('DSH')[0].text,/DSH/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('README 与管理中心展示特色功能和双层人生记忆，不再堆积版本路线图',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8'),js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8'),readme=readFileSync(new URL('../README.md',import.meta.url),'utf8'),pkg=readFileSync(new URL('../package.json',import.meta.url),'utf8')
  assert.match(html,/大肥鱼的家 · 配置与连接/);assert.doesNotMatch(html,/把一个长期 DSH 会话当作“大肥鱼本人”/);assert.match(html,/人生记忆 · 长期保留/);assert.match(html,/经历记录 · 原始事实/);assert.match(html,/待反思经历 · 等待 AI 分析/);assert.match(html,/人生记忆 · 长期保留/)
  assert.match(html,/导出最新表情包名称 TXT/);assert.match(html,/导出当前规则 JSON/);assert.match(html,/一起交给 AI/)
  assert.match(js,/sticker-workflow-export-names/);assert.match(js,/sticker-workflow-export-rules/);assert.match(js,/renderLifeReflection/);assert.match(js,/main-session\/memory\/import-fish/)
  assert.match(readme,/双层人生记忆/);assert.match(readme,/dafeiyu\.json/);assert.match(readme,/当前全部表情包名称 TXT \+ 当前规则 JSON/);assert.match(readme,/双域意愿/);assert.match(readme,/社交互动/);assert.doesNotMatch(readme,/2\.5\.0-dev\.|版本流水账|未来路线图/)
  assert.match(pkg,/"version": "2\.\d+\.\d+(?:-dev\.\d+)?"/)
})
