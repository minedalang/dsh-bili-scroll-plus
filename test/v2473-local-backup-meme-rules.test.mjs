import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,readFileSync,writeFileSync,rmSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createBackup,validateBackup,restoreBackupFiles} from '../lib/data-backup.mjs'
import {saveCommentMemeRules,readCommentMemeRules} from '../lib/comment-meme-rules.mjs'

const base=JSON.parse(readFileSync(new URL('../vendor/bilibili-mcp/comment_meme_rules_default.json',import.meta.url),'utf8'))
const custom={schema:1,rules:Array.from({length:81},(_,i)=>({
   ...structuredClone(base.rules[i%base.rules.length]),id:`restored_rule_${i}`
}))}
const make=()=>mkdtempSync(join(tmpdir(),'v2473-data-'))

test('81 条主人专属检索规则可以全量备份还原，图片不会被备份',()=>{
  const home=make(), restored=make()
  try {
    assert.equal(custom.rules.length,81)
    saveCommentMemeRules(home,custom)
    mkdirSync(join(home,'comment-memes'))
    writeFileSync(join(home,'comment-memes','private.png'),'image-bytes')
    const backup=createBackup({root:home,config:{masterEnabled:true,backupDirectory:'D:\\大肥鱼备份'},sqlite:{},version:'2.4.73'})
    assert.equal(validateBackup(backup).memeRules,81)
    assert.equal('comment-meme-rules.json' in backup.files,true)
    assert.equal(JSON.stringify(backup).includes('image-bytes'),false)
    const first=backup.files['comment-meme-rules.json']
    const wrong=structuredClone(custom)
    wrong.rules[0].targets=['测试污染']
    saveCommentMemeRules(restored,wrong)
    restoreBackupFiles(restored,JSON.parse(JSON.stringify(backup)))
    assert.equal(readFileSync(join(restored,'comment-meme-rules.json'),'utf8'),first)
    assert.deepEqual(readCommentMemeRules(restored,process.cwd()).data,custom)
  }finally{rmSync(home,{recursive:true,force:true});rmSync(restored,{recursive:true,force:true})}
})

test('坏掉的规则 JSON 在写入/恢复前就被拒绝，不破坏已有有效规则',()=>{
  const home=make()
  try {
    saveCommentMemeRules(home,custom)
    const before=readFileSync(join(home,'comment-meme-rules.json'),'utf8')
    const backup=createBackup({root:home,config:{masterEnabled:true},sqlite:{}})
    backup.files['comment-meme-rules.json']='{invalid_json'
    assert.throws(()=>validateBackup(backup),/备份完整性校验失败|表情包检索规则备份无效/)
    assert.throws(()=>restoreBackupFiles(home,backup),/备份完整性校验失败|表情包检索规则备份无效/)
    assert.equal(readFileSync(join(home,'comment-meme-rules.json'),'utf8'),before)
  } finally {rmSync(home,{recursive:true,force:true})}
})

test('备份按钮只写入指定目录、无浏览器下载，预览发送编辑区规则',()=>{
  const h=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
  const j=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
  const index=readFileSync(new URL('../index.js',import.meta.url),'utf8')
  assert.match(h,/>确认备份目录</)
  assert.match(h,/>备份全部业务数据</)
  assert.doesNotMatch(h,/下载完整数据备份|保存并检测目录|并可另行下载一份/)
  const backupHandler=j.slice(j.indexOf("$('backup-export').addEventListener"),j.indexOf("$('backup-import-file').addEventListener"))
  assert.doesNotMatch(backupHandler,/Blob|createObjectURL|link\.click/)
  assert.match(backupHandler,/r\.filePath/)
  assert.match(index,/\{ok:true,filePath,summary:validateBackup\(backup\)\}/)
  assert.match(j,/\/comment-meme-rules\/preview',\{query:q,rules:captureMemeRules\(\)\}/)
  assert.match(index,/const previewRules=body\?\.rules===undefined\?null:validateCommentMemeRules\(body.rules\)/)
})
