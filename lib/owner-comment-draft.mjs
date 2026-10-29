/** Local-only owner comment drafting. The model never gets posting tools.
 * Keep detailed rejection reasons internal; never persist raw rejected output.
 */
const PRIVATE_PATTERN=/[\r\n]|https?:|token|cookie|密码|验证码|私信|聊天记录|后台|主人.*秘密/i
const CODE_FENCE=/^```(?:json)?\s*([\s\S]*?)\s*```$/i

export function extractOwnerCommentDraft(raw){
  let value=String(raw??'').trim()
  const fenced=CODE_FENCE.exec(value)
  if(fenced)value=fenced[1].trim()
  let result
  try {result=JSON.parse(value)}catch{
    // Models sometimes add a short preamble. Extract balanced JSON objects while
    // honouring escaped quotes rather than stopping at the first closing brace.
    for(let start=value.indexOf('{');start!==-1;start=value.indexOf('{',start+1)){
      let depth=0,inString=false,escaped=false
      for(let end=start;end<value.length;end++){
        const c=value[end]
        if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;continue}
        if(c==='"'){inString=true;continue}
        if(c==='{')depth++
        else if(c==='}'&&--depth===0){try{result=JSON.parse(value.slice(start,end+1))}catch{};break}
      }
      if(result!==undefined)break
    }
  }
  if(!result||Array.isArray(result)||typeof result!=='object'||typeof result.text!=='string')return {ok:false,reason:'invalid-json'}
  const text=result.text.trim()
  if(!text)return {ok:false,reason:'empty-text'}
  if(text.length>120)return {ok:false,reason:'length-exceeded'}
  if(PRIVATE_PATTERN.test(text))return {ok:false,reason:'privacy-filter'}
  return {ok:true,text}
}

/** At most one bounded retry. Never log or return rejected model text. */
export async function generateOwnerCommentDraft({invoke,prompt}){
  let lastReason='invalid-json'
  for(let attempt=0;attempt<2;attempt++){
    const guidance=attempt===0?'':
      '\n上一次输出没有通过格式或公开内容安全校验。请重新生成全新、无私人信息的简短评论；不要解释，不要 Markdown，不要换行或链接，严格只输出 {"text":"..."}，最多 100 个汉字。'
    const raw=await invoke(prompt+guidance)
    const checked=extractOwnerCommentDraft(raw)
    if(checked.ok)return {...checked,attempts:attempt+1}
    lastReason=checked.reason
  }
  return {ok:false,reason:lastReason,attempts:2}
}
