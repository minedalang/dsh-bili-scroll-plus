/** Evidence read for an owner-initiated Bilibili social invitation.
 * No watching frames is implied. Comments and danmaku are third-party accounts,
 * not observations of the video itself. Never store the raw snippets in the log.
 */
import {normalizeOwnerCommentVideoInfo} from './owner-comment-draft.mjs'

const clean=(value,n)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,n)
const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}
const rows=(value)=>Array.isArray(value)?value:[]

export function summarizeOwnerVideoExploration(read,bvid){
  const video=normalizeOwnerCommentVideoInfo(obj(read).info,bvid)
  if(!video.title&&!video.description)return {ok:false,reason:'video-metadata-insufficient'}
  const subtitle=clean(obj(read.subtitle).text,1200)
  const comments=rows(obj(read.comments).comments).slice(0,6)
    .map(x=>clean(obj(x).content,110)).filter(Boolean)
  const danmaku=rows(obj(read.danmaku).danmakus).slice(0,10)
    .map(x=>clean(obj(x).text,65)).filter(Boolean)
  const visual=obj(read.visual)
  const visualDescription=['analyzed','cached'].includes(visual.status)?clean(visual.description,450):''
  const hasContent=!!(subtitle||visualDescription)
  const evidence={
    level:hasContent?'content-text':comments.length||danmaku.length||video.description?'related-text':'title-only',
    subtitle:!!subtitle,visual:!!visualDescription,comments:comments.length,danmaku:danmaku.length,
  }
  const context=[
    '这轮已实际查询视频详情及可用的字幕、评论和弹幕；仅代表读取到的公开资料，不代表在播放器中完整观看。',
    subtitle?'视频字幕文本节选（可作为内容证据）：'+subtitle:'没有取得可验证的字幕文本。',
    visualDescription?'实际返回的低清预览分析（仅限该画面描述）：'+visualDescription:'没有取得可验证的画面描述。',
    comments.length?'第三方视频评论（不是已看画面的证据）：'+comments.join(' / '):'没有取得可用的第三方评论内容。',
    danmaku.length?'第三方弹幕（不是已看画面的证据）：'+danmaku.join(' / '):'没有取得可用的弹幕文本。',
  ].join('\n').slice(0,2900)
  return {ok:true,video,context,evidence}
}
