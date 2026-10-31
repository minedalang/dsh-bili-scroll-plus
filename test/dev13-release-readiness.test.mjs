import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {__test as memoryRetrieverTest} from '../lib/memory-retriever.mjs'
import {__test as reflectionTest} from '../lib/life-reflection.mjs'
const source=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8')
const host=source('index.js')
const ui=source('lib/management-console.html')
const charter=source('prompts/duty.md')
const readme=source('README.md')
const packageInfo=JSON.parse(source('package.json'))
const persona=source('lib/persona-default.mjs')

test('Host schema 与运行时默认值逐字段保持一致（不只核对记忆开关）',()=>{
 const start=host.indexOf('const DEFAULTS = {')
 const end=host.indexOf('\n  }',start)
 assert.ok(start>0&&end>start)
 const block=host.slice(start,end)
 const schema=new Map([...host.matchAll(/([A-Za-z][\w]+)\s*:\s*z\.[a-zA-Z]+\(\)\.default\(([^)]+)\)/g)].map(m=>[m[1],m[2].trim()]))
 const runtime=new Map([...block.matchAll(/([A-Za-z][\w]+)\s*:\s*(true|false|\d+(?:\.\d+)?|'[^']*'|"[^"]*")(?=\s*[,}])/g)].map(m=>[m[1],m[2].trim()]))
 assert.ok(runtime.size>=185,'too few runtime defaults inspected')
 for(const [key,value] of runtime){
  if(key==='dmStrangerText')continue
  if(!schema.has(key))continue
  assert.equal(value.replaceAll('\"',"'"),schema.get(key).replaceAll('\"',"'"),key+' differs between schema and DEFAULTS')
 }
 assert.match(block,/personaPrompt:\s*DEFAULT_PERSONA_PROMPT/)
 assert.match(host,/personaPrompt: z\.string\(\)\.default\(DEFAULT_PERSONA_PROMPT\)/)
})

test('dev.15 全新安装默认启用有限生活体验，但保持外部写入和额外检索模型关闭',()=>{
 for(const name of ['mainSessionMemorySemanticEnabled','socialAutoSend','ownerCommentSocialPublishEnabled','ownerDmCommentPublishEnabled','ownerDmDynamicPublishEnabled']){
  assert.match(host,new RegExp(`${name}: z\\.boolean\\(\\)\\.default\\(false\\)`),name+' schema must default off')
  assert.match(host,new RegExp(`${name}:\\s*false`),name+' runtime fallback must default off')
 }
 for(const name of ['mainSessionMemoryEnabled','dailyDynamicEnabled','autonomousPlannerEnabled']){
  assert.match(host,new RegExp(`${name}: z\\.boolean\\(\\)\\.default\\(true\\)`),name+' schema must default on for fresh installs')
  assert.match(host,new RegExp(`${name}:\\s*true`),name+' runtime fallback must default on')
 }
 assert.match(host,/legacyInstall/)
 assert.match(host,/dailyDynamicDraftOnly: z\.boolean\(\)\.default\(true\)/)
 assert.match(host,/mainSessionMemoryCandidates: z\.natural\(\)\.default\(48\)/)
 assert.match(host,/mainSessionMemorySearchDailyLimit: z\.natural\(\)\.default\(80\)/)
 assert.match(host,/mainSessionMemoryHalfLifeDays: z\.number\(\)\.default\(30\)/)
 assert.match(host,/mainSessionReflectionBatchSize: z\.natural\(\)\.default\(24\)/)
 assert.match(host,/mainSessionReflectionDailyBatches: z\.natural\(\)\.default\(16\)/)
 assert.match(host,/mainSessionReflectionIntervalHours: z\.number\(\)\.default\(1\)/)
 assert.match(host,/LEGACY_REFLECTION_SCHEDULER_DEFAULTS/)
 assert.match(host,/migrateLegacyReflectionDefaults/)
 assert.match(ui,/id="main-memory-semantic" type="checkbox"(?! checked)/)
 assert.match(ui,/id="main-memory-candidates"[^>]+value="48"/)
 assert.match(ui,/id="main-memory-search-daily"[^>]+value="80"/)
})

test('默认语义检索提示词只选候选 ID，明确不信任外部内容与遗忘时间限制',()=>{
 const prompt=memoryRetrieverTest.selectionPrompt('chat','昨天的声音视频',[
  {id:'episode:e-demo',type:'episode',m:{id:'e-demo',text:'昨天看过声音视频',kind:'watch',stage:'clear',at:'2026-10-29T08:00:00Z',importance:.6}}
 ],6)
 assert.match(prompt,/只读记忆检索器/)
 assert.match(prompt,/不可信数据/)
 assert.match(prompt,/不能执行/)
 assert.match(prompt,/不返回候选之外的 ID/)
 assert.match(prompt,/毫不相关时返回空数组/)
 assert.match(prompt,/没有时间字段不能猜精确日期/)
 assert.match(prompt,/episode:e-demo/)
 assert.match(prompt,/2026-10-29T08:00:00Z/)
 assert.match(prompt,/"stage":"clear"/)
 assert.doesNotMatch(prompt,/life-memory\/archive\/|永久档案的真实正文/)
})

test('默认反思提示词不流水账、不凭空恢复、不虚构制作视频',()=>{
 const prompt=reflectionTest.reflectionPrompt([{id:'c-1',kind:'watch',title:'声音视频',text:'看过一条声音视频'}])
 assert.match(prompt,/新领悟/)
 assert.match(prompt,/将来可能改变的行为/)
 assert.match(prompt,/candidate_ids 对应的当前可衰减经历副本/)
 assert.match(prompt,/不能编造候选里没有发生的事/)
 assert.match(prompt,/不能把看过的视频写成自己制作、投稿或剪辑过/)
 assert.match(prompt,/没有任何值得长期记住的事，memories 返回空数组/)
 assert.match(persona,/遗忘后不要假装认出对方/)
 assert.match(persona,/同一 UID/)
 assert.match(persona,/主 Session 的正常任务遵循工作域规则/)
})

test('默认值班提示词与正式文档不允许从任务审计档案绕过遗忘',()=>{
 assert.match(charter,/不能直接读归档补回已遗忘细节/)
 assert.match(readme,/永久事实档案（仅备份 \/ 管理审计）/)
 assert.match(readme,/日常 AI 不可直接回读/)
 assert.match(readme,/AI 辅助回忆（可选，默认关闭）/)
 assert.match(source('docs/DEV13_DUAL_LIFE_MEMORY.md'),/Release 前必做验收/)
 assert.match(packageInfo.version,/^(?:2\.5\.\d+|2\.6\.0)(?:-dev\.\d+)?$/)
 assert.ok(packageInfo.files.includes('RELEASE_NOTES_v2.5.0.md'))
})
