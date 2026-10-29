import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtempSync,rmSync,readFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createOwnerCommentAgent} from '../lib/owner-comment-agent.mjs'
import {interpretTrustedSocial} from '../lib/comment-social-ai.mjs'
import {decideOwnerSocialComment} from '../lib/owner-comment-social.mjs'
import {recentOwnerSocialOutcomes} from '../lib/owner-comment-persuasion.mjs'
const UID='210228238',OTHER='12345678',BV='BV1SqHK6oE2i',NOW=1793279269436
const cfg={masterEnabled:true,ownerCommentAgentEnabled:true,ownerCommentSocialPublishEnabled:true,
  dmOwnerUid:UID,commentDailyLimit:20,commentReplyPerDay:20,commentWatchReplies:true,commentAtEnabled:true}
const row=(uid,id,text,root='322275838160')=>({kind:'notice',scope:'self-top',id:'comment:'+id,uid,
  bvid:BV,rpid:id,root,targetId:root,locationRoot:root,timestampMs:NOW,text})
const firstResponse=JSON.stringify({intent:'social_invite',decision:'allow',commentRequested:true,
  reply:'鱼鱼再看看，不过还要自己决定留不留言～'})
const secondSkip=JSON.stringify({decision:'skip',reason:'insufficient-context',text:'',
  ownerReply:'刚查了标题，暂时没有公开留言的想法～'})
const secondComment=JSON.stringify({decision:'comment',text:'测试视频在测试什么呀？小鱼有点好奇～',
  ownerReplySuccess:'鱼鱼想了想，已经留言问问啦～',
  ownerReplyFailure:'鱼鱼想留言，但这次发不出去～',
  ownerReplyUncertain:'鱼鱼试了，不过还不能确定发出没有～'})
test('同一评论串的二次劝说传给两阶段 AI，不增加第三次生成调用',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'dafeiyu-followup-'))
  let calls=0,step=0;const firstPrompts=[],secondPrompts=[],sent=[]
  const agent=createOwnerCommentAgent({dataDir:dir,getConfig:()=>cfg,getRole:()=> 'owner',now:()=>NOW,
    interpretSocial:async r=>interpretTrustedSocial({row:r,role:'owner',emotion:{energy:70},history:{recent:[],attempts:0},
      invoke:async p=>{firstPrompts.push(p);calls++;return firstResponse}}),
    recordAgency:()=>({decision:'allow',attempt:step+1}),
    perform:async action=>{
      const result=await decideOwnerSocialComment({info:{title:'测试专用'},bvid:action.bvid,
        invitation:action.invitation,commentRequested:action.commentRequested,priorCommentOutcomes:action.priorCommentOutcomes,
        invoke:async p=>{secondPrompts.push(p);calls++;return step++===0?secondSkip:secondComment},
        maxAttempts:1,requireReply:true})
      assert.equal(result.ok,true)
      if(result.skipped)return {ok:true,skipped:true,inspected:true,inspection:'title-only',
        commentDecision:'skip',ownerReply:result.ownerReply,
        summary:'大肥鱼已探索公开视频资料，选择暂不公开评论（'+result.reason+'）'}
      return {ok:true,inspected:true,inspection:'title-only',commentDecision:'comment',
        ownerReplySuccess:result.ownerReplySuccess}
    },
    sendReply:async args=>{sent.push(args);return {ok:true,rpid:String(1000+sent.length)}}})
  try{
    const a=await agent.accept(row(UID,'111111','鱼鱼去这个视频底下说两句吧'))
    assert.equal(a.status,'skipped')
    assert.equal(calls,2)
    assert.doesNotMatch(firstPrompts[0],/insufficient-context/)
    assert.doesNotMatch(secondPrompts[0],/"skipReason":"insufficient-context"/)
    const b=await agent.accept(row(UID,'222222','拜托啦，不用编画面，你就问问这个测试视频是做什么的嘛'))
    assert.equal(b.status,'done')
    assert.equal(calls,4)
    assert.match(firstPrompts[1],/"skipReason":"insufficient-context"/)
    assert.match(secondPrompts[1],/"skipReason":"insufficient-context"/)
    assert.match(secondPrompts[1],/拜托啦/)
    assert.equal(sent.length,2)
    assert.match(sent[1].text,/已经留言问问/)
    const records=JSON.parse(readFileSync(join(dir,'owner-comment-agent.json'),'utf8')).items
    assert.deepEqual(records.map(x=>x.commentDecision),['skip','comment'])
  }finally{rmSync(dir,{recursive:true,force:true})}
})
test('二阶段劝说记忆按真实UID、BV、评论串及12小时隔离，并且不透传历史错误文本',()=>{
  const items=[
    {key:UID+':comment:1',type:'social_invite',bvid:BV,thread:BV+':100',at:NOW-1000,status:'skipped',commentRequested:true,
      commentDecision:'skip',inspection:'title-only',reason:'选择暂不公开评论（self-chose-not-to-comment:insufficient-context）'},
    {key:OTHER+':comment:2',type:'social_invite',bvid:BV,thread:BV+':100',at:NOW-1000,status:'skipped',reason:'self-chose-not-to-comment:no-opinion'},
    {key:UID+':comment:3',type:'social_invite',bvid:BV,thread:BV+':200',at:NOW-1000,status:'skipped',reason:'self-chose-not-to-comment:no-opinion'},
    {key:UID+':comment:4',type:'social_invite',bvid:BV,thread:BV+':100',at:NOW-13*3600_000,status:'skipped',reason:'self-chose-not-to-comment:low-energy'},
    {key:UID+':comment:5',type:'social_invite',bvid:BV,thread:BV+':100',at:NOW-1000,status:'claimed',reason:'self-chose-not-to-comment:no-opinion'},
  ]
  const result=recentOwnerSocialOutcomes(items,{uid:UID,bvid:BV,thread:BV+':100',at:NOW})
  assert.deepEqual(result,[{status:'skipped',commentRequested:true,commentDecision:'skip',inspection:'title-only',skipReason:'insufficient-context'}])
  assert.deepEqual(recentOwnerSocialOutcomes(items,{uid:UID,bvid:BV,thread:BV+':300',at:NOW}),[])
  assert.deepEqual(recentOwnerSocialOutcomes(items,{uid:UID,bvid:'BV1OtherVid',thread:BV+':100',at:NOW}),[])
})
