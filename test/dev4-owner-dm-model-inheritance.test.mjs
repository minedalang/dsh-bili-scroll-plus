import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { effectiveModelSelection } from '../lib/model-routing.mjs'

test('主人私信 Agent 运行路由与连接测试一致：独立模型为空时继承后台互动模型', () => {
  const server = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const begin = server.indexOf('const ensureOverlay =')
  const end = server.indexOf('const mainOverlayAtBoot', begin)
  assert.ok(begin > 0 && end > begin)
  const runtime = server.slice(begin, end)
  assert.match(runtime, /prefix === 'ownerDmAgent'/)
  assert.match(runtime, /cfg\.ownerDmAgentModelProvider\s*\|\|\s*cfg\.interactionModelProvider/)
  assert.match(runtime, /cfg\.ownerDmAgentModelId\s*\|\|\s*cfg\.interactionModelId/)
  assert.match(runtime, /cfg\.ownerDmAgentReasoningEffort\s*\|\|\s*cfg\.interactionReasoningEffort/)
  const rows = effectiveModelSelection(null, { provider: 'configured-interaction-provider', model: 'configured-interaction-model' })
  assert.ok(rows.includes('    provider: "configured-interaction-provider"'))
  assert.ok(rows.includes('    model: "configured-interaction-model"'))
})
