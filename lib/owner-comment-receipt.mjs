/**
 * The bundled Python bili_reply_manual tool reports a confirmed acceptance as
 * {ok:true, action:'reply'|'comment', receipt:{success:true, rpid|rpid_str}}.
 * It does NOT return a top-level `sent` flag. Keep acknowledgement validation
 * strict: only an explicit positive platform receipt can mark a send as sent.
 */
export function confirmedOwnerCommentReceipt(value, action) {
  const expected = action === 'reply' ? 'reply' : 'comment'
  if (!value || typeof value !== 'object' || value.ok !== true || value.action !== expected ||
      value.receipt?.success !== true) return {ok:false, rpid:''}
  const receipt = value.receipt
  const rawId = receipt.rpid_str || receipt.rpid || value.rpid_str || value.rpid
  const id = String(rawId ?? '').trim()
  return {ok:true, rpid:/^[1-9]\d{0,29}$/.test(id)?id:''}
}
