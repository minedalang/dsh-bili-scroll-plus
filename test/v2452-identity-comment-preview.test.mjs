import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseDmWhitelist} from '../lib/dm-inbox.mjs';
import {parseMentionTargets} from '../lib/mentions.mjs';
import {normalizeMentionProfiles,buildMentionProfilePrompt} from '../lib/character-social.mjs';
import {recentComments} from '../lib/recent-comments.mjs';

test('UID|备注昵称白名单仍只认 UID，好友也允许只写 UID',()=>{
 assert.deepEqual([...parseDmWhitelist('123|小甲\n456|小乙')],['123','456']);
 assert.deepEqual(parseMentionTargets('123\n乙|456'),[{name:'UID 123',uid:'123'},{name:'乙',uid:'456'}]);
 const info=normalizeMentionProfiles({乙:{relationship:'朋友',otherRelationships:'与小甲是同学',personality:'外向',interests:'美食',preferences:'不要出现在新提示词'}},'乙|456');
 assert.match(buildMentionProfilePrompt({targetsText:'乙|456',profiles:info}),/与小甲是同学/);
 assert.doesNotMatch(buildMentionProfilePrompt({targetsText:'乙|456',profiles:info}),/不要出现在新提示词/);
});
test('最近评论后台回复支持预览上一条评论，旧资料缺失显式空字符串',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'v2452-comments-'));
 await writeFile(join(dir,'seen.md'),'## 评论记录\n| BV1ignA6REjB | 321906225296 | 321906220000 | 2026-10-26 10:53:34 | 才不是脾气好 |\n');
 await writeFile(join(dir,'comment-interact-state.json'),JSON.stringify({replyLabels:{'BV1ignA6REjB:321906225296':{recipientUid:'1217526350',recipientName:'来token来',recipientComment:'你明明就是脾气很好啊'}}}));
 const row=recentComments(dir).rows[0];assert.equal(row.recipientComment,'你明明就是脾气很好啊');assert.equal(row.recipientUid,'1217526350');
});
