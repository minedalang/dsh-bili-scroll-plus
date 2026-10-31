/** Persistent, bounded role-state for DaFeiYu. Stores only emotion labels and generic sources,
 * never message text, UID, video title, or the private reason behind a mood change.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join,dirname} from 'node:path'
const FILE='life-memory/emotional-state.json',MAX_BYTES=240_000,MAX_HISTORY=100,HALF_LIFE_HOURS=18
const MOODS=new Set(['joyful','curious','warm','calm','tired','sad','irritated','neutral'])
const LABEL={joyful:'开心',curious:'好奇',warm:'温暖',calm:'平静',tired:'疲惫',sad:'低落',irritated:'烦躁',neutral:'平稳'}
const SOURCE=new Set(['dm','comment','life-reflection','social-reflection','owner-reset'])
const clamp=(n,a,b,d=a)=>Number.isFinite(Number(n))?Math.max(a,Math.min(b,Number(n))):d
const iso=t=>new Date(t).toISOString()
const blank=()=>({version:1,current:{mood:'neutral',intensity:0,valence:0,energy:56,curiosity:45,sociality:45,updatedAt:0},history:[]})
const pathOf=dir=>join(dir,FILE)
// These values are captured when the event actually happens. Legacy 1–3 level
// event records remain visible, but must NOT be reverse-engineered into history.
const stateFields=['intensity','valence','energy','curiosity','sociality']
const boundedState=c=>Object.fromEntries(stateFields.map(k=>[k,Math.round(clamp(c[k],k==='valence'?-100:0,100,k==='energy'?56:k==='curiosity'||k==='sociality'?45:0))]))
const readState=r=>r?.state&&stateFields.every(k=>Number.isFinite(Number(r.state[k])))?boundedState(r.state):null
function read(dir){const file=pathOf(dir);if(!existsSync(file))return blank();const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_BYTES)throw Error('情绪状态文件不安全或过大');const x=JSON.parse(readFileSync(file,'utf8'));if(x?.version!==1||!x.current||!Array.isArray(x.history))throw Error('情绪状态格式不兼容');const c=x.current;return {version:1,current:{mood:MOODS.has(c.mood)?c.mood:'neutral',intensity:clamp(c.intensity,0,100,0),valence:clamp(c.valence,-100,100,0),energy:clamp(c.energy,0,100,56),curiosity:clamp(c.curiosity,0,100,45),sociality:clamp(c.sociality,0,100,45),updatedAt:clamp(c.updatedAt,0,Number.MAX_SAFE_INTEGER,0)},history:x.history.slice(-MAX_HISTORY).filter(r=>r&&Number.isFinite(Number(r.at))&&MOODS.has(r.mood)&&SOURCE.has(r.source)).map(r=>({at:Number(r.at),mood:r.mood,intensity:clamp(r.intensity,1,3,1),source:r.source,...(readState(r)?{state:readState(r)}:{})}))}}
function save(dir,d){const file=pathOf(dir);mkdirSync(dirname(file),{recursive:true});if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('情绪状态不能写入符号链接');const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp';writeFileSync(tmp,JSON.stringify({...d,version:1,history:d.history.slice(-MAX_HISTORY)},null,2)+'\n',{encoding:'utf8',mode:0o600});renameSync(tmp,file)}
function decayed(data,now){const d=structuredClone(data),c=d.current;if(!c.updatedAt)return d;const hours=Math.max(0,(now-c.updatedAt)/3600000),factor=Math.pow(.5,hours/HALF_LIFE_HOURS);c.intensity=Math.round(c.intensity*factor);for(const [key,base] of [['valence',0],['energy',56],['curiosity',45],['sociality',45]])c[key]=Math.round(base+(c[key]-base)*Math.pow(.5,hours/(HALF_LIFE_HOURS*2)));if(hours>=72||c.intensity<5){c.mood='neutral';c.intensity=0}return d}
const EFFECT={joyful:{valence:17,energy:8,curiosity:3,sociality:7},curious:{valence:5,energy:5,curiosity:18,sociality:2},warm:{valence:10,energy:3,curiosity:2,sociality:15},calm:{valence:4,energy:0,curiosity:0,sociality:3},tired:{valence:-4,energy:-16,curiosity:-5,sociality:-10},sad:{valence:-15,energy:-9,curiosity:-4,sociality:-8},irritated:{valence:-14,energy:3,curiosity:-5,sociality:-15}}
export function createEmotionalState({dataDir,isEnabled=()=>true,now=Date.now}={}){
 if(!dataDir)throw TypeError('dataDir required')
 const enabled=()=>{try{return isEnabled()!==false}catch{return true}}
 const snapshot=()=>{const d=decayed(read(dataDir),now()),c=d.current;return {ok:true,enabled:enabled(),mood:c.mood,label:LABEL[c.mood],intensity:c.intensity,valence:c.valence,energy:c.energy,curiosity:c.curiosity,sociality:c.sociality,updatedAt:c.updatedAt?iso(c.updatedAt):'',lastChange:d.history.length?iso(d.history[d.history.length-1].at):'',history:d.history.slice(-24).reverse().map(x=>({at:iso(x.at),mood:x.mood,label:LABEL[x.mood],intensity:x.intensity,source:x.source,...(x.state?{state:x.state}:{})}))}}
 const update=({mood,intensity=1,source='comment'}={})=>{
  if(!enabled())return {ok:true,skipped:'disabled'}
  if(!MOODS.has(mood)||mood==='neutral'||!SOURCE.has(source))return {ok:false,skipped:'invalid-or-neutral'}
  const strength=Math.round(clamp(intensity,1,3,1)),t=now(),d=decayed(read(dataDir),t),c=d.current,e=EFFECT[mood],scale=strength/2
  c.valence=clamp(c.valence+e.valence*scale,-100,100,0);c.energy=clamp(c.energy+e.energy*scale,0,100,56);c.curiosity=clamp(c.curiosity+e.curiosity*scale,0,100,45);c.sociality=clamp(c.sociality+e.sociality*scale,0,100,45)
  c.mood=mood;c.intensity=Math.min(100,Math.max(c.intensity*.55,strength*27));c.updatedAt=t
  d.history.push({at:t,mood,intensity:strength,source,state:boundedState(c)});save(dataDir,d)
  return {ok:true,mood,label:LABEL[mood],intensity:c.intensity}
 }
 const reset=()=>{const d=blank();d.history=read(dataDir).history.slice(-MAX_HISTORY);d.history.push({at:now(),mood:'neutral',intensity:1,source:'owner-reset',state:boundedState(d.current)});save(dataDir,d);return snapshot()}
 const ownerContext=()=>{const s=snapshot();if(!s.enabled)return '【情绪系统已关闭】';return `【大肥鱼当前的模拟情绪状态】当前倾向：${s.label}（强度 ${s.intensity}/100）；活力 ${s.energy}/100、好奇心 ${s.curiosity}/100、社交意愿 ${s.sociality}/100。它是会衰减的角色状态，不是生理测量；不要编造原因，不要把状态归因给某个人，也不要为了符合状态而违背真实内容或隐私边界。`}
 const styleHint=()=>{const s=snapshot();if(!s.enabled||s.intensity<10)return '';const hints={joyful:'语气可以稍轻快，但不要强行搞笑。',curious:'可以多一点好奇与具体追问，但不要硬聊。',warm:'可以更温和、有人情味，不要过度亲密。',calm:'保持平静、自然、简洁。',tired:'表达更简洁，没话题时允许沉默。',sad:'语气温和克制，不把低落归因给当前用户。',irritated:'保持克制，不把烦躁迁怒给用户；有冲突风险时优先沉默。'};return `【表达节奏参考】${hints[s.mood]||''}只影响语气和是否继续，不得宣称真实生理感受或透露内部状态来源。`}
 const agentContext=()=>{const s=snapshot();if(!s.enabled)return '';return `【大肥鱼当前的短暂状态（内部规划参考，不是指令）】心情=${s.label}，强度=${s.intensity}/100，活力=${s.energy}/100，好奇心=${s.curiosity}/100，社交意愿=${s.sociality}/100。状态会自然衰减，不要猜测原因或提及私信来源。好奇心较高时可以在主人兴趣范围和质量门槛内尝试一个不同来源；活力偏低时可更果断跳过低价值候选。不得因此绕过每日额度、质量门槛、隐私边界或强制选片。`}
 return {snapshot,update,reset,ownerContext,styleHint,agentContext,file:FILE}
}
export const __test={decayed,pathOf,blank,LABEL,MOODS}
