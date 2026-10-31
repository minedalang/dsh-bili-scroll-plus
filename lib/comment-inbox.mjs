/** 只把能够明确定位到视频和评论 ID 的 B站通知/热门评论交给互动引擎。 */
export const validId = v => /^\d{1,20}$/.test(String(v ?? '')) && BigInt(String(v)) > 0n ? String(v) : '';
export const validBv = v => /^BV[0-9A-Za-z]{10}$/.test(String(v || '')) ? String(v) : '';
import {avToBv} from './bv-to-av.mjs';

/** Prefer comment coordinates carried by B站's own notification URI or explicit root_id.
 * target_id is often the immediate parent, NOT necessarily the thread root. */
export function notificationCommentLocation(item, rpid) {
  let uriRoot='';
  for (const raw of [item?.uri, item?.native_uri]) {
    if (typeof raw!=='string' || raw.length>1500 || !raw.includes('comment_root_id')) continue;
    try {
      const u=new URL(raw);
      const allowed=(u.protocol==='https:' && (u.hostname==='bilibili.com'||u.hostname.endsWith('.bilibili.com')))
        || (u.protocol==='bilibili:' && u.hostname==='video');
      if (!allowed) continue;
      uriRoot=validId(u.searchParams.get('comment_root_id'));
      if (uriRoot) break;
    } catch { /* malformed or unsupported notification URI */ }
  }
  const explicitRoot=validId(item?.root_id);
  const root=uriRoot||explicitRoot;
  // If B站 says root_id=0, it is a top-level comment; source_id is the root.
  const top=String(item?.root_id??'')==='0' && !uriRoot && !validId(item?.target_id);
  return {locationRoot:root||(top?validId(rpid):''),locationSource:uriRoot?'bili-uri':explicitRoot?'root-id':top?'top':'unknown'};
}


// 仅使用接口返回的明确 Unix 时间戳；不存在时间字段时不做首次启动的旧通知补发。
function notificationTime(row, item) {
  for (const value of [item?.source_time,item?.reply_time,item?.ctime,item?.timestamp,row?.reply_time,row?.timestamp,row?.ctime]) {
    if (value === null || value === undefined || value === '') continue;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) continue;
    const ms = n < 1e11 ? n * 1000 : n;
    if (ms > 1500000000000 && ms < 4102444800000) return ms;
  }
  return 0;
}
export function normalizeReplyNotifications(raw, selfUid = '', {onIgnored=()=>{}} = {}) {
  if (raw?.error || (raw?.code != null && Number(raw.code) !== 0)) throw new Error('回复通知接口失败：' + String(raw.error || raw.message));
  const items = Array.isArray(raw) ? raw : (raw?.data?.items ?? raw?.items);
  if (!Array.isArray(items)) throw new Error('回复通知未返回 items，无法安全判重');
  return items.flatMap((x) => {
    const entry = x?.item || {};
    const uid = validId(x?.user?.mid);
    const rpid = validId(entry.source_id);
    const aid = validId(entry.subject_id || entry.aid);
    const name = String(x?.user?.uname||x?.user?.name||x?.user?.nickname||'').trim().slice(0,60);
    const ignore = reason => {onIgnored({id:'comment:'+(rpid||validId(x?.id)||'unknown'),uid,name,aid,rpid,reason});return [];};
    const uri = [entry.uri,entry.native_uri,entry.bvid].map(v=>String(v||'')).join(' ');
    const business = String(entry.business||'').trim();
    const hasVideoLink = /BV[0-9A-Za-z]{10}|(?:\bav|\/video\/av)[1-9]\d{0,19}/i.test(uri);
    // B站回复通知既可能标成「视频」也可能标成「评论」；没有 business_id 也是有效格式。
    // 非视频的业务编号只有同时给出明确视频链接才能放行，绝不误读动态/赞通知。
    if (business && !['视频','评论'].includes(business)) return ignore('not_video_comment');
    if (entry.business_id != null && Number(entry.business_id) !== 1 &&
        !(business==='评论' && hasVideoLink)) return ignore('not_video_comment');
    const text = stripAccountMentions(entry.source_content || entry.message,entry.at_details,selfUid);
    if (!aid || !rpid) return ignore('comment_reference_missing');
    if (!uid || uid === String(selfUid)) return ignore('sender_missing_or_self');
    if (!text) return ignore('comment_text_missing');
    const bvid = validBv(uri.match(/BV[0-9A-Za-z]{10}/)?.[0]) || avToBv(aid);
    const location=notificationCommentLocation(entry,rpid);
    return [{id:`comment:${rpid}`, aid, bvid, rpid,...location,
      root:validId(entry.root_id) || validId(entry.target_id) || rpid,
      targetId:validId(entry.target_id),uid,name,text:text.slice(0,800),kind:'notice',timestampMs:notificationTime(x,entry),
      context:stripAccountMentions(entry.target_reply_content || entry.root_reply_content,entry.at_details,selfUid).slice(0,700)}];
  });
}

