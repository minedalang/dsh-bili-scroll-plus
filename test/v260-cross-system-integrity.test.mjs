import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,readFileSync,rmSync,mkdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createCommentInteract} from '../lib/comment-interact.mjs'
import {normalizeReplyNotifications,normalizeAtNotifications,normalizeTopComments} from '../lib/comment-inbox.mjs'
import {createOwnerCommentAgent} from '../lib/owner-comment-agent.mjs'
import {recordConfirmedRecipient,readConfirmedRecipients} from '../lib/confirmed-comment-recipients.mjs'
import {recentComments} from '../lib/recent-comments.mjs'
import {createDailyDynamic} from '../lib/daily-dynamic.mjs'
import {collectBackupFiles} from '../lib/data-backup.mjs'

const B='BV1mzso6uEZh',B2='BV17x411w7KC',R1='322436448640',R2='322430862000'
const make=()=>mkdtempSync(join(tmpdir(),'v260-chain-integrity-'))
const seen=(dir,records)=>writeFileSync(join(dir,'seen.md'),'## 评论记录\n'+records.map(r=>`| ${r.bvid} | ${r.rpid} | 322436561248 | 2026-10-31 11:11:00 | 这是已确认的回复内容 |`).join('\n')+'\n')

test('跨写入来源：普通回复与主人 Agent 共用 BV+rpid 索引，管理页不增加新评论',async()=>{
 const dir=make();try{
  seen(dir,[{bvid:B,rpid:R1},{bvid:B2,rpid:R2}])
  recordConfirmedRecipient(dir,{bvid:B2,rpid:R2,uid:'2002222',name:'普通观众',comment:'你最近喜欢什么'})
  const agent=createOwnerCommentAgent({dataDir:dir,now:()=>Date.parse('2026-10-31T10:53:28+08:00'),
   getConfig:()=>({masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,dmOwnerUid:'210228238',commentDailyLimit:30,commentReplyPerDay:30}),
   interpretSocial:async()=>({intent:'chat',decision:'allow',reply:'可以聊聊这个',commentRequested:false}),
   perform:async()=>{throw Error('must not execute')},sendReply:async()=>({ok:true,rpid:R1}),getRole:()=> 'owner'})
  await agent.accept({id:'comment:322436561248',kind:'notice',scope:'self-top',verifiedOwnerReply:true,
   uid:'210228238',name:'主人原昵称',bvid:B,rpid:'322436561248',root:'322436561248',timestampMs:Date.parse('2026-10-31T10:53:28+08:00'),text:'测试回忆'})
  const result=recentComments(dir)
  assert.equal(result.total,2)
  assert.equal(result.counts.reply,2)
  assert.equal(result.counts.unknownRecipientUid,0)
  assert.equal(result.rows.find(x=>x.rpid===R1).recipientName,'主人原昵称')
  assert.equal(result.rows.find(x=>x.rpid===R1).recipientUid,'210228238')
  assert.equal(result.rows.find(x=>x.rpid===R2).recipientUid,'2002222')
  assert.equal(result.rows.find(x=>x.rpid===R2).recipientComment,'你最近喜欢什么')
  assert.ok(collectBackupFiles(dir)['confirmed-comment-recipients.json'])
  assert.equal(recentComments(dir,{kind:'top'}).total,0)
 }finally{rmSync(dir,{force:true,recursive:true})}
})

test('跨文件冲突：不同 UID 指向同一出站评论，全部身份隐藏且不能串到另一条评论',()=>{
 const dir=make();try{
  seen(dir,[{bvid:B,rpid:R1},{bvid:B2,rpid:R2}])
  recordConfirmedRecipient(dir,{bvid:B,rpid:R1,uid:'2002222',name:'甲'})
  recordConfirmedRecipient(dir,{bvid:B2,rpid:R2,uid:'8888888',name:'无关人'})
  writeFileSync(join(dir,'comment-interact-state.json'),JSON.stringify({replyLabels:{
   [`${B}:${R1}`]:{recipientUid:'3333333',recipientName:'乙'},
   [`${B2}:${R1}`]:{recipientUid:'4444444',recipientName:'错误的BV'},
  }}))
  const a=recentComments(dir)
  const row=a.rows.find(x=>x.bvid===B)
  assert.equal(a.total,2)
  assert.equal(a.counts.identityConflicts,1)
  assert.equal(row.recipientIdentityStatus,'conflict')
  assert.equal(row.recipientUid,'')
  assert.equal(row.recipientName,'')
  assert.equal(a.rows.find(x=>x.bvid===B2).recipientUid,'8888888')
 }finally{rmSync(dir,{force:true,recursive:true})}
})

test('昵称缺失时保留可靠 UID，不混入无 UID 的历史昵称；缺号不凭评论摘要推断',()=>{
 const dir=make();try{
  seen(dir,[{bvid:B,rpid:R1}])
  recordConfirmedRecipient(dir,{bvid:B,rpid:R1,uid:'7777777'})
  writeFileSync(join(dir,'comment-interact-state.json'),JSON.stringify({replyLabels:{
   [`${B}:${R1}`]:{recipientName:'无 UID 的可能错误昵称',recipientComment:'用户无证据的文本'},
  }}))
  const row=recentComments(dir).rows[0]
  assert.equal(row.recipientUid,'7777777');assert.equal(row.recipientName,'');assert.equal(row.recipientComment,'')
  rmSync(join(dir,'confirmed-comment-recipients.json'))
  writeFileSync(join(dir,'comment-interact-state.json'),JSON.stringify({}))
  const lost=recentComments(dir).rows[0]
  assert.equal(lost.recipientUid,'');assert.equal(lost.recipientName,'')
 }finally{rmSync(dir,{force:true,recursive:true})}
})

