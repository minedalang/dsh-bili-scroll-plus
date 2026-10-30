/** Explicit, single-owner authorization from the locally edited friend roster. */
import { normalizeFriendDirectory } from './friend-directory.mjs'
import { normalizeMentionProfiles } from './character-social.mjs'

const UID = /^[1-9]\d{0,18}$/
export const validAuthorizedOwnerUid = value => {
  const text=String(value??'0').trim()
  return text==='0'||(UID.test(text)&&Number.isSafeInteger(Number(text))&&String(Number(text))===text)
}

/** A roster save is an administrative operation, not a permission that DM/AI messages may exercise.
 * It commits the exact owner selected in the UI and never silently grants a second owner.
 */
export function validateOwnerRosterUpdate(patch, current={}) {
  const has=(key)=>Object.prototype.hasOwnProperty.call(patch,key)
  if (!has('friendDirectory')&&!has('mentionProfiles')&&!has('dmOwnerUid')) return patch
  if (has('dmOwnerUid')&&(!has('friendDirectory')||!has('mentionProfiles')))
    throw Error('主人 UID 只能从好友名册完整保存，不能单独修改')
  // A legacy caller may edit only a profile or roster. Such edits must never change
  // the authorized owner, and should not erase unrelated legacy profile data.
  if(!has('friendDirectory')||!has('mentionProfiles')) {
    if(has('mentionProfiles')){
      const raw=normalizeMentionProfiles(patch.mentionProfiles,has('mentionTargets')?patch.mentionTargets:current.mentionTargets||'',current.mentionName||'',current.friendDirectory||'[]')
      const owners=Object.entries(JSON.parse(raw)).filter(([,p])=>p.role==='owner').map(([uid])=>uid)
      if(owners.length>1||owners.some(uid=>uid!==String(current.dmOwnerUid||'')))
        throw Error('不能通过单独编辑人物画像授予主人身份；请从统一好友名册完整保存')
      // If a real owner is present in a partial payload, it may not lose the role
      // without the matching atomic UID revocation.
      const actual=String(current.dmOwnerUid||'')
      if(actual&&JSON.parse(raw)[actual]&&JSON.parse(raw)[actual].role!=='owner')
        throw Error('撤销主人角色必须同时撤销实际主人 UID，请从名册保存')
    }
    if(has('friendDirectory')&&current.dmOwnerUid){
      const roster=JSON.parse(normalizeFriendDirectory(patch.friendDirectory))
      if(!roster.some(x=>x.uid===String(current.dmOwnerUid)))
        throw Error('删除当前主人必须通过名册同时撤销主人 UID')
    }
    return patch
  }
  const directory=normalizeFriendDirectory(has('friendDirectory')?patch.friendDirectory:current.friendDirectory)
  const mentionTargets=has('mentionTargets')?patch.mentionTargets:current.mentionTargets
  const profiles=normalizeMentionProfiles(has('mentionProfiles')?patch.mentionProfiles:current.mentionProfiles,mentionTargets||'',current.mentionName||'',directory)
  const requested=String(has('dmOwnerUid')?patch.dmOwnerUid:(current.dmOwnerUid||0)).trim()
  if(!validAuthorizedOwnerUid(requested)) throw Error('主人 UID 必须是安全范围内的真实纯数字 UID，或 0（撤销授权）')
  const selected=Object.entries(JSON.parse(profiles)).filter(([,p])=>p.role==='owner').map(([uid])=>uid)
  if(selected.length>1)throw Error('最多只能授权一位主人；请在名册中取消其他主人勾选')
  const actual=selected[0]||'0'
  if(actual!==requested)throw Error('好友名册主人勾选与授权主人 UID 不一致；请从名册保存，禁止分开修改')
  if(requested!=='0'&&!JSON.parse(directory).some(r=>r.uid===requested))
    throw Error('主人 UID 必须先加入好友名册')
  return {...patch,friendDirectory:directory,mentionProfiles:profiles,dmOwnerUid:Number(requested)}
}
