/** dev.5 Owner comment Agent: hard parser + platform identity + video-bound actions.
 * No private-session read adapter is accepted. Public acknowledgements are minimal templates.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const UID=/^[1-9]\d{0,18}$/,BV=/^BV[0-9A-Za-z]{10}$/
const FILE='owner-comment-agent.json',LIMIT=160_000
const SOFT_FOLLOWUP=/^(?:@?(?:大肥鱼|小肥鱼)[\s，,:：]*)?(?:拜托|求求|求你|球球|再考虑一下|好不好|就一次|再看看嘛)/
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
const ACK={like:['点好啦～🐳','这就给它点上啦。'],comment_publish:['发出去啦～','评论发好啦。'],comment_draft:[]}
export function createOwnerCommentAgent({dataDir,getConfig,perform,decideAgency=null,sendReply=async()=>({ok:false}),now=Date.now,logger=console}){
  if(!dataDir||typeof getConfig!=='function'||typeof perform!=='function')throw TypeError('owner comment dependencies missing')
  let busy=false
  async function accept(row){
    const cfg=getConfig(),uid=String(row?.uid||''),bvid=String(row?.bvid||''),rpid=String(row?.rpid||''),id=String(row?.id||'')
    if(cfg.ownerCommentAgentEnabled!==true||cfg.masterEnabled!==true)return {ok:false,reason:'disabled'}
    if(row?.kind!=='at'||!UID.test(uid)||uid!==String(cfg.dmOwnerUid||'')||!BV.test(bvid)||!/^\d{1,30}$/.test(rpid)||!id)return {ok:false,reason:'not-verified-owner-comment'}
    const timestamp=Number(row.timestampMs)
    if(!Number.isSafeInteger(timestamp)||timestamp>now()+60_000||now()-timestamp>24*3_600_000)return {ok:false,reason:'stale'}
    let action=parseOwnerCommentIntent(row.text)
    // A gentle, elliptical follow-up can re-open only an earlier refused VIDEO
    // invitation on this exact owner's BV. It never inherits a like/write command.
    if(!action&&SOFT_FOLLOWUP.test(sanitize(row.text,280))){
      const previous=read(dataDir).items.slice().reverse().find(x=>x.bvid===bvid&&x.key.startsWith(uid+':')&&x.type==='social_invite'
        &&x.status==='skipped'&&/^low-willingness-/.test(x.reason||'')&&now()-Number(x.at)>=0&&now()-Number(x.at)<12*3600_000)
      if(previous)action={type:'social_invite'}
    }
    if(!action)return {ok:true,skipped:'no-command'}
    if(action.type==='unsupported_public_command')return {ok:true,skipped:'public-technical-command-disabled'}
    if(action.type==='coin_unavailable')return {ok:true,skipped:'coin-not-implemented'}
    if(action.type==='like'&&cfg.ownerCommentLikeEnabled!==true || action.type==='social_invite'&&cfg.ownerCommentSocialPublishEnabled!==true)return {ok:false,reason:'action-disabled'}
    if(busy)return {ok:false,reason:'busy'}
    const d=read(dataDir),key=uid+':'+id
    if(d.items.some(x=>x.key===key))return {ok:true,skipped:'duplicate'}
    const record={key,type:action.type,bvid,at:now(),status:'claimed',replyStatus:'not-requested'}
    d.items.push(record);write(dataDir,d) // duplicate protection before external effects
    busy=true
    // Skip replies are allowed by the social-comment permission itself; they do not
    // depend on the separate success-ack toggle. Reserve before sending, never retry.
    const feedbackOnSkip=async()=>{
      if(action.type!=='social_invite'||record.status!=='skipped')return
      const current=getConfig()
      if(current.masterEnabled!==true||current.ownerCommentAgentEnabled!==true||current.ownerCommentSocialPublishEnabled!==true
        ||String(current.dmOwnerUid||'')!==uid||Number(current.commentDailyLimit)<=0||Number(current.commentReplyPerDay)<=0){record.replyStatus='blocked';write(dataDir,d);return}
      record.replyStatus='reserved';write(dataDir,d)
      try{const ack=await sendReply({bvid,rpid,root:String(row.root||''),text:ownerSocialSkipReply(record.reason),actorUid:uid,kind:'social-skip'})
        record.replyStatus=ack===true||ack?.ok===true?'sent':'uncertain'}catch{record.replyStatus='uncertain'}
      write(dataDir,d)
    }
    try{
      // Social invitations and likes are requests outside the main Session, not orders.
      // Hard authorization was checked above; this gate can deny, never grant tools.
      let willingness=null
      if(typeof decideAgency==='function'){
        let will
        try{will=decideAgency({uid,messageId:id,text:row.text,intent:action.type==='like'?'like':'explore',bvid})}
        catch(e){
          record.status='failed';record.reason='willingness-evaluation-unavailable';write(dataDir,d)
          logger.warn?.('主人评论意愿状态不可用：'+sanitize(e?.message||e,80))
          return {ok:false,status:'failed',reason:record.reason}
        }
        if(will?.decision!=='allow'){
          record.status='skipped';record.reason=sanitize(will?.reason||'willingness-declined',120)
          write(dataDir,d)
          await feedbackOnSkip()
          return {ok:true,status:'skipped',reason:record.reason,replyStatus:record.replyStatus}
        }
        willingness={score:will.score,attempt:will.attempt,decision:will.decision}
      }
      // The source BV is platform-grounded; a BV in the user's text never changes it.
      let result
      try{result=await perform({...action,...(action.type==='social_invite'?{invitation:sanitize(row.text,280),willingness}:{}),bvid,actorUid:uid})}catch(e){result={ok:false,uncertain:true,error:String(e?.message||e)}}
      record.status=result?.ok===true?(result?.skipped===true?'skipped':'done'):result?.uncertain===true?'uncertain':'failed'
      record.reason=sanitize(result?.error||result?.summary||'',120);write(dataDir,d)
      if(record.status==='skipped'){await feedbackOnSkip();return {ok:true,status:'skipped',replyStatus:record.replyStatus}}
      if(record.status!=='done'||cfg.ownerCommentNaturalAckEnabled!==true||!ACK[action.type]?.length)return {ok:record.status==='done'||record.status==='skipped',status:record.status}
      // Public replies never contain model-generated private content or action args.
      if(cfg.commentDailyLimit<=0||cfg.commentReplyPerDay<=0)return {ok:true,status:record.status,ack:'quota-disabled'}
      record.replyStatus='reserved';write(dataDir,d)
      const replies=ACK[action.type],chosen=replies[Number.parseInt(id.match(/\d+/)?.[0]||'0',10)%replies.length]
      try{const ack=await sendReply({bvid,rpid,root:String(row.root||''),text:chosen,actorUid:uid})
        record.replyStatus=ack===true||ack?.ok===true?'sent':'uncertain'}catch{record.replyStatus='uncertain'}
      write(dataDir,d)
      return {ok:true,status:record.status,ack:record.replyStatus}
    }finally{busy=false}
  }
  const status=()=>({ok:true,recent:read(dataDir).items.slice(-40).map(({key,...x})=>x)})
  return {accept,status}
}
