import {isFriendRecommendationFeedback,observeFriendInterest} from './friend-learning.mjs'

/** Capture authentic owner DM preferences before the owner Agent consumes the inbox.
 *
 * B站 owner identity alone does not grant posting authority, and simulated reluctance
 * cannot veto this sender's own recommendation consent. We only read platform-verified
 * incoming messages within the same 15-minute freshness window as the owner Agent.
 * Ordinary friends continue to use the existing DM onIncoming observer.
 */
export function observeAuthenticatedOwnerDmPreferences(home,{
  rows=[],ownerUid='',friendDirectory='',now=Date.now(),maxAgeMs=15*60_000,
}={}){
  const owner=String(ownerUid||'')
  if(!/^[1-9]\d{0,18}$/.test(owner)||!Array.isArray(rows))return {added:0,observed:0}
  let added=0,observed=0
  for(const row of rows){
    const sender=String(row?.senderUid||'')
    const messageId=String(row?.messageId||'')
    const at=Number(row?.timestampMs)
    if(row?.incoming!==true||row?.system===true||sender!==owner
      ||!messageId.startsWith(owner+':')||messageId.length>140
      ||!Number.isSafeInteger(at)||at>now+60_000||now-at>maxAgeMs)continue
    if(!isFriendRecommendationFeedback(row.text))continue
    const result=observeFriendInterest(home,{
      uid:owner,text:row.text,source:'dm',eventId:messageId,
      now:at,friendDirectory,
    })
    // The store itself deduplicates by UID + message ID + observation type.
    observed++;added+=Number(result?.added)||0
  }
  return {added,observed}
}
