import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync, mkdtempSync, rmSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'
import {validateOwnerRosterUpdate} from '../lib/owner-identity.mjs'
import {buildSenderRelationshipContext, buildMentionProfilePrompt} from '../lib/character-social.mjs'
import {apply} from '../index.js'

const friendDirectory=JSON.stringify([{uid:'12345',name:'甲',dm:true,recommend:'dm',atInvite:true}, {uid:'67890',name:'乙',dm:true,recommend:'dm',atInvite:true}])
const profiles=(owner)=>JSON.stringify({12345:{role:owner==='12345'?'owner':'friend'},67890:{role:owner==='67890'?'owner':'friend'}})
const patch=(owner)=>({friendDirectory,mentionProfiles:profiles(owner),dmOwnerUid:owner?Number(owner):0})

test('名册勾选真实主人 UID，可切换、撤销，旧 UID 不再授权',()=>{
 let cfg={friendDirectory:'[]',mentionProfiles:'{}',dmOwnerUid:0}
 cfg={...cfg,...validateOwnerRosterUpdate(patch('12345'),cfg)}
 assert.equal(cfg.dmOwnerUid,12345)
 cfg={...cfg,...validateOwnerRosterUpdate(patch('67890'),cfg)}
 assert.equal(cfg.dmOwnerUid,67890)
 assert.notEqual(JSON.parse(cfg.mentionProfiles)['12345']?.role,'owner')
 cfg={...cfg,...validateOwnerRosterUpdate(patch(''),cfg)}
 assert.equal(cfg.dmOwnerUid,0)
 assert.equal(Object.values(JSON.parse(cfg.mentionProfiles)).filter(x=>x.role==='owner').length,0)
})

test('单独改 UID、多个主人、UID 精度越界、角色和 UID 不一致均拒绝',()=>{
 const cfg={friendDirectory,mentionProfiles:profiles('12345'),dmOwnerUid:12345}
 assert.throws(()=>validateOwnerRosterUpdate({dmOwnerUid:67890},cfg),/只能从好友名册/)
 assert.throws(()=>validateOwnerRosterUpdate({...patch('67890'),mentionProfiles:profiles('12345')},cfg),/不一致/)
 assert.throws(()=>validateOwnerRosterUpdate({...patch('12345'),mentionProfiles:JSON.stringify({12345:{role:'owner'},67890:{role:'owner'}})},cfg),/最多/)
 assert.throws(()=>validateOwnerRosterUpdate({...patch('12345'),dmOwnerUid:'9007199254740993'},cfg),/安全范围/)
 assert.throws(()=>validateOwnerRosterUpdate({...patch('12345'),dmOwnerUid:0},cfg),/不一致/)
})

test('角色上下文以真实配置 UID 为准，不采信旧画像里的多个主人标签',()=>{
 const legacy=JSON.stringify({12345:{role:'owner'},67890:{role:'owner'}})
 const args={friendDirectory,profiles:legacy,ownerUid:67890}
 assert.match(buildSenderRelationshipContext({...args,uid:'67890'}),/唯一授权/)
 assert.match(buildSenderRelationshipContext({...args,uid:'12345'}),/不是当前授权主人/)
 const prompt=buildMentionProfilePrompt({...args,targetsText:'12345|甲\n67890|乙'})
 assert.equal((prompt.match(/唯一授权主人/g)||[]).length,1)
})

test('管理中心只有一个可勾选的实际主人，并有明确授权及回读检查',()=>{
 const html=readFileSync(new URL('../lib/management-console.html',import.meta.url),'utf8')
 const js=readFileSync(new URL('../lib/management-console.js',import.meta.url),'utf8')
 assert.match(html,/friend-owner-status/)
 assert.match(html,/owner-dm-authorized-uid/)
 assert.match(js,/selectedOwnerUid=ownerCheck.checked\?row.uid:''/)
 assert.match(js,/dmOwnerUid:selectedOwnerUid\?Number\(selectedOwnerUid\):0/)
 assert.match(js,/主人 UID 保存后回读不一致/)
 assert.match(readFileSync(new URL('../index.js',import.meta.url),'utf8'),/授权主人与好友 UID 名册只能在本地管理中心修改/)
 assert.doesNotMatch(js,/标为主人（仅角色设定，不授管理权限）/)
})

test('管理 API 原子更新真实主人 UID，缺少名册的越权修改拒绝并保留之前配置',async()=>{
 const home=mkdtempSync(join(tmpdir(),'dafeiyu-owner-uid-check-'))
 try{
  let route
  const ctx={get(k){return k==='dshHomePath'?(...parts)=>join(home,...parts):undefined},logger:{info(){},warn(){}},tools:{register(){}},webServer:{register(x){route=x;return {dispose(){}}}},effect(f){return f()},settings:{describe(){return []}}}
  apply(ctx,{})
  const call=async (body)=>{
   const req=Readable.from([Buffer.from(JSON.stringify(body))]);req.method='POST';req.url='/api/bili-duty/config';req.headers={host:'localhost'}
   let status=0,payload;const res={writeHead(x){status=x},end(x){payload=JSON.parse(x)}}
   await route.handler(req,res)
   return {status,payload}
  }
  const assigned=await call(patch('12345'))
  assert.equal(assigned.status,200)
  assert.equal(Number(assigned.payload.config.dmOwnerUid),12345)
  const refused=await call({dmOwnerUid:67890})
  assert.equal(refused.status,400)
  assert.equal(Number(assigned.payload.config.dmOwnerUid),12345)
  const revoked=await call(patch(''))
  assert.equal(revoked.status,200)
  assert.equal(Number(revoked.payload.config.dmOwnerUid),0)
 }finally{rmSync(home,{recursive:true,force:true})}
})
