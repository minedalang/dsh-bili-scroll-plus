import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {Readable} from 'node:stream';
import {apply} from '../index.js';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';

const home=()=>mkdtempSync(join(tmpdir(),'v2456-test-'));
test('导航待审角标隐藏样式生效，四种诊断都有可保存开关',()=>{
  const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8');
  const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8');
  assert.match(html,/\.queue-badge\[hidden\]\{display:none!important\}/);
  for(const key of ['mention','dynamic','vision','meme'])assert.match(html,new RegExp(`id="diag-${key}-enabled"`));
  assert.match(html,/id="diag-save"/);
  for(const key of ['diagMentionEnabled','diagDynamicEnabled','diagVisionEnabled','diagMemeEnabled'])assert.match(js,new RegExp(key));
  assert.match(js,/request\('\/config',patch\)/);
  assert.match(html,/quota-usage-tiles/);
  assert.match(js,/quotaReadout\('dm-daily'/);
});

test('服务端四个诊断开关默认开启，允许独立关停和重新开启',async()=>{
  const root=home();let route;
  try{
    apply({get(k){return k==='dshHomePath'?(...x)=>join(root,...x):undefined},logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){route=x;return {dispose(){}}}},effect(fn){return fn()},settings:{describe(){return []}}},{});
    const req=async(method,path,body)=>{
      const r=Readable.from(body?[Buffer.from(JSON.stringify(body))]:[]);r.method=method;r.url=path;r.headers={host:'localhost'};
      let value;const res={writeHead(){},end(text){value=JSON.parse(text)}};await route.handler(r,res);return value;
    };
    let config=(await req('GET','/api/bili-duty/config')).config;
    for(const k of ['diagMentionEnabled','diagDynamicEnabled','diagVisionEnabled','diagMemeEnabled'])assert.equal(config[k],true,k);
    config=(await req('POST','/api/bili-duty/config',{diagMentionEnabled:false,diagDynamicEnabled:false,diagVisionEnabled:false,diagMemeEnabled:true})).config;
    assert.equal(config.diagMentionEnabled,false);assert.equal(config.diagDynamicEnabled,false);assert.equal(config.diagVisionEnabled,false);
    assert.equal(config.diagMemeEnabled,true);
    config=(await req('POST','/api/bili-duty/config',{diagVisionEnabled:true})).config;
    assert.equal(config.diagVisionEnabled,true);
    const data=await req('GET','/api/bili-duty/dm-quota-usage');assert.equal(data.ok,true);assert.equal(data.sentToday,0);
  }finally{rmSync(root,{recursive:true,force:true})}
});

test('私信用量从成功发送账本真实读取，今日与滚动24h不能混用',async()=>{
 const dir=home();try{
  const current=new Date();current.setHours(1,0,0,0);
  const now=current.getTime()+3600_000;
  const day=current.toLocaleDateString('en-CA');
  // Yesterday's send is inside 24-hour window, but not today's calendar day.
  writeFileSync(join(dir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,sentAt:[now-3600_000,now-3*3600_000],people:{123:{approval:{status:'approved'},approvedUsage:{day,total:4,daily:2}},456:{approval:{status:'approved'},approvedUsage:{day,total:2,daily:1}}}}));
  const dm=createDmAutoReply({dataDir:dir,now:()=>now,selfUid:'999',logger:{warn(){}},fetchIncoming:async()=>[],send:async()=>true,getConfig:()=>({enabled:false})});
  const stat=await dm.quotaUsage();assert.equal(stat.ok,true);assert.equal(stat.sentToday,1);assert.equal(stat.sent24h,2);
  assert.equal(stat.approvedDailyMaxUsed,2);assert.equal(stat.approvedDailyTotalUsed,3);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('公开评论、附图、独立识图计数只读 SQLite，不把读不到误报为 0',()=>{
 const dir=home();try{
  const setup=`import sqlite3,datetime,sys,pathlib\np=pathlib.Path(sys.argv[1]);day=datetime.datetime.now().strftime('%Y-%m-%d')\nfor name,table in [('public-comment-quota.sqlite3','public_comment_attempt'),('comment-meme-quota.sqlite3','attempts'),('vision-usage.sqlite3','usage')]:\n c=sqlite3.connect(p/name)\n if table=='public_comment_attempt':\n  c.execute('CREATE TABLE public_comment_attempt(day TEXT)');c.executemany('INSERT INTO public_comment_attempt(day) VALUES (?)',[(day,)]*3)\n else:\n  c.execute(f'CREATE TABLE {table}(day TEXT,used INTEGER)');c.execute(f'INSERT INTO {table} VALUES (?,?)',(day,2 if table=='attempts' else 4))\n c.commit();c.close()`;
  let pr=spawnSync('python',['-c',setup,dir],{encoding:'utf8'});assert.equal(pr.status,0,pr.stderr);
  pr=spawnSync('python',['lib/comment-quota-count.py',dir],{cwd:fileURLToPath(new URL('..',import.meta.url)),encoding:'utf8'});
  assert.equal(pr.status,0,pr.stderr);const stats=JSON.parse(pr.stdout.trim());
  assert.equal(stats.used,3);assert.equal(stats.memeUsed,2);assert.equal(stats.visionUsed,4);
 }finally{rmSync(dir,{recursive:true,force:true})}
});

test('Python 注释诊断记录带独立关闭门闸，后台和视频模式都传递',()=>{
 const py=readFileSync(new URL('../vendor/bilibili-mcp/mcp_server.py',import.meta.url),'utf8');
 const index=readFileSync(new URL('../index.js',import.meta.url),'utf8');
 assert.match(py,/BILI_MENTION_DIAG_ENABLED/);assert.match(py,/BILI_DYNAMIC_DIAG_ENABLED/);assert.match(py,/BILI_MEME_DIAG_ENABLED/);
 for(const env of ['BILI_MENTION_DIAG_ENABLED','BILI_DYNAMIC_DIAG_ENABLED','BILI_MEME_DIAG_ENABLED','BILI_VISION_DIAG_ENABLED']){
  assert.ok(index.split(env).length>=3,`${env} must be present in both MCP and headless env`);
 }
 assert.match(index,/mcpKeyNow = .*diagMentionEnabled.*diagDynamicEnabled/);
});