export function normalizeTopComments(raw, bvid, selfUid = '') {
  if (raw?.error || (raw?.code != null && Number(raw.code) !== 0)) throw new Error('热门评论接口失败：' + String(raw.error || raw.message));
  if (!Array.isArray(raw?.comments)) throw new Error('热门评论接口未返回 comments');
  return raw.comments.flatMap(c => {
    const uid = validId(c.mid);
    const rpid = validId(c.rpid);
    const text = String(c.content || '').trim();
    if (!uid || uid === String(selfUid) || !rpid || !text) return [];
    return [{ id:`comment:${rpid}`, uid, bvid, aid: '', rpid, root:rpid,
      name:String(c?.member?.uname||c?.uname||c?.username||c?.user||'').trim().slice(0,60), text: text.slice(0, 800), kind:'top', context: '' }];
  });
}

export const isFishBait = text => /(大肥鱼|大米饭|鲸鱼|🐳|投喂|喂饭|来吃饭|吃米饭|鱼鱼|本鱼)/i.test(String(text || ''));

/** B站把 @对象的昵称拼进 source_content；它不是发送者的陈述。
 * 有可信 UID 名称时只删除指向本账号的 @；如果平台没有给出昵称边界，
 * 将连写的 @token 整体视为不可信提及，绝不截成“@大肥鱼”后把后半段当情绪。
 * 不猜测昵称，也不据此分析被提及者的情绪或行为。 */
export function stripAccountMentions(text,details=[],selfUid='') {
  let result=String(text||'');
  const self=validId(selfUid);
  const known=Array.isArray(details)?details.filter(d=>validId(d?.mid)===self)
    .map(d=>String(d?.uname||d?.name||d?.nickname||'').trim()).filter(n=>n&&n.length<=60):[];
  // Only remove a known @name when the token truly ends there. B站 may
  // concatenate a longer nickname after a short alias without any delimiter;
  // stripping just @大肥鱼 would turn '怒了但不说话' into fake mood evidence.
  for (const name of known) {
    const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    result=result.replace(new RegExp('@'+escaped+'(?=$|[\\s,，:：。!！?？;；、])','gu'),' ');
  }
  // A continuous @token with unknown boundaries is entirely untrusted.
  result=result.replace(/@[\p{L}\p{N}_\-·・]+/gu,' ');
  return result.replace(/[ \t]+/g,' ').trim();
}

/** Only video comment @ notices addressed to this account; ignore likes, dynamics and self. */
export function normalizeAtNotifications(raw, selfUid = '', {onIgnored=()=>{}} = {}) {
  if (raw?.at_error) throw new Error('@通知接口失败：' + String(raw.at_error).slice(0,160));
  let body=raw?.at??raw;
  // 支持单次接口结果及某些 MCP 包装器产生的单元素数组。
  if (Array.isArray(body) && body.length===1 && body[0]?.data?.items)body=body[0];
  if (body?.error || (body?.code != null && Number(body.code)!==0))
    throw new Error('@通知失败：'+String(body.error||body.message));
  const items=Array.isArray(body)?body:(body?.data?.items??body?.items);
  if (!Array.isArray(items)) throw new Error('@通知未返回 items，不能安全处理');
  const self=validId(selfUid);
  return items.flatMap(x=>{
    const item=x?.item||{},uid=validId(x?.user?.mid),noticeId=validId(x?.id);
    const reject=reason=>{onIgnored({id:'at:'+(noticeId||validId(item.source_id)||'unknown'),uid,
      name:String(x?.user?.nickname||x?.user?.uname||'').slice(0,60),reason});return [];};
    if(!self)return reject('account_uid_missing');
    if(!uid||uid===self)return reject('sender_missing_or_self');
    // Only video comments, never dynamics, likes or other notification categories.
    if(item.business_id!=null&&Number(item.business_id)!==1)return reject('not_video_comment');
    if(item.business&&!['视频','评论'].includes(String(item.business)))return reject('not_video_comment');
    if(Array.isArray(item.at_details)&&item.at_details.length &&
       !item.at_details.some(a=>validId(a?.mid)===self))return reject('mention_not_for_account');
    const uri=[item.uri,item.native_uri,item.bvid,item.bv_id].map(v=>String(v||'')).join(' ');
    const aid=validId(item.subject_id||item.aid);
    const bvid=validBv(uri.match(/BV[0-9A-Za-z]{10}/)?.[0]) ||
      avToBv(uri.match(/(?:\bav|\/video\/av)([1-9]\d{0,19})/i)?.[1]) ||
      avToBv(aid);
    if (!aid || !bvid) return reject('video_reference_missing');
    const rpid=validId(item.source_id);
    if (!rpid) return reject('comment_id_missing');
    const original=String(item.source_content||item.message||'').trim();
    const text=stripAccountMentions(original,item.at_details,self);
    if (!text) return reject('mention_only_or_text_missing');
    const timestampMs=notificationTime(x,{...item,source_time:x?.at_time??item.source_time});
    // 顶层评论 root_id=0 是有效情况：发送时 root=0，取上下文时不强制存在楼中楼。
    const root=validId(item.root_id);
    const location=notificationCommentLocation(item,rpid);
    return [{id:'at:'+(noticeId||rpid),kind:'at',uid,...location,
      name:String(x?.user?.nickname||x?.user?.uname||'').slice(0,60),
      aid,bvid,rpid,root,targetId:validId(item.target_id),
      timestampMs,text:text.slice(0,800),context:stripAccountMentions(item.target_reply_content||item.root_reply_content,item.at_details,self).slice(0,700)}];
  });
}
