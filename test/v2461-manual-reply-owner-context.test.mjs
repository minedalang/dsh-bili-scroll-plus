import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createCommentInteract} from '../lib/comment-interact.mjs';
import {buildSenderRelationshipContext} from '../lib/character-social.mjs';
import {createInteractionBatcher} from '../lib/interaction-batch.mjs';

const BV='BV1ignA6REjB';
const AID='117500977089472';
const reply=(rpid,uid=123)=>({user:{mid:uid,uname:'测试用户'},item:{business:'视频',business_id:1,subject_id:AID,source_id:String(rpid),root_id:'7777777',target_id:'7777777',source_content:'大肥鱼你好，在吗？',uri:'https://www.bilibili.com/video/'+BV,timestamp:Math.floor(Date.now()/1000)}});
const raw=items=>({code:0,data:{items}});
const dirEntries=[{uid:'1001',name:'长条动物',dm:true,mention:true,atInvite:true},{uid:'1002',name:'小叶',dm:true,mention:false,atInvite:true},{uid:'1003',name:'无画像好友',dm:false,mention:true,atInvite:false}];
const profile={1001:{role:'owner',relationship:'大肥鱼的主人',personalityInterests:'喜欢骑车',peerRelationships:[{uid:'1002',relationship:'好朋友'}]},1002:{role:'friend',relationship:'大肥鱼的朋友'}};
const identity=uid=>buildSenderRelationshipContext({uid,friendDirectory:JSON.stringify(dirEntries),profiles:JSON.stringify(profile),ownerUid:'1001'});

test('主人关系按准确 UID 查找，非主人不能冒认，未知 UID 不补造画像',()=>{
 const owner=identity('1001'),friend=identity('1002');
 assert.match(owner,/唯一授权的主人/);assert.match(owner,/骑车/);assert.match(owner,/小叶/);
 assert.doesNotMatch(friend,/唯一授权的主人/);
 assert.match(friend,/不是当前授权主人/);
 assert.equal(identity('99999'),'');
 assert.equal(identity('长条动物'),'');
});

test('多人批量私信与评论的身份上下文隔离，手动回复标志传达给 AI',async()=>{
 const prompts=[];
 const batch=createInteractionBatcher({delayMs:1,invoke:async p=>{prompts.push(p);return JSON.stringify({items:[{id:'0',action:'reply',reply:p.includes('我是谁')?'你好主人':'你好'}]})},getPersona:()=> '大肥鱼'});
 try {
  const result=await Promise.all([
   batch.generate({kind:'dm',uid:'1001',text:'我是谁',identityContext:identity('1001')}),
   batch.generate({kind:'comment',uid:'1002',text:'你认识我吗',identityContext:identity('1002'),forceReply:true,canSkip:false})
  ]);
  assert.deepEqual(result,['你好主人','你好']);
  assert.equal(prompts.length,2);
  const first=JSON.parse(prompts[0].split('消息：').at(-1));
  const second=JSON.parse(prompts[1].split('消息：').at(-1));
  assert.match(first[0].identityContext,/唯一授权的主人/);
  assert.doesNotMatch(second[0].identityContext,/唯一授权的主人/);
  assert.equal(second[0].manualReply,true);
  assert.equal(first[0].manualReply,false);
 }finally{batch.stop()}
});

test('人工要求回复 SKIP 的评论，生成真实回复；同一来源已发送后不能重复',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2461-manual-'));
 try{
  let notices=[],answer='SKIP',sends=0;
  const engine=createCommentInteract({dataDir:dir,selfUid:async()=> '900',getConfig:()=>({watchReplies:true,replyPerDay:10,globalDailyLimit:100,ownTopPerUser:5}),
   getNotifications:async()=>raw(notices),getOwnComments:async()=>({top:['7777777'],nested:[]}),
   getVideoContext:async()=>({usable:true,text:'视频真实标题与最新评论'}),
   generateReply:async req=>{if(req.forceReply){assert.equal(req.canSkip,false);return '来啦，在看这段视频呢！'} return answer;},
   send:async req=>{assert.equal(req.manual,true);sends++;return {ok:true,rpid:'808080'}}});
  await engine.poll({notifications:true,mentions:false,top:false});
  notices=[reply('400400')];
  await engine.poll({notifications:true,mentions:false,top:false});
  assert.equal(engine.status().replyDiagnostics[0].reason,'ai_skipped');
  assert.equal(engine.status().replyDiagnostics[0].rpid,'400400');
  assert.equal(engine.status().replyDiagnostics[0].text,'大肥鱼你好，在吗？');
  const res=await engine.forceReply({id:'comment:400400'});
  assert.equal(res.ok,true);assert.equal(sends,1);
  await assert.rejects(()=>engine.forceReply({id:'comment:400400'}),/已经回复过|已发送|重复/);
  const state=JSON.parse(await readFile(join(dir,'comment-interact-state.json'),'utf8'));
  assert.equal(state.seen['comment:400400'],'manual-sent');
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('AI 选择沉默时手动操作也不发出空回复；无视频上下文不回复',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2461-manual-no-context-'));
 try{
  let items=[],usable=true,sent=0;
  const engine=createCommentInteract({dataDir:dir,selfUid:async()=> '900',getConfig:()=>({watchReplies:true,replyPerDay:10,globalDailyLimit:100}),
   getNotifications:async()=>raw(items),getOwnComments:async()=>({top:['7777777'],nested:[]}),
   getVideoContext:async()=>({usable,text:usable?'视频真实资料':''}),
   generateReply:async req=>req.forceReply?'SKIP':'SKIP',send:async()=>{sent++;return {ok:true}}});
  await engine.poll({notifications:true,mentions:false,top:false});
  items=[reply('505050')];await engine.poll({notifications:true,mentions:false,top:false});
  await assert.rejects(()=>engine.forceReply({id:'comment:505050'}),/没有给出可发送|生成失败/);
  usable=false;
  await assert.rejects(()=>engine.forceReply({id:'comment:505050'}),/视频与评论上下文不可用/);
  assert.equal(sent,0);
 }finally{await rm(dir,{recursive:true,force:true})}
});

test('本地 HTTP 手动回复路由及每日诊断按钮存在',()=>{
 const idx=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
 assert.match(idx,/POST' && path === '\/api\/bili-duty\/comment-force-reply'/);
 assert.match(js,/要求 AI 回复这条/);
 assert.match(js,/confirm\('/);
});
