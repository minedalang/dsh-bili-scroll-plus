/**
 * Local, read-only hybrid search over *currently accessible* memory copies.
 * SQLite FTS5 (when available) is an in-memory acceleration structure, never a
 * persistent raw-history index. All results are rechecked by the caller's
 * current privacy/forgetting policy. No network, model, or native npm dependency.
 */
import {createRequire} from 'node:module'

const require=createRequire(import.meta.url)
let DatabaseSync
try { ({DatabaseSync}=require('node:sqlite')) } catch { /* older Node 22: use the inverted index */ }
const cap=(n,low,high,def)=>Number.isFinite(Number(n))?Math.min(high,Math.max(low,Math.floor(Number(n)))):def
export const normalize=s=>String(s??'').toLocaleLowerCase().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim()
export function terms(value){
 const out=new Set(),s=normalize(value).slice(0,2400)
 for(const word of s.match(/[a-z0-9_]{2,}|[\u3400-\u9fff]+/g)||[]){
  if(/^[\u3400-\u9fff]+$/.test(word)){
   if(word.length===1)continue
   for(let i=0;i<word.length;i++)for(let size=2;size<=3&&i+size<=word.length;size++)out.add(word.slice(i,i+size))
  }else out.add(word)
 }
 return out
}
const relevantAt=(query,now)=>{
 const s=normalize(query)
 const today=new Date(now)
 const localDay=x=>`${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`
 let days=null
 if(/(?:前天|the day before yesterday)/.test(s))days=2
 else if(/(?:昨天|昨日|yesterday)/.test(s))days=1
 else if(/(?:今天|今日|today)/.test(s))days=0
 const day=(d)=>{const x=new Date(today);x.setDate(x.getDate()-d);return localDay(x)}
 const dated=s.match(/(?:20\d{2}[-/.年])?(\d{1,2})[-/.月](\d{1,2})日?/)
 if(dated){const year=(s.match(/20\d{2}/)||[])[0]||String(today.getUTCFullYear()),month=Number(dated[1]),date=Number(dated[2]);if(month>=1&&month<=12&&date>=1&&date<=31)return `${year}-${String(month).padStart(2,'0')}-${String(date).padStart(2,'0')}`}
 return days===null?'':day(days)
}
const distinct=(x)=>[...new Set(x)]
function lexScore(queryTerms,recordTerms){
 if(!queryTerms.size||!recordTerms.size)return 0
 let matched=0
 for(const t of queryTerms)if(recordTerms.has(t))matched++
 return matched/Math.sqrt(queryTerms.size*Math.max(1,recordTerms.size))
}
// Near-exact video titles that differ by only one character should not
// silently vanish. Importantly, this only sees the *current* fading summary.
function nearText(needle,title){
 const norm=s=>normalize(s).replace(/[^\p{L}\p{N}]/gu,'')
 const q=norm(needle),t=norm(title)
 if(q.length<5||q.length>45||!/\p{Script=Han}{3}/u.test(q)||!t)return false
 if(t.includes(q))return true
 const d1=(a,b)=>{if(Math.abs(a.length-b.length)>1)return false;let i=0,j=0,n=0;while(i<a.length&&j<b.length){if(a[i]===b[j]){i++;j++;continue}if(++n>1)return false;if(a.length>b.length)i++;else if(a.length<b.length)j++;else{i++;j++}}return n+a.length-i+b.length-j<=1}
 for(let i=0;i<t.length;i++)for(const len of [q.length-1,q.length,q.length+1])if(len>0&&i+len<=t.length&&d1(q,t.slice(i,i+len)))return true
 return false
}
export function createHybridIndex({logger=console,sqlite=true}={}){
 let db=null,stored=new Map(),inverted=new Map(),fingerprint='',backend='ngram',buildCount=0
 if(sqlite&&DatabaseSync){
  try{
   db=new DatabaseSync(':memory:')
   db.exec("CREATE VIRTUAL TABLE memory_fts USING fts5(id UNINDEXED, tokens, tokenize='unicode61')")
   backend='fts5+ngram'
  }catch(e){db?.close();db=null;logger.warn?.('FTS5 unavailable, using n-gram fallback: '+String(e?.message||e).slice(0,100))}
 }
 function rebuild(records=[],signature=''){
  const rows=records.filter(r=>r&&typeof r.id==='string'&&typeof r.text==='string'&&r.text.trim())
  // Caller supplies version of the live, already-faded material. For trust
  // boundaries the caller must invalidate on each mutation/decay/restore.
  const mark=String(signature||'')
  if(mark&&mark===fingerprint)return
  stored=new Map();inverted=new Map()
  if(db)db.exec('DELETE FROM memory_fts')
  const insert=db?.prepare('INSERT INTO memory_fts(id,tokens) VALUES (?,?)')
  for(const row of rows){
   const id=String(row.id),words=terms(row.text),metadata=terms(row.searchText||'')
   for(const t of metadata)words.add(t)
   const item={...row,id,words}
   stored.set(id,item)
   for(const w of words){if(!inverted.has(w))inverted.set(w,new Set());inverted.get(w).add(id)}
   if(insert){try{insert.run(id,[...words].join(' '))}catch{ /* inverted index remains authoritative */ }}
  }
  fingerprint=mark;buildCount++
 }
 function search(query,{limit=120,now=Date.now(),filter=()=>true}={}){
  const q=terms(query),needle=normalize(query).replace(/\s+/g,''),day=relevantAt(query,now)
  const eligible=[...stored.values()].filter(filter)
  const permitted=new Set(eligible.map(e=>e.id))
  if(!q.size&&!needle&&!day)return eligible.sort((a,b)=>(b.at||0)-(a.at||0)).slice(0,cap(limit,1,3200,120)).map(e=>({id:e.id,score:0,channels:['recent']}))
  const channels=new Map(),put=(name,ids,weight=1)=>{
   for(let i=0;i<ids.length;i++){
    const id=ids[i];if(!permitted.has(id))continue
    const x=channels.get(id)||{id,score:0,channels:[]}
    x.score+=weight/(50+i+1)
    if(!x.channels.includes(name))x.channels.push(name)
    channels.set(id,x)
   }
  }
  // FTS5 and the JS inverted index are independent routes, with safe fallback.
  if(db&&q.size){
   try{
    const expression=[...q].slice(0,24).map(x=>'"'+x.replace(/"/g,'')+'"').join(' OR ')
    const hits=db.prepare('SELECT id FROM memory_fts WHERE memory_fts MATCH ? ORDER BY rank LIMIT ?').all(expression,cap(limit,1,3200,120)*2)
    put('fts5',hits.map(x=>x.id),1)
   }catch(e){logger.warn?.('FTS query fallback: '+String(e?.message||e).slice(0,80))}
  }
  const counts=new Map()
  for(const token of q)for(const id of inverted.get(token)||[])if(permitted.has(id))counts.set(id,(counts.get(id)||0)+1)
  put('ngram',[...counts].sort((a,b)=>b[1]-a[1]||((stored.get(b[0])?.at||0)-(stored.get(a[0])?.at||0))).map(x=>x[0]).slice(0,cap(limit,1,3200,120)*2),1.15)
  if(needle.length>=2){
   const exact=eligible.filter(e=>{
    const normalized=normalize(e.text).replace(/\s+/g,'')
    return normalized.includes(needle)||Boolean(e.exactId&&normalize(e.exactId)===needle)
   }).sort((a,b)=>(b.at||0)-(a.at||0))
   put('exact',exact.map(e=>e.id),2.8)
  }
  const titleMatches=eligible.filter(e=>e.nearTitle&&nearText(query,e.nearTitle)).sort((a,b)=>(b.at||0)-(a.at||0))
  put('near-title',titleMatches.map(e=>e.id),2.5)
  if(day){const timed=eligible.filter(e=>e.exactDateEligible===true&&Number.isFinite(e.at)&&[new Date(e.at).getFullYear(),String(new Date(e.at).getMonth()+1).padStart(2,'0'),String(new Date(e.at).getDate()).padStart(2,'0')].join('-')===day).sort((a,b)=>b.at-a.at);put('time',timed.map(e=>e.id),1.4)}
  const byTime=eligible.slice().sort((a,b)=>(b.at||0)-(a.at||0))
  // Recent experience is a weak backoff candidate, not proof of relevance.
  put('recent',byTime.slice(0,cap(limit,1,3200,120)).map(e=>e.id),.14)
  const rows=[...channels.values()]
  for(const x of rows){const e=stored.get(x.id),lex=lexScore(q,e.words)
   x.evidence=x.channels.includes('exact')||x.channels.includes('near-title')?1:lex
   if(x.channels.includes('time'))x.evidence=Math.max(x.evidence,.55)
   // Importance and recency help break genuine ties, not overwhelm evidence.
   const age=Math.max(0,now-(Number(e.at)||now))/86400000
   x.score+=x.evidence*.1+Math.min(1,Math.max(0,Number(e.importance)||0))*.003+(.002/(1+age/30))
  }
  rows.sort((a,b)=>b.score-a.score||Number(stored.get(b.id)?.at||0)-Number(stored.get(a.id)?.at||0))
  return rows.slice(0,cap(limit,1,3200,120))
 }
 const status=()=>({backend,count:stored.size,buildCount})
 const close=()=>{db?.close();db=null}
 return {rebuild,search,status,close}
}
export const __test={nearText,lexScore,relevantAt}
