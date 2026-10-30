import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

// Automated Bilibili agents never need the workstation-wide DSH tool surface.
// Keep this list explicit: a missing/false entry makes the generated overlay invalid.
export const HEADLESS_DENY_TOOLS = Object.freeze([
  'tool-bash','tool-pwsh','tool-terminal','tool-bash-persistent','tool-pwsh-persistent','tool-jobs',
  'tool-fs','tool-fs-search','tool-working-directory','tool-str-replace-editor',
  'tool-web','web-fetch-http','tool-web-search','tool-browser',
  'tool-subagent','tool-subagent-fork','tool-subagent-control','tool-subagent-list-agents',
  'tool-workflow','workflow-ptc','tool-skill','skill','skill-filesystem',
  'tool-plugin-manager','plugin-manager','goal','goal-round-driver','tool-goal',
  'tool-session-query','tool-cordis','tool-ralph','tool-ask-user','tool-present','tool-todo',
  'tool-lsp','tool-workspace-dependencies','agent-instructions','session-reference',
  'file-reference-local','file-reference','tool-ptc','tool-cua','cua','tool-execute','tool-process',
  'tool-python','tool-code','tool-ripgrep',
])

const EXPECTED_NAME = Object.freeze({
  main: 'headless-overlay.yml',
  dm: 'headless-dm-overlay.yml',
  memory: 'headless-memory-overlay.yml',
  reflection: 'headless-reflection-overlay.yml',
  dailyDynamic: 'headless-daily-dynamic-overlay.yml',
  ownerDmAgent: 'headless-owner-dm-agent-overlay.yml',
  vision: 'headless-vision-overlay.yml',
  'model-test': 'headless-model-test-overlay.yml',
})

