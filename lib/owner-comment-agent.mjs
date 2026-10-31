/** dev.5 Owner comment Agent: hard parser + platform identity + video-bound actions.
 * No private-session read adapter is accepted. Public acknowledgements are minimal templates.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
import {safeSocialReply} from './comment-social-ai.mjs'
import {recentOwnerSocialOutcomes} from './owner-comment-persuasion.mjs'
import {recordConfirmedRecipient} from './confirmed-comment-recipients.mjs'
const UID=/^[1-9]\d{0,18}$/,BV=/^BV[0-9A-Za-z]{10}$/
const FILE='owner-comment-agent.json',LIMIT=160_000
const SOFT_FOLLOWUP=/(?:拜托|求求|求你|球球|再考虑|好不好|就一次|再看看嘛|再说说嘛)/
const sanitize=(s,n=180)=>String(s||'').replace(/[\r\n\x00-\x1f]/g,' ').trim().slice(0,n)
function read(home){const file=join(home,FILE);if(!existsSync(file))return {version:1,items:[]}
  const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.size>LIMIT)throw Error('主人评论 Agent 账本不安全')
  const d=JSON.parse(readFileSync(file,'utf8'));if(d?.version!==1||!Array.isArray(d.items))throw Error('主人评论 Agent 账本版本异常')
  return {version:1,items:d.items.slice(-250)}}
function write(home,d){mkdirSync(home,{recursive:true});const file=join(home,FILE)
  if(existsSync(file)&&lstatSync(file).isSymbolicLink())throw Error('拒绝写入符号链接')
  const tmp=file+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.tmp'
  writeFileSync(tmp,JSON.stringify({version:1,items:d.items.slice(-250)},null,2)+'\n',{mode:0o600});renameSync(tmp,file)}
export function parseOwnerCommentIntent(text){
  const s=sanitize(text,800).replace(/(?:@大肥鱼|@小肥鱼|大肥鱼|小肥鱼)[\s,，:：]*/g,'').trim()
  if(!s)return null
  // Technical commands are not a natural way to speak in a public comment.
  // Consume them without publishing anything or turning them into AI chatter.
  if(/(?:发|发布|发表)(?:一条|个)?评论\s*[:：]|(?:写|生成|起草|保存|发布).{0,18}评论草稿|发布评论草稿/.test(s))return {type:'unsupported_public_command'}
  // Coin spending is not implemented by this plugin. Never improvise a payment tool.
  if(/(?:投个?币|投币|给.{0,8}币)/.test(s))return {type:'coin_unavailable'}
  if(/(?:别|不要|取消|撤销|不用|禁止|不想|不需要|不必).{0,20}(?:评论|发表|发布|点赞|点个赞|看看|来看)/.test(s))return null
  // 'If you like it, give it a like' is NOT a direct authorization to like.
  if(/(?:喜欢的话|觉得好(?:看|玩|有趣)的话|感兴趣(?:的话)?).{0,18}(?:点个赞|点赞|赞一个)/.test(s))
    return /(?:看看|来看|看一下|看一看|瞧瞧)/.test(s)?{type:'social_invite'}:null
  if(/(?:帮我|给|替我|请|麻烦|顺手|能不能|可以)?.{0,18}(?:这个|当前|这条)?(?:视频)?.{0,8}(?:点个赞|点赞|赞一个)/.test(s))return {type:'like'}
  // 'Look now' is a read-only immediate request, not permission to publish a comment.
  if(/(?:现在|立刻|马上|立即|立马).{0,15}(?:看看?|查看|观看|读视频)/.test(s))return {type:'watch_now'}
  if(/(?:有空|有时间|以后|稍后|回头|抽空|先记下).{0,15}(?:看看?|查看|观看)/.test(s))return {type:'watch_later'}
  // Natural requests to go to a video's own comment area are invitations to
  // explore and *consider* a top-level comment, not ordinary chat in this thread.
  // Require a destination, a comment/comfort action AND a request directed at us:
  // merely quoting a comment or discussing a video's comment section is chat.
  const videoCommentArea=/(?:视频.{0,8}(?:底下|下面|下方|评论区|评论里)|视频下|评论区)/.test(s)
  const videoCommentAct=/(?:发(?:一条|条|一个|个)?评论|留(?:一条|条|一个|个)?(?:言|评论)|评论(?:一下|两句|几句)?|安慰(?:一下|两句|几句)?)/.test(s)
  const videoCommentAsk=/(?:你.{0,15}(?:去|过来)|(?:请|麻烦|能不能|可不可以|要不要|不如|快|赶紧|一起来|一起).{0,12}去|(?:^|[，,。！？?!\s])(?:去|来|过来).{0,15})/.test(s)
  if(videoCommentArea&&videoCommentAct&&videoCommentAsk)return {type:'social_invite',commentRequested:true}
  // An invitation grants room for the fish to decide; it is NOT a publishing order.
  if(/(?:来|过来|一起|有空|有时间|抽空|先)?\s*(?:看一看|看看|看下|看一下|来看|瞧瞧|围观).{0,25}(?:视频|这个|这条|这里|怎么样|有趣|好玩|！|!|[？?])/.test(s)
    ||/(?:这个|这条|这期|该)?视频.{0,15}(?:你觉得|怎么看|有啥想法|有什么想法|发表.*看法)/.test(s)
    ||/(?:你觉得|你怎么看|怎么看|说说你的想法|说说看法|聊聊你的看法).{0,22}(?:视频|这个|这条|怎么样|如何)/.test(s)
    ||/(?:看完|看了).{0,14}(?:说说|聊聊|谈谈).{0,10}(?:想法|看法|感受)/.test(s)
    ||/(?:来|过来)?\s*(?:评论一下|聊聊|说说).{0,12}(?:这个|这条|视频)/.test(s)
  )return {type:'social_invite'}
  return null
}