test('生活动态自动构思额度同步：升级旧账本、可调 0–10、至少每小时一次、修改配置不重置调用次数',async()=>{
 const dir=make();try{
  let clock=new Date(2026,9,31,12,30).getTime()
  const date=()=>new Date(clock).toLocaleDateString('sv-SE')
  let c={masterEnabled:true,dailyDynamicEnabled:true,dailyDynamicDraftOnly:true,dailyDynamicDailyLimit:1}
  let modelCalls=0,publishCalls=0
  const eng=createDailyDynamic({dataDir:dir,now:()=>clock,getConfig:()=>c,getPublicVideos:()=>[{bvid:B,title:'有材料',day:date()}],
   invokeModel:async()=>{modelCalls++;return JSON.stringify({should_post:false,reason:'目前不想说话'})},
   publish:async()=>{publishCalls++;return {status:'api_accepted_unverified'}}})
  await eng.tick();await eng.tick()
  assert.equal(modelCalls,1);assert.equal(eng.status().autoAttemptsToday,1);assert.equal(publishCalls,0)
  // Same-day switch from one to three permits more opportunities, not a reset.
  c.dailyDynamicDailyLimit=3
  clock+=60*60_000
  await eng.tick();assert.equal(modelCalls,1) // 4h cooldown under cap 3
  clock+=3*60*60_000
  await eng.tick();assert.equal(modelCalls,2)
  clock+=4*60*60_000
  await eng.tick();assert.equal(modelCalls,3)
  assert.equal(eng.status().autoAttemptsToday,3)
  clock+=4*60*60_000
  await eng.tick();assert.equal(modelCalls,3)
  assert.equal(eng.status().limit,3)
  c.dailyDynamicDailyLimit=0
  clock=new Date(2026,10,1,12,30).getTime()
  await eng.tick();assert.equal(modelCalls,3)
  assert.equal(eng.status().limit,0)
  assert.equal(publishCalls,0)
  c.dailyDynamicDailyLimit=1
  const path=join(dir,'daily-dynamic','drafts.json')
  writeFileSync(path,JSON.stringify({drafts:[],lastAutoDay:date(),lastAutoAt:new Date(clock).toISOString()}))
  await eng.tick();assert.equal(modelCalls,3) // previous version already ran once this day
  assert.equal(eng.status().autoAttemptsToday,1)
 }finally{rmSync(dir,{force:true,recursive:true})}
})

test('动态配置同源：管理页填写与次数设置都保存同一个 key；Python 发布校验和草稿文本下限一致',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const ui=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 const py=readFileSync(new URL('../lib/daily-dynamic-publish.py',import.meta.url),'utf8')
 assert.match(html,/id="daily-dynamic-limit"[^>]*max="10"/)
 assert.match(ui,/payload\.dailyDynamicDailyLimit=boundedInt\('daily-dynamic-limit',0,10/)
 assert.match(ui,/\['quota-daily-dynamic','dailyDynamicDailyLimit',0,10,1\]/)
 assert.match(py,/15<=len\(text\)<=230/)
})

test('Python 拦截发布额度后保留可重试草稿，不冒充发布状态不确定',async()=>{
 const dir=make();try{
  let c={masterEnabled:true,dailyDynamicEnabled:true,dailyDynamicDraftOnly:false,dailyDynamicDailyLimit:2}
  const engine=createDailyDynamic({dataDir:dir,getConfig:()=>c,getPublicVideos:()=>[{bvid:B,title:'米饭挑战',day:'2026-10-31'}],
   invokeModel:async()=>JSON.stringify({should_post:true,text:'哎呀，今天有点好奇这个料理里的小技巧，先记一下！',
     source_bvids:[B],evidence_claims:[{type:'selected_video',bvid:B}]}),
   publish:async()=>({status:'daily_limit'})})
  const r=await engine.createDraft()
  assert.equal(r.ok,true)
  const sent=await engine.sendDraft(r.draft.id,{manual:true})
  assert.equal(sent.skipped,'not-sent')
  assert.match(sent.error,/额度已用完/)
  assert.equal(engine.status().drafts[0].status,'draft')
  assert.equal(engine.status().usedToday,0)
 }finally{rmSync(dir,{force:true,recursive:true})}
})


test('B站来源身份字段兼容：member.mid／user.uid 均视作已由 API 提供的 UID，不混淆评论 rpid',()=>{
 const top=normalizeTopComments({comments:[{rpid:R1,mid:null,member:{mid:'321321321',uname:'来自 member 的昵称'},content:'看看这条'}]},B,'999')
 assert.equal(top.length,1);assert.equal(top[0].uid,'321321321');assert.equal(top[0].name,'来自 member 的昵称')
 const notification={data:{items:[{user:{uid:'7654321',name:'回复者昵称'},item:{source_id:R1,subject_id:'170001',business_id:1,source_content:'之前的那个呢',uri:'https://www.bilibili.com/video/'+B},timestamp:1782880000}]}}
 const reply=normalizeReplyNotifications(notification,'999')
 assert.equal(reply.length,1);assert.equal(reply[0].uid,'7654321');assert.equal(reply[0].name,'回复者昵称')
 const at=normalizeAtNotifications({at:{data:{items:[{id:'321000100',user:{uid:'7654321',name:'艾特昵称'},item:{source_id:R1,subject_id:'170001',business_id:1,source_content:'@大肥鱼 你在吗',uri:'https://www.bilibili.com/video/'+B}}]}}},'999')
 assert.equal(at.length,1);assert.equal(at[0].uid,'7654321');assert.equal(at[0].name,'艾特昵称')
 const invalid=normalizeTopComments({comments:[{rpid:R1,member:{uname:'没有真实 uid'},content:'测试'}]},B,'999')
 assert.equal(invalid.length,0)
})
