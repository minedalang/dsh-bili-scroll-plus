/** Evidence read for an owner-initiated Bilibili social invitation.
 * No watching frames is implied. Comments and danmaku are third-party accounts,
 * not observations of the video itself. Never store the raw snippets in the log.
 */
import {normalizeOwnerCommentVideoInfo} from './owner-comment-draft.mjs'

const clean=(value,n)=>String(value??'').replace(/[\u0000-\u001f\u007f]+/g,' ').trim().slice(0,n)
const obj=value=>value&&typeof value==='object'&&!Array.isArray(value)?value:{}
const rows=(value)=>Array.isArray(value)?value:[]
// Tool failures/placeholder captions are NOT evidence of what a video contains.
// Guard this even when a tool returns its error message under a `text` field.
const placeholder=/^(?:[-—–\s]*|(?:无|没有|未找到|未获取|未取得|无法获取|获取失败|读取失败|转写失败|转写未成功|转写失败|字幕没取到|字幕获取失败|暂无|不支持|失败|未生成)(?:相关|有效|可用|该视频|的视频|AI)?(?:字幕|转写|内容|画面|预览|文本|结果|描述)?(?:信息|数据|文本)?[。.!！\s]*)$/i
const toolEvidence=(value,max)=>{
  const text=clean(value,max)
  if(!text||placeholder.test(text))return ''
  if(/^(?:error|failed|error:|失败[:：]|错误[:：])/i.test(text))return ''
  return text
}

export function summarizeOwnerVideoExploration(read,bvid){
  const video=normalizeOwnerCommentVideoInfo(obj(read).info,bvid)
  if(!video.title&&!video.description)return {ok:false,reason:'video-metadata-insufficient'}
  const subtitle=toolEvidence(obj(read.subtitle).text,1200)
  const comments=rows(obj(read.comments).comments).slice(0,6)
    .map(x=>clean(obj(x).content,110)).filter(Boolean)
  const danmaku=rows(obj(read.danmaku).danmakus).slice(0,10)
    .map(x=>clean(obj(x).text,65)).filter(Boolean)
  const visual=obj(read.visual)
  const visualDescription=['analyzed','cached'].includes(visual.status)?toolEvidence(visual.description,450):''
  const hasContent=!!(subtitle||visualDescription)
  const evidence={
    level:hasContent?'content-text':comments.length||danmaku.length||video.description?'related-text':'title-only',
    subtitle:!!subtitle,visual:!!visualDescription,comments:comments.length,danmaku:danmaku.length,
  }
  const context=[
    '这轮已实际查询视频详情及可用的字幕、评论和弹幕；仅代表读取到的公开资料，不代表在播放器中完整观看。',
    '证据级别：'+evidence.level+'（content-text仅表示有真实字幕或可靠预览；related-text只表示简介或第三方文字）。',
    subtitle?'视频字幕文本节选（可作为内容证据）：'+subtitle:'没有取得可验证的字幕文本。',
    visualDescription?'实际返回的低清预览分析（仅限该画面描述）：'+visualDescription:'没有取得可验证的画面描述。',
    comments.length?'第三方视频评论（不是已看画面的证据）：'+comments.join(' / '):'没有取得可用的第三方评论内容。',
    danmaku.length?'第三方弹幕（不是已看画面的证据）：'+danmaku.join(' / '):'没有取得可用的弹幕文本。',
  ].join('\n').slice(0,2900)
  return {ok:true,video,context,evidence}
}
