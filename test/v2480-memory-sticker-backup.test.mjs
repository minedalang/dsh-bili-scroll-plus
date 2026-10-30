import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createLongTermMemory, MEMORY_BACKUP_FORMAT } from '../lib/long-term-memory.mjs'
import { createBackup, validateBackup } from '../lib/data-backup.mjs'

const root=join(fileURLToPath(new URL('.',import.meta.url)),'..')
const python=process.platform==='win32'?'python':'python3'
const pngResult=spawnSync(python,['-c',"from PIL import Image;import io,sys;b=io.BytesIO();Image.new('RGB',(16,16),(255,0,0)).save(b,'PNG');sys.stdout.buffer.write(b.getvalue())"],{encoding:null})
assert.equal(pngResult.status,0,pngResult.stderr?.toString())
const png=pngResult.stdout

function memoryAt(dir){
  return createLongTermMemory({dataDir:dir,dshHome:dir,agents:{},getConfig:()=>({mainSessionMemoryEnabled:true,mainSessionId:'room-a'}),defineTool:x=>x,getIdentityPrompt:()=>'',getGrowthPrompt:()=>'',logger:{warn(){}}})
}

test('v2.4.80 identity memory has standalone backup/restore and remains in full backup',()=>{
  const a=mkdtempSync(join(tmpdir(),'dafeiyu-mem-a-'))
  const mem=memoryAt(a)
  const add=mem.addManual('主人希望我长期记住测试事实',0.9,['测试'])
  assert.equal(add.ok,true)
  const standalone=mem.exportBackup()
  assert.equal(standalone.format,MEMORY_BACKUP_FORMAT)
  assert.equal(mem.inspectBackup(standalone).count,1)
  const full=createBackup({root:a,config:{x:1},sqlite:{},version:'2.4.80'})
  assert.ok(full.files['long-term-memory/dafeiyu.json'])
  assert.equal(validateBackup(full).count>=1,true)

  const b=mkdtempSync(join(tmpdir(),'dafeiyu-mem-b-'))
  const mem2=memoryAt(b)
  const summary=mem2.restoreBackup(standalone)
  assert.equal(summary.count,1)
  assert.match(mem2.list('',10)[0].text,/测试事实/)
})

test('v2.4.80 sticker ZIP export preserves folders and batch import restores names',()=>{
  const a=mkdtempSync(join(tmpdir(),'dafeiyu-sticker-a-'))
  mkdirSync(join(a,'comment-memes','开心'),{recursive:true})
  writeFileSync(join(a,'comment-memes','开心','笑.png'),png)
  const helper=join(root,'lib','sticker-archive.py')
  const ex=spawnSync(python,[helper,a,'export'],{encoding:null,maxBuffer:140*1024*1024})
  assert.equal(ex.status,0,ex.stderr?.toString())
  assert.equal(ex.stdout.subarray(0,2).toString(),'PK')

  const b=mkdtempSync(join(tmpdir(),'dafeiyu-sticker-b-'))
  const im=spawnSync(python,[helper,b,'import'],{input:ex.stdout,encoding:null,maxBuffer:4*1024*1024})
  assert.equal(im.status,0,im.stderr?.toString())
  const result=JSON.parse(im.stdout.toString())
  assert.equal(result.imported,1)
  assert.equal(existsSync(join(b,'comment-memes','开心','笑.png')),true)
})

test('v2.4.80 sticker ZIP batch import refuses traversal and overwrite',()=>{
  const helper=join(root,'lib','sticker-archive.py')
  const makeZip=(name)=>{
    const script=`import io,sys,zipfile,base64\nb=io.BytesIO()\nz=zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED)\nz.writestr(${JSON.stringify(name)},base64.b64decode(${JSON.stringify(png.toString('base64'))}))\nz.close()\nsys.stdout.buffer.write(b.getvalue())`
    const r=spawnSync(python,['-c',script],{encoding:null})
    assert.equal(r.status,0,r.stderr?.toString());return r.stdout
  }
  const a=mkdtempSync(join(tmpdir(),'dafeiyu-sticker-safe-'))
  const bad=spawnSync(python,[helper,a,'import'],{input:makeZip('../evil.png'),encoding:null})
  assert.notEqual(bad.status,0)
  assert.equal(existsSync(join(a,'evil.png')),false)

  mkdirSync(join(a,'comment-memes','开心'),{recursive:true})
  writeFileSync(join(a,'comment-memes','开心','笑.png'),png)
  const dup=spawnSync(python,[helper,a,'import'],{input:makeZip('开心/笑.png'),encoding:null})
  assert.notEqual(dup.status,0)
})

test('v2.4.80 management console explains standalone memory backup and ZIP behavior',()=>{
  const html=readFileSync(join(root,'lib','management-console.html'),'utf8')
  const js=readFileSync(join(root,'lib','management-console.js'),'utf8')
  assert.match(html,/单独备份完整人生记忆/)
  assert.match(html,/导出全部表情包 ZIP/)
  assert.match(html,/请先在 ZIP 里自己整理好文件夹、文件名/)
  assert.match(html,/单张导入时的重命名步骤/)
  assert.match(js,/RESTORE_DAFEIYU_MEMORY/)
  assert.match(js,/stickers\/archive\/import/)
})


test('v2.4.80 repairs 2.4.79 question-placeholder memories and restores previous valid fact',()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-memory-repair-'))
  const memDir=join(dir,'long-term-memory');mkdirSync(memDir,{recursive:true})
  const old={id:'old-drink',text:'主人目前最喜欢喝「冰美式」。',importance:.98,category:'stable_profile',事实键:'主人.偏好.饮料',source:'owner-deterministic',createdAt:'2026-10-27T01:00:00.000Z',已被取代:{by:'bad-query',reason:'同一事实键已有更新',at:'2026-10-27T02:00:00.000Z'}}
  const bad={id:'bad-query',text:'主人目前最喜欢喝「什么」。',importance:.98,category:'stable_profile',事实键:'主人.偏好.饮料',source:'owner-deterministic',createdAt:'2026-10-27T02:00:00.000Z'}
  writeFileSync(join(memDir,'dafeiyu.json'),JSON.stringify({version:3,scope:'dafeiyu-identity',policy:{},memories:[old,bad],traces:[],deleted:[],migration:{legacySessionFiles:[]}},null,2))
  const mem=memoryAt(dir)
  const active=mem.list('饮料',10).filter(x=>!x.已被取代)
  assert.equal(active.length,1)
  assert.match(active[0].text,/冰美式/)
  assert.doesNotMatch(active[0].text,/什么/)
  const raw=JSON.parse(readFileSync(join(memDir,'dafeiyu.json'),'utf8'))
  assert.equal(raw.memories.some(x=>x.id==='bad-query'),false)
  assert.equal(raw.deleted.some(x=>x.id==='bad-query'&&/疑问占位词/.test(x.deleteReason||'')),true)
})
