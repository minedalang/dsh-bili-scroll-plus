import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HEADLESS_DENY_TOOLS, writeSecureHeadlessOverlay, assertSafeHeadlessLaunch } from '../lib/headless-security.mjs'
import { effectiveModelSelection } from '../lib/model-routing.mjs'

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8')

test('人生反思拥有独立模型配置并通过专用无工具 headless overlay 路由', () => {
  const html = read('lib/management-console.html')
  const ui = read('lib/management-console.js')
  const index = read('index.js')
  assert.match(html, /id="models-reflection"/)
  assert.match(html, /人生反思与经历提炼/)
  assert.match(ui, /\['reflection','mainSessionReflectionModelProvider','mainSessionReflectionModelId','mainSessionReflectionReasoningEffort'\]/)
  for (const key of ['mainSessionReflectionModelProvider','mainSessionReflectionModelId','mainSessionReflectionReasoningEffort']) {
    assert.match(index, new RegExp(key))
  }
  assert.match(index, /invokeInteractionPrompt\(prompt,maxChars,\{\.\.\.opt,modelRoute:'reflection'\}\)/)
  assert.match(index, /ensureOverlay\(true, reflectionRoute \? 'reflection' : dynamicRoute \? 'dailyDynamic' : ownerAgentRoute \? 'ownerDmAgent' : 'interaction'\)/)

  const dir = mkdtempSync(join(tmpdir(), 'dafeiyu-v2487-reflection-overlay-'))
  try {
    const yq = value => "'" + String(value).replace(/'/g, "''") + "'"
    const rows = [
      ...HEADLESS_DENY_TOOLS.flatMap(id => ['- id: ' + id, '  disabled: true', '']),
      ...['credentials','authorization','deepseek-account'].flatMap(id => ['- id: ' + id, '  disabled: false', '']),
      ...effectiveModelSelection({provider:'provider-x',model:'model-y'}, {provider:'provider-z',model:'reflector',reasoningEffort:'medium'}, yq),
    ]
    const file = join(dir, 'headless-reflection-overlay.yml')
    writeSecureHeadlessOverlay(file, rows.join('\n'), {kind:'reflection',stateDir:dir})
    assertSafeHeadlessLaunch(['dsh','--profile','headless','--patch',file],file,{kind:'reflection',stateDir:dir})
    assert.match(readFileSync(file,'utf8'), /model: 'reflector'/)
    assert.doesNotMatch(readFileSync(file,'utf8'), /mcp-bili-duty|^\\s*- id: tool-bash\\s*\\n\\s*disabled: false/m)
  } finally {
    rmSync(dir,{recursive:true,force:true})
  }
})

test('当前附加到提示词的只读预览不再显示搜索框或绑定搜索逻辑', () => {
  const html = read('lib/management-console.html')
  const js = read('lib/management-console.js')
  assert.match(html, /当前附加到提示词的内容（只读）/)
  assert.doesNotMatch(html, /growth-preview-query|growth-preview-apply|growth-preview-reset/)
  assert.doesNotMatch(js, /growthPreviewQuery|growth-preview-query|growth-preview-apply|growth-preview-reset/)
  assert.match(js, /const data=await request\('\/persona-growth'\)/)
})

test('记忆流向简明呈现，反思和汇报各自独立且不干扰可用记忆', () => {
  const html = read('lib/management-console.html')
  const js = read('lib/management-console.js')
  assert.match(html, /一段经历，怎样变成鱼鱼的记忆/)
  assert.match(html, /真实发生/)
  assert.match(html, /现在还记得/)
  assert.match(html, /留下体会/)
  assert.match(html, /原始记录独立封存/)
  assert.match(html, /<details class="memory-reflection-details"/)
  assert.match(html, /id="main-reflection-status"/)
  assert.match(html, /待汇报队列/)
  assert.match(html, /不直接写入人生记忆；人生反思会独立读取待反思经历/)
  assert.match(js, /待反思 .* 已关联长期记忆/)
  assert.match(js, /累计评估后未沉淀/)
  assert.match(js, /因经历已遗忘跳过/)
})
