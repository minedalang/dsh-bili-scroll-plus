/** Confirmed outgoing public reply => platform-verified incoming recipient.
 * This is supplementary display metadata only. It must never create a comment
 * or bypass the canonical seen.md ledger. No guessed identities.
 */
import { existsSync, lstatSync, readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const FILE='confirmed-comment-recipients.json'
const KEY=/^BV[0-9A-Za-z]{10}:[1-9]\d{5,29}$/
const UID=/^[1-9]\d{0,18}$/
const MAX_BYTES=4*1024*1024, MAX_ROWS=8000
const clean=(v,n)=>String(v||'').replace(/[\r\n\x00-\x1f|]/g,' ').trim().slice(0,n)

export function readConfirmedRecipients(dir){
 const file=join(dir,FILE)
 if(!existsSync(file))return {}
 const st=lstatSync(file)
 if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('评论接收对象索引不是安全文件')
 const doc=JSON.parse(readFileSync(file,'utf8'))
 if(doc?.version!==1||!doc.entries||typeof doc.entries!=='object'||Array.isArray(doc.entries))throw Error('评论接收对象索引格式异常')
 const items=Object.entries(doc.entries)
 if(items.length>MAX_ROWS)throw Error('评论接收对象索引超出限制')
 return Object.fromEntries(items.filter(([key,row])=>KEY.test(key)&&UID.test(String(row?.uid||'')))
   .map(([key,row])=>[key,{uid:String(row.uid),name:clean(row.name,60),comment:clean(row.comment,420),at:Number(row.at)||0}]))
}

/** Call only after the platform confirms the outgoing reply and returns an rpid. */
export function recordConfirmedRecipient(dir,{bvid,rpid,uid,name='',comment='',at=Date.now()}={}){
 const key=String(bvid||'')+':'+String(rpid||'')
 if(!KEY.test(key)||!UID.test(String(uid||'')))return false
 const entries=readConfirmedRecipients(dir)
 const next={uid:String(uid),name:clean(name,60),comment:clean(comment,420),at:Number(at)||Date.now()}
 if(entries[key]&&entries[key].uid!==next.uid)throw Error('同一出站评论 ID 的已验证接收人 UID 冲突')
 entries[key]={...next,name:next.name||entries[key]?.name||'',comment:next.comment||entries[key]?.comment||''}
 const sorted=Object.entries(entries).sort((a,b)=>(b[1].at||0)-(a[1].at||0)).slice(0,MAX_ROWS)
 const raw=JSON.stringify({version:1,entries:Object.fromEntries(sorted)},null,2)+'\n'
 if(Buffer.byteLength(raw)>MAX_BYTES)throw Error('评论接收对象索引过大')
 const file=join(dir,FILE),tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp'
 try{writeFileSync(tmp,raw,{mode:0o600});renameSync(tmp,file)}
 catch(e){try{unlinkSync(tmp)}catch{}throw e}
 return true
}
