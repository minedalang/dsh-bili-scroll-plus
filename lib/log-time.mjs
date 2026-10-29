/** duty.log 的人类可读本地时间：保留毫秒和显式 UTC 偏移。
 * 不修改用于状态文件/接口/配额计算的 UTC ISO 时间。
 */
export function formatLocalLogTimestamp(date=new Date()){
  const d=date instanceof Date?date:new Date(date)
  if(!Number.isFinite(d.getTime()))throw new TypeError('无效的日志时间')
  const pad=(n,size=2)=>String(n).padStart(size,'0')
  const east=-d.getTimezoneOffset()
  const sign=east>=0?'+':'-'
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}${sign}${pad(Math.floor(Math.abs(east)/60))}:${pad(Math.abs(east)%60)}`
}
