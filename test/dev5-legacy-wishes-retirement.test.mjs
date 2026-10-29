import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises'
import {readFileSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createDmAutoReply} from '../lib/dm-autoreply.mjs'
import {createSocialCognition} from '../lib/social-cognition.mjs'
import {parseSafeVideoTopics,unsafeVideoInspiration} from '../lib/video-topics.mjs'

const root=new URL('../',import.meta.url)
const source=path=>readFileSync(new URL(path,root),'utf8')

test('retired wish cannot be added from approved DM; original history and permissions remain',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dev5-retire-dm-'))
  const clock=1800000000000
  const msg={incoming:true,senderUid:'123',messageId:'m-one',timestampMs:clock,text:'帮我找美食视频，多艾特我一下'}
  const inbox=[]
  const dm=createDmAutoReply({dataDir:dir,selfUid:'999',now:()=>clock,
    getConfig:()=>({enabled:true,whitelist:['123'],whitelistCooldownSeconds:0}),
    fetchIncoming:async()=>inbox,send:async()=>({ok:true}),generateReply:async()=> 'SKIP',logger:{warn(){},error(){}}})
  await dm.poll() // baseline
  inbox.push(msg)
  await dm.poll()
  const state=JSON.parse(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'))
  assert.deepEqual(state.people['123'].videoWishes,undefined)
  assert.ok(state.people['123'].seen.includes('m-one'))
  assert.equal(typeof dm.listVideoWishes,'undefined')
  assert.equal(typeof dm.backfillVideoWishes,'undefined')
})

test('old active/pending/rejected wishes become inert archives with original data retained',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dev5-retire-old-'))
  const records=['active','pending_review','rejected','cancelled'].map((status,i)=>({id:'wish'+i,topic:'美食',status,uid:'123'}))
  await writeFile(join(dir,'dm-autoreply-state.json'),JSON.stringify({version:1,initialized:true,people:{'123':{seen:['old1'],history:[],approval:{status:'approved'},videoWishes:records}},sentAt:[]}))
  const dm=createDmAutoReply({dataDir:dir,now:()=>1800000000000,
    fetchIncoming:async()=>[],send:async()=>true,getConfig:()=>({enabled:false}),logger:{warn(){},error(){}}})
  await dm.listApprovals() // works even when polling is disabled
  const a=JSON.parse(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'))
  assert.deepEqual(a.people['123'].videoWishes.map(x=>x.status),['legacy_archived','legacy_archived','legacy_archived','cancelled'])
  assert.equal(a.people['123'].videoWishes[0].id,'wish0')
  assert.deepEqual(a.people['123'].seen,['old1'])
  assert.equal(a.people['123'].approval.status,'approved')
  await dm.listApprovals()
  const b=JSON.parse(await readFile(join(dir,'dm-autoreply-state.json'),'utf8'))
  assert.deepEqual(b,a,'migration must be idempotent')
})

test('new stranger inspiration remains independent from legacy wish registration and sending',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'dev5-retire-insp-'))
  assert.deepEqual(parseSafeVideoTopics('希望你以后看看深海生物视频'),{topics:['海洋']})
  assert.ok(unsafeVideoInspiration('给我找色情视频'))
  const social=createSocialCognition({dataDir:dir,now:()=>1800000000000,
    getConfig:()=>({dmOwnerUid:'999',strangerInspirationEnabled:true,friendDirectory:'[]'})})
  assert.equal(social.observe({uid:'123',text:'希望你以后看看深海生物视频',source:'dm',eventId:'new-one',timestampMs:1800000000000}).created,true)
  assert.deepEqual(social.inspirationKeywords(),['海洋'])
  assert.equal(social.status().items[0].kind,'stranger-inspiration')
  assert.ok(!existsSync(join(dir,'dm-autoreply-state.json')),'the inspiration must not write old DM approval state')
  assert.equal(social.observe({uid:'123',text:'给我找色情视频',source:'dm',eventId:'new-two',timestampMs:1800000000000}).skipped,'not-a-safe-inspiration')
})

test('old public @ invocation is unreachable; UI/API/config have no legacy enrollment controls',()=>{
  const index=source('index.js'), python=source('vendor/bilibili-mcp/mcp_server.py')
  const html=source('lib/management-console.html'), ui=source('lib/management-console.js')
  const state=source('lib/state.mjs')
  assert.doesNotMatch(index,/temporary_wish_id|\/api\/bili-duty\/video-wishes|dmWishMentionLimit|listActiveVideoWishes/)
  assert.doesNotMatch(python,/temporary_wish_id|from video_wishes|claim_wish|wish_claim/)
  assert.doesNotMatch(html,/dm-wishes-list|dm-wish-limit|临时视频心愿（仅获批用户）/)
  assert.doesNotMatch(ui,/loadDmWishes|dm-wish-limit|\/video-wishes/)
  assert.doesNotMatch(state,/video_wishes\.py/)
  assert.ok(!existsSync(new URL('../lib/video-wishes.mjs',import.meta.url)))
  assert.ok(!existsSync(new URL('../vendor/bilibili-mcp/video_wishes.py',import.meta.url)))
  assert.match(source('lib/data-backup.mjs'),/video-wish-claims/,'historical backup entries must be preserved')
})
