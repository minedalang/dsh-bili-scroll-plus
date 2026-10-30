import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {normalizeReplyNotifications} from '../lib/comment-inbox.mjs';
import {createCommentInteract} from '../lib/comment-interact.mjs';
const BV='BV1ignA6REjB', AID='117500977089472';
const raw=items=>({code:0,data:{items}});
const reply=(rpid,mid=123,business='评论',business_id=undefined)=>({user:{mid,uname:'观众'+mid},item:{business,business_id,
  subject_id:AID,source_id:String(rpid),root_id:'7777777',target_id:'7777777',source_content:'大肥鱼，你还在吗？',
  uri:'https://www.bilibili.com/video/'+BV,timestamp:Math.floor(Date.now()/1000)}});
test('回复通知允许「评论」及合法视频业务格式，排除动态并记录过滤原因',()=>{
  const dropped=[];
  const wrong=reply(10,155,'动态',19),right=reply(11,133,'评论'),video=reply(12,144,'视频',1),mixed=reply(13,166,'评论',3);
  const withoutVideo=reply(14,177,'评论',3);withoutVideo.item.uri='';
  const rows=normalizeReplyNotifications(raw([wrong,right,video,mixed,withoutVideo]),'900',{onIgnored:e=>dropped.push(e)});
  assert.deepEqual(rows.map(x=>x.uid),['133','144','166']);
  assert.ok(rows.every(x=>x.bvid===BV));
  assert.deepEqual(dropped.map(x=>x.reason),['not_video_comment','not_video_comment']);
});
test('两条新楼中楼回复按每轮额度依次处理，结果在回复通知诊断可见',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'v2459-reply-'));
  try{
    let notices=[];const sent=[];const cfg={watchReplies:true,watchTop:false,watchAt:false,replyPerPoll:1,replyPerDay:10,globalDailyLimit:100};
    const engine=createCommentInteract({dataDir:dir,selfUid:async()=> '900',getConfig:()=>cfg,
      getNotifications:async()=>raw(notices),getOwnComments:async()=>({top:['7777777'],nested:[]}),
      getVideoContext:async()=>({text:'视频标题、真实热评与相关回复',usable:true}),
      generateReply:async req=>{assert.equal(req.mustReply,true);return '在呢！';},
      send:async r=>{sent.push(r);return {ok:true,rpid:String(700001+sent.length)};}});
    await engine.poll({notifications:true,top:false,mentions:false});
    notices=[reply(10001,123),reply(10002,124)];
    assert.equal((await engine.poll({notifications:true,top:false,mentions:false})).sent,1);
    assert.equal((await engine.poll({notifications:true,top:false,mentions:false})).sent,1);
    assert.equal(sent.length,2);
    const status=engine.status();assert.equal(status.replyLastFetch.recognized,2);
    assert.equal(status.replyDiagnostics.filter(x=>x.reason==='sent').length,2);
    const db=JSON.parse(await readFile(join(dir,'comment-interact-state.json'),'utf8'));
    assert.equal(db.seen['comment:10001'],'sent');assert.equal(db.seen['comment:10002'],'sent');
  }finally{await rm(dir,{recursive:true,force:true})}
});
test('新通知可由 AI 自主停聊，诊断独立开关关闭不影响实际评论处理',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'v2459-skip-'));
  try{
    let notices=[];const cfg={watchReplies:true,replyPerPoll:3,replyPerDay:10,globalDailyLimit:100,diagReplyInboxEnabled:true};
    let count=0;
    const engine=createCommentInteract({dataDir:dir,selfUid:async()=> '900',getConfig:()=>cfg,
      getNotifications:async()=>raw(notices),getOwnComments:async()=>({top:['7777777'],nested:[]}),
      generateReply:async()=>{count++;return 'SKIP';},send:async()=>{throw Error('should not send')}});
    await engine.poll({notifications:true,top:false,mentions:false});
    notices=[reply(20001)];await engine.poll({notifications:true,top:false,mentions:false});
    assert.equal(engine.status().replyDiagnostics[0].reason,'ai_skipped');
    cfg.diagReplyInboxEnabled=false;
    notices.push(reply(20002));await engine.poll({notifications:true,top:false,mentions:false});
    assert.equal(count,2);
    assert.equal(engine.status().replyDiagnostics[0].id,'comment:20001');
  }finally{await rm(dir,{recursive:true,force:true})}
});
test('@ 邀请诊断与回复诊断位于运行诊断，最近评论不再嵌入事件列表',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
  const diag=html.split('<section id="panel-diagnostics" hidden>')[1].split('<section id="panel-quotas" hidden>')[0];
  const comment=html.split('<section id="panel-comments" hidden>')[1].split('<section id="panel-',2)[0];
  assert.match(diag,/@ 邀请处理诊断（最近 30 条）/);
  assert.match(diag,/收到评论回复处理诊断（最近 30 条）/);
  assert.match(diag,/id="comment-at-events"/);assert.match(diag,/id="comment-reply-events"/);
  assert.doesNotMatch(comment,/id="comment-at-events"/);
  assert.match(comment,/「运行诊断 → @ 邀请处理诊断」/);
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
  assert.match(js,/replyLastFetch/);assert.match(js,/diagReplyInboxEnabled/);
});
test('升级旧回复解析器时不会补发过去漏识别的通知，后续新回复可处理',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'v2459-upgrade-baseline-'));
  try{
    const {writeFile}=await import('node:fs/promises');
    await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify({version:1,notificationBootstrapped:true,
      atBootstrapped:true,seen:{},sent:[],replyRecords:[]}));
    let notices=[reply(30001)],sent=[];
    const engine=createCommentInteract({dataDir:dir,selfUid:async()=> '900',getConfig:()=>({watchReplies:true,replyPerPoll:2,replyPerDay:20,globalDailyLimit:100}),
      getNotifications:async()=>raw(notices),getOwnComments:async()=>({top:['7777777'],nested:[]}),
      generateReply:async()=> '来啦',send:async r=>{sent.push(r);return {ok:true,rpid:'80001'}}});
    await engine.poll({notifications:true,top:false,mentions:false});
    assert.equal(sent.length,0);
    assert.equal(engine.status().replyDiagnostics[0].reason,'parser_upgrade_baseline');
    notices=[...notices,reply(30002)];
    await engine.poll({notifications:true,top:false,mentions:false});
    assert.equal(sent.length,1);assert.equal(sent[0].rpid,'30002');
  }finally{await rm(dir,{recursive:true,force:true})}
});
