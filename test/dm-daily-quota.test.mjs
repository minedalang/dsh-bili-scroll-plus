import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {createDmAutoReply} from '../lib/dm-autoreply.mjs';

const source=readFileSync(new URL('../index.js',import.meta.url),'utf8');
test('DM 0=unlimited and 21–1000 are not reduced to 20',()=>{
  assert.match(source,/dmReplyPerDay\s*=\s*Math\.max\(0,\s*Math\.min\(1000,/);
  assert.doesNotMatch(source,/dmReplyPerDay\s*=\s*Math\.max\(0,\s*Math\.min\(20,/);
  assert.match(source,/maxPerDay: cfg\.dmReplyPerDay/);
});
test('actual DM poll respects 21, 1000 and 0 caps for ordinary accounts',async()=>{
  for(const cap of [21,1000,0]) {
    const dataDir=await mkdtemp(join(tmpdir(),'dm-cap-'));
    let n=0;const inbox=[];const config={enabled:true,whitelist:[],
      strangerEnabled:true,whitelistCooldownSeconds:0,maxPerPoll:20,maxPerHour:120,maxPerDay:cap};
    const dm=createDmAutoReply({dataDir,selfUid:'999',getConfig:()=>config,now:()=>1800000000000,
      fetchIncoming:async()=>inbox,generateReply:async()=> '消息已收到',
      send:async()=>{n++;return {ok:true}},logger:{warn(){},error(){}}});
    await dm.poll();
    for(let i=0;i<30;i++)inbox.push({senderUid:String(500+i),messageId:'m'+i,incoming:true,timestampMs:1800000000000,text:'hello'});
    await dm.poll();await dm.poll();await dm.poll();
    assert.equal(n,cap===21?21:30);
  }
});
