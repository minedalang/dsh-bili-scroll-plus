import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeSafeDshLaunch } from '../lib/dsh-launcher.mjs'

function fakeDesktop() {
  const root=mkdtempSync(join(tmpdir(),'fish-dsh-windows-'))
  const bin=join(root,'resources','runtime','cli','bin')
  const asar=join(root,'resources','app.asar')
  const entry=join(asar,'dsh','node_modules','@deepseek-ai','dsh-desktop-host','lib','cli.js')
  mkdirSync(bin,{recursive:true})
  mkdirSync(join(entry,'..'),{recursive:true})
  const shim=join(bin,'dsh.cmd')
  const exe=join(root,'DeepSeek Harness.exe')
  writeFileSync(shim,'@echo off\r\n')
  writeFileSync(exe,'placeholder')
  writeFileSync(entry,'// stub')
  return {root,shim,exe,entry}
}

test('Windows Desktop dsh.cmd must be resolved to native Electron CLI rather than spawned as a .cmd',()=>{
  const fx=fakeDesktop()
  try{
    const launch=makeSafeDshLaunch(fx.shim,{platform:'win32'})
    assert.equal(launch.missing,undefined)
    assert.equal(launch.command,fx.exe)
    assert.deepEqual(launch.args,['--expose-internals',fx.entry])
    assert.equal(launch.shell,false)
    assert.equal(launch.env.ELECTRON_RUN_AS_NODE,'1')
    // External text stays an argument, never part of a cmd.exe command string.
    const unsafe='有人评论：“你们 & del /q * | echo 偷偷执行”'
    const argv=[...launch.args,'--profile','headless',unsafe]
    assert.equal(argv.at(-1),unsafe)
    assert.ok(!argv.some(x=>x==='cmd.exe'||x==='/c'))
  }finally{rmSync(fx.root,{recursive:true,force:true})}
})

test('unrecognized .cmd/.bat fails closed, rather than silently re-enabling shell command injection',()=>{
  for(const f of ['C:\\temp\\dsh.cmd','C:\\temp\\dsh.bat']){
    const launch=makeSafeDshLaunch(f,{platform:'win32'})
    assert.equal(launch.missing,true)
    assert.match(launch.hint,/shell:true|批处理/)
  }
  assert.equal(makeSafeDshLaunch('C:\\x\\headless.ps1',{platform:'win32'}).missing,true)
  assert.equal(makeSafeDshLaunch('C:\\x\\dsh',{platform:'win32'}).missing,true)
})

test('normal executable and JS CLI preserve direct non-shell behavior',()=>{
  assert.deepEqual(makeSafeDshLaunch('C:\\dsh.exe',{platform:'win32'}),{command:'C:\\dsh.exe',args:[],shell:false})
  assert.deepEqual(makeSafeDshLaunch('C:\\cli.js',{platform:'win32',nodeExecutable:'C:\\node.exe'}),{command:'C:\\node.exe',args:['C:\\cli.js'],shell:false})
  assert.deepEqual(makeSafeDshLaunch('/usr/local/bin/dsh',{platform:'linux'}),{command:'/usr/local/bin/dsh',args:[],shell:false})
})

test('DSH launch calls share the resolved native route and carry its environment to child processes',()=>{
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(index,/const resolveDsh = \(\) => \{/)
  assert.ok(index.includes('makeSafeDshLaunch(cli)'))
  assert.ok(index.includes('makeSafeDshLaunch(onPath)'))
  assert.ok(index.includes('env: dsh.env || {}')) // updater
  const spawnCount=(index.match(/spawn\(dsh\.command,\s*args/g)||[]).length
  assert.equal(spawnCount,5)
  const envCount=(index.match(/\.\.\.\(dsh\.env \|\| \{\}\)|\.\.\.\(dsh\.env\|\|\{\}\)/g)||[]).length
  assert.equal(envCount,5)
})
