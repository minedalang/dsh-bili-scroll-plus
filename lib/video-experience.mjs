/**
 * Verified, read-only video exploration evidence for Life Memory 2.0.
 * A title, a transcript, and an observed frame are different experiences.
 * Never claim the player was watched or a public action was performed.
 */
import {summarizeOwnerVideoExploration} from './owner-social-exploration.mjs'

const clean=(v,n=160)=>String(v??'').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const validBV=v=>/^BV[A-Za-z0-9]{10}$/.test(String(v||''))
const validTitle=v=>{const s=clean(v,140);return s&&!/^(?:BV[A-Za-z0-9]{10}|无标题|unknown|undefined|null)$/i.test(s)?s:''}
const safeSource=v=>['bili-life','main-session','autonomous','owner-todo'].includes(v)?v:'bili-life'

export function buildVideoExplorationEvent({bvid,info,subtitle,comments,danmaku,visual,source='bili-life',operationId='',at=Date.now()}={}){
 if(!validBV(bvid)||!operationId||!/^[A-Za-z0-9_-]{8,90}$/.test(operationId))return null
 if(info?.ok===false||info?.error||info?.data?.code&&info.data.code!==0)return null
 const reviewed=summarizeOwnerVideoExploration({info,subtitle,comments,danmaku,visual},bvid)
 if(!reviewed.ok)return null
 const title=validTitle(reviewed.video.title)
 if(!title)return null
 const evidence=reviewed.evidence
 const flags={metadata:true,subtitle:evidence.subtitle===true,comments:Number(evidence.comments)||0,
  danmaku:Number(evidence.danmaku)||0,vision:evidence.visual===true}
 return {kind:'watch',key:`video-explore:${operationId}`,bvid,title,at,
  experience:{source:safeSource(source),...flags},
  // No raw third-party comments, UIDs, private messages or transcripts are
  // persisted here. The bounded, public title identifies the experience.
  note:'读取过的公开资料',visibility:'public-event'}
}

const stopWords=/^(?:你|鱼鱼|大肥鱼|以前|之前|上次|是不是|是否|还|有没有|看过|记得|那条|那个|这条|这个|视频|的|吗|嘛|呀|啊|了|呢|我|说|提到|讲|关于|里面|在|过|曾经|一下|还记得|记不记得)+$/
export function videoRecallQueries(input='',{currentBvid=''}={}){
 const text=clean(input,1100),hints=[]
 const push=v=>{const x=clean(v,140);if(x.length>=2&&!hints.includes(x))hints.push(x)}
 const explicit=[...text.matchAll(/BV[A-Za-z0-9]{10}/g)].map(x=>x[0])
 for(const id of explicit)push(id)
 for(const m of text.matchAll(/(?:《([^》]{2,100})》|“([^”]{2,100})”|「([^」]{2,100})」|"([^"\n]{2,100})")/g))push(m[1]||m[2]||m[3]||m[4])
 // A referenced video, as opposed to a specific *other* video, can use the
 // platform-verified BV. It is never guessed from the current comment's text.
 const deictic=/(?:这个|这条|本条|当前|这里|这视频|该视频)(?:.{0,4})(?:视频|片|内容)?/.test(text)
 if(!explicit.length&&hints.length===0&&deictic&&validBV(currentBvid))push(currentBvid)
 // Strip question scaffolding only for a genuinely descriptive phrase; do not
 // convert general "看过什么视频" questions into misleading title matches.
 const phrase=text.replace(/@[^\s，。！？；：,!?;:]{1,45}/g,' ')
  .replace(/(?:以前|之前|上次|曾经|还记得|记不记得|是不是|是否|看过|有没有|那个|那条|这个|这条|关于|里面|讲的|视频|吗|嘛|呀|啊|呢|了|过)/g,' ')
  .replace(/[\s，。！？；：,!?;:《》“”「」"']/g,' ').trim()
 if(phrase.length>=3&&!stopWords.test(phrase))push(phrase)
 push(text)
 return hints.slice(0,5)
}
