import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HEADLESS_DENY_TOOLS, writeSecureHeadlessOverlay, assertSafeHeadlessLaunch } from '../lib/headless-security.mjs'

// Regression: generating the correct filename isn't enough. The write call must
// pass the matching 'ownerDmAgent' kind or the security guard refuses the file.
test('主人私信 Agent 创建专用 overlay 时使用 ownerDmAgent 安全类型', () => {
  const source = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const mapping = source.match(/const overlayKind\s*=\s*([^\n]+)/)
  assert.ok(mapping, '未找到 ensureOverlay 的安全类型映射')
  assert.match(mapping[1], /modelPrefixOverride\s*===\s*'ownerDmAgent'\s*\?\s*'ownerDmAgent'/)
  assert.match(source, /headless-owner-dm-agent-overlay\.yml/)
})

test('主人私信 Agent overlay 严格隔离工具，文件名与安全类型必须一致', () => {
  const dir = mkdtempSync(join(tmpdir(), 'owner-dm-overlay-regression-'))
  try {
    const file = join(dir, 'headless-owner-dm-agent-overlay.yml')
    const text = [
      ...HEADLESS_DENY_TOOLS.flatMap(id => [`- id: ${id}`, '  disabled: true', '']),
      ...['credentials', 'authorization', 'deepseek-account'].flatMap(id => [`- id: ${id}`, '  disabled: false', '']),
    ].join('\n')
    assert.throws(() => writeSecureHeadlessOverlay(file, text, { kind: 'dm', stateDir: dir }), /拒绝写入未知的 headless overlay 路径/)
    writeSecureHeadlessOverlay(file, text, { kind: 'ownerDmAgent', stateDir: dir })
    assertSafeHeadlessLaunch(['dsh', '--profile', 'headless', '--patch', file], file, { kind: 'ownerDmAgent', stateDir: dir })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
