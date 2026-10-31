import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {buildVideoExplorationEvent,videoRecallQueries} from '../lib/video-experience.mjs'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'
import {createMemoryRetriever} from '../lib/memory-retriever.mjs'

const BV='BV1234567890',OTHER='BV0987654321',DAY=86400_000,START=Date.parse('2026-10-30T12:00:00Z')
const cfg=()=>({mainSessionMemoryEnabled:true,mainSessionMemoryHalfLifeDays:15,mainSessionMemoryThreshold:.25,mainSessionMemoryMaxItems:8,mainSessionMemoryMaxChars:1300})
const withMemory=fn=>{const dir=mkdtempSync(join(tmpdir(),'life-v253-')),clock={at:START};const gate=createLifeMemoryGateway({dataDir:dir,now:()=>clock.at,getConfig:cfg});const retriever=createMemoryRetriever({getMemories:()=>[],getConfig:cfg,getEpisodes:(q,o)=>gate.recall({query:q,...o})});try{fn({gate,retriever,clock,dir})}finally{gate.close();rmSync(dir,{recursive:true,force:true})}}
const explored=(operationId='unique-operation-1',bvid=BV,overrides={})=>buildVideoExplorationEvent({operationId,bvid,at:START,source:'bili-life',info:{title:'神奇大肥鱼的海底冒险',description:'水下生活记录'},subtitle:{text:'鱼儿在珊瑚旁边游来游去'},comments:{comments:[{content:'好可爱'}]},...overrides})

test('2.5.3: 证据必须来自真实成功查看；字幕、画面、评论不互相冒充',()=>{
 const e=explored();assert.equal(e.experience.metadata,true);assert.equal(e.experience.subtitle,true);assert.equal(e.experience.vision,false)
 assert.equal(e.experience.comments,1);assert.equal(e.experience.source,'bili-life')
 assert.equal(e.note,'读取过的公开资料')
 assert.equal(buildVideoExplorationEvent({operationId:'operation-other',bvid:BV,info:{ok:false,error:'失败'}}),null)
 assert.equal(buildVideoExplorationEvent({operationId:'operation-other',bvid:BV,info:{title:''}}),null)
 assert.equal(buildVideoExplorationEvent({operationId:'operation-other',bvid:'invalid',info:{title:'测试'}}),null)
 const vision=explored('operation-vision',BV,{subtitle:{error:'未取得字幕'},visual:{status:'analyzed',description:'画面中有鱼'}})
 assert.equal(vision.experience.subtitle,false);assert.equal(vision.experience.vision,true)
})

test('2.5.3: B站 @ 邀请后的公开探索写进衰减副本，可被其他观众提及标题召回',()=>withMemory(({gate,retriever,dir})=>{
 const evt=explored();assert.equal(gate.recordEvents([evt]).added,1)
 assert.equal(gate.recordEvents([evt]).added,0)
 assert.ok(readFileSync(gate.file,'utf8').includes('取得过字幕文本'))
 const reply=retriever.socialContext('你以前看过《神奇大肥鱼的海底冒险》吗',{role:'stranger',actorUid:'999',currentBvid:OTHER})
 assert.match(reply,/神奇大肥鱼的海底冒险/)
 assert.match(reply,/不代表完整观看过视频画面/)
 assert.doesNotMatch(reply,/系统提示|私信内容/)
 assert.equal(gate.recall({query:BV,domain:'bili-life',role:'friend',actorUid:'222',kinds:['watch']}).length,1)
 assert.ok(readFileSync(join(dir,'life-memory','archive','2026-10.jsonl'),'utf8').includes('video-explore:unique-operation-1'))
}))

