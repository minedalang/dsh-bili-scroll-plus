/**
 * Resolve a DSH executable without passing external prompts through a shell.
 *
 * Windows Desktop's dsh.cmd is a batch shim, not a Win32 executable. Node's
 * spawn(..., {shell:false}) fails with EINVAL on recent Windows/Node versions.
 * Never set shell:true: prompts can contain untrusted Bilibili text.
 * Instead use the documented Desktop native Electron + CLI dispatcher entry.
 */
import { existsSync } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'

export function makeSafeDshLaunch(file, {
  platform = process.platform,
  nodeExecutable = process.execPath,
  pathExists = existsSync,
} = {}) {
  const input = String(file || '').trim()
  if (!input) return { missing: true, hint: 'DSH CLI 路径为空' }
  const ext = extname(input).toLowerCase()
  if (platform === 'win32' && (ext === '.cmd' || ext === '.bat')) {
    const norm = input.replace(/\\/g, '/').toLowerCase()
    if (!norm.endsWith('/resources/runtime/cli/bin/dsh.cmd')) {
      return { missing: true, hint: '不能把 .cmd/.bat 作为 Node 子进程直接执行；请配置 DSH 的原生 .exe 或实际 .js 入口。禁止用 shell:true 传递视频或聊天文本。' }
    }
    // Official Desktop layout: <install>/resources/runtime/cli/bin/dsh.cmd
    const root = resolve(dirname(input), '..', '..', '..', '..')
    const exe = join(root, 'DeepSeek Harness.exe')
    const resource = join(root, 'resources')
    const asar = join(resource, 'app.asar')
    const entry = join(asar, 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')
    // From the Electron Host, existsSync() supports ASAR paths; checking the
    // archive itself also supports environments without ASAR filesystem hooks.
    if (!pathExists(exe) || !(pathExists(entry) || pathExists(asar))) {
      return { missing: true, hint: '已找到 Desktop dsh.cmd，但未能确认匹配的 Electron 程序或 CLI 入口：' + exe + ' / ' + entry + '。请检查 Desktop 安装或升级。' }
    }
    return {
      command: exe,
      args: ['--expose-internals', entry],
      shell: false,
      env: { ELECTRON_RUN_AS_NODE: '1' },
      source: 'desktop-native',
    }
  }
  if (ext === '.exe') return { command: input, args: [], shell: false }
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
    return { command: nodeExecutable, args: [input], shell: false }
  }
  if (platform === 'win32' && (ext === '.ps1' || ext === '.com')) {
    return { missing: true, hint: 'DSH CLI 需要可直接执行的 .exe 或 JS 入口，不支持将 PowerShell/批处理脚本当作可执行文件' }
  }
  if (platform === 'win32') {
    return { missing: true, hint: 'Windows 上未识别的 DSH CLI 入口：' + input + '。请使用 Desktop 自带的 dsh.cmd 或真实 .exe/.js。' }
  }
  // POSIX CLI scripts can be executable directly (shebang).
  return { command: input, args: [], shell: false }
}
