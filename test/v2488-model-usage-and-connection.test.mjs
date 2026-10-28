import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync,existsSync,symlinkSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {recordModelTask,readModelTaskUsage,MODEL_TASKS} from '../lib/model-task-usage.mjs'
import {HEADLESS_DENY_TOOLS,writeSecureHeadlessOverlay,assertSafeHeadlessLaunch} from '../lib/headless-security.mjs'
import {allowedPath} from '../lib/data-backup.mjs'
const read=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8')

test('六种模型任务写入独立计数，重复任务多次计数，未产生过的任务显示暂无记录',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-v2488-'))
  try{
    const now=new Date(2026,9,27,10,0,0)
    for(const task of MODEL_TASKS)assert.equal(recordModelTask(dir,task,now),true)
    recordModelTask(dir,'video',new Date(2026,9,27,10,5,0))
    const r=readModelTaskUsage(dir,new Date(2026,9,27,11,0,0))
    assert.equal(r.tasks.video.today,2)
    assert.equal(r.tasks.reflection.today,1)
    assert.equal(r.tasks.memory.today,1)
    assert.equal(r.tasks.video.lastAt,new Date(2026,9,27,10,5,0).toISOString())
    assert.throws(()=>recordModelTask(dir,'unsupported',now),/未知模型任务/)
    assert.equal(readModelTaskUsage(mkdtempSync(join(tmpdir(),'dafeiyu-empty-')),now).tasks.video.today,0)
    assert.ok(!readFileSync(join(dir,'model-usage','2026-10.jsonl'),'utf8').includes('secret'))
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('跨天自动归零、跨月保留上次调用时间、跨年也可回溯',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-v2488-'))
  try{
    recordModelTask(dir,'interaction',new Date(2025,11,31,23,59,0))
    recordModelTask(dir,'video',new Date(2026,0,1,8,0,0))
    const r=readModelTaskUsage(dir,new Date(2026,0,1,9,0,0))
    assert.equal(r.day,'2026-01-01')
    assert.equal(r.tasks.interaction.today,0)
    assert.equal(r.tasks.interaction.lastAt,new Date(2025,11,31,23,59,0).toISOString())
    assert.equal(r.tasks.video.today,1)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('拒绝将统计写入符号链接，业务备份包含统计账本但不允许任意路径',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-v2488-'))
  try {
    const target=mkdtempSync(join(tmpdir(),'dafeiyu-v2488-target-'))
    try {
      symlinkSync(target,join(dir,'model-usage'),process.platform==='win32'?'junction':'dir')
      assert.equal(recordModelTask(dir,'video'),false)
      assert.equal(existsSync(join(target,'2026-10.jsonl')),false)
    } finally {rmSync(target,{recursive:true,force:true})}
    assert.equal(allowedPath('model-usage/2026-10.jsonl'),true)
    assert.equal(allowedPath('model-usage/../../config.json'),false)
    assert.equal(allowedPath('model-usage/secret.json'),false)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('模型测试的安全 overlay 禁止全部文件、Shell、B站和其他 MCP 工具',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-v2488-'))
  try {
    const text=[...HEADLESS_DENY_TOOLS.flatMap(id=>['- id: '+id,'  disabled: true','']),...['credentials','authorization','deepseek-account'].flatMap(id=>['- id: '+id,'  disabled: false',''])].join('\n')
    const path=join(dir,'headless-model-test-overlay.yml')
    writeSecureHeadlessOverlay(path,text,{kind:'model-test',stateDir:dir})
    assertSafeHeadlessLaunch(['dsh','--profile','headless','--patch',path],path,{kind:'model-test',stateDir:dir})
    assert.throws(()=>writeSecureHeadlessOverlay(path,text+'\n- insert:\n    - id: mcp-bili-duty\n',{kind:'model-test',stateDir:dir}),/不应挂载任何 MCP 工具|插入了非预期插件/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})

test('页面每个模型都有调用统计和独立测试按钮，测试请求不记入正常任务次数',()=>{
  const html=read('lib/management-console.html'),ui=read('lib/management-console.js'),server=read('index.js')
  for(const t of MODEL_TASKS){
    assert.match(html,new RegExp('id="models-'+t+'-usage"'))
    assert.match(html,new RegExp('id="models-'+t+'-test"'))
    assert.match(html,new RegExp('id="models-'+t+'-test-result"'))
  }
  assert.match(ui,/await request\('\/model-usage'\)/)
  assert.match(ui,/await request\('\/model-test',\{task\}\)/)
  assert.match(server,/path === '\/api\/bili-duty\/model-test'/)
  assert.match(server,/path === '\/api\/bili-duty\/model-usage'/)
  const start=server.indexOf('async function testConfiguredModel('),end=server.indexOf('async function invokeMemoryPrompt(',start)
  const testing=server.slice(start,end)
  assert.doesNotMatch(testing,/recordModelTask\(/)
  assert.match(testing,/modelTestNextAt/)
  assert.match(testing,/assertSafeHeadlessLaunch\(args,overlay,\{kind:'model-test',stateDir\}\)/)
  assert.match(testing,/DAFEIYU_MODEL_TEST_OK/)
  assert.match(html,/独立视觉的测试只验证文字连接/)
  assert.match(html,/测试连接不计入统计/)
})

test('视频、互动、反思、记忆检索和表情包规则优化均在调用链路记录；Python 子进程也记录',()=>{
  const server=read('index.js'),mcp=read('vendor/bilibili-mcp/mcp_server.py'),vision=read('lib/vision_dsh.py')
  for(const expr of ["recordModelTask(stateDir,'video')","recordModelTask(stateDir,'memory')","recordModelTask(stateDir,reflectionRoute?'reflection':'interaction')"])assert.ok(server.includes(expr))
  assert.match(mcp,/_record_model_launch\(home, 'memory'\)/)
  assert.match(vision,/_record_model_launch\(home, 'vision'\)/)
  assert.match(server,/readModelTaskUsage\(stateDir\)/)
})
