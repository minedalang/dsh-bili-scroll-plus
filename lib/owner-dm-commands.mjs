/**
 * Authenticated B站 owner-DM ingress for read-only TODOs.
 * A platform message is never a system instruction; even from the configured
 * owner UID it cannot grant write permissions; explicit immediate VIDEO READ is permitted.
 */
const BV=/^BV[0-9A-Za-z]{10}$/i,UID=/^[1-9]\d{0,18}$/
const clean=(v,n)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,n)
export function parseOwnerDmTodo(message){
  const text=clean(message,600)
  // Require an explicit single-line prefix. Do not parse forwards or quoted text.
  const m=text.match(/^\s*(?:大肥鱼|#大肥鱼|!dafeiyu)\s*[:：,，]?\s*(.+)$/i)
  if(!m)return null
  const cmd=m[1].trim()
  let x=cmd.match(/^(?:(现在|立刻|立马|马上|立即)\s*)?(?:去\s*)?(?:看看?|查看|观看|读视频)\s*(?:视频\s*)?(BV[0-9A-Za-z]{10})\s*$/i)
  if(x&&BV.test(x[2]))return {type:'watch_video',bvid:x[2],immediate:true,title:`主人私信：马上看看视频 ${x[2]}`}
  x=cmd.match(/^(?:有空|稍后|先记下|记下)\s*(?:看看?|查看|观看)\s*(?:视频\s*)?(BV[0-9A-Za-z]{10})\s*$/i)
  if(x&&BV.test(x[1]))return {type:'watch_video',bvid:x[1],immediate:false,title:`主人私信：有空看看视频 ${x[1]}`}
  x=cmd.match(/^(?:搜索|搜视频|找视频)\s*[:：]?\s*(.{2,70})$/)
  if(x)return {type:'search_videos',immediate:true,topic:clean(x[1],70),title:`主人私信：搜索 ${clean(x[1],70)}`}
  if(/^(?:查看|看看|检查)\s*(?:我的|自己(?:的)?)\s*(?:空间)?投稿$/.test(cmd))return {type:'inspect_my_space',immediate:true,title:'主人私信：看看自己的空间投稿'}
  x=cmd.match(/^(?:查看|看看|检查)\s*(?:up|UP主|用户)\s*(\d{1,19})\s*(?:投稿|视频)?$/)
  if(x&&UID.test(x[1]))return {type:'inspect_creator_videos',immediate:true,uid:x[1],title:`主人私信：查看 UP ${x[1]} 投稿`}
  if(/^(?:检查|查看|看看)\s*(?:我的)?\s*(?:B站)?\s*(?:通知|未读消息)$/.test(cmd))return {type:'check_notifications',immediate:true,title:'主人私信：查看 B站通知'}
  // Likes, follows, favorites, messages, comments, arbitrary links: never auto authorize.
  return null
}
export function queueOwnerDmReadTodo({messages=[],ownerUid='',enabled=false,todos,now=Date.now}={}){
  if(!enabled||!UID.test(String(ownerUid))||!todos)return {added:0,skipped:true}
  let added=0
  const immediate=[]
  for(const row of (Array.isArray(messages)?messages:[]).slice(0,100)){
    if(row?.incoming!==true||String(row.senderUid)!==String(ownerUid))continue
    const task=parseOwnerDmTodo(row.text)
    const id=clean(row.messageId,120)
    const time=Number(row.timestampMs)
    if(!task||!id||!Number.isSafeInteger(time)||time<0||time>now()+60_000||now()-time>15*60_000)continue
    const r=todos.add({...task,
      origin:{kind:'owner-dm',uid:String(ownerUid),senderName:clean(row.senderName,50),messageId:id,quotedText:clean(row.text,450),at:time},
      sourceKey:`owner-dm:${ownerUid}:${id}`,
      note:task.immediate?'主人经身份核验的私信要求立即只读查看视频':'主人私信记录的普通只读待办',
      ownerAuthorized:false,
    },{source:'owner'})
    if(r.created){added++;if(task.immediate===true)immediate.push({id:r.item.id,bvid:r.item.bvid,type:r.item.type,ownerUid:String(ownerUid)})}
  }
  return {added,immediate,skipped:false}
}
