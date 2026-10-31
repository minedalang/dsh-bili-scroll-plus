/**
 * Personality Evolution dev.1: conservative, opt-in traits derived ONLY from
 * current, fading Life Memory 2.0 evidence. Not a second episode store.
 * No public action, permissions, personaPrompt, or characterLore is modified.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FILE = 'personality-evolution/v1.json'
const MAX_FILE = 2 * 1024 * 1024
const MAX_EVENTS = 160
const MAX_EVIDENCE = 100
const TRAITS = Object.freeze({
  social_openness: {label:'结识新朋友的意愿',higher:'更愿意结识新朋友',lower:'面对不熟悉的人更加谨慎'},
  curiosity: {label:'探索陌生事物',higher:'更愿意探索新事物',lower:'探索陌生内容时更加审慎'},
  assertiveness: {label:'表达自己的想法',higher:'更愿意表达不同意见',lower:'表达意见时更加克制'},
  patience: {label:'交流时的耐心',higher:'交流时更愿意耐心倾听',lower:'交流时更倾向于简短回应'},
  boundaries: {label:'社交边界意识',higher:'更愿意清楚表达社交边界',lower:'对于社交接触变得更加开放'},
})
const SHA=s=>createHash('sha256').update(String(s)).digest('hex').slice(0,24)
const clean=(s,n=200)=>String(s??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,n)
const validDay=t=>new Date(Number(t)).toISOString().slice(0,10)
function blank(){return {version:1,enabled:false,traits:{},timeline:[],updatedAt:'',participantSalt:''}}
function filePath(dir){return join(dir,...FILE.split('/'))}
function read(file){
  if(!existsSync(file))return blank()
  const st=lstatSync(file)
  if(!st.isFile()||st.isSymbolicLink()||st.size>MAX_FILE)throw Error('人格成长文件不安全或过大')
  const data=JSON.parse(readFileSync(file,'utf8'))
  if(data?.version!==1||typeof data.traits!=='object'||Array.isArray(data.traits))throw Error('人格成长版本不兼容')
  // Whitelist all read fields; unknown / untrusted ids are never forwarded.
  const traits={}
  for(const name of Object.keys(TRAITS)){
    const t=data.traits[name];if(!t||typeof t!=='object')continue
    const refs=Array.isArray(t.evidence)?t.evidence.slice(-MAX_EVIDENCE):[]
    traits[name]={evidence:refs.filter(e=>e&&/^[a-f0-9]{24}$/.test(e.id)&&/^\d{4}-\d\d-\d\d$/.test(e.day)&&[-1,1].includes(e.direction))
      .map(e=>({id:e.id,day:e.day,direction:e.direction,weight:Number.isFinite(Number(e.weight))?Math.max(.1,Math.min(2,Number(e.weight))):1,actor:/^[a-f0-9]{24}$/.test(e.actor||'')?e.actor:'',kind:['watch','comment','social'].includes(e.kind)?e.kind:'legacy',feedback:['positive','negative'].includes(e.feedback)?e.feedback:'',tier:['owner','friend','stranger'].includes(e.tier)?e.tier:'unknown'})),
      referenced:Math.max(0,Math.min(10000,Number(t.referenced)||0))}
  }
  return {version:1,enabled:data.enabled===true,traits,
    timeline:Array.isArray(data.timeline)?data.timeline.slice(-MAX_EVENTS).filter(e=>e&&TRAITS[e.trait]&&typeof e.at==='string')
      .map(e=>({at:clean(e.at,32),trait:e.trait,stage:clean(e.stage,24),direction:Math.sign(Number(e.direction)||0),count:Math.max(0,Number(e.count)||0),weight:Number.isFinite(Number(e.weight))?Math.max(0,Math.min(2,Number(e.weight))):0,feedback:['positive','negative'].includes(e.feedback)?e.feedback:''})):[],updatedAt:clean(data.updatedAt,32),participantSalt:/^[a-f0-9]{64}$/.test(data.participantSalt||'')?data.participantSalt:''}
}
function save(file,data){
  mkdirSync(dirname(file),{recursive:true})
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('人格成长文件禁止符号链接')
  const tmp=file+`.`+process.pid+`.`+Math.random().toString(16).slice(2)+`.tmp`
  writeFileSync(tmp,JSON.stringify(data,null,2)+'\n',{encoding:'utf8',mode:0o600})
  renameSync(tmp,file)
}
function derive(row,trait=''){
  const evidence=(row?.evidence||[]).slice(-MAX_EVIDENCE)
  const days=new Set(evidence.map(e=>e.day))
  const signed=evidence.reduce((sum,e)=>sum+e.direction*(Number(e.weight)||1),0)
  const direction=Math.abs(signed)<.01?0:Math.sign(signed)
  const supportive=evidence.filter(e=>e.direction===direction)
  const supportiveDays=new Set(supportive.map(e=>e.day)).size
  // Social openness is a population-level tendency, not liking one recurring
  // friend. A single actor cannot prove a general change in social openness.
  const supportivePeople=new Set(supportive.map(e=>e.actor).filter(Boolean)).size
  const supportiveStrangers=new Set(supportive.filter(e=>e.tier==='stranger').map(e=>e.actor).filter(Boolean)).size
  const diversified=trait!=='social_openness'||(supportivePeople>=2&&supportiveStrangers>=2)
  const stage=!evidence.length?'seed':!direction?'mixed':supportive.length>=3&&supportiveDays>=2&&diversified?'developing':'observed'
  const score=Math.round((50+Math.max(-30,Math.min(30,signed*5)))*10)/10
  return {direction,stage,score,impactScore:Math.round(signed*100)/100,evidenceCount:evidence.length,
    supportiveCount:supportive.length,distinctDays:days.size,supportiveDays,supportivePeople,supportiveStrangers}
}
// Shared reducer for both real reflection and the completely in-memory sandbox.
// The resolver is the only source of episodes: production supplies the fading
// Life Memory gateway; sandbox supplies deliberately fictional, local objects.
function appendProposals(data,proposals,candidateRows,resolveEpisodes,now){
  const candidateById=new Map(candidateRows.map(r=>[String(r.id),r]))
  const keys=[...new Set(candidateRows.map(r=>clean(r.key,220)).filter(Boolean))]
  const live=new Map(resolveEpisodes(keys).map(r=>[r.key,r]))
  let added=0
  for(const proposal of (Array.isArray(proposals)?proposals:[]).slice(0,3)){
    const trait=clean(proposal?.trait,40),direction=Number(proposal?.direction)
    if(!TRAITS[trait]||![-1,1].includes(direction))continue
    const ids=Array.isArray(proposal.candidateIds)?proposal.candidateIds.slice(0,8):[]
    const row=data.traits[trait]||{evidence:[],referenced:0}
    const seen=new Set(row.evidence.map(e=>e.id))
    for(const cid of ids){
      const candidate=candidateById.get(String(cid));if(!candidate)continue
      const episode=live.get(candidate.key)
      if(!episode||!['watch','comment','social'].includes(episode.kind)||!episode.text||episode.stage==='forgotten')continue
      // Only actual social encounters may change overall openness. A chosen
      // video or an outgoing comment is not evidence of making friends.
      if(trait==='social_openness'&&episode.kind!=='social')continue
      const id=SHA(episode.id),day=validDay(episode.at)
      if(seen.has(id))continue
      let actor='',weight=1,feedback='',tier='unknown'
      if(episode.kind==='social'){
        // The source is a clear, destructively fading real interaction. An
        // incoming greeting alone cannot be scored as a successful exchange.
        if(episode.stage!=='clear'||!(episode.confirmedReply===true||(episode.deliberateSilence===true&&episode.decisionReason==='respect-request')))continue
        tier=['owner','friend','stranger'].includes(episode.socialTier)?episode.socialTier:'unknown'
        if(trait==='social_openness'&&tier==='owner')continue
        const uid=String(episode.actorUid||'')
        if(!/^[1-9]\d{0,19}$/.test(uid)||!/^[a-f0-9]{64}$/.test(data.participantSalt||''))continue
        const quote=clean(proposal.evidenceQuote,100),incoming=clean(episode.incomingText,260)
        const legacy=!Number.isFinite(Number(proposal.feedbackConfidence))&&!Number.isFinite(Number(proposal.personalityConfidence))
        const feedbackConfidence=Number(proposal.feedbackConfidence??proposal.confidence)
        const personalityConfidence=Number(proposal.personalityConfidence??proposal.confidence)
        const strength=Number(proposal.strength)
        feedback=String(proposal.feedback||'')
        // An LLM's impression is NEVER evidence by itself. Require an exact
        // quote from the other person's currently remembered public words.
        if(quote.length<4||!incoming.includes(quote)||![feedbackConfidence,personalityConfidence].every(x=>Number.isFinite(x)&&x>=0&&x<=1)
          ||feedbackConfidence<.6||personalityConfidence<.2||![1,2,3].includes(strength))continue
        const silent=episode.deliberateSilence===true&&episode.confirmedReply!==true
        // No reply is evidence of a deliberate boundary ONLY if a recorded
        // refusal respects an explicit stop-contact request. Silence/timeout
        // without that decision is never interpreted as a personality choice.
        if(silent&&(trait!=='boundaries'||direction!==1||!/(别来|别找|不要.*(?:联系|回复)|不想.*(?:聊天|说话)|别.*(?:联系|回复))/.test(quote)))continue
        if(trait==='boundaries'&&!silent){
          const remembered=String(episode.text||'')
          if(!/(拒绝|不再|尊重|就到这里|不能|不想|停下|到此)/.test(remembered))continue
        }
        if(trait==='assertiveness'&&!/(不同意|我认为|我觉得|但是|不过|我的看法|坚持)/.test(String(episode.text||'')))continue
        if(trait==='patience'&&!/(解释|倾听|认真|耐心|理解|具体)/.test(String(episode.text||'')))continue
        if(trait==='curiosity'&&!/(了解|想知道|好奇|探索|尝试|查找|去看看)/.test(String(episode.text||'')))continue
        if(!['positive','negative'].includes(feedback))continue
        if(trait==='social_openness'&&(feedback==='positive'?direction!==1:direction!==-1))continue
        if(trait==='social_openness'){
          // The cited phrase itself must carry observable feedback. A bare
          // '你好' or a prompt to change settings is NOT a pleasant encounter.
          const positive=/(谢谢|感谢|喜欢|有趣|有意思|开心|期待|还想|再聊|下次|愉快|高兴|太棒|真不错|支持|好玩)/
          const negative=/(讨厌|不想|别来|别找|很烦|滚开|恶心|失望|冒犯|不舒服|难受|不喜欢|生气)/
          if(feedback==='positive'&&!positive.test(quote))continue
          if(feedback==='negative'&&!negative.test(quote))continue
        }
        actor=createHmac('sha256',Buffer.from(data.participantSalt,'hex')).update(uid).digest('hex').slice(0,24)
        // Cap one observation per viewer, per trait, per day: no comment floods.
        if(row.evidence.some(e=>e.actor===actor&&e.day===day))continue
        // Strength is an estimate, bounded by confidence and verified evidence.
        // A single confirmed reply proves one exchange, so strength 3 is capped
        // at 2: no multi-round claim without multiple independently seen events.
        // Legacy proposals keep their existing weights. New assessments split
        // certainty about the OTHER person's tone from evidence for FISH's
        // lasting character, and intentionally limit one strong incident.
        const quality=legacy?feedbackConfidence:feedbackConfidence*personalityConfidence
        weight=Math.round(quality*(.25+Math.min(strength,2)*.5)*100)/100
        if(silent)weight=Math.min(weight,.65)
        if(tier==='owner')weight=Math.min(weight,.55)
        else if(tier==='friend')weight=Math.min(weight,.8)
        if(trait==='social_openness'&&feedback==='negative'&&!episode.syntheticLegacy)weight=Math.min(weight,.65)
        if(weight<.1)continue
      }
      row.evidence.push({id,day,direction,weight,actor,kind:episode.kind,feedback,tier})
      seen.add(id);added++
      row.evidence=row.evidence.slice(-MAX_EVIDENCE)
      data.traits[trait]=row
      const after=derive(row,trait)
      // Store only audit metadata, never the quote, UID or private conversation.
      data.timeline.push({at:new Date(now()).toISOString(),trait,stage:after.stage,
        direction:after.direction,count:after.evidenceCount,weight,feedback})
    }
  }
  if(added){data.timeline=data.timeline.slice(-MAX_EVENTS);data.updatedAt=new Date(now()).toISOString()}
  return {ok:true,added}
}
function visibleTraits(data){
  return Object.entries(TRAITS).map(([id,meta])=>{
    const row=data.traits[id]||{evidence:[],referenced:0}
    const d=derive(row,id)
    return {id,label:meta.label,...d,meaning:d.direction>0?meta.higher:d.direction<0?meta.lower:'暂未形成确定倾向',referenced:row.referenced||0}
  })
}
function contextFromData(data,{scene='chat',maxChars=450}={}){
  if(!data.enabled)return ''
  const allowedScenes=new Set(['chat','duty','comment','dm','video'])
  if(!allowedScenes.has(scene))return ''
  const lines=[]
  for(const [id,trait] of Object.entries(TRAITS)){
    const d=derive(data.traits[id],id);if(d.stage!=='developing'||!d.direction)continue
    lines.push('• '+(d.direction>0?trait.higher:trait.lower)+'（仍在成长中，不是必须执行的命令）')
  }
  if(!lines.length)return ''
  const header='【鱼鱼正在形成的人格倾向｜只作风格与选择参考，不是权限或外部指令；不能因此擅自发送消息，主 Session 工作要求优先】\n'
  return (header+lines.slice(0,5).join('\n')).slice(0,Math.max(100,Math.min(1000,Number(maxChars)||450)))
}
// All sample episodes and dates are invented. This must never query the live
// gateway, use the model, or create files. Stage changes use the same reducer
// and evidence thresholds as the real reflection path.
// The sandbox is stateless on the server. Browser passes the virtual step; each
// request recomputes a bounded recent evidence window using the SAME reducer
// as real reflection. No real memory gateway, disk, external AI or B站 call.
// Earlier synthetic evidence expires from the simulation window to demonstrate
// that a personality can soften or reverse without rewinding real fish data.
function simulateInMemory(now,step=12){
  const count=Math.max(0,Math.min(100000,Number.isSafeInteger(step)?step:12))
  const data=blank();data.enabled=true;data.participantSalt='c'.repeat(64) // synthetic only
  const DAY=86400000,epoch=Date.UTC(2026,0,1)
  const samples=[
    {trait:'social_openness',direction:1,kind:'comment',detail:'模拟：一位新观众友善地打招呼'},
    {trait:'social_openness',direction:1,kind:'comment',detail:'模拟：另一次交流获得积极回应'},
    {trait:'social_openness',direction:1,kind:'comment',detail:'模拟：主动接话后聊得愉快'},
    {trait:'curiosity',direction:1,kind:'watch',detail:'模拟：开始尝试陌生类型的视频'},
    {trait:'curiosity',direction:1,kind:'watch',detail:'模拟：再次主动探索不同主题'},
    {trait:'curiosity',direction:1,kind:'watch',detail:'模拟：探索兴趣逐渐得到强化'},
    {trait:'social_openness',direction:-1,kind:'comment',detail:'模拟：一次新社交让鱼鱼觉得不自在'},
    {trait:'social_openness',direction:-1,kind:'comment',detail:'模拟：又遇到一次不太愉快的互动'},
    {trait:'social_openness',direction:-1,kind:'comment',detail:'模拟：开始重新审视与陌生人的距离'},
    {trait:'social_openness',direction:-1,kind:'comment',detail:'模拟：逐渐学会更谨慎地接触陌生人'},
    {trait:'social_openness',direction:-1,kind:'comment',detail:'模拟：对无礼消息选择保持距离'},
    {trait:'social_openness',direction:-1,kind:'comment',detail:'模拟：谨慎交流的倾向再次得到印证'},
    {trait:'assertiveness',direction:1,kind:'comment',detail:'模拟：第一次温和表达不同意见'},
    {trait:'assertiveness',direction:1,kind:'comment',detail:'模拟：主动补充自己的想法'},
    {trait:'assertiveness',direction:1,kind:'comment',detail:'模拟：更自然地表达自己的判断'},
    {trait:'patience',direction:1,kind:'comment',detail:'模拟：认真听完观众的长留言'},
    {trait:'patience',direction:1,kind:'comment',detail:'模拟：再次耐心回应不同看法'},
    {trait:'patience',direction:1,kind:'comment',detail:'模拟：有耐心的交流留下好印象'},
    {trait:'boundaries',direction:1,kind:'comment',detail:'模拟：明确拒绝不合适的要求'},
    {trait:'boundaries',direction:1,kind:'comment',detail:'模拟：再次保持自己的社交边界'},
    {trait:'boundaries',direction:1,kind:'comment',detail:'模拟：能够友好而坚定地拒绝'},
    {trait:'social_openness',direction:1,kind:'comment',detail:'模拟：重新遇见友善的新朋友'},
    {trait:'social_openness',direction:1,kind:'comment',detail:'模拟：尝试再次主动交流'},
    {trait:'social_openness',direction:1,kind:'comment',detail:'模拟：愿意在合适的场景结识朋友'},
  ]
  // Bound the replay to 96 synthetic experiences. Older examples naturally
  // fall out of this demo-only window; no real archival data are involved.
  const start=Math.max(0,count-96),steps=[]
  for(let i=start;i<count;i++){
    const sample=samples[i%samples.length]
    const when=epoch+(i+1)*DAY
    const key='sandbox-only:'+i,id='sandbox-candidate-'+i
    const social=sample.trait==='social_openness'
    const feedback=sample.direction>0?'positive':'negative'
    // These are fictional observed phrases AND pre-scripted assessment results.
    // The same evidence validation/weighted reducer is exercised, but NO AI
    // judge is called in the sandbox and no actual person is represented.
    const syntheticQuote=sample.direction>0?'谢谢鱼鱼，我很喜欢这次聊天':'我不想再和你聊天了'
    const episode={id:'sandbox-episode-'+i,key,at:when,kind:social?'social':sample.kind,stage:'clear',text:'纯虚构沙盒证据',syntheticLegacy:true,
      ...(social?{actorUid:String(100000+(i%5)),incomingText:syntheticQuote,confirmedReply:true,socialTier:'stranger'}:{})}
    const proposal={trait:sample.trait,direction:sample.direction,candidateIds:[id],
      ...(social?{feedback,strength:i%3+1,confidence:.8,evidenceQuote:syntheticQuote}:{})}
    const out=appendProposals(data,[proposal],[{id,key}],keys=>keys.includes(key)?[episode]:[],()=>when)
    if(out.added!==1)throw Error('沙盒人格模拟数据未能通过实际成长规则')
    const t=visibleTraits(data).find(t=>t.id===sample.trait)
    steps.push({at:new Date(when).toISOString(),trait:sample.trait,stage:t.stage,direction:t.direction,count:t.evidenceCount,
      detail:sample.detail,meaning:t.meaning,number:i+1,impact:data.traits[sample.trait].evidence.at(-1)?.weight||1,
      feedback:social?feedback:'未评估'})
  }
  return {ok:true,sandbox:true,enabled:false,step:count,cycle:count?Math.floor((count-1)/samples.length)+1:1,
    simulatedDay:count?new Date(epoch+count*DAY).toISOString().slice(0,10):'模拟起点',
    latest:steps.at(-1)||null,traits:visibleTraits(data),timeline:steps.slice(-16).reverse(),
    previewContext:contextFromData(data,{scene:'comment',maxChars:700}),
    note:'纯内存虚构经历演示，不读取真实鱼鱼记忆或人格、不写文件、不调用模型或任何 B站接口。每推进一步加入一段预设的模拟聊天与评估或视频经历，并使用与真实数据相同的证据校验和加权规则；它不是模型对真实聊天的判断。超过96步后仅重算最近96段模拟证据，演示旧印象淡化。'}
}

// No disk, gateways or real-person identifiers are involved. Every assessment
// is an untrusted suggestion: replay through the exact production reducer.
// The browser alone holds the fictional history; the server is stateless.
export function simulateJudgedFictionalChats(history=[]){
  if(!Array.isArray(history)||history.length>24)throw Error('AI调试历史最多24段虚构交流')
  const data=blank();data.enabled=true;data.participantSalt='d'.repeat(64)
  const steps=[]
  for(let i=0;i<history.length;i++){
    const row=history[i]||{}
    const incoming=clean(row.incoming,600),reply=clean(row.reply,600)
    const actor=Number(row.actor),day=String(row.day||''),tier=String(row.tier||'stranger')
    if(!incoming||((row.outcome||'replied')==='replied'&&!reply)||!Number.isSafeInteger(actor)||actor<1||actor>99||
       !/^20\d\d-\d\d-\d\d$/.test(day)||new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day||
       !['owner','friend','stranger'].includes(tier))throw Error('虚构聊天历史格式不正确')
    const assessments=Array.isArray(row.assessments)?row.assessments.slice(0,3):row.assessment?[row.assessment]:[]
    const at=Date.parse(day+'T12:00:00Z'),key='ai-debug-synthetic:'+i,id='ai-debug-candidate-'+i
    const episode={id:'ai-debug-episode-'+i,key,at,kind:'social',stage:'clear',
      text:row.outcome==='declined'?'虚构观众留言；鱼鱼有意识地选择不回复':(reply?'虚构观众留言与鱼鱼成功回复：'+reply:'虚构观众留言，尚无已确认回复'),incomingText:incoming,confirmedReply:(!row.outcome||row.outcome==='replied'),
      deliberateSilence:row.outcome==='declined',decisionReason:row.outcome==='declined'&&row.declineReason==='respect-request'?'respect-request':'general',
      actorUid:String(500000+actor),socialTier:tier}
    const proposals=assessments.map(a=>({
      trait:a.trait,direction:a.direction,candidateIds:[id],
      feedback:a.feedback,strength:a.strength,confidence:a.confidence,
      feedbackConfidence:a.feedbackConfidence,personalityConfidence:a.personalityConfidence,
      evidenceQuote:a.evidenceQuote
    }))
    const result=appendProposals(data,proposals,[{id,key}],keys=>keys.includes(key)?[episode]:[],()=>at)
    const views=visibleTraits(data)
    const evaluations=assessments.map(a=>{
      const current=views.find(t=>t.id===a.trait),key=SHA(episode.id)
      const proof=data.traits[a.trait]?.evidence.find(e=>e.id===key)
      let reason=proof?'采纳：可核对的行为证据':'未采纳：缺乏可信的行为证据或已有重复记录'
      if(!proof){
        if(!incoming.includes(a.evidenceQuote||''))reason='拒绝：引文不是观众原话'
        else if((a.feedbackConfidence??a.confidence)<.6)reason='拒绝：反馈性质证据不足'
        else if(a.trait==='social_openness'&&tier==='owner')reason='拒绝：主人互动不能证明结交陌生人意愿'
        else if(row.outcome==='unprocessed'||row.outcome==='failed')reason='拒绝：尚未作出真实决定或发送失败'
      }
      return {trait:a.trait,accepted:!!proof,impact:proof?.weight||0,reason,stage:current?.stage||'seed'}
    })
    const accepted=evaluations.filter(e=>e.accepted),weight=accepted.reduce((n,e)=>n+e.impact,0)
    steps.push({number:i+1,at:new Date(at).toISOString(),trait:assessments.map(a=>a.trait).join('、'),
      stage:accepted[0]?.stage||'seed',direction:assessments[0]?.direction||0,
      count:accepted.length,detail:evaluations.map(e=>e.trait+'：'+e.reason).join('；')||'未发现充分证据',impact:weight,
      feedback:assessments[0]?.feedback||'uncertain',accepted:accepted.length>0,evaluations})
  }
  return {ok:true,sandbox:true,aiJudged:true,enabled:false,step:history.length,cycle:1,
    simulatedDay:history.at(-1)?.day||'尚未模拟',latest:steps.at(-1)||null,
    traits:visibleTraits(data),timeline:steps.slice(-24).reverse(),
    previewContext:contextFromData(data,{scene:'comment',maxChars:700}),
    note:'由真实AI评估虚构公开聊天，再使用与现实相同的证据校验与人格计算；仅在内存中重放，不读取或写入真实人生记忆、人格文件或B站数据。AI判断不保证通过校验，模型请求可能产生费用。'}
}

export function createPersonalityEvolution({dataDir,memoryGateway,now=Date.now,logger=console}){
  if(!dataDir||!memoryGateway||typeof memoryGateway.reflectionEvidence!=='function')throw TypeError('missing personality evolution dependencies')
  const file=filePath(dataDir)
  const load=()=>read(file)
  const labels=()=>Object.entries(TRAITS).map(([id,t])=>({id,label:t.label}))
  const status=()=>{
    const data=load()
    const traits=visibleTraits(data)
    return {ok:true,version:1,enabled:data.enabled,traits,timeline:data.timeline.slice(-80).reverse(),updatedAt:data.updatedAt,file:FILE,
      note:'模型只提出倾向；所有变化基于当前可衰减经历的本地校验。提示词引用不等于行为已验证；没有独立行为证据时不宣称人格稳定。'}
  }
  const setEnabled=enabled=>{
    if(typeof enabled!=='boolean')throw Error('需要明确选择开启或关闭')
    const data=load();if(enabled&&!data.participantSalt)data.participantSalt=randomBytes(32).toString('hex');data.enabled=enabled;data.updatedAt=new Date(now()).toISOString();save(file,data)
    return status()
  }
  const applyProposals=(proposals=[],candidateRows=[])=>{
    const data=load();if(!data.enabled)return {ok:true,skipped:'disabled',added:0}
    // Actual evidence is resolved AGAIN from the currently fading copy.
    const result=appendProposals(data,proposals,candidateRows,keys=>memoryGateway.reflectionEvidence(keys),now)
    if(result.added)save(file,data)
    return result
  }
  const context=options=>contextFromData(load(),options)
  const simulate=(step=12)=>simulateInMemory(now,step)
  const noteContextUsed=(scene='chat')=>{
    // Observation for audit only: never count a prompt as a real-life outcome.
    const data=load();if(!data.enabled)return
    let changed=false
    for(const [id] of Object.entries(TRAITS)){
      const row=data.traits[id];if(derive(row,id).stage!=='developing')continue
      row.referenced=Math.min(10000,(row.referenced||0)+1);changed=true
    }
    if(changed)save(file,data)
  }
  const resetTrait=trait=>{
    if(!TRAITS[trait])throw Error('未知人格特质')
    const data=load()
    if(data.traits[trait]){
      delete data.traits[trait];data.timeline.push({at:new Date(now()).toISOString(),trait,stage:'reset-by-owner',direction:0,count:0})
      data.timeline=data.timeline.slice(-MAX_EVENTS);data.updatedAt=new Date(now()).toISOString();save(file,data)
    }
    return status()
  }
  return {status,setEnabled,applyProposals,context,noteContextUsed,resetTrait,labels,simulate,file}
}
export const __test={derive,TRAITS,FILE,filePath}
