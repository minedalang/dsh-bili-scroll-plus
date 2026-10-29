/** dev.5 Owner comment Agent: hard parser + platform identity + video-bound actions.
 * No private-session read adapter is accepted. Public acknowledgements are minimal templates.
 */
import {existsSync,lstatSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs'
import {join} from 'node:path'
const UID=/^[1-9]\d{0,18}$/,BV=/^BV[0-9A-Za-z]{10}$/
const FILE='owner-comment-agent.json',LIMIT=160_000
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
  if(/(?:别|不要|取消|撤销|不用|禁止).{0,20}(?:评论|发表|发布|点赞|点个赞|看看|来看)/.test(s))return null
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

const ACK={like:['点好啦～🐳','这就给它点上啦。'],comment_publish:['发出去啦～','评论发好啦。'],comment_draft:[]}
export function createOwnerCommentAgent({dataDir,getConfig,perform,sendReply=async()=>({ok:false}),now=Date.now,logger=console}){
  if(!dataDir||typeof getConfig!=='function'||typeof perform!=='function')throw TypeError('owner comment dependencies missing')
  let busy=false
  async function accept(row){
    const cfg=getConfig(),uid=String(row?.uid||''),bvid=String(row?.bvid||''),rpid=String(row?.rpid||''),id=String(row?.id||'')
    if(cfg.ownerCommentAgentEnabled!==true||cfg.masterEnabled!==true)return {ok:false,reason:'disabled'}
    if(row?.kind!=='at'||!UID.test(uid)||uid!==String(cfg.dmOwnerUid||'')||!BV.test(bvid)||!/^\d{1,30}$/.test(rpid)||!id)return {ok:false,reason:'not-verified-owner-comment'}
    const timestamp=Number(row.timestampMs)
    if(!Number.isSafeInteger(timestamp)||timestamp>now()+60_000||now()-timestamp>24*3_600_000)return {ok:false,reason:'stale'}
    const action=parseOwnerCommentIntent(row.text);if(!action)return {ok:true,skipped:'no-command'}
    if(action.type==='unsupported_public_command')return {ok:true,skipped:'public-technical-command-disabled'}
    if(action.type==='coin_unavailable')return {ok:true,skipped:'coin-not-implemented'}
    if(action.type==='like'&&cfg.ownerCommentLikeEnabled!==true || action.type==='social_invite'&&cfg.ownerCommentSocialPublishEnabled!==true)return {ok:false,reason:'action-disabled'}
    if(busy)return {ok:false,reason:'busy'}
    const d=read(dataDir),key=uid+':'+id
    if(d.items.some(x=>x.key===key))return {ok:true,skipped:'duplicate'}
    const record={key,type:action.type,bvid,at:now(),status:'claimed',replyStatus:'not-requested'}
    d.items.push(record);write(dataDir,d) // duplicate protection before external effects
    busy=true
    try{
      // The source BV is platform-grounded; a BV in the user's text never changes it.
      let result
      try{result=await perform({...action,...(action.type==='social_invite'?{invitation:sanitize(row.text,280)}:{}),bvid,actorUid:uid})}catch(e){result={ok:false,uncertain:true,error:String(e?.message||e)}}
      record.status=result?.ok===true?(result?.skipped===true?'skipped':'done'):result?.uncertain===true?'uncertain':'failed'
      record.reason=sanitize(result?.error||result?.summary||'',120);write(dataDir,d)
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