function toolStates(text) {
  const states = new Map()
  const lines = String(text).replace(/\r/g, '').split('\n')
  let current = ''
  for (const line of lines) {
    const m = /^- id:\s*([^\s#]+)\s*$/.exec(line)
    if (m) { current = m[1]; continue }
    const d = /^\s{2}disabled:\s*(true|false)\s*(?:#.*)?$/.exec(line)
    if (current && d) { states.set(current, d[1] === 'true'); current = '' }
    else if (line && !/^\s/.test(line) && !/^#/.test(line)) current = ''
  }
  return states
}

function requireText(text, pattern, message) {
  if (!pattern.test(text)) throw new Error(message)
}

export function validateHeadlessOverlayText(text, kind = 'main') {
  text = String(text || '')
  if (!EXPECTED_NAME[kind]) throw new Error('未知 headless overlay 类型')
  if (!text || Buffer.byteLength(text, 'utf8') > 160_000) throw new Error('headless overlay 为空或过大')
  // The generated patch language is intentionally tiny. Reject any extra top-level
  // mutation directive and any inserted plugin other than the one expected for this mode.
  for (const line of text.replace(/\r/g,'').split('\n')) {
    if (/^- /.test(line) && !/^- (?:id:|insert:\s*$)/.test(line)) throw new Error('headless overlay 含未知顶层 patch 指令')
  }
  const inserted=[...text.matchAll(/^\s{4}- id:\s*([^\s#]+)\s*$/gm)].map(m=>m[1])
  const allowedInserted = kind==='main' ? ['mcp-bili-duty'] : (kind==='vision' ? ['mcp-bili-vision-readonly'] : [])
  if (inserted.length !== allowedInserted.length || inserted.some((id,i)=>id!==allowedInserted[i])) {
    throw new Error('headless overlay 插入了非预期插件：'+(inserted.join(', ')||'（无）'))
  }

  const states = toolStates(text)
  const allowedTop = new Set([...HEADLESS_DENY_TOOLS,'credentials','authorization','deepseek-account','agent-default-model'])
  for (const id of states.keys()) if (!allowedTop.has(id)) throw new Error('headless overlay 修改了非预期服务：'+id)
  const missing = HEADLESS_DENY_TOOLS.filter((id) => states.get(id) !== true)
  if (missing.length) throw new Error('headless 安全隔离缺少禁用项：' + missing.slice(0, 8).join(', '))

  // These services are required only to let the selected account/model route work;
  // none of them exposes a model-facing filesystem/shell tool by itself.
  for (const id of ['credentials','authorization','deepseek-account']) {
    if (states.get(id) !== false) throw new Error('headless 模型登录服务配置不完整：' + id)
  }

  if (kind === 'main') {
    requireText(text, /^\s{4}- id:\s*mcp-bili-duty\s*$/m, '主 overlay 缺少 mcp-bili-duty')
    requireText(text, /^\s{8}serverName:\s*bili-duty\s*$/m, '主 overlay 的 MCP serverName 异常')
    requireText(text, /^\s{10}BILI_MCP_TOOLS:\s*'[^']*'\s*$/m, '主 overlay 缺少 MCP 工具白名单')
  } else if (kind === 'dm' || kind === 'memory' || kind === 'reflection' || kind === 'dailyDynamic' || kind === 'ownerDmAgent' || kind === 'model-test') {
    if (/^\s{4}- id:\s*mcp-/m.test(text) || /^\s*- insert:\s*$/m.test(text)) {
      throw new Error('互动 overlay 不应挂载任何 MCP 工具')
    }
  } else if (kind === 'vision') {
    requireText(text, /^\s{4}- id:\s*mcp-bili-vision-readonly\s*$/m, '视觉 overlay 缺少只读视觉 MCP')
    requireText(text, /^\s{8}serverName:\s*bilivision\s*$/m, '视觉 overlay 的 MCP serverName 异常')
    requireText(text, /^\s{10}BILI_MCP_TOOLS:\s*'bili_preview_vision'\s*$/m, '视觉 overlay 工具白名单必须只有 bili_preview_vision')
  }
  return { ok: true, kind, denied: HEADLESS_DENY_TOOLS.length }
}

export function validateHeadlessOverlayFile(file, { kind = 'main', stateDir = '' } = {}) {
  const expected = EXPECTED_NAME[kind]
  if (!expected) throw new Error('未知 headless overlay 类型')
  if (basename(file) !== expected) throw new Error(`overlay 文件名异常：期望 ${expected}`)
  if (stateDir && resolve(dirname(file)) !== resolve(stateDir)) throw new Error('overlay 必须位于插件家目录')
  let st
  try { st = lstatSync(file) } catch { throw new Error('安全 overlay 不存在：' + file) }
  if (st.isSymbolicLink() || !st.isFile()) throw new Error('安全 overlay 不能是符号链接或非普通文件')
  if (st.size <= 0 || st.size > 160_000) throw new Error('安全 overlay 文件大小异常')
  const text = readFileSync(file, 'utf8')
  return validateHeadlessOverlayText(text, kind)
}

/**
 * Write a generated overlay without ever following an existing symlink.
 * The file is disposable runtime state: generate -> validate -> replace -> validate again.
 */
export function writeSecureHeadlessOverlay(file, text, { kind = 'main', stateDir = '' } = {}) {
  const expected = EXPECTED_NAME[kind]
  if (!expected || basename(file) !== expected) throw new Error('拒绝写入未知的 headless overlay 路径')
  if (stateDir && resolve(dirname(file)) !== resolve(stateDir)) throw new Error('拒绝在插件家目录外写入 overlay')
  mkdirSync(dirname(file), { recursive: true })
  validateHeadlessOverlayText(text, kind)

  try {
    const st = lstatSync(file)
    if (st.isSymbolicLink() || !st.isFile()) rmSync(file, { force: true })
  } catch { /* first install */ }

  const temp = file + '.' + process.pid + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temp, text, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    try { chmodSync(temp, 0o600) } catch { /* Windows ACL/permission model differs */ }
    validateHeadlessOverlayText(readFileSync(temp, 'utf8'), kind)
    // Runtime overlays are regenerated, so removing the previous regular file is safe.
    // rmSync on a symlink removes the link itself, never the target.
    try { rmSync(file, { force: true }) } catch { /* rename below reports a useful error */ }
    renameSync(temp, file)
    try { chmodSync(file, 0o600) } catch { /* best effort on Windows */ }
    validateHeadlessOverlayFile(file, { kind, stateDir })
    return file
  } finally {
    try { rmSync(temp, { force: true }) } catch { /* no-op */ }
  }
}

export function assertSafeHeadlessLaunch(args, overlay, { kind = 'main', stateDir = '' } = {}) {
  if (!Array.isArray(args)) throw new Error('DSH 启动参数无效')
  const profiles = args.reduce((a,v,i)=>v==='--profile'?[...a,i]:a,[])
  const patches = args.reduce((a,v,i)=>v==='--patch'?[...a,i]:a,[])
  if (profiles.length !== 1 || patches.length !== 1) throw new Error('DSH 自动任务必须且只能带一个 --profile 和一个 --patch')
  if (args[profiles[0] + 1] !== 'headless') throw new Error('DSH 自动任务固定使用受控 headless profile')
  if (resolve(String(args[patches[0] + 1] || '')) !== resolve(overlay)) throw new Error('DSH 自动任务的 overlay 参数不匹配')
  validateHeadlessOverlayFile(overlay, { kind, stateDir })
  return true
}
