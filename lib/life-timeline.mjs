/** Owner-facing timeline built only from public watched-video/comment records and coarse internal state changes. */
const clean=(v,n=180)=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,n)
const validBv=x=>/^BV[0-9A-Za-z]{10}$/.test(String(x||''))
export function buildLifeTimeline({watched=[],comments=[],emotionHistory=[],relationshipRows=[],days=30,limit=100,now=Date.now()}={}){
 const cutoff=now-Math.max(1,Math.min(90,Number(days)||30))*86400000,rows=[]
 for(const x of watched||[]){
  // Rows supplied by parseSeenTable are backed by seen.md, digest or explicit
  // session-watch history. Do not require "picked": skipping a video or turning
  // off public comments must not erase a real exploration from the owner UI.
  if(!validBv(x?.bvid)||!/^\d{4}-\d{2}-\d{2}$/.test(String(x.day||'')))continue
  const at=Date.parse(x.day+'T12:00:00Z');if(!Number.isFinite(at)||at<cutoff||at>now+86400000)continue
  const status=clean(x.tier||x.status,60)
  const ownerWatch=/主\s*Session\s*指定观看|主人指定观看/.test(status)
  const skipped=/跳过|未选|没挑|不收|无字幕/.test(status)
  const label=ownerWatch?'主人指定查看视频':x.picked===true?'入选视频':skipped?'探索视频 · 未入选':'视频探索记录 · 未标记入选'
  rows.push({id:'watch:'+x.bvid+':'+x.day,at,day:x.day,dateOnly:true,type:'video',label,title:clean(x.title||x.bvid,140),detail:status,bvid:x.bvid,url:'https://www.bilibili.com/video/'+x.bvid})
 }
 for(const x of comments||[]){const at=Date.parse(x.time||'');if(!Number.isFinite(at)||at<cutoff||at>now+86400000||!validBv(x.bvid))continue;rows.push({id:'comment:'+x.bvid+':'+String(x.rpid||x.time),at,type:'comment',label:x.kind==='reply'?'回复评论':'发了评论',title:clean(x.snippet||'公开评论记录',140),detail:clean(x.recipientName?`回复对象：${x.recipientName}`:'',80),bvid:x.bvid,url:x.url||'https://www.bilibili.com/video/'+x.bvid})}
 for(const x of emotionHistory||[]){const at=typeof x.at==='number'?x.at:Date.parse(x.at||'');if(!Number.isFinite(at)||at<cutoff||at>now)continue;rows.push({id:'emotion:'+at+':'+x.mood,at,type:'emotion',label:'心情变化',title:`心情转为${clean(x.label||x.mood,24)}`,detail:'仅保存情绪类别，不保存触发它的私信或评论内容'})}
 for(const friend of relationshipRows||[])for(const x of friend.history||[]){const at=Number(x.at);if(!Number.isFinite(at)||at<cutoff||at>now)continue;const label={known:'逐渐熟悉',familiar:'互动渐多',regular:'经常互动',new:'刚认识'}[x.stage]||x.stage;rows.push({id:'relationship:'+friend.uid+':'+at,type:'relationship',at,label:'关系阶段变化',title:`与${clean(friend.name||'一位白名单好友',36)}：${label}`,detail:'根据跨日、双向互动元数据形成的保守估计'})}
 const unique=new Map();for(const x of rows)if(!unique.has(x.id))unique.set(x.id,x)
 const sorted=[...unique.values()].sort((a,b)=>b.at-a.at)
 const cap=Math.max(1,Math.min(200,Number(limit)||100))
 // Comments have exact timestamps, while video-ledger entries usually only
 // have dates. Reserve some room for video events so a busy comment day does
 // not push every video off the owner-facing timeline.
 const videoRows=sorted.filter(x=>x.type==='video').slice(0,Math.max(1,Math.floor(cap/4)))
 const selected=[...videoRows],seenIds=new Set(selected.map(x=>x.id))
 for(const x of sorted){if(selected.length>=cap)break;if(!seenIds.has(x.id)){selected.push(x);seenIds.add(x.id)}}
 return selected.sort((a,b)=>b.at-a.at).map(x=>({...x,at:new Date(x.at).toISOString()}))
}
