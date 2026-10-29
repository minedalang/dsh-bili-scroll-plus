/** Portable business-data export/import. Never include login cookies, DPAPI keys or sticker assets. */
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { validateCommentMemeRules } from './comment-meme-rules.mjs'

export const FORMAT = 'dsh-dafeiyu-life-backup'
const LEGACY_FORMATS = new Set([FORMAT, 'dsh-bili-scroll-plus-backup'])
export const SCHEMA = 1
const MAX_FILE = 8 * 1024 * 1024
const MAX_TOTAL = 48 * 1024 * 1024
const MAX_ITEMS = 3000
const ROOT_FILES = new Set([
  'state.json', 'seen.md', 'duty.md', 'verify-state.json', 'uid-cache.json',
  'comment-meme-rules.json', 'main-session-memory.json', 'session-watch-history.json',
  // Sensitive per-UID private preference observations and outreach drafts are NOT
  // included in portable general business backups. They remain local.
  'video-recommendations.json', 'owner-todos.json', 'emotion-recall.json',
  'dm-autoreply-state.json', 'comment-interact-state.json', 'comment-ledger-import-v1.json',
])
const DIR_RULES = new Map([
  ['persona-growth',/^(?:v1|previous)\.json$/],
  // Historical dev.4 claim receipts are archived/backup-only in dev.5; never replay.
  ['video-wish-claims',/^[a-zA-Z0-9_-]{1,110}--[a-zA-Z0-9_-]{1,110}\.json$/],
  ['seen',/^\d{4}-\d{2}\.md$/],
  ['out',/^\d{4}-\d{2}-\d{2}\.md$/],
  ['reports',/^[\w.-]{1,100}\.(?:md|json)$/],
  ['digest',/^[\w.-]{1,100}\.(?:md|json)$/],
  ['comment-video-context',/^BV[A-Za-z0-9]{10}\.json$/],
  ['mention-diagnostics',/^\d{4}-\d{2}-\d{2}\.jsonl$/],
  ['meme-diagnostics',/^\d{4}-\d{2}-\d{2}\.jsonl$/],
  ['vision-events',/^\d{4}-\d{2}-\d{2}\.jsonl$/],
  ['model-usage',/^\d{4}-\d{2}\.jsonl$/],
  ['dynamic-sync',/^[\w.-]{1,100}\.(?:json|jsonl)$/],
  ['long-term-memory',/^[a-zA-Z0-9_-]{1,180}\.json$/],
  ['life-memory',/^(?:candidates|interests|emotional-state)\.json$/],
  ['daily-dynamic',/^drafts\.json$/],
])
const SQL_PATHS = new Set(['meme-memory.sqlite3', 'public-comment-quota.sqlite3', 'video-actions.sqlite3', 'dynamic-sync/dynamic-limit.sqlite3','daily-dynamic/publish-quota.sqlite3'])

export function allowedPath(path) {
  if (typeof path !== 'string' || path.length > 180 || path.includes('\\') || path.includes('..') || path.startsWith('/')) return false
  const parts = path.split('/')
  if (parts.length === 1) return ROOT_FILES.has(path)
  if (parts.length !== 2) return false
  return !!DIR_RULES.get(parts[0])?.test(parts[1])
}

export function collectBackupFiles(root) {
  const data = {}, stats = { bytes: 0, count: 0 }
  const add = (relative) => {
    if (!allowedPath(relative)) return
    const path = join(root, ...relative.split('/'))
    if (!existsSync(path)) return
    const s = lstatSync(path)
    if (!s.isFile() || s.isSymbolicLink()) return
    if (s.size > MAX_FILE) throw Error('数据文件过大，未进行不完整备份：'+relative)
    stats.bytes += s.size; stats.count++
    if (stats.count > MAX_ITEMS || stats.bytes > MAX_TOTAL) throw Error('业务数据超过单次备份限制（48 MB / 3000 文件），请先归档历史报告')
    data[relative] = readFileSync(path, 'utf8')
  }
  for (const name of ROOT_FILES) add(name)
  for (const [dir, rule] of DIR_RULES) {
    const folder = join(root, dir)
    if (!existsSync(folder) || !lstatSync(folder).isDirectory()) continue
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      if (item.isFile() && rule.test(item.name)) add(dir+'/'+item.name)
    }
  }
  return data
}

export function createBackup({root, config, sqlite = {}, version = ''}) {
  const files = collectBackupFiles(root)
  const backup = {format:FORMAT,schema:SCHEMA,createdAt:new Date().toISOString(),version,
    config:structuredClone(config),files,sqlite,
    exclusions:['表情包图片与素材','B站登录凭证/Cookie','独立密钥','Python环境、模型、缓存与日志','外部 dsh-fish-memory 插件目录（仅内置长期记忆会随本插件备份）','私密好友兴趣/关系观察与社交草稿（不随可携带备份转移）']}
  validateBackup(backup)
  return backup
}

