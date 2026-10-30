import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {spawnSync} from 'node:child_process'
import {allowedPath,createBackup,validateBackup,restoreBackupFiles} from '../lib/data-backup.mjs'

const dir=()=>mkdtempSync(join(tmpdir(),'dafeiyu-backup-'))
const write=(root,name,text)=>{const f=join(root,name);mkdirSync(join(f,'..'),{recursive:true});writeFileSync(f,text)}
const helper=join(import.meta.dirname,'..','lib','data-backup-sqlite.py')
const python=(root,command,obj)=>{
  const r=spawnSync(process.env.PYTHON || 'python3',[helper,command,root],{input:obj?JSON.stringify(obj):'',encoding:'utf8'})
  if(r.error?.code==='ENOENT') return null
  assert.equal(r.status,0,r.stderr+' / '+r.stdout)
  const result=JSON.parse(r.stdout);assert.equal(result.ok,true);return result
}

test('导出包含人设成长记忆与状态，绝不包含图片、凭证、密钥或代码缓存',()=>{
  const root=dir();try{
    write(root,'persona-growth/v1.json',JSON.stringify({approved:['经验']}))
    write(root,'video-wish-claims/a--b.json','{}')
    write(root,'comment-interact-state.json','{}')
    write(root,'duty.md','用户修改章程')
    write(root,'session-watch-history.json',JSON.stringify({version:1,entries:[{day:'2026-10-28',bvid:'BV1pXHK6mE6z',title:'公开视频'}]}))
    write(root,'comment-memes/表情包.jpg','PRIVATE_IMAGE')
    write(root,'bili_credential.json','SECRET_COOKIE')
    write(root,'.vision-api-key.dpapi','VERY_SECRET')
    write(root,'out/2026-10-26.md','刷视频报告')
    const backup=createBackup({root,config:{personaPrompt:'爱吃白饭',masterEnabled:false,friendDirectory:'[{"uid":"123"}]'}})
    assert.equal(backup.files['persona-growth/v1.json'],JSON.stringify({approved:['经验']}))
    assert.equal(backup.files['duty.md'],'用户修改章程')
    assert.equal(backup.files['session-watch-history.json']?.includes('BV1pXHK6mE6z'),true)
    assert.equal(backup.files['out/2026-10-26.md'],'刷视频报告')
    assert.equal(JSON.stringify(backup).includes('SECRET_COOKIE'),false)
    assert.equal(JSON.stringify(backup).includes('PRIVATE_IMAGE'),false)
    assert.equal(JSON.stringify(backup).includes('VERY_SECRET'),false)
    const target=dir();try{
      restoreBackupFiles(target,backup)
      assert.equal(readFileSync(join(target,'persona-growth','v1.json'),'utf8'),JSON.stringify({approved:['经验']}))
      assert.equal(existsSync(join(target,'bili_credential.json')),false)
    }finally{rmSync(target,{recursive:true,force:true})}
  }finally{rmSync(root,{recursive:true,force:true})}
})
test('拒绝目录穿越、符号链接、伪造备份',()=>{
  assert.equal(allowedPath('../bili_credential.json'),false)
  assert.equal(allowedPath('comment-memes/a.png'),false)
  assert.equal(allowedPath('persona-growth/v1.json'),true)
  assert.equal(allowedPath('session-watch-history.json'),true)
  const b={format:'dsh-bili-scroll-plus-backup',schema:1,config:{a:'b'},files:{'../../pw':'invalid'},sqlite:{}}
  assert.throws(()=>validateBackup(b),/格式版本不支持/)
  delete b.files['../../pw'];b.sqlite={'bili_credential.json':'AAAA'}
  assert.throws(()=>validateBackup(b),/格式版本不支持/)
})
test('SQLite 快照保存待审核和已批准梗，恢复后数据完整',()=>{
  const root=dir();try{
    mkdirSync(join(root,'dynamic-sync'))
    const make=spawnSync(process.env.PYTHON||'python3',['-c',"import sqlite3,sys;d=sqlite3.connect(sys.argv[1]);d.execute('create table memes (name text, meaning text, status text)');d.execute('insert into memes values (?,?,?)',('鱼来','召唤大肥鱼','approved'));d.commit();d.close()",join(root,'meme-memory.sqlite3')],{encoding:'utf8'})
    if(make.error?.code==='ENOENT')return
    assert.equal(make.status,0,make.stderr)
    const exported=python(root,'export');assert.ok(exported.sqlite['meme-memory.sqlite3'])
    const other=dir();try{
      python(other,'restore',exported)
      const r=spawnSync(process.env.PYTHON||'python3',['-c',"import sqlite3,sys;print(sqlite3.connect(sys.argv[1]).execute('select name,meaning,status from memes').fetchone())",join(other,'meme-memory.sqlite3')],{encoding:'utf8'})
      assert.match(r.stdout,/鱼来/);assert.match(r.stdout,/approved/)
    }finally{rmSync(other,{recursive:true,force:true})}
    const invalid={sqlite:{'meme-memory.sqlite3':Buffer.from('not a database').toString('base64')}}
    const bad=spawnSync(process.env.PYTHON||'python3',[helper,'restore',root],{input:JSON.stringify(invalid),encoding:'utf8'})
    assert.notEqual(bad.status,0)
    assert.match(bad.stdout,/不合法/)
  }finally{rmSync(root,{recursive:true,force:true})}
})
