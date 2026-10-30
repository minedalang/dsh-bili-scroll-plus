/** Bounded, same-user, same-thread PUBLIC comment outcomes for follow-up persuasion.
 * Never inject raw comments, model-generated text, account IDs or private memories.
 * This is a read-only context adapter, not a mechanism to force public posting.
 */
const WINDOW=12*3600_000
const STATES=new Set(['skipped','done','failed','uncertain'])
const OUTCOMES=new Set(['skip','comment','blocked','not-authorized'])
const INSPECTIONS=new Set(['title-only','related-text','content-text','checked'])
const SKIP_REASONS=new Set(['not-interested','no-opinion','insufficient-context','low-energy'])
export function recentOwnerSocialOutcomes(items,{uid,bvid,thread,at=Date.now(),limit=4}={}){
  if(!Array.isArray(items)||!uid||!bvid||!thread||!Number.isFinite(at))return []
  const prefix=String(uid)+':'
  return items.filter(x=>x&&x.type==='social_invite'&&x.key?.startsWith(prefix)
      &&x.bvid===bvid&&x.thread===thread&&STATES.has(x.status)
      &&Number.isFinite(Number(x.at))&&Number(x.at)<=at&&at-Number(x.at)<WINDOW)
    .slice(-Math.max(1,Math.min(4,Math.floor(Number(limit)||4))))
    .map(x=>{
      const match=String(x.reason||'').match(/self-chose-not-to-comment:(not-interested|no-opinion|insufficient-context|low-energy)/)
      return {
        status:x.status,
        commentRequested:x.commentRequested===true,
        commentDecision:OUTCOMES.has(x.commentDecision)?x.commentDecision:'unknown',
        inspection:INSPECTIONS.has(x.inspection)?x.inspection:'unknown',
        skipReason:match&&SKIP_REASONS.has(match[1])?match[1]:'',
      }
    })
}
