import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync,mkdtempSync,rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {effectiveModelSelection} from '../lib/model-routing.mjs'
import {createBackup,allowedPath,validateBackup} from '../lib/data-backup.mjs'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const h=read('lib/management-console.html'),j=read('lib/management-console.js')
const index=read('index.js'),client=read('client.js'),pkg=JSON.parse(read('package.json'))

test('v2.4.99 使用新版版本号，原有数据目录保持不变',()=>{
 assert.match(pkg.version,/^2\.(?:[5-9]|[1-9]\d+)\.\d+(?:-dev\.\d+)?$/)
 assert.match(index,/mainSessionMemoryReasoningEffort/)
 assert.match(read('lib/data-backup.mjs'),/main-session-memory\.json/)
})
test('检索模型思考深度实际保存并写到隔离的 headless 模型路由',()=>{
 for(const text of [h,j,index])assert.match(text,/main-memory-model-effort|mainSessionMemoryReasoningEffort/)
 assert.match(index,/reasoningEffort:cfg\.mainSessionMemoryReasoningEffort/)
 const r=effectiveModelSelection({}, {provider:'qwen',model:'cheap-retriever',reasoningEffort:'low'},JSON.stringify)
 assert.match(r.join('\n'),/reasoningEffort: "low"/)
 const r2=effectiveModelSelection({}, {provider:'qwen',model:'cheap-retriever',reasoningEffort:''},JSON.stringify)
 assert.doesNotMatch(r2.join('\n'),/reasoningEffort/)
 assert.throws(()=>effectiveModelSelection({}, {provider:'qwen',model:'cheap-retriever',reasoningEffort:'[bad'},JSON.stringify),/JSON/)
 assert.match(index,/HEADLESS_DENY_TOOLS/)
})
test('梗知识审批与释义证据分别标注，待核实仍不能当成确定事实',()=>{
 assert.match(h,/释义证据/)
 assert.match(h,/待核实.*大肥鱼不能当成确定事实/)
 assert.match(j,/证据：/)
 assert.match(read('lib/interaction-meme-memory.mjs'),/待核实的释义不得当作事实/)
 assert.match(read('lib/meme-memory-admin.py'),/review_status='approved'/)
})
test('学习状态反映配置，关闭状态不能展示正在收集',()=>{
 for(const id of ['meme-learning-status','life-learning-status','interest-learning-status','reflection-learning-status'])assert.ok(h.includes('id="'+id+'"'),id)
 assert.match(j,/const setLearningState=/)
 assert.match(j,/classList\.toggle\('paused',!enabled\)/)
 assert.match(j,/cfg\.config\?\.memeMemoryEnabled/)
 assert.match(j,/cfg\.config\?\.mainSessionMemoryAutoBili/)
})
test('主 Session 和经历同步更名，补历史明确只暂存待汇报',()=>{
 for(const txt of ['把新经历告诉大肥鱼的频率','现在把新经历告诉主 Session','把过去 7 天遗漏的经历加入待汇报','等待告诉主 Session'])assert.ok(h.includes(txt)||j.includes(txt),txt)
 assert.doesNotMatch(h,/>经历同步频率</)
 assert.doesNotMatch(h,/>当前队列与历史</)
 assert.match(j,/不会立即发送/)
})
test('完整备份包含表情包规则 JSON，但不会混入表情包素材目录',()=>{
 assert.equal(allowedPath('comment-meme-rules.json'),true)
 assert.equal(allowedPath('comment-memes/demo.png'),false)
 const dir=mkdtempSync(join(tmpdir(),'v2483-backup-'))
 try{const backup=createBackup({root:dir,config:{},version:'2.4.84',sqlite:{}});assert.equal(validateBackup(backup).count,0)}finally{rmSync(dir,{recursive:true,force:true})}
 assert.match(h,/包含表情包检索规则/)
 assert.match(h,/不包含表情包图片本体/)
})
test('关于页作者姓名直接可点，不显示冗余访问字样',()=>{
 assert.match(client,/data-bd-author-link/)
 assert.match(client,/href:'https:\/\/space\.bilibili\.com\/210228238'.*'长条动物'/)
 assert.doesNotMatch(client,/访问「长条动物」的 B站主页/)
})
test('全局 UI 与人生记忆独立导航兼顾窄屏及暗色',()=>{
 assert.match(h,/\.life-jump/)
 assert.match(h,/href="#life-interest-section"/)
 assert.match(h,/href="#life-recall-section"/)
 assert.match(h,/\.interest-meter-fill/)
 assert.match(h,/@media\(prefers-color-scheme:dark\)/)
 assert.match(h,/@media\(max-width:620px\)/)
 assert.match(client,/data-bd-sec\]\{padding:15px/)
})
