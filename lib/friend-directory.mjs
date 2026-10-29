/** Same UID for authorization across DM, outgoing @ and incoming @; display names are never authority. */
import {readUidList} from './uid-labels.mjs'
import {parseMentionTargets} from './mentions.mjs'
const uidOK = x => /^[1-9]\d{0,18}$/.test(String(x||''))
const trimName = x => String(x||'').replace(/[\r\n\0<>|]/g,' ').trim().slice(0,40)
export function normalizeFriendDirectory(value) {
  let rows=value
  if(typeof value==='string'){if(value.length>16000)return '[]';try{rows=JSON.parse(value)}catch{return '[]'}}
  if(!Array.isArray(rows))return '[]'
  const seen=new Set(),out=[]
  for(const row of rows){
    const uid=String(row?.uid||'').trim()
    if(!uidOK(uid)||seen.has(uid))continue
    seen.add(uid)
    // A single friend roster owns the outreach channel. Legacy dm/mention flags remain
    // wire-compatible; a saved channel is authoritative for *proactive* outreach only.
    const dm=row?.dm===true,legacyMention=row?.mention===true
    const fallback=dm?(legacyMention?'both':'dm'):(legacyMention?'mention':'off')
    const requested=String(row?.recommend||'')
    const recommend=['off','dm','mention','both'].includes(requested)?requested:fallback
    const mention=(recommend==='mention'||recommend==='both')
    out.push({uid,name:trimName(row?.name),dm,mention,atInvite:row?.atInvite===true,recommend})
    if(out.length>=120)break
  }
  return JSON.stringify(out)
}
export function mergeLegacyFriendLists({friendDirectory='',mentionTargets='',dmWhitelist='',commentAtWhitelist=''}={}) {
  let prior=[];try{prior=JSON.parse(normalizeFriendDirectory(friendDirectory))}catch{}
  const map=new Map(prior.map(r=>[r.uid,{...r}]))
  const put=(uid,name,key)=>{
    if(!uidOK(uid))return
    const known=map.has(uid)
    const row=map.get(uid)||{uid,name:'',dm:false,mention:false,atInvite:false}
    if(!row.name&&name&&!String(name).startsWith('UID '))row.name=trimName(name)
    row[key]=true
    // Never upgrade an existing friend's explicit 'off' recommendation policy
    // just because an older compatibility list still contains their UID.
    if(!known){if(key==='dm')row.recommend='dm';if(key==='mention')row.recommend='mention'}
    map.set(uid,row)
  }
  for(const t of parseMentionTargets(mentionTargets))put(t.uid,t.name,'mention')
  for(const [uid,name] of readUidList(dmWhitelist))put(uid,name,'dm')
  for(const [uid,name] of readUidList(commentAtWhitelist))put(uid,name,'atInvite')
  return JSON.parse(normalizeFriendDirectory([...map.values()]))
}
export function directoryToLegacy(value) {
  const arr=JSON.parse(normalizeFriendDirectory(value))
  const line=r=>r.uid+(r.name?'|'+r.name:'')
  return {
    mentionTargets:arr.filter(r=>r.mention).slice(0,8).map(line).join('\n'),
    dmWhitelist:arr.filter(r=>r.dm).map(line).join('\n'),
    commentAtWhitelist:arr.filter(r=>r.atInvite).map(line).join('\n')
  }
}
