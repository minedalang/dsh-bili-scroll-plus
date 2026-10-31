import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLongTermMemory } from '../lib/long-term-memory.mjs'
import { createOwnerTodoEngine } from '../lib/owner-todos.mjs'

// A basic register(spec) mock accepts specs with no output. The real DSH
// registrar reads output.render immediately, so recreate that behavior here.
function rig(enabled) {
  const dataDir = mkdtempSync(join(tmpdir(), 'dafeiyu-tool-output-'))
  const warnings = [], tools = [], listeners = new Map()
  const session = { id: 'main', snapshotEvents: () => [{ type: 'user/message', data: { message: { content: '以后有空看看这个视频' } } }] }
  const agent = { id: 'main', session, ctx: {
    on(name, fn) { listeners.set(name, fn); return () => listeners.delete(name) },
    systemPrompt: { section() { return () => {} }, context() { return () => {} } },
    tools: { register(spec) {
      // These accesses reproduce the missing output.render startup error.
      assert.equal(spec.output.schema.type, 'object', `${spec.name} output schema is missing`)
      assert.equal(typeof spec.output.render, 'function', `${spec.name} render is missing`)
      assert.equal(Array.isArray(spec.output.render({}, { ok: true })), true)
      tools.push(spec)
      return () => {}
    } },
  } }
  const todos = createOwnerTodoEngine({ dataDir })
  const memory = createLongTermMemory({
    dataDir, dshHome: dataDir,
    agents: { get: () => agent, list: () => [agent] },
    getConfig: () => ({ mainSessionId: 'main', mainSessionMemoryEnabled: enabled }),
    defineTool: opts => opts,
    getExperienceRecall: () => [{kind: 'watch', day: '2026-10-26', bvid: 'BV19SJi6VEj1', summary: '读过字幕'}],
    getTodoEngine: () => todos,
    logger: { warn: message => warnings.push(String(message)) },
  })
  return { memory, tools, warnings, listeners, cleanup() { memory.stop(); rmSync(dataDir, { recursive: true, force: true }) } }
}

test('主 Session 关闭长期记忆也能在真实宿主式注册器中挂载五个工具', async () => {
  const r = rig(false)
  try {
    r.memory.start()
    const expected = ['dafeiyu_life_recall','dafeiyu_todo_list','dafeiyu_todo_add','dafeiyu_todo_update','dafeiyu_todo_execute']
    assert.deepEqual(r.tools.map(t => t.name), expected)
    assert.deepEqual(r.warnings, [])
    for(const tool of r.tools) {
      const rendered = tool.output.render({}, { ok:true, items:[] })
      assert.equal(rendered[0].type,'text')
      assert.deepEqual(JSON.parse(rendered[0].text), {ok:true,items:[]})
    }
    const recalled = await r.tools[0].execute({ query:'猫咪' })
    assert.equal(recalled.ok,true)
    assert.equal(recalled.experiences[0].summary,'读过字幕')
    const add = await r.tools[2].execute({ type:'watch_video', bvid:'BV19SJi6VEj1', title:'以后看看' })
    assert.equal(add.ok,true)
    assert.equal((await r.tools[1].execute({})).items.length, 1)
    const unauthorized = await r.tools[2].execute({ type:'like_video', bvid:'BV19SJi6VEj1' })
    assert.equal(unauthorized.ok,false)
  } finally { r.cleanup() }
})

test('开启长期记忆时两项已有记忆工具和五项新增工具均完整提供输出渲染', () => {
  const r = rig(true)
  try {
    r.memory.start()
    assert.deepEqual(r.tools.map(t => t.name), ['dafeiyu_remember','dafeiyu_memory_recall','dafeiyu_life_recall','dafeiyu_todo_list','dafeiyu_todo_add','dafeiyu_todo_update','dafeiyu_todo_execute'])
    assert.deepEqual(r.warnings, [])
    for(const tool of r.tools) assert.equal(typeof tool.output.render,'function',tool.name)
  } finally { r.cleanup() }
})
