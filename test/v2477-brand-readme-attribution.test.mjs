import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=(p)=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('v2.4.77+ 使用新的产品名、包名和 Cordis id',()=>{
  const pkg=JSON.parse(read('package.json')), index=read('index.js'), client=read('client.js'), patch=read('cordis.patch.yml')
  assert.equal(pkg.name,'dsh-dafeiyu-life')
  const parts=String(pkg.version).split('.').map(Number);assert.equal(parts[0],2);assert.ok(parts[1]>=4);if(parts[1]===4)assert.ok(parts[2]>=77)
  assert.match(index,/export const name = 'dafeiyu-life'/)
  assert.match(client,/id: 'dsh-dafeiyu-life'/)
  assert.match(client,/label: '大肥鱼'/)
  assert.match(patch,/id: dafeiyu-life/)
  assert.match(patch,/name: dsh-dafeiyu-life/)
})

test('README 前部讲生活系统并前置开源来源，不再堆版本流水账',()=>{
  const readme=read('README.md')
  assert.match(readme,/大肥鱼 · DSH 生活系统/)
  assert.match(readme,/先感谢这些开源项目/)
  assert.match(readme,/c1overzz\/dsh-bili-scroll/)
  assert.match(readme,/adoresever\/bilibili-mcp/)
  assert.match(readme,/Yuuyuko-uu\/dsh-fish-memory/)
  assert.match(readme,/Yuuyuko-uu\/dsh-bili-subagent/)
  assert.doesNotMatch(readme.slice(0,1800),/v2\.4\.7[0-6]/)
})

test('DSH 设置页直接展示开源来源和关系类型',()=>{
  const client=read('client.js')
  assert.match(client,/const tab = 'daily'/)
  assert.match(client,/开源来源与致谢/)
  assert.match(client,/直接上游与代码血缘基础/)
  assert.match(client,/内置 Python B站 MCP 的上游/)
  assert.match(client,/长期人格记忆的核心设计与部分实现来源/)
  assert.match(client,/架构思路给了重要启发/)
})

test('新备份格式写新品牌，无老用户时拒绝旧版无校验备份',async()=>{
  const mod=await import('../lib/data-backup.mjs')
  assert.equal(mod.FORMAT,'dsh-dafeiyu-life-backup')
  const bad={format:'dsh-bili-scroll-plus-backup',schema:1,config:{a:1},files:{'../../x':'bad'},sqlite:{}}
  assert.throws(()=>mod.validateBackup(bad),/格式版本不支持/)
})
