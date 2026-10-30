import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { apply } from '../index.js'

function harness({ existing = null } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-lively-defaults-'))
  const state = join(root, 'bili-duty')
  if (existing !== null) {
    mkdirSync(state, { recursive: true })
    writeFileSync(join(state, 'config.json'), JSON.stringify(existing))
  }
  let handler
  const ctx = {
    get: k => k === 'dshHomePath' ? (...segments) => join(root, ...segments) : undefined,
    logger: { info() {}, warn() {} }, tools: { register() {} },
    webServer: { register(spec) { handler = spec.handler; return { dispose() {} } } },
    effect: fn => fn(), settings: { describe() { return [] } },
    slots: { register() {}, inject() {} },
  }
  apply(ctx, {})
  const config = async (body = null) => {
    const req = Readable.from(body ? [Buffer.from(JSON.stringify(body))] : [])
    req.method = body ? 'POST' : 'GET'
    req.url = '/api/bili-duty/config'
    req.headers = { host: 'localhost' }
    let status, output
    const res = { writeHead(n) { status = n }, end(x) { output = JSON.parse(x) } }
    await handler(req, res)
    assert.equal(status, 200)
    return output.config
  }
  return { root, config, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('全新安装生动默认：开启本地记忆、限额只读计划和纯草稿，但不自动公开', async () => {
  const x = harness()
  try {
    const c = await x.config()
    assert.equal(c.mainSessionMemoryEnabled, true)
    assert.equal(c.mainSessionReflectionAuto, true)
    assert.equal(c.mainSessionMemorySemanticEnabled, false)
    assert.equal(c.mainSessionMemoryMaxItems, 8)
    assert.equal(c.mainSessionMemoryMaxChars, 1200)
    assert.equal(c.emotionSystemEnabled, true)
    assert.equal(c.autonomousPlannerEnabled, true)
    assert.equal(c.autonomousPlannerDailyLimit, 4)
    assert.equal(c.autonomousPlannerMinutes, 180)
    assert.equal(c.dailyDynamicEnabled, true)
    assert.equal(c.dailyDynamicDraftOnly, true)
    assert.equal(c.dailyDynamicDailyLimit, 1)
    for (const key of [
      'ownerCommentAgentEnabled', 'ownerCommentSocialPublishEnabled', 'ownerCommentNaturalAckEnabled',
      'commentAtEnabled', 'socialOutreachEnabled', 'socialAutoSend', 'emotionRecallMainEnabled',
      'emotionRecallDmEnabled', 'ownerDmActionsEnabled', 'autoComment', 'autoVideoLike',
      'autoVideoCollect', 'agentFollowEnabled', 'visionEnabled', 'commentMemesEnabled',
      'dmStrangerOnce', 'mainSessionBridgeEnabled', 'ownerTodoAutoReviewEnabled',
    ]) assert.equal(c[key], false, `未经授权的默认开关: ${key}`)
  } finally { x.cleanup() }
})

test('历史配置即使缺少新增字段，也不被新默认偷偷打开；显式关闭会被保存', async () => {
  const x = harness({ existing: { mainSessionMemoryEnabled: false, dmWatch: false } })
  try {
    let c = await x.config()
    assert.equal(c.mainSessionMemoryEnabled, false)
    assert.equal(c.autonomousPlannerEnabled, false)
    assert.equal(c.dailyDynamicEnabled, false)
    assert.equal(c.autonomousPlannerDailyLimit, 24)
    assert.equal(c.autonomousPlannerMinutes, 30)
    assert.equal(c.mainSessionMemoryMaxItems, 6)
    assert.equal(c.mainSessionMemoryMaxChars, 800)
    assert.equal(c.dmWatch, false)
    c = await x.config({ mainSessionMemoryEnabled: true, dailyDynamicEnabled: true })
    assert.equal(c.mainSessionMemoryEnabled, true)
    assert.equal(c.dailyDynamicEnabled, true)
    assert.equal(c.autonomousPlannerEnabled, false)
    assert.equal(JSON.parse(readFileSync(join(x.root, 'bili-duty', 'config.json'))).autonomousPlannerEnabled, false)
  } finally { x.cleanup() }
})

test('新装也可直接关掉生动功能，所有公开发布保持独立授权', async () => {
  const x = harness()
  try {
    const c = await x.config({mainSessionMemoryEnabled:false, autonomousPlannerEnabled:false, dailyDynamicEnabled:false})
    assert.equal(c.mainSessionMemoryEnabled, false)
    assert.equal(c.autonomousPlannerEnabled, false)
    assert.equal(c.dailyDynamicEnabled, false)
    assert.equal(c.dailyDynamicDraftOnly, true)
    assert.equal(c.ownerCommentSocialPublishEnabled, false)
  } finally { x.cleanup() }
})
