import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createLifeMemoryGateway} from '../lib/life-memory-gateway.mjs'

const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
const script=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')

test('记忆页只暴露一个常用搜索框；反思、模型诊断和旧插件导入默认收起',()=>{
 const life=html.split('<section id="panel-life"')[1].split('<section id="panel-diagnostics"')[0]
 assert.equal((life.match(/id="main-session-history-query"/g)||[]).length,1)
 assert.equal((life.match(/id="main-memory-query"/g)||[]).length,1)
 assert.match(life,/id="main-memory-query"[^>]*hidden/)
 assert.match(life,/class="memory-reflection-details"/)
 assert.match(life,/class="memory-advanced-details"/)
 assert.match(life,/<details class="memory-legacy-details">/)
 assert.match(life,/id="memory-flow-recorded"/)
 assert.match(life,/id="memory-flow-remembered"/)
 assert.match(life,/id="memory-flow-learned"/)
 assert.match(html,/prefers-reduced-motion:reduce/)
 assert.match(script,/const searchFishMemory=async/)
 assert.match(script,/await Promise\.all\(\[renderMainSessionHistory\(\),renderLongMemory\(\)\]\)/)
 assert.doesNotMatch(life,/测试记忆召回/)
})

test('准确视频 BV 和中文标题可检索，但模糊或遗忘状态不能恢复已删除 BV',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fish-memory-ui-'))
 const start=Date.parse('2026-10-30T12:00:00Z')
 let now=start
 try{
  const gateway=createLifeMemoryGateway({dataDir:dir,now:()=>now,getConfig:()=>({mainSessionMemoryHalfLifeDays:15,mainSessionMemoryThreshold:.8})})
  gateway.recordEvents([{kind:'watch',bvid:'BV1gwHg6MERk',time:'2026-10-30T09:00:00Z',day:'2026-10-30',title:'怎么让你的大肥鱼有可爱的声音2'}])
  const byTitle=gateway.recall({query:'怎么让你的大肥鱼有可爱的声音2'})
  assert.equal(byTitle.length,1)
  assert.equal(byTitle[0].bvid,'BV1gwHg6MERk')
  assert.equal(gateway.recall({query:'BV1gwHg6MERk'})[0].kind,'watch')
  now+=13*86400000
  assert.deepEqual(gateway.recall({query:'BV1gwHg6MERk'}),[])
  assert.equal(gateway.status().counts.fuzzy,1)
  now+=100*86400000
  assert.deepEqual(gateway.recall({query:'BV1gwHg6MERk'}),[])
  assert.equal(gateway.status().counts.forgotten,1)
  assert.equal(gateway.status().archiveEvents,1)
 }finally{rmSync(dir,{recursive:true,force:true})}
})
