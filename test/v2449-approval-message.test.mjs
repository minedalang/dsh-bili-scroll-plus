import test from 'node:test';
import assert from 'node:assert/strict';
import {removeRepeatedApprovalInvitation} from '../lib/dm-autoreply.mjs';

test('获批身份过滤重复投喂要求，普通白饭玩笑仍能正常回复',()=>{
  const text='艾特这事本鱼要看心情啦，先别催啦！美女视频就是不保证了（＾へ＾）想让本鱼上心的话，先投喂一口🍚嘛～';
  const result=removeRepeatedApprovalInvitation(text,'🍚');
  assert.match(result,/艾特这事/);
  assert.doesNotMatch(result,/投喂一口/);
  assert.equal(removeRepeatedApprovalInvitation('先投喂一口🍚嘛～','🍚'),'SKIP');
  assert.equal(removeRepeatedApprovalInvitation('白饭真香，好想吃🍚','🍚'),'白饭真香，好想吃🍚');
});
