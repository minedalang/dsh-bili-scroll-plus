/** Model TASK launch telemetry, not provider token/API-request billing. No prompts or keys. */
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dayKey } from './state.mjs'

export const MODEL_TASKS = Object.freeze(['video','interaction','dailyDynamic','reflection','vision','memory','memeRules'])
const VALID = new Set(MODEL_TASKS)
const ZERO = () => Object.fromEntries(MODEL_TASKS.map(k=>[k,{today:0,lastAt:null}]))

function ledgerPath(home, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('非法统计日期')
  return join(home,'model-usage',date.slice(0,7)+'.jsonl')
}

export function recordModelTask(home, task, now = new Date()) {
  if (!VALID.has(task)) throw new Error('未知模型任务')
  try {
    const dir=join(home,'model-usage')
    mkdirSync(dir,{recursive:true})
    if (lstatSync(dir).isSymbolicLink()) return false
    const path=ledgerPath(home,dayKey(now))
    if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) return false
    // One short append per launch; avoids read/modify/write races across JS and Python.
    appendFileSync(path,JSON.stringify({task,day:dayKey(now),at:now.toISOString()})+'\n',{encoding:'utf8',flag:'a',mode:0o600})
    return true
  } catch {return false} // telemetry must never interrupt an agent task
}

export function readModelTaskUsage(home, now = new Date()) {
  const out=ZERO(), today=dayKey(now)
  try {
    const dir=join(home,'model-usage')
    if (lstatSync(dir).isSymbolicLink() || !lstatSync(dir).isDirectory()) return {day:today,tasks:out}
    // Look backward up to 24 months for a real last-launch time, even across years.
    // Stop early once all five task types have a known last launch.
    for(let offset=0;offset<24;offset++) {
      const month=new Date(now.getFullYear(),now.getMonth()-offset,1)
      const file=ledgerPath(home,dayKey(month))
      if(!existsSync(file))continue
      const st=lstatSync(file)
      if(!st.isFile()||st.isSymbolicLink()||st.size>2_000_000)continue
      for(const line of readFileSync(file,'utf8').split('\n')) {
        if(!line||line.length>400)continue
        let v;try{v=JSON.parse(line)}catch{continue}
        if(!VALID.has(v.task)||!/^\d{4}-\d{2}-\d{2}$/.test(v.day)||typeof v.at!=='string')continue
        const ts=Date.parse(v.at)
        if(!Number.isFinite(ts)||ts>now.getTime()+60_000)continue
        const entry=out[v.task]
        if(v.day===today)entry.today++
        if(!entry.lastAt||ts>Date.parse(entry.lastAt))entry.lastAt=new Date(ts).toISOString()
      }
      if(MODEL_TASKS.every(k=>out[k].lastAt)) break
    }
  } catch { /* partial data is fine; no prompts or API key data read */ }
  return {day:today,tasks:out,unit:'task-launch',note:'统计插件发起的模型任务次数，不等于 Provider 的真实 API 请求或 Token 消耗；连接测试不计入。'}
}
