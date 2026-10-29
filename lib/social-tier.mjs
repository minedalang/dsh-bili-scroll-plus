/** dev.12: Identity selects a capability ceiling; willingness NEVER grants permissions. */
import {normalizeFriendDirectory} from './friend-directory.mjs'
const UID=/^[1-9]\d{0,18}$/
const BV=/^BV[0-9A-Za-z]{10}$/
export function socialTier(uid,ownerUid,friendDirectory){
 const sender=String(uid||'')
 if(!UID.test(sender))return 'unverified'
 if(sender===String(ownerUid||''))return 'owner'
 let friends=[];try{friends=JSON.parse(normalizeFriendDirectory(friendDirectory))}catch{}
 return friends.some(x=>x.uid===sender)?'friend':'stranger'
}
export function commentThreadId(row){
 // A B站 root or the original reply's platform-verified parent links the conversation.
 // Never substitute BV alone: unrelated threads on the same video are independent.
 const root=String(row?.locationRoot||row?.root||'')
 const own=String(row?.rpid||'')
 const id=/^[1-9]\d{0,29}$/.test(root)?root:/^[1-9]\d{0,29}$/.test(own)?own:''
 return BV.test(String(row?.bvid||''))&&id?String(row.bvid)+':'+id:''
}
export const hasExplicitVideoRecommendation=(text)=>/\bBV[0-9A-Za-z]{10}\b/.test(String(text||''))
export const isSoftPersuasion=(text)=>/(?:拜托|求求|求你|球球|再考虑|好不好|就一次|再看看嘛|再说说嘛)/.test(String(text||''))