// Skip feedback is a short public reply to the verified owner's existing @,
// never a newly authored top-level comment or a claim that video was watched.
const SKIP_REPLY={
  'low-willingness-defer':'今天有点懒，想先放一放，过会儿再叫我嘛～🐟',
  'low-willingness-refuse':'这会儿真不太想评论，容我偷个懒～🐟',
  'video-context-insufficient':'这里的视频资料还不够我形成看法，先不乱评论啦～🐟',
  'self-chose-not-to-comment:not-interested':'这次暂时没激起我的表达欲，就先不留评论啦～🐟',
  'self-chose-not-to-comment:no-opinion':'想了想还是没什么具体想说的，这次先不评论啦～🐟',
  'self-chose-not-to-comment:insufficient-context':'我现在掌握的内容还不够，不想乱评论～🐟',
  'self-chose-not-to-comment:low-energy':'今天有点没精神，先不评论啦～🐟',
}
export function ownerSocialSkipReply(reason){
  const key=Object.keys(SKIP_REPLY).find(k=>reason===k||String(reason||'').endsWith('（'+k+'）'))
  return SKIP_REPLY[key]||'这次我先不发表评论啦，有想法时再聊～🐟'
}
const ACK={watch_now:[],watch_later:[],like:['点好啦～🐳','这就给它点上啦。'],comment_publish:['发出去啦～','评论发好啦。'],comment_draft:[]}
export function createOwnerCommentAgent({dataDir,getConfig,perform,decideAgency=null,sendReply=async()=>({ok:false}),generateChat=async()=> 'SKIP',deferWatch=async()=>({ok:false}),onDeliberateSilence=async()=>{},interpretSocial=null,recordAgency=null,getRole=null,now=Date.now,logger=console}){
  if(!dataDir||typeof getConfig!=='function'||typeof perform!=='function')throw TypeError('owner comment dependencies missing')
  let busy=false
  async function accept(row){
    const cfg=getConfig(),uid=String(row?.uid||''),bvid=String(row?.bvid||''),rpid=String(row?.rpid||''),id=String(row?.id||'')
    const role=typeof getRole==='function'?getRole(uid):'owner'
    const owner=role==='owner'
    if(cfg.masterEnabled!==true||(owner?cfg.ownerCommentAgentEnabled!==true
      :role!=='friend'||!(row.kind==='notice'?cfg.commentWatchReplies===true:cfg.commentAtEnabled===true)))
      return {ok:false,reason:'disabled'}
    // Reply notifications are trusted ONLY when linked to a comment the account authored.
    if(!['at','notice'].includes(row?.kind)||!UID.test(uid)||(owner&&uid!==String(cfg.dmOwnerUid||''))||!BV.test(bvid)||!/^\d{1,30}$/.test(rpid)||!id || (row.kind==='notice'&&!['self-top','self-nested'].includes(row.scope)&&row.verifiedOwnerReply!==true))return {ok:false,reason:'not-verified-owner-comment'}
    const timestamp=Number(row.timestampMs)
    if(!Number.isSafeInteger(timestamp)||timestamp>now()+60_000||now()-timestamp>24*3_600_000)return {ok:false,reason:'stale'}
    const rootId=String(row.locationRoot||row.root||row.rpid||'')
    const thread=/^[1-9]\d{0,29}$/.test(rootId)?bvid+':'+rootId:''
    let action=typeof interpretSocial==='function'?{type:'ai-pending'}:parseOwnerCommentIntent(row.text)
    // Elliptical persuasion inherits ONLY an earlier refused invitation on the
    // exact verified comment thread (or direct parent of our acknowledged reply).
    if(typeof interpretSocial!=='function'&&!action&&thread&&SOFT_FOLLOWUP.test(sanitize(row.text,280))){
      const parent=String(row.targetId||'')
      const previous=read(dataDir).items.slice().reverse().find(x=>x.bvid===bvid&&x.key.startsWith(uid+':')&&x.type==='social_invite'
        &&x.status==='skipped'&&(x.thread===thread||(parent&&x.replyRpid===parent))
        &&now()-Number(x.at)>=0&&now()-Number(x.at)<12*3600_000)
      if(previous)action={type:'social_invite',...(previous.commentRequested===true?{commentRequested:true}:{})}
    }
    // Even a first reply with no @ can be ordinary social conversation.
    if(!action)action={type:'chat'}
    if(action.type==='unsupported_public_command')return {ok:true,skipped:'public-technical-command-disabled'}
    if(action.type==='coin_unavailable')return {ok:true,skipped:'coin-not-implemented'}
    if(typeof interpretSocial!=='function'&&(action.type==='like'&&cfg.ownerCommentLikeEnabled!==true || action.type==='chat'&&cfg.ownerCommentSocialPublishEnabled!==true))return {ok:false,reason:'action-disabled'}
    if(busy)return {ok:false,reason:'busy'}
    const d=read(dataDir),key=uid+':'+id
    if(d.items.some(x=>x.key===key))return {ok:true,skipped:'duplicate'}
    // Friends use the normal comment per-user caps even though their single-AI
    // path is consumed before the generic reply engine runs.
    if(role==='friend'){
      const rawLimit=row.scope==='self-nested'?cfg.commentOwnNestedPerUser:cfg.commentOwnTopPerUser
      const perUserLimit=Math.max(0,Math.min(100,Number.isFinite(Number(rawLimit))?Math.floor(Number(rawLimit)):3))
      const attempts=d.items.filter(x=>x.key.startsWith(uid+':')&&now()-x.at<86400_000
        &&x.scope===row.scope&&['sent','reserved','uncertain'].includes(x.replyStatus)).length
      if(attempts>=perUserLimit)return {ok:true,skipped:'friend-reply-quota'}
    }
    const priorCommentOutcomes=recentOwnerSocialOutcomes(d.items,{uid,bvid,thread,at:now()})
    // Keep the already-verified incoming identity next to the reply receipt.
    // The public comment ledger stays authoritative for the existence of a sent
    // comment; this metadata is only for displaying the person we answered.
    const record={key,type:action.type,bvid,thread,at:now(),status:'claimed',replyStatus:'not-requested',scope:row.scope,
      recipientUid:uid,recipientName:sanitize(row.name,60),recipientComment:sanitize(row.text,220),
      ...(role==='friend'?{role:'friend'}:{})}
    if(action.commentRequested===true)record.commentRequested=true
    d.items.push(record);write(dataDir,d) // duplicate protection before external effects
    const sendRecordedReply=async(args)=>{
      const ack=await sendReply(args)
      // Verified incoming UID and actual outgoing platform receipt must both be present.
      // Recording display metadata must never cause a second public send on failure.
      const sent=ack===true||ack?.ok===true
      if(sent&&/^[1-9]\d{5,29}$/.test(String(ack?.rpid||''))) {
        try{recordConfirmedRecipient(dataDir,{bvid,rpid:String(ack.rpid),uid,name:row.name,comment:row.text,at:now()})}
        catch(e){logger.warn?.('已确认评论的接收人索引写入失败：'+sanitize(e?.message||e,120))}
      }
      return ack
    }
    busy=true
    // Skip replies are allowed by the social-comment permission itself; they do not
    // depend on the separate success-ack toggle. Reserve before sending, never retry.
    const feedbackOnSkip=async()=>{
      if(!['social_invite','watch_now','like'].includes(action.type)||record.status!=='skipped')return
      const current=getConfig()
      if(current.masterEnabled!==true||(owner
        ?current.ownerCommentAgentEnabled!==true||current.ownerCommentSocialPublishEnabled!==true||String(current.dmOwnerUid||'')!==uid
        :!(row.kind==='notice'?current.commentWatchReplies===true:current.commentAtEnabled===true)||getRole?.(uid)!=='friend')
        ||Number(current.commentDailyLimit)<=0||Number(current.commentReplyPerDay)<=0){record.replyStatus='blocked';write(dataDir,d);return}
      record.replyStatus='reserved';write(dataDir,d)
      const replyText=safeSocialReply(record.ownerReply)|| (action.type==='social_invite'&&record.inspection==='title-only'&&String(record.reason).includes('insufficient-context')
        ?'我去查了这个视频，目前只能取得标题，没读到字幕或画面；不敢假装看完了，先不乱评论啦～🐟'
        :action.type==='watch_now'
        ?(record.reason==='low-willingness-defer'?'现在想休息一下，我记下来，之后自己找时间看看吧～🐟':'现在还不太想看这个视频，先不看啦～🐟')
        :action.type==='like'?'这次我还不想点赞，先聊聊嘛～🐟':ownerSocialSkipReply(record.reason))
      try{const ack=await sendRecordedReply({bvid,rpid,root:String(row.root||''),text:replyText,actorUid:uid,kind:'social-skip',channel:row.kind})
        record.replyStatus=ack===true||ack?.ok===true?'sent':'uncertain';if(ack?.rpid)record.replyRpid=String(ack.rpid)}catch{record.replyStatus='uncertain'}
      write(dataDir,d)
    }
    // A result reply is independent of any top-level publication. Reserve first:
    // unknown receipts must not trigger an automatic retry on the next poll.
    const replyForOutcome=async(text)=>{
      const answer=safeSocialReply(text)
      if(!answer)return
      const current=getConfig()
      if(current.masterEnabled!==true||Number(current.commentDailyLimit)<=0||Number(current.commentReplyPerDay)<=0
        ||(owner?(current.ownerCommentAgentEnabled!==true||current.ownerCommentSocialPublishEnabled!==true||String(current.dmOwnerUid||'')!==uid)
          :(!(row.kind==='notice'?current.commentWatchReplies===true:current.commentAtEnabled===true)||getRole?.(uid)!=='friend'))){
        record.replyStatus='blocked';write(dataDir,d);return
      }
      record.replyStatus='reserved';write(dataDir,d)
      try{const ack=await sendRecordedReply({bvid,rpid,root:String(row.root||''),text:answer,actorUid:uid,kind:'social-result',channel:row.kind})
        record.replyStatus=ack===true||ack?.ok===true?'sent':'uncertain'
        if(ack?.rpid)record.replyRpid=String(ack.rpid)
      }catch{record.replyStatus='uncertain'}
      write(dataDir,d)
    }
    try{
      // Trusted owner/friend comments: ONE model call chooses intent and first
      // willingness. No regexp route and no second willingness model call.
      let first=null
      if(typeof interpretSocial==='function'){
        try{first=await interpretSocial({...row,thread,role,priorCommentOutcomes})}
        catch(e){record.status='failed';record.reason='social-ai-unavailable';write(dataDir,d)
          logger.warn?.('可信评论 AI 解析失败：'+sanitize(e?.message||e,100));return {ok:false,status:'failed',reason:record.reason}}
        if(!first||!['chat','social_invite','watch_now','watch_later','like','coin_unavailable'].includes(first.intent)
          ||!safeSocialReply(first.reply)||!['allow','defer','refuse'].includes(first.decision)){
          record.status='failed';record.reason='invalid-social-ai-decision';write(dataDir,d);return {ok:false,status:'failed',reason:record.reason}
        }
        action={type:first.intent,...(first.commentRequested===true?{commentRequested:true}:{})}
        record.type=action.type
        if(action.commentRequested)record.commentRequested=true
        write(dataDir,d)
      }
      if(action.type==='coin_unavailable'||action.type==='unsupported_public_command'){
        record.status='skipped';record.reason='coin-not-implemented'
        write(dataDir,d);await replyForOutcome(first?.reply||'鱼鱼还没有投币能力啦～🐟')
        return {ok:true,status:record.status,replyStatus:record.replyStatus}
      }
      if(action.type==='like'&&(!owner||getConfig().ownerCommentLikeEnabled!==true)){
        record.status='skipped';record.reason='action-not-authorized';write(dataDir,d)
        await replyForOutcome('这个点赞请求目前不在可用权限内，先不操作啦～🐟')
        return {ok:true,status:record.status,replyStatus:record.replyStatus}
      }
      // A 'watch sometime' recommendation is optional input to the EXISTING
      // autonomous TODOs, not a request to execute. Never consume AI willingness
      // quota merely to file a read-only candidate, same as a stranger's BV.
      if(action.type==='watch_later'){
        let result
        try{result=await perform({type:'watch_later',bvid,actorUid:uid,messageId:id})}catch(e){result={ok:false,error:sanitize(e?.message||e,120)}}
        record.status=result?.ok===true?'done':'failed';record.reason=sanitize(result?.error||result?.summary||'',120);write(dataDir,d)
        if(first)await replyForOutcome(record.status==='done'?first.reply:'我想记下来，不过这次没能成功存进待办～🐟')
        return {ok:record.status==='done',status:record.status,reason:record.reason,replyStatus:record.replyStatus}
      }
      // Social invitations and likes are requests outside the main Session, not orders.
      // Hard authorization was checked above; this gate can deny, never grant tools.
      let willingness=null
      if(first&&action.type==='chat'){
        // chat has no action willingness ledger, and the first AI already wrote the reply.
      }else if(first&&action.type!=='watch_later'){
        let will
        try{will=await recordAgency?.({uid,messageId:id,text:row.text,intent:action.type==='social_invite'?'explore':action.type==='like'?'like':'explore',action:action.type,bvid,thread,decision:first.decision})}
        catch(e){record.status='failed';record.reason='willingness-record-unavailable';write(dataDir,d);return {ok:false,status:'failed',reason:record.reason}}
        if(!will||will.decision==='blocked'){record.status='failed';record.reason='willingness-record-unavailable';write(dataDir,d);return {ok:false,status:'failed',reason:record.reason}}
        if(first.decision!=='allow'){
          record.status='skipped';record.reason=first.decision==='defer'?'ai-defer':'ai-refuse';record.ownerReply=first.reply
          write(dataDir,d)
          if(action.type==='watch_now'&&first.decision==='defer')try{await deferWatch({bvid,row})}catch{}
          await feedbackOnSkip()
          return {ok:true,status:'skipped',replyStatus:record.replyStatus}
        }
        willingness={decision:'allow',score:null,attempt:will.attempt}
      }else if(typeof decideAgency==='function'){
        let will
        try{will=decideAgency({uid,messageId:id,text:row.text,intent:action.type==='like'?'like':action.type==='chat'?'chat':action.commentRequested===true?'publish':'explore',bvid,thread})}
        catch(e){
          record.status='failed';record.reason='willingness-evaluation-unavailable';write(dataDir,d)
          logger.warn?.('主人评论意愿状态不可用：'+sanitize(e?.message||e,80))
          return {ok:false,status:'failed',reason:record.reason}
        }
        if(will?.decision!=='allow'){
          record.status='skipped';record.reason=sanitize(will?.reason||'willingness-declined',120)
          write(dataDir,d)
          if(action.type==='watch_now'&&will?.decision==='defer'){try{await deferWatch({bvid,row})}catch(e){logger.warn?.('主人视频延期待办失败：'+sanitize(e?.message||e,80))}}
          await feedbackOnSkip()
          return {ok:true,status:'skipped',reason:record.reason,replyStatus:record.replyStatus}
        }
        willingness={score:will.score,attempt:will.attempt,decision:will.decision}
      }
      // Local conversation can be accepted while a requested action is refused.
      // Keep this a single bounded model request, never a top-level publish.
      if(action.type==='chat'){
        let answer='SKIP'
        try{answer=first?safeSocialReply(first.reply):sanitize(await generateChat({...row,thread}),130)}catch(e){record.reason='chat-model-failed';record.status='failed';write(dataDir,d);return {ok:false,reason:record.reason}}
        if(!answer||answer==='SKIP'){record.status='skipped';record.reason='chose-silence';write(dataDir,d);
          try{await onDeliberateSilence({uid,bvid,rpid,text:row.text})}catch(e){logger.warn?.('记录主动沉默失败：'+sanitize(e?.message||e))}
          return {ok:true,status:'skipped'}}
        record.replyStatus='reserved';write(dataDir,d)
        try{const ack=await sendRecordedReply({bvid,rpid,root:String(row.root||''),text:answer,actorUid:uid,kind:'social-chat',channel:row.kind})
          record.replyStatus=ack?.ok===true?'sent':'uncertain';if(ack?.rpid)record.replyRpid=String(ack.rpid)}catch{record.replyStatus='uncertain'}
        record.status=record.replyStatus==='sent'?'done':'uncertain';write(dataDir,d)
        return {ok:record.status==='done',status:record.status,replyStatus:record.replyStatus}
      }
      // The source BV is platform-grounded; a BV in the user's text never changes it.
      let result
      try{result=await perform({...action,...(action.type==='social_invite'?{invitation:sanitize(row.text,280),willingness,...(first?{aiSocial:true,role,priorCommentOutcomes}:{}),...(action.commentRequested===true?{commentRequested:true}:{})}:{}),bvid,actorUid:uid,...(['watch_later','watch_now'].includes(action.type)?{messageId:id}:{})})}catch(e){result={ok:false,uncertain:true,error:String(e?.message||e)}}
      record.status=result?.ok===true?(result?.skipped===true?'skipped':'done'):result?.uncertain===true?'uncertain':'failed'
      record.reason=sanitize(result?.error||result?.summary||'',120)
      if(result?.commentDecision)record.commentDecision=sanitize(result.commentDecision,20)
      if(result?.inspected===true)record.inspection=['title-only','related-text','content-text'].includes(result.inspection)?result.inspection:'checked'
      write(dataDir,d)
      if(first&&action.type==='social_invite'){
        if(record.status==='skipped'){
          record.ownerReply=safeSocialReply(result?.ownerReply)||ownerSocialSkipReply(record.reason)
          write(dataDir,d);await feedbackOnSkip()
        }else{
          const outcomeReply=record.status==='done'?result?.ownerReplySuccess
            :record.status==='uncertain'?result?.ownerReplyUncertain:result?.ownerReplyFailure
          await replyForOutcome(outcomeReply||(record.status==='done'?'我尝试过评论啦～🐟':record.status==='uncertain'?'我尝试发送了，但没确认成功，先不重复发～🐟':'我试过了，但这次没能成功发表评论～🐟'))
        }
        return {ok:record.status==='done'||record.status==='skipped',status:record.status,replyStatus:record.replyStatus}
      }
      if(first&&action.type!=='chat'&&record.status!=='skipped'){
        await replyForOutcome(record.status==='done'?(action.type==='watch_later'?'先记下来，有空再探索～🐟':action.type==='watch_now'?'已经尝试查看啦～🐟':'鱼鱼试过啦～🐟')
          :record.status==='uncertain'?'结果还没确认，先不重复操作啦～🐟':'我试过啦，不过这次没有执行成功～🐟')
      }
      if(record.status==='skipped'){if(first)record.ownerReply=first.reply;await feedbackOnSkip();return {ok:true,status:'skipped',replyStatus:record.replyStatus}}
      if(first)return {ok:record.status==='done',status:record.status,replyStatus:record.replyStatus}
      if(record.status!=='done'||cfg.ownerCommentNaturalAckEnabled!==true||!ACK[action.type]?.length)return {ok:record.status==='done'||record.status==='skipped',status:record.status}
      // Public replies never contain model-generated private content or action args.
      if(cfg.commentDailyLimit<=0||cfg.commentReplyPerDay<=0)return {ok:true,status:record.status,ack:'quota-disabled'}
      record.replyStatus='reserved';write(dataDir,d)
      const replies=ACK[action.type],chosen=replies[Number.parseInt(id.match(/\d+/)?.[0]||'0',10)%replies.length]
      try{const ack=await sendRecordedReply({bvid,rpid,root:String(row.root||''),text:chosen,actorUid:uid})
        record.replyStatus=ack===true||ack?.ok===true?'sent':'uncertain';if(record.replyStatus==='sent'&&ack?.rpid)record.replyRpid=String(ack.rpid)}catch{record.replyStatus='uncertain'}
      write(dataDir,d)
      return {ok:true,status:record.status,ack:record.replyStatus}
    }finally{busy=false}
  }
  const status=()=>({ok:true,recent:read(dataDir).items.slice(-40).map(({key,...x})=>x)})
  return {accept,status}
}
