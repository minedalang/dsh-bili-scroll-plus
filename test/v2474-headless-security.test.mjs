import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  HEADLESS_DENY_TOOLS, validateHeadlessOverlayText, validateHeadlessOverlayFile,
  writeSecureHeadlessOverlay, assertSafeHeadlessLaunch,
} from '../lib/headless-security.mjs'

function base(kind='main') {
  const rows=[]
  for (const id of HEADLESS_DENY_TOOLS) rows.push('- id: '+id,'  disabled: true','')
  for (const id of ['credentials','authorization','deepseek-account']) rows.push('- id: '+id,'  disabled: false','')
  if (kind==='main') rows.push('- insert:','    - id: mcp-bili-duty',"      name: '@deepseek-ai/dsh-mcp-client'",'      config:','        serverName: bili-duty','        transport: stdio','        env:',"          BILI_MCP_TOOLS: 'bili_search,bili_comments'",'')
  if (kind==='vision') rows.push('- insert:','    - id: mcp-bili-vision-readonly',"      name: '@deepseek-ai/dsh-mcp-client'",'      config:','        serverName: bilivision','        transport: stdio','        env:',"          BILI_MCP_TOOLS: 'bili_preview_vision'",'')
  return rows.join('\n')
}

test('all three generated overlay shapes validate',()=>{
  assert.equal(validateHeadlessOverlayText(base('main'),'main').denied,HEADLESS_DENY_TOOLS.length)
  assert.equal(validateHeadlessOverlayText(base('dm'),'dm').denied,HEADLESS_DENY_TOOLS.length)
  assert.equal(validateHeadlessOverlayText(base('vision'),'vision').denied,HEADLESS_DENY_TOOLS.length)
})

test('a single re-enabled workstation tool fails closed',()=>{
  const text=base('main').replace('- id: tool-fs\n  disabled: true','- id: tool-fs\n  disabled: false')
  assert.throws(()=>validateHeadlessOverlayText(text,'main'),/tool-fs/)
})

test('DM overlay cannot accidentally receive MCP tools',()=>{
  assert.throws(()=>validateHeadlessOverlayText(base('main'),'dm'),/非预期插件/)
})

test('secure writer replaces an existing symlink instead of following it',()=>{
  const dir=mkdtempSync(join(tmpdir(),'v2474-overlay-'))
  try {
    const victim=join(dir,'victim.txt'); writeFileSync(victim,'KEEP','utf8')
    const out=join(dir,'headless-overlay.yml')
    try { symlinkSync(victim,out,'file') } catch { return } // Windows without symlink privilege
    writeSecureHeadlessOverlay(out,base('main'),{kind:'main',stateDir:dir})
    assert.equal(readFileSync(victim,'utf8'),'KEEP')
    assert.equal(validateHeadlessOverlayFile(out,{kind:'main',stateDir:dir}).ok,true)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('launch guard fixes profile and exact patch path',()=>{
  const dir=mkdtempSync(join(tmpdir(),'v2474-launch-'))
  try {
    const out=join(dir,'headless-dm-overlay.yml')
    writeSecureHeadlessOverlay(out,base('dm'),{kind:'dm',stateDir:dir})
    assert.equal(assertSafeHeadlessLaunch(['bin.js','--profile','headless','--patch',out,'hello'],out,{kind:'dm',stateDir:dir}),true)
    assert.throws(()=>assertSafeHeadlessLaunch(['bin.js','--profile','custom','--patch',out],out,{kind:'dm',stateDir:dir}),/固定使用/)
    assert.throws(()=>assertSafeHeadlessLaunch(['bin.js','--profile','headless','--patch',out,'--patch',out],out,{kind:'dm',stateDir:dir}),/只能带一个/)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('actual source auto-generates main and DM overlays and fixes automated profile to headless',()=>{
  const code=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(code,/mainOverlayAtBoot=ensureOverlay\(false\)/)
  assert.match(code,/dmOverlayAtBoot=ensureOverlay\(true\)/)
  assert.match(code,/const args = \[\.\.\.dsh\.args, '--profile', 'headless'\]/)
  assert.match(code,/const args = \[\.\.\.dsh\.args, '--profile', 'headless', '--patch', overlay, promptText\]/)
  assert.match(code,/assertSafeHeadlessLaunch\(args,overlay,\{kind:'main',stateDir\}\)/)
  assert.match(code,/assertSafeHeadlessLaunch\(args,overlay,\{kind:reflectionRoute\?'reflection':dynamicRoute\?'dailyDynamic':ownerAgentRoute\?'ownerDmAgent':'dm',stateDir\}\)/)
})
