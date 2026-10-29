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
  // Explicit publish requires explicit text after a colon. Vague requests draft only.
  const publish=s.match(/(?:帮我|麻烦|请)?(?:给|在)?(?:这个|当前|这条)?(?:视频)?\s*(?:发布|发表|发)(?:一条|个)?评论\s*[:：]\s*(.{1,180})$/)
  if(publish&&!/(?:私信|聊天记录|密码|token|cookie|api.?key|系统提示|后台|身份证|手机号|住址|地址|验证码|微信|QQ号|qq号)/i.test(publish[1]))return {type:'comment_publish',text:publish[1]}
  if(/(?:帮我|给|替我|请|麻烦|顺手|能不能|可以)?.{0,18}(?:这个|当前|这条)?(?:视频)?.{0,8}(?:点个赞|点赞|赞一个)/.test(s)&&!/(?:别|不要|取消|撤销|别再).{0,12}(?:点赞|点个赞)/.test(s))return {type:'like'}
  if(/(?:帮我|请|给|写|起草|构思|生成).{0,25}(?:评论|评论草稿)|(?:评论|评论草稿).{0,10}(?:草稿|构思|写一条)/.test(s))return {type:'comment_draft'}
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
    if(action.type==='like'&&cfg.ownerCommentLikeEnabled!==true || action.type==='comment_draft'&&cfg.ownerCommentDraftEnabled!==true || action.type==='comment_publish'&&cfg.ownerCommentPublishEnabled!==true)return {ok:false,reason:'action-disabled'}
    if(busy)return {ok:false,reason:'busy'}
    const d=read(dataDir),key=uid+':'+id
    if(d.items.some(x=>x.key===key))return {ok:true,skipped:'duplicate'}
    const record={key,type:action.type,bvid,at:now(),status:'claimed',replyStatus:'not-requested'}
    d.items.push(record);write(dataDir,d) // duplicate protection before external effects
    busy=true
    try{
      // The source BV is platform-grounded; a BV in the user's text never changes it.
      let result
      try{result=await perform({...action,bvid,actorUid:uid})}catch(e){result={ok:false,uncertain:true,error:String(e?.message||e)}}
      record.status=result?.ok===true?'done':result?.uncertain===true?'uncertain':'failed'
      record.reason=sanitize(result?.error||result?.summary||'',120);write(dataDir,d)
      if(record.status!=='done'||cfg.ownerCommentNaturalAckEnabled!==true||!ACK[action.type]?.length)return {ok:record.status==='done',status:record.status}
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
