import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {dirname,join} from 'node:path'
const root=join(dirname(fileURLToPath(import.meta.url)),'..')
// Ensure portable backup metadata follows the actually installed release.
test('备份元数据使用安装包实际版本号，不写死旧 2.4.80',()=>{
  const code=readFileSync(join(root,'index.js'),'utf8')
  assert.match(code,/createBackup\(\{root:stateDir,config:effective,sqlite,version:myVersion\(\)\}\)/)
  assert.doesNotMatch(code,/createBackup\(\{root:stateDir,config:effective,sqlite,version:'2\.4\.80'/)
})
