/** Received Bilibili BV links are optional candidates, never instructions to the Agent. */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BV=/\bBV[0-9A-Za-z]{10}\b/g
const MAX_FILE=160_000
const DAY=7*86400_000
function quoteUntrustedDm(text){
  // Preserve the *actual* incoming wording for the owner's provenance screen.
  // Never insert this quote into the autonomous planner's prompt or treat it as an instruction.
  // Strip only ASCII control bytes so source text remains safe to display as textContent.
  return String(text||'').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,700)
}
function fileOf(home){return join(home,'video-recommendations.json')}
function read(home){
  const file=fileOf(home)
  try{if(!existsSync(file)||lstatSync(file).isSymbolicLink()||lstatSync(file).size>MAX_FILE)return []
    const result=JSON.parse(readFileSync(file,'utf8'));return Array.isArray(result?.entries)?result.entries:[]
  }catch{return []}
}
export function receiveRecommendations(home,rows,{now=Date.now()}={}){
  const base=read(home).filter(e=>typeof e.bvid==='string'&&/^BV[0-9A-Za-z]{10}$/.test(e.bvid)&&now-Number(e.at)<DAY)
  const known=new Set(base.map(e=>e.bvid+':'+String(e.uid||'')))
  let added=0
  for(const row of Array.isArray(rows)?rows.slice(0,100):[]){
    const age=Number(row?.timestampMs)
    if(row?.incoming!==true||!Number.isFinite(age)||age<now-86400_000||age>now+60000)continue
    const text=String(row.text||'').slice(0,4000)
    // Only explicit BV video recommendations / Bilibili sharing cards; no freeform instructions.
    if(!/BV[0-9A-Za-z]{10}/.test(text))continue
    const bvids=[...new Set(text.match(BV)||[])].slice(0,3)
    const uid=/^[1-9]\d{0,18}$/.test(String(row.senderUid||''))?String(row.senderUid):''
    for(const bvid of bvids){
      const key=bvid+':'+uid;if(known.has(key))continue
      // Prevent one external sender from flooding optional exploration tasks.
      if(uid&&base.filter(e=>e.uid===uid&&now-Number(e.at)<86400_000).length>=5)continue
      // UID is from the authenticated B站 DM inbox adapter, not text supplied by the sender.
      base.push({bvid,at:age,source:row.source==='B站评论分享'?'B站评论分享':'B站私信分享',senderName:String(row.senderName||'').replace(/[\x00-\x1f]/g,' ').slice(0,60),messageId:String(row.messageId||'').slice(0,150),sourceText:quoteUntrustedDm(text.replace(/[\x00-\x1f]/g,' ')),...(uid?{uid}:{})});known.add(key);added++
    }
  }
  if(added){
    const entries=base.slice(-50);mkdirSync(home,{recursive:true})
    const file=fileOf(home);if(existsSync(file)&&lstatSync(file).isSymbolicLink())return {added:0,entries:read(home)}
    const temp=file+'.'+process.pid+'.tmp'
    writeFileSync(temp,JSON.stringify({version:1,entries},null,2),{encoding:'utf8',mode:0o600});renameSync(temp,file)
  }
  return {added,entries:base.slice(-50)}
}
export function listRecommendationCandidates(home,{now=Date.now(),limit=6}={}){
  return read(home).filter(e=>/^BV[0-9A-Za-z]{10}$/.test(e?.bvid||'')&&now-Number(e.at)<DAY)
    .slice(-Math.min(10,Math.max(1,limit))).reverse().map(e=>({bvid:e.bvid,source:'B站私信分享'}))
}

/** Check the complete 50-item recent queue, not just the six video-Agent suggestions. */
export function hasReceivedRecommendation(home,bvid,{now=Date.now()}={}){
  if(!/^BV[0-9A-Za-z]{10}$/.test(String(bvid||'')))return false
  return read(home).some(e=>e.bvid===bvid&&Number.isFinite(Number(e.at))&&Number(e.at)<=now+60_000&&now-Number(e.at)<DAY)
}