test('2.5.3: “这个视频”在没有明确其他标题时才使用当前平台核实 BV',()=>{
 assert.equal(videoRecallQueries('你以前看过这个视频吗',{currentBvid:BV})[0],BV)
 assert.equal(videoRecallQueries('之前看过那个《小鱼吃鱼》视频吗',{currentBvid:BV})[0],'小鱼吃鱼')
 assert.equal(videoRecallQueries('看过 BV0987654321 吗',{currentBvid:BV})[0],OTHER)
 assert.ok(!videoRecallQueries('你以前看过那个《小鱼吃鱼》视频吗',{currentBvid:BV}).includes(BV))
})

test('2.5.3: 旧版选中记录保持旧证据级别，不能伪造成取得字幕或画面',()=>withMemory(({gate,retriever})=>{
 gate.recordEvents([{kind:'watch',key:'old-selected-1',bvid:BV,title:'怀旧鱼鱼游泳',at:START}])
 const result=retriever.socialContext('怀旧鱼鱼游泳',{role:'friend',actorUid:'101',currentBvid:OTHER})
 assert.match(result,/选中视频/);assert.doesNotMatch(result,/取得过字幕|完整观看过视频画面|看完/)
}))

test('2.5.3: 主 Session 视频探索不能自动作为公开社交记忆',()=>withMemory(({gate})=>{
 const evt=explored('main-session-operation',BV,{})
 evt.experience.source='main-session'
 gate.recordEvents([evt])
 assert.equal(gate.recall({query:BV,domain:'main-session',kinds:['watch']}).length,1)
 assert.equal(gate.recall({query:BV,domain:'bili-life',role:'friend',actorUid:'123',kinds:['watch']}).length,0)
}))

test('2.5.3: 社交 UID 隔离依然有效，自身公开视频可用，不暴露其他观众原话',()=>withMemory(({gate,retriever})=>{
 gate.recordEvents([explored(),{kind:'social',key:`social:101:${BV}:2`,bvid:BV,actorUid:'101',text:'我们的暗号是蓝星贝壳',at:START}])
 const stranger=retriever.socialContext('神奇大肥鱼的海底冒险',{role:'stranger',actorUid:'202',currentBvid:OTHER})
 assert.match(stranger,/神奇大肥鱼/);assert.doesNotMatch(stranger,/蓝星贝壳/)
 const friend=retriever.socialContext('蓝星贝壳',{role:'friend',actorUid:'101'})
 assert.match(friend,/蓝星贝壳/)
 assert.equal(gate.recall({query:BV,domain:'bili-life',actorUid:'',role:'stranger'}).length,0)
}))

test('2.5.3: 变模糊后既不能从标题/BV取回旧细节，也不能绕过遗忘',()=>withMemory(({gate,retriever,clock})=>{
 gate.recordEvents([explored()])
 clock.at+=14*DAY
 const q='神奇大肥鱼的海底冒险'
 assert.deepEqual(gate.recall({query:BV,domain:'bili-life',actorUid:'101',role:'friend',kinds:['watch']}),[])
 assert.deepEqual(gate.recall({query:q,domain:'bili-life',actorUid:'101',role:'friend',kinds:['watch']}),[])
 const active=gate.recall({query:'',domain:'bili-life',actorUid:'101',role:'friend',kinds:['watch']})
 assert.equal(active[0]?.stage,'fuzzy');assert.ok(!('bvid' in active[0]));assert.doesNotMatch(active[0].summary,/神奇大肥鱼的海底冒险/)
 clock.at+=90*DAY
 assert.equal(gate.recall({query:'',domain:'bili-life',actorUid:'101',role:'friend',kinds:['watch']}).length,0)
}))

test('2.5.3: 实际视频查看的生活写入与社交召回接线存在于插件入口',()=>{
 const source=readFileSync(new URL('../index.js',import.meta.url),'utf8')
 assert.match(source,/const event=buildVideoExplorationEvent\(/)
 assert.match(source,/lifeMemory\?\.recordEvents\(\[event\]\)/)
 assert.match(source,/lifeReflection\?\.addEvents\(\[event\]\)/)
 assert.match(source,/excludeEventKey,currentBvid/)
 assert.match(source,/item\.incomingRpid.*item\.bvid/)
})
