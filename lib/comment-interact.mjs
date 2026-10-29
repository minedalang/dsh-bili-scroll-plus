import {readUidList} from './uid-labels.mjs'
/**
 * B站后台公开评论互动。只对经本地发送账本证实归属我的评论启用优先回复。
 * 顶层评论/楼中楼各自按 UID 近24小时限额；全局仍受每轮、近24小时、Python 每日硬闸约束。
 * 回复前持久化 pending；网络结果未知时不自动重发。
 */
import {mkdir,open,stat,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {normalizeReplyNotifications,normalizeAtNotifications,normalizeTopComments,isFishBait,validBv} from './comment-inbox.mjs';
const cap=(n,lo,hi,def)=>Number.isFinite(Number(n))?Math.max(lo,Math.min(hi,Math.floor(Number(n)))):def;
const validId=v=>/^\d{1,30}$/.test(String(v||''))?String(v):'';
const WINDOW=86400_000;
const fresh=()=>({version:1,notificationBootstrapped:false,replyParserVersion:1,atBootstrapped:false,atParserVersion:1,atContextRetries:{},atDiagnostics:[],atLastFetch:null,replyDiagnostics:[],replyLastFetch:null,seen:{},sent:[],replyRecords:[],replyLabels:{},sendAttempts:[],sendAttemptHistoryStartedAt:0,manualVerifiedRetries:{},globalQuotaBlocked:null,ownReplies:{},threadHistory:{}});
const localDayKey=ms=>{const d=new Date(ms);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const hardQuotaError=message=>/(?:已达到硬上限|每日硬上限禁用|额度已满|达到全局评论上限)/i.test(String(message||''));
const quotaStoreError=message=>/(?:配额记录不可用|database is locked|sqlite|数据库.*(?:锁|不可用))/i.test(String(message||''));
// Only keep a bounded, credential-scrubbed error for the local diagnostics UI.
const safeErrorDetail=value=>String(value?.message||value||'')
  .replace(/(?:SESSDATA|bili_jct|DedeUserID__ckMd5|access[_-]?token|api[_-]?key)\s*[=:]\s*[^\s&;]+/gi,'[凭证已隐藏]')
  .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi,'Bearer [凭证已隐藏]')
  .replace(/[\r\n\t]+/g,' ').slice(0,320);
const protectedSendState=value=>/^(?:sent|manual-sent|pending|manual-pending|uncertain|manual-uncertain|send_)/.test(String(value||''));
const terminalSendReason=reason=>/^(?:sent|send_failed|send_uncertain|manual_send_failed|manual_send_uncertain)$/.test(String(reason||''));
const failedSendReason=reason=>/^(?:send_failed|send_uncertain|manual_send_failed|manual_send_uncertain)$/.test(String(reason||''));
const definiteSendState=value=>/^(?:sent|manual-sent|pending|manual-pending)$/.test(String(value||''));
const VERIFIED_RETRY_LIMIT=3; // Human-confirmed retries per original comment in a rolling 24h window.
const sourceKeyFor=entry=>entry.aid&&entry.rpid?'source:'+entry.aid+':'+entry.rpid:'';
const verificationKeyFor=entry=>sourceKeyFor(entry)||String(entry.id||'');
function verifiedRetryInfo(db,entry,timestamp){
  const byId=String(db.seen[entry.id]||''),sourceKey=sourceKeyFor(entry),bySource=String(sourceKey?db.seen[sourceKey]||'':'');
  const prior=db.manualVerifiedRetries?.[verificationKeyFor(entry)];
  const history=(Array.isArray(prior)?prior:[]).filter(t=>Number(t)>timestamp-WINDOW);
  const remaining=Math.max(0,VERIFIED_RETRY_LIMIT-history.length);
  const successOrInFlight=entry.reason==='sent'||definiteSendState(byId)||definiteSendState(bySource);
  // A verified retry may fail before it even reaches B站 (context / AI failure).
  // Keep the recheck action available if the durable ledger still says the
  // previous publish was uncertain; those failures must not erase that history.
  const previouslyUncertain=/^(?:uncertain|manual-uncertain)$/.test(byId)||/^(?:uncertain|manual-uncertain)$/.test(bySource);
  const failed=failedSendReason(entry.reason)||(previouslyUncertain&&/^(?:manual_context_unavailable|manual_ai_generation_error|manual_ai_skipped)$/.test(String(entry.reason||'')));
  return {allowed:failed&&!successOrInFlight&&remaining>0,remaining,successOrInFlight,failed};
}

const annotateDiagnostic=(rows,db,timestamp=Date.now())=>rows.slice(-30).reverse().map(entry=>{
  const sourceKey=entry.aid&&entry.rpid?'source:'+entry.aid+':'+entry.rpid:'';
  const byId=String(db.seen[entry.id]||''),bySource=String(sourceKey?db.seen[sourceKey]||'':'');
  const sendState=protectedSendState(byId)?byId:protectedSendState(bySource)?bySource:byId||bySource;
  const retry=verifiedRetryInfo(db,entry,timestamp);
  return {...entry,sendState,retryBlocked:protectedSendState(byId)||protectedSendState(bySource)||terminalSendReason(entry.reason),
    manualRetryAllowed:retry.allowed,manualRetryRemaining:retry.remaining};
});
const errorClass=message=>{
  const s=String(message||'');
  if(hardQuotaError(s))return 'blocked_quota';
  if(quotaStoreError(s))return 'blocked_quota_store';
  if(/评论配额|评论额度|评论上限|额度.*(?:禁用|已满)|配额.*(?:不可用|已满)/i.test(s))return 'blocked_quota_store';
  if(/后台评论回复已关闭|总开关已关闭|插件已暂停|发送已暂停|开关关闭/i.test(s))return 'blocked';
  if(/结果不确定|超时|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|网络|连接重置|回执未包含|未收到成功回执|fetch failed/i.test(s))return 'uncertain';
  return 'failed';
};
function scopeOf(row,owned,ownReplies){
  if(row.kind==='at')return 'at';
  if(row.kind!=='notice')return 'top';
  const target=validId(row.targetId),root=validId(row.root);
  // 直接回复我的楼中楼 A，走独立额度；在我顶层评论下直接留言则走主评论额度。
  if(target&&(owned.nested.has(target)||ownReplies[target]))return 'self-nested';
  if((root&&owned.top.has(root))||(target&&owned.top.has(target)))return 'self-top';
  return 'notice'; // 归属不能确认时沿用普通通知的可跳过回复，不冒充强制回复
}
export function createCommentInteract({dataDir,getConfig,selfUid,getNotifications,getAtNotifications=async()=>({at:{data:{items:[]}}}),getVideoContext=async()=>({text:'',usable:false}),getVideos,getComments,getOwnComments=()=>({top:new Set(),nested:new Set()}),onIncoming=async()=>{},generateReply,send,logger=console,now=Date.now}){
  const stateFile=join(dataDir,'comment-interact-state.json');
  const lockPath=join(dataDir,'comment-interact.lock');
  let busy=false,lastError='',lastPollAt=0;
  async function load(){try{const x=JSON.parse(await readFile(stateFile,'utf8'));if(x?.version===1&&x.seen&&Array.isArray(x.sent)){
    x.replyRecords=Array.isArray(x.replyRecords)?x.replyRecords:[];
    x.replyLabels=x.replyLabels&&typeof x.replyLabels==='object'&&!Array.isArray(x.replyLabels)?x.replyLabels:{};
    // 升级已有状态时，保留24小时窗口内能找到的历史昵称与 UID。
    for(const record of x.replyRecords){
      const bv=validBv(record?.bvid),rpid=validId(record?.outboundRpid);
      if(bv&&rpid){
        const key=bv+':'+rpid;
        if(!x.replyLabels[key])x.replyLabels[key]={recipientName:String(record?.recipientName||'').slice(0,60),
          recipientUid:validId(record?.recipientUid||record?.uid),at:Number(record?.at)||0};
      }
    }
    if(!Array.isArray(x.sendAttempts)){
      x.sendAttempts=[];
      x.sendAttemptHistoryStartedAt=now();
    }else if(!Number.isFinite(Number(x.sendAttemptHistoryStartedAt))||Number(x.sendAttemptHistoryStartedAt)<=0){
      x.sendAttemptHistoryStartedAt=Number(x.sendAttempts[0]?.at)||now();
    }
    x.manualVerifiedRetries=x.manualVerifiedRetries&&typeof x.manualVerifiedRetries==='object'&&!Array.isArray(x.manualVerifiedRetries)?x.manualVerifiedRetries:{};
    x.globalQuotaBlocked=x.globalQuotaBlocked&&typeof x.globalQuotaBlocked==='object'?x.globalQuotaBlocked:null;
    x.ownReplies=x.ownReplies&&typeof x.ownReplies==='object'?x.ownReplies:{};
    x.threadHistory=x.threadHistory&&typeof x.threadHistory==='object'?x.threadHistory:{};
    x.atContextRetries=x.atContextRetries&&typeof x.atContextRetries==='object'?x.atContextRetries:{};
    x.atDiagnostics=Array.isArray(x.atDiagnostics)?x.atDiagnostics:[];
    x.replyDiagnostics=Array.isArray(x.replyDiagnostics)?x.replyDiagnostics:[];
    return x;
  }throw Error('invalid comment state');}catch(e){if(e.code==='ENOENT'){const x=fresh();x.sendAttemptHistoryStartedAt=now();return x;}throw e;}}
  async function save(db){const tmp=stateFile+'.'+process.pid+'.tmp';await writeFile(tmp,JSON.stringify(db,null,2)+'\n',{mode:0o600});await rename(tmp,stateFile);}
  async function lock(){
    try{const handle=await open(lockPath,'wx',0o600);await handle.writeFile(String(process.pid));return handle;}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      const age=await stat(lockPath).then(x=>now()-x.mtimeMs).catch(()=>0);
      const pid=Number(await readFile(lockPath,'utf8').catch(()=>'0'));
      let alive=true;if(pid>0)try{process.kill(pid,0)}catch(err){alive=err.code!=='ESRCH'}
      if(age>600_000&&pid>0&&!alive){await unlink(lockPath).catch(()=>{});return lock();}
      return null;
    }
  }
  const atNote=(db,x,reason)=>{
    if(getConfig().diagAtInviteEnabled===false)return;
    db.atDiagnostics??=[];
    const key=String(x.id||'unknown'),entry={id:key,uid:validId(x.uid),name:String(x.name||'').slice(0,60),
      aid:validId(x.aid),bvid:validBv(x.bvid),rpid:validId(x.rpid),root:validId(x.root),targetId:validId(x.targetId),
      locationRoot:validId(x.locationRoot),locationSource:String(x.locationSource||'').slice(0,20),
      text:String(x.text||'').trim().slice(0,800),context:String(x.context||'').trim().slice(0,700),contextSummary:String(x.contextSummary||'').slice(0,300),
      rootPreview:String(x.rootPreview||'').slice(0,600),threadPreview:String(x.threadPreview||'').slice(0,900),
      timestampMs:Number(x.timestampMs)||0,reason,forced:x.forced===true,
      generatedReply:String(x.generatedReply||'').slice(0,130),errorDetail:safeErrorDetail(x.errorDetail||'').slice(0,320),at:now()};
    const old=db.atDiagnostics.findIndex(r=>r.id===key);
    if(old>=0)db.atDiagnostics.splice(old,1);
    db.atDiagnostics.push(entry);
    if(db.atDiagnostics.length>100)db.atDiagnostics=db.atDiagnostics.slice(-100);
  };
  const replyNote=(db,x,reason)=>{
    if(getConfig().diagReplyInboxEnabled===false)return;
    db.replyDiagnostics??=[];
    const key=String(x.id||'unknown'),entry={id:key,uid:validId(x.uid),name:String(x.name||'').slice(0,60),
      aid:validId(x.aid),bvid:validBv(x.bvid),rpid:validId(x.rpid),root:validId(x.root),scope:String(x.scope||''),targetId:validId(x.targetId),
      locationRoot:validId(x.locationRoot),locationSource:String(x.locationSource||'').slice(0,20),
      text:String(x.text||'').trim().slice(0,800),context:String(x.context||'').trim().slice(0,700),contextSummary:String(x.contextSummary||'').slice(0,300),
      rootPreview:String(x.rootPreview||'').slice(0,600),threadPreview:String(x.threadPreview||'').slice(0,900),
      timestampMs:Number(x.timestampMs)||0,reason,forced:x.forced===true,
      generatedReply:String(x.generatedReply||'').slice(0,130),errorDetail:safeErrorDetail(x.errorDetail||'').slice(0,320),at:now()};
    const old=db.replyDiagnostics.findIndex(v=>v.id===key);
    if(old>=0)db.replyDiagnostics.splice(old,1);
    db.replyDiagnostics.push(entry);
    if(db.replyDiagnostics.length>100)db.replyDiagnostics=db.replyDiagnostics.slice(-100);
  };
  const interactionNote=(db,x,reason)=>{
    if(x.kind==='at')atNote(db,x,reason);
    else if(x.kind==='notice')replyNote(db,x,reason);
  };
  const windowRecords=db=>(db.replyRecords||[]).filter(r=>Number(r.at)>now()-WINDOW);
  function status(){
    let sentLast24Hours=0,sentOnOwnTop24h=0,sentOnOwnNested24h=0;
    let sendAttemptHistoryAvailable=false,sendAttemptHistoryStartedAt=0,sendFailedLast24Hours=0,sendUncertainLast24Hours=0,
      sendBlockedByGlobalQuotaLast24Hours=0,sendBlockedOtherLast24Hours=0,sendPendingLast24Hours=0;
    let globalQuotaBlocked=null,atDiagnostics=[],atLastFetch=null,replyDiagnostics=[],replyLastFetch=null;
    try{
      const db=JSON.parse(readFileSync(stateFile,'utf8'));
      const since=now()-WINDOW;
      sentLast24Hours=(db.sent||[]).filter(t=>Number(t)>since).length;
      sendAttemptHistoryAvailable=Array.isArray(db.sendAttempts);
      sendAttemptHistoryStartedAt=Number(db.sendAttemptHistoryStartedAt)||0;
      const attempts=(db.sendAttempts||[]).filter(a=>Number(a.at)>since);
      sendFailedLast24Hours=attempts.filter(a=>a.outcome==='failed').length;
      sendUncertainLast24Hours=attempts.filter(a=>a.outcome==='uncertain').length;
      sendBlockedByGlobalQuotaLast24Hours=attempts.filter(a=>a.outcome==='blocked_quota').length;
      sendBlockedByGlobalQuotaLast24Hours+=attempts.filter(a=>a.outcome==='blocked_quota_store').length;
      sendBlockedOtherLast24Hours=attempts.filter(a=>a.outcome==='blocked').length;
      sendPendingLast24Hours=attempts.filter(a=>a.outcome==='pending').length;
      globalQuotaBlocked=db.globalQuotaBlocked&&typeof db.globalQuotaBlocked==='object'?db.globalQuotaBlocked:null;
      atDiagnostics=annotateDiagnostic(db.atDiagnostics||[],db,now());atLastFetch=db.atLastFetch||null;
      replyDiagnostics=annotateDiagnostic(db.replyDiagnostics||[],db,now());replyLastFetch=db.replyLastFetch||null;
      for(const x of db.replyRecords||[]){if(Number(x.at)<=since)continue;
        if(x.scope==='self-top')sentOnOwnTop24h++;
        if(x.scope==='self-nested')sentOnOwnNested24h++;
      }
    }catch{/* 首次安装时暂无统计文件 */}
    const c=getConfig();
    const quotaBlockMatches=!!(globalQuotaBlocked&&globalQuotaBlocked.day===localDayKey(now())&&Number(globalQuotaBlocked.limit)===cap(c.globalDailyLimit,0,1000,10));
    const quotaBlockActive=quotaBlockMatches&&(globalQuotaBlocked.reason!=='store-error'||Number(globalQuotaBlocked.retryAfter)>now());
    return {busy,lastError,lastPollAt,atDiagnostics,atLastFetch,replyDiagnostics,replyLastFetch,sentLast24Hours,sentOnOwnTop24h,sentOnOwnNested24h,
      sendAttemptHistoryAvailable,
      sendAttemptHistoryStartedAt,
      sendAttemptsLast24Hours:sentLast24Hours+sendFailedLast24Hours+sendUncertainLast24Hours+sendBlockedByGlobalQuotaLast24Hours+sendBlockedOtherLast24Hours+sendPendingLast24Hours,
      sendFailedLast24Hours,sendUncertainLast24Hours,sendBlockedByGlobalQuotaLast24Hours,sendBlockedOtherLast24Hours,sendPendingLast24Hours,
      globalQuotaBlocked:!!quotaBlockActive,
      globalQuotaBlockReason:quotaBlockActive?String(globalQuotaBlocked.reason||'limit'):'',
      watchAt:!!c.watchAt,replyAt:c.replyAt!==false,atMode:c.atMode==='all'?'all':'whitelist',replyPerDay:cap(c.replyPerDay,1,1000,5),ownTopPerUser:cap(c.ownTopPerUser,1,1000,5),ownNestedPerUser:cap(c.ownNestedPerUser,1,1000,3)};
  }

  async function forceReply({id,confirmedMissing=false}={}){
    const forcedId=String(id||'').trim();
    if(!/^(?:at|comment):[A-Za-z0-9_-]{1,40}$/.test(forcedId))throw Error('无效的诊断记录编号');
    if(busy)throw Error('后台评论回复正在运行，请稍后再试');
    busy=true;let handle;
    try{
      await mkdir(dataDir,{recursive:true});handle=await lock();if(!handle)throw Error('后台评论回复正忙，请稍后重试');
      const db=await load();
      const self=String(await selfUid());if(!/^[1-9]\d*$/.test(self))throw Error('没有登录 UID，无法手动回复');
      const list=forcedId.startsWith('at:')?(db.atDiagnostics||[]):(db.replyDiagnostics||[]);
      const saved=list.find(x=>x&&x.id===forcedId)||null;
      let inboxVersion=null;
      try{
        inboxVersion=forcedId.startsWith('at:')
          ? (normalizeAtNotifications(await getAtNotifications(),self,{}).find(x=>x.id===forcedId)||null)
          : (normalizeReplyNotifications(await getNotifications(),self,{}).find(x=>x.id===forcedId)||null);
      }catch{}
      if(!saved && !inboxVersion)throw Error('未找到这条诊断记录，可能已被清理');
      const base={...(saved||{}),...(inboxVersion||{})};
      const x={id:forcedId,kind:forcedId.startsWith('at:')?'at':'notice',uid:validId(base.uid),name:String(base.name||'').trim().slice(0,60),
        aid:validId(base.aid),bvid:validBv(base.bvid),rpid:validId(base.rpid),root:validId(base.root),targetId:validId(base.targetId),
        locationRoot:validId(base.locationRoot),locationSource:String(base.locationSource||''),
        text:String(base.text||'').trim().slice(0,800),context:String(base.context||'').trim().slice(0,700),timestampMs:Number(base.timestampMs)||0,scope:String(base.scope||'')};
      if(!x.uid||x.uid===self)throw Error('评论来自本账号或缺少有效 UID');
      // Human verification is required for *each* retry of a previously failed/uncertain send.
      // Never allow a known success or in-flight attempt, even with confirmation.
      const sourceKey=sourceKeyFor(x);
      const previouslyAttempted=protectedSendState(db.seen[x.id])||protectedSendState(db.seen[sourceKey])||terminalSendReason(saved?.reason);
      const eligibility=verifiedRetryInfo(db,{...x,reason:saved?.reason},now());
      if(eligibility.successOrInFlight)throw Error('该评论已发送（有成功回执）或正在发送中，不能再次发送');
      if(confirmedMissing===true){
        if(!eligibility.failed)throw Error('只有发送失败或结果不确定的诊断记录才能执行人工核对后重发');
        if(!eligibility.allowed)throw Error('这条评论24小时内人工核对重试次数已达到'+VERIFIED_RETRY_LIMIT+'次，请稍后再试');
      }else if(previouslyAttempted){
        throw Error('该评论已发送或曾尝试发送（结果可能不确定），请先在 B站核对；确认未公开后使用人工核对重发按钮');
      }
      const verifiedRetry=confirmedMissing===true;
      const cfg=getConfig();
      const sent24=(db.sent||[]).filter(t=>Number(t)>now()-WINDOW);
      if(sent24.length>=cap(cfg.replyPerDay,1,1000,5))throw Error('后台评论近24小时回复额度已满');
      const today=localDayKey(now()),globalLimit=cap(cfg.globalDailyLimit,0,1000,10);
      if(globalLimit===0||(db.globalQuotaBlocked?.day===today&&db.globalQuotaBlocked?.reason==='limit'&&Number(db.globalQuotaBlocked?.limit)===globalLimit))throw Error('公开评论每日硬上限已满，不能手动绕过');
      if(!x.uid||!x.bvid||!x.rpid||!x.text)throw Error('这条记录缺少 BV / 评论内容 / 评论ID，暂时无法强制回复');
      const ownedRaw=await getOwnComments();
      const owned={top:new Set(ownedRaw?.top||[]),nested:new Set(ownedRaw?.nested||[])};
      if(x.kind==='notice')x.scope=scopeOf(x,owned,db.ownReplies);
      if(!x.scope)x.scope=x.kind==='at'?'at':'notice';
      const ownUserCap=x.scope==='self-top'?cap(cfg.ownTopPerUser,1,1000,5):x.scope==='self-nested'?cap(cfg.ownNestedPerUser,1,1000,3):0;
      if(ownUserCap&&windowRecords(db).filter(r=>r.uid===x.uid&&r.scope===x.scope).length>=ownUserCap)
        throw Error('这位观众在该评论类型的近24小时回复次数已达到上限');
      const root=validId(x.root)||validId(x.rpid);
      const threadKey=`${validId(x.aid)||x.bvid||'unknown'}:${root}`;
      const contextHistory=(db.threadHistory?.[threadKey]||[]).slice(-20);
      const history=contextHistory.map(h=>({role:h.role,text:String(h.text||'').slice(0,350)}));
      // Retry an existing draft unchanged; no extra AI or video-context fetching.
      // Older failures have no draft and must regenerate from fresh real context.
      const draft=verifiedRetry?String(saved?.generatedReply||'').trim().slice(0,130):'';
      let videoContext={text:'',usable:false};
      if(!draft){
        try{videoContext=await getVideoContext(x.bvid,{aid:x.aid,root:x.root,rpid:x.rpid,targetId:x.targetId,text:x.text,context:x.context,kind:x.kind});}
        catch(e){logger.warn?.('强制回复时读取视频上下文失败：'+String(e.message||e).slice(0,140));}
      }
      x.contextSummary=draft?String(saved?.contextSummary||'').slice(0,300):String(videoContext?.summary||'').slice(0,300);
      x.rootPreview=draft?String(saved?.rootPreview||''):String(videoContext?.rootPreview||'');
      x.threadPreview=draft?String(saved?.threadPreview||''):String(videoContext?.threadPreview||'');
      if(!draft&&!videoContext?.usable){interactionNote(db,{...x,forced:true},'manual_context_unavailable');await save(db);throw Error('视频与评论上下文不可用，不能在不了解内容的情况下强制回复；可查看卡片中的上下文诊断后再试');}
      const parentContext=x.context&&!String(videoContext?.text||'').includes(String(x.context))?'被回复的内容：'+String(x.context).slice(0,320):'';
      const context=[videoContext?.text||'',parentContext,history.length?'当前视频同一评论串的近况：'+history.map(h=>(h.role==='assistant'?'大肥鱼':'观众')+'：'+h.text).join('；'):''].filter(Boolean).join('\n').slice(0,10000);
      let result=draft;
      if(!draft){
        try{result=await generateReply({kind:'comment',mode:x.scope,text:x.text,uid:x.uid,memeSourceText:x.context,context,history,bvid:x.bvid,mustReply:true,canSkip:false,forceReply:true});}
        catch(e){x.errorDetail=safeErrorDetail(e);interactionNote(db,{...x,forced:true},'manual_ai_generation_error');await save(db);throw Error('AI 生成失败：'+x.errorDetail.slice(0,120));}
      }
      const reply=String(result||'').trim().slice(0,130);
      if(!reply||reply==='SKIP'){interactionNote(db,{...x,forced:true},'manual_ai_skipped');await save(db);throw Error('AI 这次仍然没有给出可发送的回复；诊断已记录，可以稍后重试');}
      x.generatedReply=reply;
      db.seen[x.id]='manual-pending';if(sourceKey)db.seen[sourceKey]='manual-pending';
      const attempt={at:now(),outcome:'pending',scope:x.scope,bvid:validBv(x.bvid)?x.bvid:'',
        id:x.id,sourceKey,forced:true,verifiedMissing:verifiedRetry,reusedDraft:!!draft,generatedReply:reply};
      if(verifiedRetry){
        const key=verificationKeyFor(x);
        db.manualVerifiedRetries??={};
        for(const [k,stamps] of Object.entries(db.manualVerifiedRetries)){
          const recent=(Array.isArray(stamps)?stamps:[]).filter(t=>Number(t)>now()-WINDOW);
          if(recent.length)db.manualVerifiedRetries[k]=recent;
          else delete db.manualVerifiedRetries[k];
        }
        db.manualVerifiedRetries[key]=[...(db.manualVerifiedRetries[key]||[]),now()];
      }
      db.sendAttempts.push(attempt);
      db.sendAttempts=db.sendAttempts.filter(a=>Number(a.at)>now()-7*WINDOW).slice(-10000);
      await save(db);
      try{
        const ack=await send({bvid:x.bvid,aid:x.aid,rpid:x.rpid,root:x.root,text:reply,manual:true});
        if(ack!==true&&ack?.ok!==true)throw Error(ack?.error||'评论未收到成功回执');
        attempt.outcome='success';attempt.completedAt=now();
        db.seen[x.id]='manual-sent';if(sourceKey)db.seen[sourceKey]='manual-sent';interactionNote(db,{...x,forced:true},'sent');db.sent.push(now());
        db.replyRecords=windowRecords(db);
        db.replyRecords.push({at:now(),uid:x.uid,scope:x.scope,threadKey,bvid:validBv(x.bvid)?x.bvid:'',aid:validId(x.aid),
          outboundRpid:validId(ack?.rpid||ack?.rpid_str),recipientName:String(x.name||'').trim().slice(0,60),recipientUid:validId(x.uid),
          recipientComment:String(x.text||'').trim().slice(0,420)});
        const outboundId=validId(ack?.rpid||ack?.rpid_str);
        if(outboundId&&validBv(x.bvid)){
          db.replyLabels??={};
          db.replyLabels[x.bvid+':'+outboundId]={recipientName:String(x.name||'').trim().slice(0,60),recipientUid:validId(x.uid),recipientComment:String(x.text||'').trim().slice(0,420),at:now()};
          const keys=Object.keys(db.replyLabels);if(keys.length>30000)for(const k of keys.slice(0,keys.length-30000))delete db.replyLabels[k];
        }
        if(outboundId)db.ownReplies[outboundId]={at:now(),root,aid:validId(x.aid),bvid:x.bvid||''};
        const h=db.threadHistory?.[threadKey]??[];
        h.push({role:'user',uid:x.uid,text:String(x.text).slice(0,350)},{role:'assistant',uid:self,text:reply});
        if(h.length>24)h.splice(0,h.length-24);
        db.threadHistory[threadKey]=h;
        const keys=Object.keys(db.seen);if(keys.length>5000)for(const k of keys.slice(0,keys.length-5000))delete db.seen[k];
        await save(db);
        return {ok:true,reply,rpid:validId(ack?.rpid||ack?.rpid_str),id:x.id,contextSummary:x.contextSummary,verifiedRetry,reusedDraft:!!draft};
      }catch(e){
        x.errorDetail=safeErrorDetail(e);
        const outcome=errorClass(x.errorDetail);attempt.outcome=outcome;attempt.completedAt=now();
        attempt.errorDetail=x.errorDetail;
        if(outcome==='blocked_quota'||outcome==='blocked_quota_store'){
          const today=localDayKey(now()),globalLimit=cap(getConfig().globalDailyLimit,0,1000,10);
          db.seen[x.id]=`quota-blocked:${today}:${globalLimit}`;if(sourceKey)db.seen[sourceKey]=db.seen[x.id];
          const storeError=outcome==='blocked_quota_store';
          db.globalQuotaBlocked={day:today,limit:globalLimit,at:now(),reason:storeError?'store-error':'limit',retryAfter:storeError?now()+300_000:0};
          interactionNote(db,{...x,forced:true},storeError?'quota_store_blocked':'quota_exhausted');
        }else{
          db.seen[x.id]='manual-uncertain';if(sourceKey)db.seen[sourceKey]='manual-uncertain';interactionNote(db,{...x,forced:true},outcome==='uncertain'?'manual_send_uncertain':outcome==='failed'?'manual_send_failed':'send_'+outcome);
        }
        await save(db);
        if(outcome==='uncertain')throw Error('发送结果不确定，为防止重复回复已禁止再次自动发送：'+String(e?.message||e).slice(0,120));
        throw Error('发送失败：'+String(e?.message||e).slice(0,140));
      }
    }finally{busy=false;if(handle){await handle.close().catch(()=>{});await unlink(lockPath).catch(()=>{});}}
  }

  async function poll({notifications=true,top=true,mentions=true}={}){
    if(busy)return {skipped:'busy'};
    const cfg=getConfig();if(!cfg.watchReplies&&!cfg.watchTop&&!cfg.watchAt)return {skipped:'disabled'};
    busy=true;let handle;
    try{
      await mkdir(dataDir,{recursive:true});handle=await lock();if(!handle)return {skipped:'locked'};
      const db=await load();
      const today=localDayKey(now()),globalLimit=cap(cfg.globalDailyLimit,0,1000,10);
      // 全局公开评论额度已经耗尽时，整轮停止，不让每分钟的后台轮询反复生成回复、反复调用 MCP。
      // 新自然日或用户修改全局上限后会重新检查；旧通知不会被永久标成已回复。
      const sameQuotaBlock=!!(db.globalQuotaBlocked&&db.globalQuotaBlocked.day===today&&Number(db.globalQuotaBlocked.limit)===globalLimit);
      const feedbackOnly=globalLimit===0||(sameQuotaBlock&&db.globalQuotaBlocked.reason!=='store-error');
      // Keep accepting authenticated, recent feedback even after public-comment quota
      // exhaustion; do not make any AI or public-send calls in this mode.
      if(sameQuotaBlock&&db.globalQuotaBlocked.reason==='store-error'&&Number(db.globalQuotaBlocked.retryAfter)>now()){
        lastPollAt=now();lastError='';return {sent:0,failed:0,ignored:0,limitSkipped:0,quotaBlocked:0,skipped:'quota-store-cooldown'};
      }
      if(db.globalQuotaBlocked&&!feedbackOnly){
        const retryingStoreError=db.globalQuotaBlocked.reason==='store-error';
        db.globalQuotaBlocked=null;
        for(const [id,value] of Object.entries(db.seen)){
          if(typeof value==='string'&&value.startsWith('quota-blocked:')){
            const [,blockedDay,blockedLimit]=value.split(':');
            if(retryingStoreError||blockedDay!==today||Number(blockedLimit)!==globalLimit)delete db.seen[id];
          }
        }
        await save(db);
      }
      const self=String(await selfUid());if(!/^\d+$/.test(self)||self==='0')throw Error('没有登录 UID，停止评论回复');
      const ownedRaw=await getOwnComments();
      const owned={top:new Set(ownedRaw?.top||[]),nested:new Set(ownedRaw?.nested||[])};
      const candidates=[];let baselined=0;
      if(cfg.watchReplies&&notifications){
        const dropped=[];
        const received=normalizeReplyNotifications(await getNotifications(),self,{onIgnored:x=>dropped.push(x)});
        db.replyLastFetch={at:now(),rawCount:received.length+dropped.length,recognized:received.length,invalid:dropped.length};
        for(const x of dropped)replyNote(db,x,x.reason);
        if(db.notificationBootstrapped && db.replyParserVersion!==1){
          // 升级解析器后不补发旧版本漏识别的陈年评论通知；后续真正新消息照常处理。
          for(const x of received)if(!db.seen[x.id]){
            db.seen[x.id]='reply-parser-upgrade-baseline';replyNote(db,x,'parser_upgrade_baseline');
          }
          db.replyParserVersion=1;await save(db);
        }
        if(!db.notificationBootstrapped){
          // 首次启动仅恢复有明确近24小时日期且能证明回复了我自己的评论的通知。
          // 无时间/无归属的不补发，避免重装插件后对陈年通知群发回复。
          for(const x of received) {
            const scope=scopeOf(x,owned,db.ownReplies);
            if((scope==='self-top'||scope==='self-nested') &&
              x.timestampMs>now()-WINDOW && x.timestampMs<=now()+60_000) candidates.push(x);
            else { db.seen[x.id]='baseline';replyNote(db,x,'first_poll_baseline');baselined++; }
          }
          db.notificationBootstrapped=true;db.replyParserVersion=1;await save(db);
        }else{
          for(const x of received)if(!db.seen[x.id])replyNote(db,x,'received');
          candidates.push(...received);
        }
      }
      if(cfg.watchAt&&mentions){
        const dropped=[];
        const received=normalizeAtNotifications(await getAtNotifications(),self,{onIgnored:x=>dropped.push(x)});
        db.atLastFetch={at:now(),rawCount:received.length+dropped.length,recognized:received.length,invalid:dropped.length};
        for(const x of dropped)atNote(db,x,x.reason);
        // 首次开启只对已有通知作历史基线；此后的新 @ 会正常进入判断。
        if(db.atBootstrapped && db.atParserVersion!==1){
          // 旧版本因解析器缺陷未能识别的通知，不在更新后突然批量补发。
          for(const x of received){
            if(!db.seen[x.id]){db.seen[x.id]='at-parser-upgrade-baseline';atNote(db,x,'parser_upgrade_baseline');}
          }
          db.atParserVersion=1;await save(db);
        }
        if(!db.atBootstrapped){
          for(const x of received){db.seen[x.id]='at-baseline';atNote(db,x,'first_poll_baseline');}
          db.atBootstrapped=true;await save(db);
        }else{
          for(const x of received)if(!db.seen[x.id])atNote(db,x,'received');
          candidates.push(...received);
        }
      }
      if(cfg.watchTop&&top){
        const videos=(await getVideos()).filter(validBv).slice(0,cap(cfg.topVideoCount,1,6,3));
        for(const bv of videos){try{
          const comments=normalizeTopComments(await getComments(bv,cap(cfg.topCount,1,20,5)),bv,self);
          candidates.push(...comments.sort((a,b)=>Number(isFishBait(b.text))-Number(isFishBait(a.text))));
        }catch(e){logger.warn?.(`读取 ${bv} 评论失败：${String(e.message||e)}`);}}
      }
      const since=now()-WINDOW;
      db.sent=db.sent.filter(t=>Number(t)>since);
      db.replyRecords=windowRecords(db);
      const maxPoll=cap(cfg.replyPerPoll,1,5,1),maxDay=cap(cfg.replyPerDay,1,1000,5);
      const topCap=cap(cfg.ownTopPerUser,1,1000,5),nestedCap=cap(cfg.ownNestedPerUser,1,1000,3);
      let sent=0,ignored=0,failed=0,limitSkipped=0,quotaBlocked=0;
      const unique=new Set();
      const tagged=candidates.map(x=>({...x,scope:scopeOf(x,owned,db.ownReplies)}));
      // Trust-scoped recommendation feedback must not depend on AI deciding to reply.
      // Read-only observation happens even when per-user/public reply quotas are full.
      for(const x of tagged){
        if(!['notice','at'].includes(x.kind)||db.seen[x.id])continue;
        if(!x.timestampMs||x.timestampMs<=now()-WINDOW||x.timestampMs>now()+60_000)continue;
        try{await onIncoming(x)}catch(e){logger.warn?.('评论好友反馈记录失败：'+String(e?.message||e).slice(0,110))}
      }
      if(feedbackOnly){
        await save(db);lastPollAt=now();lastError='';
        return {sent:0,failed:0,ignored:0,limitSkipped:0,quotaBlocked:0,skipped:'global-quota-exhausted',observedFeedback:true};
      }
      // 我的顶层评论下 > 我的楼中楼回复下 > 其他回复通知 > 热门评论
      const order={'self-top':0,'self-nested':1,'at':2,'notice':3,'top':4};
      tagged.sort((a,b)=>order[a.scope]-order[b.scope]||(a.kind==='top'?Number(isFishBait(b.text))-Number(isFishBait(a.text)):0));
      for(const x of tagged){
        const sourceKey=x.kind==='at'||x.kind==='notice'?'source:'+x.aid+':'+x.rpid:'';
        if(unique.has(x.id)||(sourceKey&&(unique.has(sourceKey)||db.seen[sourceKey]))){
          if(!db.seen[x.id]){db.seen[x.id]='source-already-processed';interactionNote(db,x,'source_already_processed');}
          continue;
        }
        const prior=db.seen[x.id];
        if(x.kind==='at'){
          // Listening for trusted friends' preferences is NOT permission to publish.
          if(cfg.replyAt===false){db.seen[x.id]='at-feedback-only';atNote(db,x,'feedback_only');continue;}
          if(!cfg.watchAt){db.seen[x.id]='at-disabled';atNote(db,x,'disabled');continue;}
          if(cfg.atMode!=='all'){
            const permitted=new Set(readUidList(cfg.atWhitelist).keys());
            if(!permitted.has(x.uid)){db.seen[x.id]='at-not-in-whitelist';atNote(db,x,'not_in_whitelist');ignored++;continue;}
          }
          // Unknown time and old notifications must never trigger a public reply.
          if(!x.timestampMs || x.timestampMs<=now()-WINDOW || x.timestampMs>now()+60_000){
            db.seen[x.id]='at-out-of-window';atNote(db,x,'out_of_window');ignored++;continue;
          }
        }
        if(typeof prior==='string'&&prior.startsWith('quota-blocked:')){
          const [,blockedDay,blockedLimit]=prior.split(':');
          if(blockedDay===today&&Number(blockedLimit)===globalLimit)continue;
          delete db.seen[x.id];
        }
        if(db.seen[x.id])continue;
        if(x.kind==='at' && Number(db.atContextRetries?.[x.id]?.nextAt)>now())continue;
        unique.add(x.id);if(sourceKey)unique.add(sourceKey);
        if(sent>=maxPoll||db.sent.length>=maxDay){interactionNote(db,x,'reply_limit');break;}
        if(x.kind==='top'&&!cfg.allowGeneralTop&&!isFishBait(x.text)){db.seen[x.id]='irrelevant';ignored++;continue;}
        const capFor=x.scope==='self-top'?topCap:x.scope==='self-nested'?nestedCap:0;
        if(capFor&&db.replyRecords.filter(r=>r.uid===x.uid&&r.scope===x.scope).length>=capFor){
          db.seen[x.id]='per-user-limit';interactionNote(db,x,'per_user_limit');limitSkipped++;continue;
        }
        const root=validId(x.root)||validId(x.rpid);
        const threadKey=`${validId(x.aid)||x.bvid||'unknown'}:${root}`;
        const contextHistory=(db.threadHistory[threadKey]||[]).slice(-20);
        const history=contextHistory.map(h=>({role:h.role,text:String(h.text||'').slice(0,350)}));
        let videoContext={text:'',usable:false};
        try{videoContext=await getVideoContext(x.bvid,{aid:x.aid,root:x.root,rpid:x.rpid,targetId:x.targetId,text:x.text,context:x.context,kind:x.kind,includeHot:false});}
        catch(e){logger.warn?.('视频评论上下文不可用：'+String(e.message||e).slice(0,140));}
        x.contextSummary=String(videoContext?.summary||'').slice(0,300);
        x.rootPreview=String(videoContext?.rootPreview||'');
        x.threadPreview=String(videoContext?.threadPreview||'');
        if(x.kind==='at'&&!videoContext?.usable){
          const retry=db.atContextRetries[x.id]??{attempts:0};
          retry.attempts++;
          // Network / API failures are not proof the invitation is irrelevant.
          if(retry.attempts>=3){db.seen[x.id]='at-no-video-context';delete db.atContextRetries[x.id];atNote(db,x,'video_context_unavailable');}
          else {retry.nextAt=now()+5*60_000;db.atContextRetries[x.id]=retry;atNote(db,x,'waiting_for_video_context');}
          ignored++;continue;
        }
        if(x.kind==='at')delete db.atContextRetries[x.id];
        if(x.kind==='notice'&&!videoContext?.usable)replyNote(db,x,'video_context_partial');
        const parentContext=x.context&&!String(videoContext?.text||'').includes(String(x.context))?'被回复的内容：'+String(x.context).slice(0,320):'';
      const context=[videoContext?.text||'',parentContext,history.length?'当前视频同一评论串的近况：'+history.map(h=>(h.role==='assistant'?'大肥鱼':'观众')+'：'+h.text).join('；'):''].filter(Boolean).join('\n').slice(0,10000);
        let result;
        try{result=await generateReply({kind:'comment',mode:x.scope,text:x.text,uid:x.uid,memeSourceText:x.context,context,history,bvid:x.bvid,
          mustReply:x.scope==='self-top'||x.scope==='self-nested',canSkip:true});}
        catch(e){x.errorDetail=safeErrorDetail(e);logger.warn?.('生成评论失败：'+x.errorDetail);interactionNote(db,x,'ai_generation_error');failed++;continue;}
        let reply=String(result||'').trim().slice(0,130);
        if(reply&&reply!=='SKIP'&&validBv(x.bvid)){
          // Only now has the AI opted to reply: optionally read this video's hot comments and re-evaluate.
          try{
            const hotContext=await getVideoContext(x.bvid,{aid:x.aid,root:x.root,rpid:x.rpid,targetId:x.targetId,text:x.text,context:x.context,kind:x.kind,includeHot:true});
            if(hotContext?.counts?.hotProvided>0){
              const enriched=[hotContext.text,parentContext,history.length?'当前评论串历史：'+history.map(h=>h.text).join('；'):''].filter(Boolean).join('\n').slice(0,10000);
              reply=String(await generateReply({kind:'comment',mode:x.scope,text:x.text,uid:x.uid,memeSourceText:x.context,context:enriched,history,bvid:x.bvid,mustReply:false,canSkip:true})||'').trim().slice(0,130);
            }
          }catch(e){logger.warn?.('决定回复后获取热评或二次生成失败，本次只用已有上下文：'+String(e?.message||e).slice(0,120));}
        }
        if(!reply||reply==='SKIP'){
          db.seen[x.id]='skipped';if(sourceKey)db.seen[sourceKey]='skipped';interactionNote(db,x,'ai_skipped');ignored++;
          if(reply==='SKIP'){
            // 记下对方的收尾消息；以后同一评论串重新开始话题时仍能理解前情。
            const h=db.threadHistory[threadKey]??=[];
            h.push({role:'user',uid:x.uid,text:String(x.text).slice(0,350)});
            if(h.length>24)h.splice(0,h.length-24);
          }
          continue;
        }
        x.generatedReply=reply;
        db.seen[x.id]='pending';if(sourceKey)db.seen[sourceKey]='pending';
        const attempt={at:now(),outcome:'pending',scope:x.scope,bvid:validBv(x.bvid)?x.bvid:'',generatedReply:reply};
        db.sendAttempts.push(attempt);
        db.sendAttempts=db.sendAttempts.filter(a=>Number(a.at)>now()-7*WINDOW).slice(-10000);
        await save(db);
        try{
          const ack=await send({bvid:x.bvid,aid:x.aid,rpid:x.rpid,root:x.root,text:reply});
          if(ack!==true&&ack?.ok!==true)throw Error(ack?.error||'评论未收到成功回执');
          attempt.outcome='success';attempt.completedAt=now();
          db.seen[x.id]='sent';if(sourceKey)db.seen[sourceKey]='sent';interactionNote(db,x,'sent');db.sent.push(now());sent++;
          db.replyRecords.push({at:now(),uid:x.uid,scope:x.scope,threadKey,
            bvid:validBv(x.bvid)?x.bvid:'',aid:validId(x.aid),
            outboundRpid:validId(ack?.rpid||ack?.rpid_str),
            recipientName:String(x.name||'').trim().slice(0,60),recipientUid:validId(x.uid),
            recipientComment:String(x.text||'').trim().slice(0,420)});
          const outboundId=validId(ack?.rpid||ack?.rpid_str);
          if(outboundId&&validBv(x.bvid)){
            db.replyLabels??={};
            db.replyLabels[x.bvid+':'+outboundId]={recipientName:String(x.name||'').trim().slice(0,60),
              recipientUid:validId(x.uid),recipientComment:String(x.text||'').trim().slice(0,420),at:now()};
            // 有界存储，防止长期聊天造成状态文件无限增大。
            const keys=Object.keys(db.replyLabels);
            if(keys.length>30000)for(const k of keys.slice(0,keys.length-30000))delete db.replyLabels[k];
          }
          if(outboundId)db.ownReplies[outboundId]={at:now(),root,aid:validId(x.aid),bvid:x.bvid||''};
          const h=db.threadHistory[threadKey]??=[];
          h.push({role:'user',uid:x.uid,text:String(x.text).slice(0,350)}, {role:'assistant',uid:self,text:reply});
          if(h.length>24)h.splice(0,h.length-24);
        }catch(e){
          const message=safeErrorDetail(e),outcome=errorClass(message);
          x.errorDetail=message;attempt.outcome=outcome;attempt.completedAt=now();attempt.errorDetail=message;
          if(outcome==='blocked_quota'||outcome==='blocked_quota_store'){
            // 明确知道未发起公开发布：硬上限耗尽时暂停到次日/改设置；账本暂不可用时冷却5分钟后再试。
            db.seen[x.id]=`quota-blocked:${today}:${globalLimit}`;if(sourceKey)db.seen[sourceKey]=db.seen[x.id];
            const storeError=outcome==='blocked_quota_store';
            db.globalQuotaBlocked={day:today,limit:globalLimit,at:now(),reason:storeError?'store-error':'limit',retryAfter:storeError?now()+300_000:0};quotaBlocked++;
            interactionNote(db,x,storeError?'quota_store_blocked':'quota_exhausted');
            logger.warn?.(storeError?'公开评论额度账本不可用，本轮停止并冷却5分钟':'公开评论全局额度已阻止发送，本轮停止并暂停后续重复调用');
          }else{
            db.seen[x.id]='uncertain';if(sourceKey)db.seen[sourceKey]='uncertain';interactionNote(db,x,'send_'+outcome);failed++;
            logger.warn?.('评论发送未确认，不自动重试：'+outcome);
          }
        }
        await save(db);
        if(quotaBlocked)break;
      }
      const keys=Object.keys(db.seen);if(keys.length>5000)for(const k of keys.slice(0,keys.length-5000))delete db.seen[k];
      // 避免长期增长：自发评论 ID 保留90天，评论串最多500条。
      for(const [id,r] of Object.entries(db.ownReplies))if(Number(r.at)<now()-90*WINDOW)delete db.ownReplies[id];
      const retryKeys=Object.keys(db.atContextRetries||{});if(retryKeys.length>500)for(const k of retryKeys.slice(0,retryKeys.length-500))delete db.atContextRetries[k];
      const threads=Object.keys(db.threadHistory);if(threads.length>500)for(const k of threads.slice(0,threads.length-500))delete db.threadHistory[k];
      await save(db);lastPollAt=now();lastError='';
      return {sent,failed,ignored,limitSkipped,baselined,quotaBlocked};
    }catch(e){lastError=String(e.message||e);logger.error?.('评论监听失败：'+lastError);return {error:lastError};}
    finally{busy=false;if(handle){await handle.close().catch(()=>{});await unlink(lockPath).catch(()=>{});}}
  }
  return {poll,status,stateFile,forceReply};
}