export function validateBackup(backup) {
  if (!backup || typeof backup !== 'object' || Array.isArray(backup) || !LEGACY_FORMATS.has(backup.format) || backup.schema !== SCHEMA) throw Error('不是兼容的大肥鱼数据备份（格式版本不支持）')
  if (!backup.config || typeof backup.config !== 'object' || Array.isArray(backup.config)) throw Error('备份缺少设置项')
  if (!backup.files || typeof backup.files !== 'object' || Array.isArray(backup.files)) throw Error('备份缺少业务数据')
  if (!backup.sqlite || typeof backup.sqlite !== 'object' || Array.isArray(backup.sqlite)) throw Error('备份缺少数据库字段')
  let total = 0, count = 0
  for (const [file, content] of Object.entries(backup.files)) {
    if (!allowedPath(file) || typeof content !== 'string') throw Error('备份包含不允许恢复的路径：'+String(file).slice(0,90))
    const bytes = Buffer.byteLength(content, 'utf8'); total += bytes; count++
    if (bytes > MAX_FILE || total > MAX_TOTAL || count > MAX_ITEMS) throw Error('备份文件内容超过安全限制')
    if (file.startsWith('long-term-memory/')) {
      try {
        const x=JSON.parse(content)
        if (![2,3].includes(x?.version) || !Array.isArray(x.memories) || !Array.isArray(x.traces) || !Array.isArray(x.deleted) || x.memories.length>5000 || x.deleted.length>1500) throw Error('结构不兼容')
      } catch (e) { throw Error('长期记忆备份无效：'+String(e?.message||e).slice(0,120)) }
    }
    if (file === 'owner-todos.json') {
      try {
        const x=JSON.parse(content),types=['watch_video','like_video','inspect_my_space','inspect_creator_videos','search_videos','check_notifications','collect_video','follow_creator','unfollow_creator','comment_video','dm_friend'],statuses=['open','deferred','running','done','dismissed','uncertain','blocked']
        if(x?.version!==1||!Array.isArray(x.items)||x.items.length>500)throw Error('待办数量或版本不合法')
        for(const t of x.items){
          if(!t||typeof t!=='object'||typeof t.id!=='string'||t.id.length>80||!types.includes(t.type)||!statuses.includes(t.status))throw Error('待办结构不合法')
          for(const [k,max] of [['title',120],['note',220],['topic',120],['folderTitle',40],['sourceKey',240],['lastError',220],['resultSummary',420],['text',2000]])if(t[k]!=null&&(typeof t[k]!=='string'||t[k].length>max))throw Error('待办文本字段不合法：'+k)
          if(t.bvid&& !/^BV[0-9A-Za-z]{10}$/.test(t.bvid))throw Error('待办 BV 号不合法')
          if(t.uid&& !/^[1-9]\d{0,18}$/.test(String(t.uid)))throw Error('待办 UID 不合法')
          if(t.ownerAuthorized!==true&&t.ownerAuthorized!==false)throw Error('待办授权字段不合法')
        }
      } catch(e) { throw Error('自主待办备份无效：'+String(e?.message||e).slice(0,120)) }
    }
    if (file === 'emotion-recall.json') {
      try {
        const x=JSON.parse(content)
        if(x?.version!==1||!Array.isArray(x.recentKeys)||x.recentKeys.length>80||
          x.recentKeys.some(v=>typeof v!=='string'||v.length>240)||
          !['checks','sent','lastCheckAt','lastSentAt','lastEmotionAt'].every(k=>Number.isFinite(Number(x[k]))&&Number(x[k])>=0)||
          typeof x.lastError!=='string'||x.lastError.length>220||typeof x.lastResult!=='string'||x.lastResult.length>220)
          throw Error('自主回忆账本字段不合法')
      }catch(e){throw Error('自主回忆备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if (file === 'life-memory/emotional-state.json') {
      try{
        const x=JSON.parse(content), moods=['joyful','curious','warm','calm','tired','sad','irritated','neutral'],sources=['dm','comment','life-reflection','social-reflection','owner-reset']
        if(x?.version!==1||!x.current||!Array.isArray(x.history)||x.history.length>100||!moods.includes(x.current.mood))throw Error('情绪状态结构不兼容')
        for(const k of ['intensity','energy','curiosity','sociality'])if(!Number.isFinite(Number(x.current[k]))||Number(x.current[k])<0||Number(x.current[k])>100)throw Error('情绪数值不合法')
        if(!Number.isFinite(Number(x.current.valence))||Number(x.current.valence)<-100||Number(x.current.valence)>100)throw Error('情绪正向度不合法')
        for(const row of x.history)if(!row||!Number.isFinite(Number(row.at))||!moods.includes(row.mood)||!sources.includes(row.source)||!Number.isFinite(Number(row.intensity))||row.intensity<1||row.intensity>3)throw Error('情绪历史不合法')
      }catch(e){throw Error('情绪状态备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if (file === 'life-memory/interests.json') {
      try{
        const x=JSON.parse(content)
        if(x?.schema!==1||!Array.isArray(x.entries)||x.entries.length>30)throw Error('兴趣条目数量或格式不合法')
        for(const e of x.entries){
          if(!e||typeof e.topic!=='string'||e.topic.length>48||!Array.isArray(e.evidence)||e.evidence.length>90||!Array.isArray(e.history)||e.history.length>20)throw Error('兴趣条目不合法')
          for(const v of e.evidence)if(!v||typeof v.bvid!=='string'||!/^BV[0-9A-Za-z]{10}$/.test(v.bvid)||typeof v.day!=='string'||v.day.length>12||typeof v.at!=='string'||v.at.length>40)throw Error('兴趣证据不合法')
          for(const h of e.history)if(!h||typeof h.at!=='string'||h.at.length>40||!['insufficient','emerging','growing','stable','quiet',''].includes(String(h.from))||!['emerging','growing','stable'].includes(String(h.to)))throw Error('兴趣历史不合法')
        }
      }catch(e){throw Error('兴趣档案备份无效：'+String(e?.message||e).slice(0,120))}
    }
    if (file === 'life-memory/candidates.json') {
      try {
        const x=JSON.parse(content)
        if (x?.version !== 1 || !Array.isArray(x.candidates) || !Array.isArray(x.runs) || x.candidates.length>2500 || x.runs.length>120) throw Error('结构不兼容')
        for (const c of x.candidates) {
          if (!c || typeof c !== 'object' || Array.isArray(c)) throw Error('候选项不是对象')
          if (typeof c.id !== 'string' || !/^c-[a-f0-9]{18}$/.test(c.id)) throw Error('candidate id 不合法')
          if (typeof c.key !== 'string' || c.key.length>220 || !['watch','comment'].includes(c.kind)) throw Error('候选键或类型不合法')
          if (typeof c.bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(c.bvid)) throw Error('候选 BV 号不合法')
          if (!['pending','reflected','reviewed'].includes(c.status)) throw Error('候选状态不合法')
          if (!Array.isArray(c.memoryIds) || c.memoryIds.length>12 || c.memoryIds.some(v=>typeof v!=='string'||v.length>120)) throw Error('候选关联记忆不合法')
          for (const [k,max] of [['day',20],['time',40],['title',180],['tier',60],['note',260],['recipientName',70],['text',320],['rpid',40],['root',40],['createdAt',40],['reviewedAt',40],['reviewNote',180]]) {
            if (c[k] != null && (typeof c[k] !== 'string' || c[k].length>max)) throw Error('候选文本字段不合法：'+k)
          }
        }
        for (const r of x.runs) {
          if (!r || typeof r !== 'object' || Array.isArray(r)) throw Error('反思运行记录不是对象')
          if (!['ok','error'].includes(r.status) || !Number.isFinite(Number(r.at))) throw Error('反思运行记录不合法')
          if ((r.note!=null && (typeof r.note!=='string'||r.note.length>180)) || (r.error!=null && (typeof r.error!=='string'||r.error.length>300))) throw Error('反思运行文本过长')
        }
        if (x.lastError != null && (typeof x.lastError !== 'string' || x.lastError.length>300)) throw Error('lastError 不合法')
      } catch (e) { throw Error('人生记忆候选备份无效：'+String(e?.message||e).slice(0,120)) }
    }
  }
  for (const [file, content] of Object.entries(backup.sqlite)) {
    if (!SQL_PATHS.has(file) || typeof content !== 'string' || content.length > 34_000_000 || !/^[A-Za-z0-9+/=]+$/.test(content)) throw Error('SQLite 数据不合法：'+String(file).slice(0,90))
  }
  // Never restore an invalid owner-editable rule set; Python would otherwise refuse to search.
  // Backups from older versions may not contain a custom rule file at all.
  let memeRules = null
  if (Object.hasOwn(backup.files, 'comment-meme-rules.json')) {
    try {
      const content=JSON.parse(backup.files['comment-meme-rules.json'])
      memeRules=validateCommentMemeRules(content).rules.length
    } catch (e) {
      throw Error('表情包检索规则备份无效：'+String(e?.message||e).slice(0,120))
    }
  }
  if (Object.keys(backup.config).length > 300) throw Error('设置字段数量异常')
  return {count, databases:Object.keys(backup.sqlite).length, configKeys:Object.keys(backup.config).length, memeRules, createdAt:backup.createdAt||''}
}

export function restoreBackupFiles(root, backup) {
  validateBackup(backup)
  const tempSuffix = '.backup-import-'+process.pid+'.tmp'
  let count = 0
  for (const [name, content] of Object.entries(backup.files)) {
    const path = join(root, ...name.split('/'))
    const base = dirname(path)
    mkdirSync(base, {recursive:true})
    if (existsSync(path) && lstatSync(path).isSymbolicLink()) throw Error('目标存在符号链接，拒绝覆盖：'+name)
    const tmp = path + tempSuffix
    writeFileSync(tmp, content, 'utf8')
    renameSync(tmp, path)
    count++
  }
  return count
}

export function backupSummary(backup) { return validateBackup(backup) }
