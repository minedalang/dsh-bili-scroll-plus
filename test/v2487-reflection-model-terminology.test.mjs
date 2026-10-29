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
  assert.match(index, /ensureOverlay\(true, reflectionRoute \? 'reflection' : dynamicRoute \? 'dailyDynamic' : 'interaction'\)/)

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

test('经历记录、待反思经历、待汇报经历和人生记忆在界面中明确区分', () => {
  const html = read('lib/management-console.html')
  const js = read('lib/management-console.js')
  assert.match(html, /经历记录 · 原始事实/)
  assert.match(html, /待反思经历 · 等待 AI 分析/)
  assert.match(html, /人生记忆 · 长期保留/)
  assert.match(html, /待汇报队列/)
  assert.match(html, /是否发送给主 Session，不影响反思/)
  assert.match(js, /待反思经历 .* 已反思并关联长期记忆/)
})
