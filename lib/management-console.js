'use strict';
// No eval/innerHTML for user-supplied strings. Same-origin local console only.
(() => {
  const API='/api/bili-duty';
  const $=id=>document.getElementById(id);
  const node=(tag,text='',className='')=>{const e=document.createElement(tag);if(className)e.className=className;e.textContent=String(text??'');return e};
  const pill=(status)=>node('span',({pending:'待审核',approved:'已批准',rejected:'已拒绝'})[status]||status,'pill '+status);
  const add=(e,...items)=>{for(const x of items)if(x)e.appendChild(x);return e};
  const info=(x)=>node('p',x,'muted');
  const btn=(text,fn,kind='')=>{const b=node('button',text,kind);b.type='button';b.addEventListener('click',()=>run(fn));return b};
  let toastTimer=null,pendingRequests=0;
  const message=(m,bad=false)=>{
    const value=String(m||''),e=$('message'),toast=$('action-toast');
    e.textContent=value;e.style.color=bad?'var(--bad)':'var(--action)';
    clearTimeout(toastTimer);
    if(!value){toast.hidden=true;return}
    toast.textContent=value;toast.dataset.tone=bad?'error':'success';toast.hidden=false;
    toastTimer=setTimeout(()=>{toast.hidden=true},bad?12000:5500);
  };
  // 统一为管理中心中的异步操作提供即时反馈；不掩盖具体模型/配额错误。
  const run=async(fn)=>{
    const focused=document.activeElement;
    const button=focused?.tagName==='BUTTON'&&!focused.disabled?focused:null;
    const before=$('message').textContent;
    if(button){button.disabled=true;button.classList.add('is-busy');button.setAttribute('aria-busy','true')}
    message('正在处理，请稍候…');
    try{await fn();if($('message').textContent==='正在处理，请稍候…'||$('message').textContent===before)message('操作已完成')}
    catch(e){message(e?.message||'操作失败',true)}
    finally{if(button){button.disabled=false;button.classList.remove('is-busy');button.removeAttribute('aria-busy')}}
  };
  const request=async(path,body)=>{
    const indicator=$('request-indicator');pendingRequests++;indicator.hidden=false;
    const controller=typeof AbortController==='function'?new AbortController():null;const timeout=controller?setTimeout(()=>controller.abort(),120000):null;
    try{
      const res=await fetch(API+path,body===undefined?{credentials:'same-origin',...(controller?{signal:controller.signal}:{})}:{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),...(controller?{signal:controller.signal}:{})});
      let data;try{data=await res.json()}catch{throw Error('服务器未返回 JSON（HTTP '+res.status+'）')}
      if(!res.ok||data?.ok===false){
        const raw=String(data?.error||'请求失败');
        if(path==='/daily-dynamic/delete'&&res.status===404&&/^unknown POST \/api\/bili-duty\/daily-dynamic\/delete$/.test(raw))
          throw Error('运行中的 DSH 插件后端仍是旧版，不支持草稿删除。请确认加载的是当前 dev 源码，重启 DSH 后强制刷新管理页面（Ctrl+F5）。');
        throw Error(raw.slice(0,220));
      }
      return data;
    }catch(e){if(e?.name==='AbortError')throw Error('请求超过120秒仍未完成。请查看诊断或模型配置；若涉及对外发送，请先核实结果，避免重复操作。');throw e}
    finally{clearTimeout(timeout);pendingRequests=Math.max(0,pendingRequests-1);indicator.hidden=pendingRequests===0}
  };
  // 可访问的确认弹窗；用户可选取消、Esc，永远不自动执行写操作。
  const confirmAction=({title,description,confirmLabel='确认继续',danger=false})=>new Promise(resolve=>{
    const dialog=$('action-confirm-dialog');
    if(typeof dialog.showModal!=='function'){resolve(window.confirm(description));return}
    if(dialog.open){resolve(false);return}
    dialog.returnValue='';
    $('action-confirm-title').textContent=title;
    $('action-confirm-description').textContent=description;
    $('action-confirm-accept').textContent=confirmLabel;
    dialog.classList.toggle('danger',danger);
    const cancel=$('action-confirm-cancel'),accept=$('action-confirm-accept');
    const dismiss=()=>dialog.close('cancel'),proceed=()=>dialog.close('confirm');
    const closed=()=>{
      cancel.removeEventListener('click',dismiss);accept.removeEventListener('click',proceed);
      resolve(dialog.returnValue==='confirm');
    };
    cancel.addEventListener('click',dismiss);accept.addEventListener('click',proceed);
    dialog.addEventListener('close',closed,{once:true});dialog.showModal();
  });
  const badge=(id,n)=>{const e=$(id);e.hidden=!n;e.textContent=String(n)};
  const setLearningState=(id,enabled,onText,offText)=>{const el=$(id);if(!el)return;el.textContent=enabled?'● 大肥鱼'+onText:'● '+offText;el.classList.toggle('paused',!enabled)};
  let active='persona',firstNavigation=true;
  const refresh=()=>loaders[active]();
  const tabNames=['persona','social','home','models','bili','dynamic','life','comments','dm','growth','stickers','meme','quotas','polling','reports','diagnostics','backup'];
  const switchTab=tab=>{
    if(!tabNames.includes(tab))return;
    active=tab;
    for(const t of tabNames){$('panel-'+t).hidden=t!==tab;document.querySelector(`[data-tab="${t}"]`).setAttribute('aria-selected',String(t===tab))}
    try{const url=new URL(location.href);url.searchParams.set('tab',tab);history.replaceState(history.state,'',url)}catch{}
    message('');
    if(firstNavigation){firstNavigation=false;void refresh().catch(e=>message(e?.message||'读取页面失败',true))}
    else run(refresh);
  };
  document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.tab)));
  document.querySelectorAll('[data-nav-tab]').forEach(link=>link.addEventListener('click',event=>{event.preventDefault();switchTab(link.dataset.navTab);try{const url=new URL(location.href);url.hash='unified-friends';history.replaceState(history.state,'',url)}catch{}const target=document.getElementById('unified-friends');target?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}));
  $('refresh').addEventListener('click',()=>run(refresh));

  // v2.4.86: 所有模型配置集中一处，保留旧字段名与数据路径，避免迁移覆盖。
  const modelDefs=[
    ['video','videoModelProvider','videoModelId','videoReasoningEffort'],
    ['interaction','interactionModelProvider','interactionModelId','interactionReasoningEffort'],
    ['dailyDynamic','dailyDynamicModelProvider','dailyDynamicModelId','dailyDynamicReasoningEffort'],
    ['ownerDmAgent','ownerDmAgentModelProvider','ownerDmAgentModelId','ownerDmAgentReasoningEffort'],
    ['reflection','mainSessionReflectionModelProvider','mainSessionReflectionModelId','mainSessionReflectionReasoningEffort'],
    ['vision','visionModelProvider','visionModelId','visionReasoningEffort','visionEndpoint'],
    ['memeRules','memeRulesModelProvider','memeRulesModelId','memeRulesReasoningEffort'],
  ];
  for(const [group,...keys] of modelDefs){
    const target=$('models-'+group);
    for(let i=0;i<keys.length;i++){
      const wrap=node('div'),lab=node('label',['Provider（可继承）','模型 ID（可继承）','思考深度（可留空）','旧版独立视觉 Endpoint（可留空）'][i]);
      const input=node('input');input.id='model-'+keys[i];input.maxLength=i===3?250:160;input.placeholder=['DSH Provider ID','DSH 模型 ID','如 low / medium / high','https://...'][i];
      lab.htmlFor=input.id;add(wrap,lab,input);target.appendChild(wrap);
    }
  }
  // 将人生记忆模型的三个既有输入框搬到模型页，而非复制出第二套编辑入口。
  for(const id of ['main-memory-model-provider','main-memory-model-id','main-memory-model-effort']){
    const field=$(id)?.parentElement;if(field)$('models-memory').appendChild(field);
  }
  const modelFields=modelDefs.flatMap(x=>x.slice(1));
  const memoryModelFields=[['main-memory-model-provider','mainSessionMemoryModelProvider'],['main-memory-model-id','mainSessionMemoryModelId'],['main-memory-model-effort','mainSessionMemoryReasoningEffort']];
  const modelTaskIds=['video','interaction','dailyDynamic','ownerDmAgent','reflection','vision','memory','memeRules'];
  const loadModelUsage=async()=>{
    try {
      const r=await request('/model-usage');
      for(const task of modelTaskIds){
        const v=r.tasks?.[task]||{today:0,lastAt:null};
        const when=v.lastAt?new Date(v.lastAt).toLocaleString('zh-CN',{hour12:false}):'暂无记录';
        $('models-'+task+'-usage').textContent='今日调用次数：'+Number(v.today||0)+' 次 · 上次调用时间：'+when;
      }
    } catch(e) {
      for(const task of modelTaskIds)$('models-'+task+'-usage').textContent='调用统计读取失败';
    }
  };
  for(const task of modelTaskIds){
    $('models-'+task+'-test').addEventListener('click',async()=>{
      const button=$('models-'+task+'-test'),result=$('models-'+task+'-test-result');
      button.disabled=true;result.textContent='正在验证已保存的模型配置…';
      try {
        const r=await request('/model-test',{task});
        result.textContent='✓ 连接正常（'+r.elapsedMs+'ms）· '+r.note;
        result.style.color='var(--action)';
      } catch(e) {
        result.textContent='✗ '+String(e?.message||'测试失败').slice(0,200);
        result.style.color='var(--bad)';
      } finally {button.disabled=false;}
    });
  }
  const loadModels=async()=>{
    const {config:c={}}=await request('/config');
    for(const key of modelFields)$('model-'+key).value=String(c[key]||'');
    for(const [id,key] of memoryModelFields)$(id).value=String(c[key]||'');
    $('models-vision-enabled').checked=c.visionEnabled===true;
    $('models-vision-debug').checked=c.visionDebug===true;
    $('models-vision-mode').value=['reuse_video_model','independent_dsh','auto'].includes(c.visionMode)?c.visionMode:'reuse_video_model';
    await loadModelUsage();
  };
  $('models-refresh').addEventListener('click',()=>run(loadModels));
  $('models-save').addEventListener('click',()=>run(async()=>{
    const payload={clear:[]};
    for(const key of modelFields){payload[key]=$('model-'+key).value.trim();if(!payload[key])payload.clear.push(key)}
    for(const [id,key] of memoryModelFields){payload[key]=$(id).value.trim();if(!payload[key])payload.clear.push(key)}
    payload.visionEnabled=$('models-vision-enabled').checked;
    payload.visionDebug=$('models-vision-debug').checked;
    payload.visionMode=$('models-vision-mode').value;
    const r=await request('/config',payload);await loadModels();
    message(r.host?.ok===false?'模型配置已保存到插件，但同步宿主失败：'+(r.host.error||'未知原因'):'AI 模型配置已保存，下次 Agent 运行生效');
  }));

  const biliFields=[
    ['bili-home-recommend','homeRecommendationsEnabled'],['bili-auto-comment','autoComment'],
    ['bili-auto-like','autoVideoLike'],['bili-auto-collect','autoVideoCollect'],['bili-agent-follow','agentFollowEnabled'],
    ['bili-sync-comment','commentSyncDynamic'],['bili-daily-enabled','dailyDynamicEnabled'],
    ['bili-daily-draft','dailyDynamicDraftOnly'],
    ['bili-transcribe','transcribe'],['bili-comment-memes','commentMemesEnabled'],
    ['bili-comment-memes-debug','commentMemesDebug'],
  ];
  const loadBili=async()=>{
    const {config:c={}}=await request('/config');
    for(const [id,key] of biliFields)$(id).checked=c[key]===true;
    $('bili-daily-draft').checked=c.dailyDynamicDraftOnly!==false;
    $('bili-extra-keywords').value=(c.keywords||[]).join('\n');
    $('bili-dm-mode').value=['off','only','both'].includes(c.dmMode)?c.dmMode:'only';
    $('bili-dm-uid').value=String(c.dmUid||'');
    $('bili-report-level').value=['full','brief','off'].includes(c.reportLevel)?c.reportLevel:'full';
    $('bili-asr-model').value=['tiny','base','small','medium','large-v3'].includes(c.asrModel)?c.asrModel:'small';
  };
  $('bili-refresh').addEventListener('click',()=>run(loadBili));
  $('bili-save').addEventListener('click',()=>run(async()=>{
    const payload={};for(const [id,key] of biliFields)payload[key]=$(id).checked;
    payload.keywords=$('bili-extra-keywords').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).slice(0,30);
    if(!payload.keywords.length)payload.clear=['keywords'];
    payload.dmMode=$('bili-dm-mode').value;
    payload.dmUid=Math.max(0,Math.floor(Number($('bili-dm-uid').value)||0));
    payload.reportLevel=$('bili-report-level').value;
    payload.asrModel=$('bili-asr-model').value;
    const r=await request('/config',payload);await loadBili();
    message(r.host?.ok===false?'设置已保存但宿主同步失败：'+(r.host.error||'未知原因'):'B站生活设置已保存');
  }));

  const loadDailyDynamic=async()=>{
    const r=await request('/daily-dynamic');
    $('daily-dynamic-status').textContent='自主生活动态：'+(r.enabled?'已开启':'关闭')+' · '+(r.draftOnly?'仅草稿':'允许自动发布')+' · 每日最多 '+r.limit+' 条';
    if(r.canDeleteDraft!==true)$('daily-dynamic-action-status').textContent='当前加载的插件后端还不支持草稿删除：请安装/加载 dev.2 源码并重启 DSH，再用 Ctrl+F5 刷新管理页面。';
    const list=$('daily-dynamic-list');list.replaceChildren();
    if(!(r.drafts||[]).length){list.appendChild(info('还没有草稿。大肥鱼会根据真实入选视频决定有没有值得分享的内容。'));return}
    for(const d of r.drafts){
      const card=node('article','','record');add(card,node('strong',d.day+' · '+({draft:'待发布草稿',published:'B站接口已接受（未核验公开）',uncertain:'结果不确定，请勿重复发送',publishing:'正在发布'}[d.status]||d.status)));
      add(card,node('p',d.text||''),info('真实 BV：'+(d.source_bvids||[]).join('、')));
      if(d.status==='draft'){
        const actions=node('div','','actions');
        add(actions,btn('确认公开发布这条动态',async()=>{
          if(!await confirmAction({title:'公开发布这条动态？',description:'这条内容将用你的 B站账号公开发布。发送结果可能无法实时核实，请确认后再继续。',confirmLabel:'确认发布'}))return;
          $('daily-dynamic-action-status').textContent='正在向 B站请求发布，发送期间请勿重复操作…';
          try{
            const result=await request('/daily-dynamic/publish',{id:d.id,confirm:true});
            await loadDailyDynamic();
            $('daily-dynamic-action-status').textContent=result.ok?'B站接口已接受发布（尚未核验公开可见）。':'发布状态：'+result.status;
            message($('daily-dynamic-action-status').textContent);
          }catch(e){$('daily-dynamic-action-status').textContent='发布未确认：'+String(e?.message||e);throw e}
        },'primary'));
        if(r.canDeleteDraft!==true)add(actions,info('此后端版本尚不能删除本地草稿；更新插件并重启 DSH 后可用。'));
        else add(actions,btn('删除本地草稿',async()=>{
          if(!await confirmAction({title:'删除未发布的动态草稿？',description:'只删除这条本地未发布草稿，不会向 B站发送，也不会删除真实视频经历。此操作无法撤销。',confirmLabel:'删除草稿',danger:true}))return;
          await request('/daily-dynamic/delete',{id:d.id,confirm:true});await loadDailyDynamic();
          $('daily-dynamic-action-status').textContent='已删除一条未发布草稿。';message('已删除本地草稿');
        },'danger'));
        card.appendChild(actions);
      }
      list.appendChild(card);
    }
  };
  $('daily-dynamic-refresh').addEventListener('click',()=>run(loadDailyDynamic));
  $('daily-dynamic-generate').addEventListener('click',()=>run(async()=>{
    const status=$('daily-dynamic-action-status');
    status.dataset.tone='pending';status.textContent='正在整理真实视频经历并请求 AI 构思草稿，可能需要一段时间…';
    try{
      const r=await request('/daily-dynamic/draft',{});
      await loadDailyDynamic();
      status.dataset.tone=r.skipped?'warning':'success';
      status.textContent=r.skipped?'本次没有生成草稿：'+(r.reason||r.skipped)+'（这不等于发布额度用完）':'已生成生活动态草稿，请检查下方内容后决定是否公开发布。';
      message(status.textContent);
    }catch(e){status.dataset.tone='error';status.textContent='生成失败：'+String(e?.message||e)+'。请检查近期真实入选视频、互动模型连接和错误日志；生成草稿本身不消耗每日发布额度。';throw e}
  }));

  // v2.4.41: 所有数字输入都只在「次数与额度」提交。
  // 将旧评论/私信页的 DOM 控件物理搬迁，保留字段 ID 与原有验证规则，避免双入口覆盖设置。
  const quotaFields=[
    ['quota-per-day','perDay',0,1000000,50],['quota-pick-round','pickPerRound',1,50,5],
    ['quota-comment-daily','commentDailyLimit',0,1000,10],['quota-comment-round','commentPerRound',0,20,5],
    ['quota-dynamic-daily','dynamicDailyLimit',0,30,3],
    ['quota-like-daily','autoVideoLikeDailyLimit',0,100,10],
    ['quota-daily-dynamic','dailyDynamicDailyLimit',0,10,1],
    ['comment-top-count','commentTopCount',1,20,5],['comment-top-videos','commentTopVideoCount',1,6,3],
    ['comment-reply-hot-count','commentReplyHotCount',1,30,12],
    ['comment-per-poll','commentReplyPerPoll',1,5,1],['comment-per-day','commentReplyPerDay',1,1000,5],
    ['comment-own-top-per-user','commentOwnTopPerUser',1,1000,5],['comment-own-nested-per-user','commentOwnNestedPerUser',1,1000,3],
    ['dm-reply-per-day','dmReplyPerDay',0,1000,0],
    ['dm-context-messages','dmContextMessages',0,80,40],['dm-stranger-max','dmStrangerMaxReplies',1,20,1],
    ['dm-total','dmApprovedTotalLimit',1,10000,50],['dm-daily','dmApprovedDailyLimit',1,1000,10],
    ['quota-meme-day','commentMemesPerDay',0,10000,2],['quota-meme-round','commentMemesPerRound',0,5,1],
    ['quota-meme-max','memeMemoryMaxEntries',10,2000,300],['quota-vision-frames','visionFrames',1,3,2],
    ['quota-vision-daily','visionDailyLimit',0,200,30],
    ['quota-min-views','minVideoViews',0,100000000,1000],['quota-min-likes','minVideoLikes',0,100000000,10],
    ['quota-min-replies','minVideoReplies',0,100000000,3]
  ];
  for (const [target,ids] of [
    ['quota-fields-comment',['comment-top-count','comment-top-videos','comment-per-poll','comment-per-day','comment-own-top-per-user','comment-own-nested-per-user','comment-reply-hot-count']],
    ['quota-fields-dm',['dm-reply-per-day','dm-context-messages','dm-stranger-max','dm-total','dm-daily']]
  ]) {
    for(const id of ids){const el=$(id);if(el?.parentElement)$(target).appendChild(el.parentElement)}
  }
  const quotaReadout=(id,text)=>{
    const input=$(id),wrap=input?.parentElement;if(!wrap)return;
    let out=wrap.querySelector('.quota-readout');if(!out){out=node('small','','quota-readout');wrap.appendChild(out)}
    out.textContent=text;
  };
  const quotaTile=(target,title,value,window)=>{
    const card=node('div','','quota-tile');add(card,node('span',title),node('strong',value),node('span',window));target.appendChild(card);
  };
  const loadQuotas=async()=>{
    const [config,quota,stat,dm]=await Promise.all([
      request('/config'),request('/comment-quota').catch(()=>({ok:false})),
      request('/status').catch(()=>({ok:false})),request('/dm-quota-usage').catch(()=>({ok:false}))
    ]);
    const c=config.config||{};
    for(const [id,key,,,fallback] of quotaFields)$(id).value=String(c[key]??fallback);
    const meter=(used,limit)=>used==null?'暂不可读':`${used} / ${limit}`;
    const daily=(used,limit)=>used==null?'今日已用：暂不可读':`今日已用 ${used} / ${limit}`;
    const commentUsed=quota.ok!==false && Number.isFinite(Number(quota.used))?Number(quota.used):null;
    const picked=stat.ok!==false&&Number.isFinite(Number(stat.pickedToday))?Number(stat.pickedToday):null;
    const dynamic=stat.ok!==false&&Number.isFinite(Number(stat.dynamicSyncUsage?.used))?Number(stat.dynamicSyncUsage.used):null;
    const reply=stat.ok!==false&&Number.isFinite(Number(stat.commentInteractStatus?.sentLast24Hours))?Number(stat.commentInteractStatus.sentLast24Hours):null;
    const dmUsed=dm.ok===true?Number(dm.sentToday):null;
    const dmRolling=dm.ok===true?Number(dm.sent24h):null;
    const memeUsed=quota.memeError||quota.memeUsed==null?null:Number(quota.memeUsed);
    const visionUsed=quota.visionError||quota.visionUsed==null?null:Number(quota.visionUsed);
    const dmCap=Number(c.dmReplyPerDay||0),approvedCap=Number(c.dmApprovedDailyLimit??10);
    $('quota-usage-summary').textContent=`本机日期 ${stat.today||quota.day||localDay()} · 设置值在下方修改；修改前显示当前真实使用量。`;
    const target=$('quota-usage-tiles');target.replaceChildren();
    quotaTile(target,'选片',meter(picked,c.perDay??50),'今日 · 已挑中的视频');
    quotaTile(target,'公开评论',meter(commentUsed,c.commentDailyLimit??10),'今日 · 发布接口尝试');
    quotaTile(target,'同步动态',meter(dynamic,c.dynamicDailyLimit??3),'今日 · 同步尝试');
    quotaTile(target,'后台评论回复',meter(reply,c.commentReplyPerDay??5),'滚动 24 小时 · 成功回执');
    quotaTile(target,'自动私信',meter(dmUsed,dmCap===0?'不限':dmCap),'今日 · 成功发送（额度闸门另按滚动24小时）');
    quotaTile(target,'附图',meter(memeUsed,c.commentMemesPerDay??2),'今日 · 占用的附图尝试');
    const visionCap=Number(c.visionDailyLimit??30);
    const visionMode=!c.visionEnabled?'预览识图未开启':c.visionMode==='independent_dsh'?'独立 DSH 视觉模型':'复用视频 Agent 看图';
    quotaTile(target,'额外独立视觉调用',meter(visionUsed,visionCap),`今日 · ${visionMode} · 按尝试计数`);
    quotaReadout('quota-per-day',daily(picked,c.perDay??50));
    quotaReadout('quota-comment-daily',daily(commentUsed,c.commentDailyLimit??10));
    quotaReadout('quota-dynamic-daily',daily(dynamic,c.dynamicDailyLimit??3));
    quotaReadout('comment-per-day',reply==null?'近24小时：暂不可读':`近24小时已成功 ${reply} / ${c.commentReplyPerDay??5}`);
    quotaReadout('dm-reply-per-day',dmRolling==null?'滚动24小时：暂不可读':`滚动24小时已发送 ${dmRolling} / ${dmCap===0?'不限制':dmCap}`);
    quotaReadout('dm-daily',dm.ok===true?`获批用户：今日最多单人已用 ${dm.approvedDailyMaxUsed} / ${approvedCap}（各 UID 独立）`:'获批用户用量：暂不可读');
    quotaReadout('dm-total',dm.ok===true?'这是每位获批用户的累计上限，非每天；详见后台私信用户记录':'这是每位用户的累计上限，非每天');
    quotaReadout('quota-meme-day',daily(memeUsed,c.commentMemesPerDay??2));
    quotaReadout('quota-vision-frames',`当前模式：${visionMode}；每个视频预览 ${c.visionFrames??2} 帧。取帧量不等于独立视觉调用次数。`);
    quotaReadout('quota-vision-daily',visionUsed===null?'独立视觉调用今日用量暂不可读；请检查本地账本':`今日独立调用 ${visionUsed} / ${visionCap} 次。${!c.visionEnabled?'目前识图总开关已关闭，不会新增视觉调用。':c.visionMode==='independent_dsh'?'当前独立模式，只有确实启动且非缓存命中的分析才增加计数。':'当前为复用模式；视频 Agent 直接看图不计入此账本，因此显示 0 并不代表今天没看过画面。'}`);
  };
  $('quota-refresh').addEventListener('click',()=>run(loadQuotas));
  $('quota-save').addEventListener('click',()=>run(async()=>{
    const payload={};
    for(const [id,key,min,max] of quotaFields)payload[key]=boundedInt(id,min,max,key);
    const saved=await request('/config',payload);
    await loadQuotas();
    message(saved.host?.ok===false?'已写插件配置，但同步到 DSH 失败：'+(saved.host.error||'未知原因'):'全部次数与额度已保存');
  }));

  // v2.4.53: 后台轮询设置单一入口，与每轮/每日额度分离；上次执行时间来自调度器实时状态。
  const pollingFields=[
    ['dm-interval','dmWatchMinutes'],
    ['poll-replies-minutes','commentReplyWatchMinutes'],
    ['poll-at-minutes','commentAtWatchMinutes'],
    ['poll-top-minutes','commentTopWatchMinutes'],
  ];
  const pollNames={dm:'自动私信',replies:'收到评论回复',mentions:'被 @ 邀请',top:'近期视频热评'};
  const pollClock=timestamp=>timestamp?new Date(timestamp).toLocaleString():'暂无';
  const loadPolling=async()=>{
    const data=await request('/status');const c=data.config||{},scheduler=data.interactionSchedulerStatus||{};
    const runs=scheduler.checks||{};
    for(const [id,key] of pollingFields){$(id).value=String(c[key]??({dmWatchMinutes:1,commentReplyWatchMinutes:3,commentAtWatchMinutes:3,commentTopWatchMinutes:5}[key]));}
    const target=$('polling-status-list');target.replaceChildren();
    for(const key of ['dm','replies','mentions','top']){
      const x=runs[key]||{},card=node('article','','settings-section');add(card,node('h4',pollNames[key]));
      const label=!scheduler.running?'宿主调度已停止':!x.enabled?'未启用':x.polling?'正在检查':x.lastResult==='error'?'最近检查失败':x.lastResult==='skipped'?'最近检查已跳过':x.lastFinishedAt?'最近检查完成':'尚未检查';
      add(card,node('p',`状态：${label} · 检查间隔：${x.intervalMinutes??'—'} 分钟`,'muted'));
      add(card,node('p',`上次开始：${pollClock(x.lastStartedAt)} · 上次完成：${pollClock(x.lastFinishedAt)}`,'muted'));
      add(card,node('p',`下次预计：${x.enabled&&scheduler.running?(x.polling?'本轮进行中':pollClock(x.nextAt)):'未计划'}`,'muted'));
      if(x.lastError)add(card,node('p','最近错误：'+String(x.lastError).slice(0,180),'muted'));
      else if(x.lastDetails?.skipped)add(card,node('p','跳过原因：'+String(x.lastDetails.skipped),'muted'));
      target.appendChild(card);
    }
  };
  $('polling-refresh').addEventListener('click',()=>run(loadPolling));
  $('polling-reload').addEventListener('click',()=>run(loadPolling));
  $('polling-save').addEventListener('click',()=>run(async()=>{
    const payload={};for(const [id,key] of pollingFields)payload[key]=boundedInt(id,1,120,key);
    const saved=await request('/config',payload);await loadPolling();
    message(saved.host?.ok===false?'间隔已保存到本插件，但同步 DSH 设置失败：'+(saved.host.error||'未知原因'):'四项轮询间隔已保存，下次检查会动态采用新值');
  }));

  // 显式加载内置默认提示词，旧用户已有非空自定义优先。不存在自动覆盖和自动保存。
  const promptEntries=[
    ['persona','personaPrompt','/persona-prompt-default','8000','大肥鱼人设'],
    ['meme-prompt','commentMemePrompt','/comment-meme-prompt-default','4000','AI 选图提示词'],
    ['vision-prompt','visionPrompt','/vision-prompt-default','4000','视觉识图提示词'],
    ['lore','characterLore','/character-lore-default','4000','角色背景']
  ];
  const promptDefaults={};
  let friendProfilesDraft={};
  let friendsDirectory=[];
  let selectedOwnerUid='';
  let savedOwnerUid='';
  const uidValid=v=>/^[1-9]\d{0,18}$/.test(String(v||''));
  const friendName=r=>r.name||('UID '+r.uid);
  const normalizeFriends=rows=>{
    const seen=new Set();return rows.filter(r=>r&&uidValid(r.uid)).map(r=>({
      uid:String(r.uid), name:String(r.name||'').replace(/[<>|\r\n]/g,' ').trim().slice(0,40),
      dm:r.dm===true,mention:r.mention===true,atInvite:r.atInvite===true,
      recommend:['dm','mention','both','off'].includes(r.recommend)?r.recommend:
        (r.dm===true?(r.mention===true?'both':'dm'):(r.mention===true?'mention':'off'))
    })).filter(r=>{if(seen.has(r.uid))return false;seen.add(r.uid);return true}).slice(0,120);
  };
  const readNames=text=>String(text||'').split(/[\r\n,，;；]+/).map(x=>x.trim()).filter(Boolean).map(x=>{
    const [left='',right='']=x.split('|').map(v=>v.trim());
    return uidValid(left)?{uid:left,name:right}:uidValid(right)?{uid:right,name:left}:null;
  }).filter(Boolean);
  const importPriorDirectory=c=>{
    let current=[];try{current=JSON.parse(c.friendDirectory||'[]')}catch{}
    const existing=normalizeFriends(Array.isArray(current)?current:[]);
    const map=new Map(existing.map(r=>[r.uid,r]));
    for(const [key,flag] of [['dmWhitelist','dm'],['mentionTargets','mention'],['commentAtWhitelist','atInvite']]){
      for(const item of readNames(c[key])){
        const r=map.get(item.uid)||{uid:item.uid,name:item.name,dm:false,mention:false,atInvite:false,recommend:'off'};
        if(!r.name&&item.name)r.name=item.name;
        if(!r[flag]){
          r[flag]=true;
          if(flag==='dm')r.recommend=r.recommend==='mention'?'both':'dm';
          if(flag==='mention')r.recommend=r.recommend==='dm'?'both':'mention';
        }
        map.set(r.uid,r);
      }
    }
    return normalizeFriends([...map.values()]);
  };
  const drawFriendDirectory=()=>{
    const target=$('friend-directory-editor');target.replaceChildren();
    if(!friendsDirectory.length){target.appendChild(info('还没有好友。请先添加 UID；昵称可留空。'));return}
    for(const row of friendsDirectory){
      const card=node('article','','settings-section');
      const heading=node('div','','toolbar');add(heading,node('strong',friendName(row)+' · UID '+row.uid), btn('移除',async()=>{
        if(!confirm('移除 UID '+row.uid+' 的名册权限和画像？请点击保存后才正式生效。'))return;
        friendsDirectory=friendsDirectory.filter(x=>x.uid!==row.uid);
        if(selectedOwnerUid===row.uid)selectedOwnerUid='';
        delete friendProfilesDraft[row.uid];drawFriendDirectory();
      },'danger'));
      card.appendChild(heading);
      const nameWrap=node('div','','fields');const nameL=node('label','昵称备注（不参与权限判断）');const nameInput=node('input');
      nameInput.value=row.name;nameInput.maxLength=40;nameInput.addEventListener('input',()=>{row.name=nameInput.value.trim();heading.querySelector('strong').textContent=friendName(row)+' · UID '+row.uid});
      add(nameWrap,add(node('div'),nameL,nameInput));card.appendChild(nameWrap);
      const checks=node('div','','friend-role-row');
      const dmWrap=node('label','','checkline');const dmCheck=document.createElement('input');dmCheck.type='checkbox';dmCheck.checked=row.dm;
      dmCheck.addEventListener('change',()=>{row.dm=dmCheck.checked});
      add(dmWrap,dmCheck,node('span','允许与这位好友私信往来（互动与手动发送权限）'));checks.appendChild(dmWrap);
      const channelWrap=node('div');const channelLabel=node('label','主动视频推荐渠道');const channelSelect=node('select');
      for(const [value,label] of [['dm','私信优先（推荐）'],['both','私信 + 公开 @（两项都可用）'],['mention','只在公开视频中 @（可选）'],['off','不主动推荐（仍可聊天和学习偏好）']])channelSelect.add(new Option(label,value));
      channelSelect.value=row.recommend;channelSelect.addEventListener('change',()=>{row.recommend=channelSelect.value;row.mention=['mention','both'].includes(row.recommend)});
      add(channelWrap,channelLabel,channelSelect,node('small','只有开启对应的全局自主社交／公开评论权限后才会真正发送；选择私信还需允许与这位好友私信。','muted'));checks.appendChild(channelWrap);
      const atWrap=node('label','','checkline');const atCheck=document.createElement('input');atCheck.type='checkbox';atCheck.checked=row.atInvite;
      atCheck.addEventListener('change',()=>{row.atInvite=atCheck.checked});
      add(atWrap,atCheck,node('span','接受这位好友通过 @ 表达的意愿／被 @ 互动白名单'));checks.appendChild(atWrap);
      card.appendChild(checks);
      const profile=friendProfilesDraft[row.uid]||{};
      const fields=node('div','','fields');
      const makeField=(label,value,onUpdate,multiline=false)=>{
        const wrap=node('div');const lab=node('label',label);const el=node(multiline?'textarea':'input');
        el.value=value||'';el.maxLength=multiline?700:120;if(multiline)el.rows=3;
        el.addEventListener('input',()=>{const v=friendProfilesDraft[row.uid]||{};onUpdate(v,el.value);friendProfilesDraft[row.uid]=v});
        add(wrap,lab,el);return wrap;
      };
      fields.appendChild(makeField('与大肥鱼的关系',profile.relationship,(v,x)=>v.relationship=x));
      const ownerWrap=node('div');const ownerLab=node('label','授权主人（最多一个 UID）','');
      const ownerCheck=document.createElement('input');ownerCheck.type='checkbox';ownerCheck.checked=selectedOwnerUid===row.uid;
      ownerCheck.addEventListener('change',()=>{
        if(ownerCheck.checked&&selectedOwnerUid&&selectedOwnerUid!==row.uid){
          if(!confirm('切换授权主人将撤销原 UID '+selectedOwnerUid+' 的主人私信及公开评论 Agent 权限。确定切换到 '+row.uid+' 吗？')){ownerCheck.checked=false;return}
        }
        selectedOwnerUid=ownerCheck.checked?row.uid:'';
        drawFriendDirectory();
      });
      add(ownerWrap,ownerLab,add(node('label','设为唯一授权主人（控制主人私信及评论 Agent）','checkline'),ownerCheck),node('small','勾选并保存：授予此 UID 主人身份；取消并保存：撤销主人身份。点赞、发布评论等写操作仍须单独授权。','muted'));fields.appendChild(ownerWrap);
      fields.appendChild(makeField('性格爱好',profile.personalityInterests||[profile.personality,profile.interests].filter(Boolean).join('；'),(v,x)=>v.personalityInterests=x,true));
      card.appendChild(fields);
      const peers=node('div','','settings-section');add(peers,node('h4','与其他白名单用户的关系'),info('选一位 UID，填入这位好友与对方的关系；不能选择自己。'));
      const peerRows=Array.isArray(profile.peerRelationships)?profile.peerRelationships:[];
      const makePeer=(peer)=>{
        const line=node('div','','peer-line');const select=node('select');
        add(select, new Option('选择好友',''));
        for(const r of friendsDirectory.filter(x=>x.uid!==row.uid))add(select,new Option(friendName(r)+' · '+r.uid,r.uid));
        select.value=peer.uid||'';const description=node('input');description.placeholder='这两位是什么关系';description.maxLength=120;description.value=peer.relationship||'';
        const rm=btn('移除关系',async()=>{line.remove()});
        add(line,select,description,rm);peers.appendChild(line);
        // Persist draft from live editor in a safe, deterministic way.
        line.dataset.peer='1';line.dataset.forUid=row.uid;
        select.addEventListener('change',syncPeers);description.addEventListener('input',syncPeers);rm.addEventListener('click',syncPeers);
      };
      const syncPeers=()=>{const links=[...peers.querySelectorAll('.peer-line')].map(l=>({uid:l.querySelector('select')?.value||'',relationship:l.querySelector('input')?.value.trim()||''})).filter(x=>x.uid&&x.relationship&&x.uid!==row.uid);friendProfilesDraft[row.uid]={...(friendProfilesDraft[row.uid]||{}),peerRelationships:links}};
      for(const peer of peerRows)makePeer(peer);
      add(peers,btn('添加一项好友关系',async()=>{makePeer({uid:'',relationship:''})}));card.appendChild(peers);
      target.appendChild(card);
    }
  };
  const loadFriendLearning=async()=>{
    const data=await request('/friend-learning');
    const target=$('friend-learning-list');target.replaceChildren();
    const rows=data.rows||[];
    $('friend-learning-status').textContent=rows.length+' 位白名单好友有明确兴趣线索（不会收集非白名单用户）';
    for(const friend of rows){
      const card=node('article','','record');
      add(card,node('strong','UID '+friend.uid),info((friend.interests||[]).map(x=>({tentative:'待确认',cooling:'较久未提及','changed-recently':'近期表达有变化','observed-repeated':'多次明确提到'}[x.status]||'观察中')+(x.directRequest?' · 明确请求多推荐':'')+' · '+(x.stance==='like'?'喜欢':'不喜欢')+'「'+x.topic+'」'+(x.support180!==undefined?'（近半年 '+x.support180+' 次）':'')).join('；')+(friend.rejectedVideos?'；明确拒绝重复推荐的 BV：'+friend.rejectedVideos+' 条':'')+(friend.contactOptOuts?.length?'；明确拒绝的联系渠道：'+friend.contactOptOuts.map(x=>x==='mention'?'公开 @':'私信').join('、') :'')+(friend.recommendationConsent==='off'?'；已明确拒绝所有主动视频推荐':'')));
      add(card,btn('清除这个 UID 的兴趣学习',async()=>{
        if(!confirm('确定清空 UID '+friend.uid+' 的后天兴趣观察？原始好友画像不变。'))return;
        await request('/friend-learning/clear',{uid:friend.uid,confirm:'CLEAR_FRIEND_OBSERVATIONS'});
        await loadFriendLearning();message('已清理该好友兴趣观察');
      },'danger'));
      target.appendChild(card);
    }
    if(!target.children.length)target.append(info('暂无观察。仅当白名单好友自己在私信或评论里明确说出兴趣，才会产生线索。'));
  };
  const loadDev5Social=async()=>{
    const r=await request('/dev5-social'),target=$('social-dev5-records');target.replaceChildren();
    const rows=r.social?.items||[];
    $('social-dev5-status').textContent=`候选意愿 ${rows.filter(x=>x.status==='candidate').length} 条 · 陌生灵感 ${r.social?.inspirations?.join('、')||'无'} · 主人评论最近 ${r.ownerComment?.recent?.length||0} 条`;
    for(const x of rows.slice(0,15)){
      const name=x.kind==='friend-invitation'?'好友只读邀请':'陌生人临时灵感';
      add(target,node('div',`${name} · ${x.status} · ${x.bvid||x.topics?.join('、')||''} · ${new Date(x.at).toLocaleString()}`,'record'));
    }
    if(!rows.length)target.append(info('尚无新意愿；首次监听会跳过旧通知。'));
    const last=r.ownerComment?.recent?.at(-1);
    $('owner-comment-agent-status').textContent=last?`最近：${last.type} · ${last.status} · ${last.replyStatus||'无公开回执'}`:'尚无主人评论动作记录。';
  };
  $('social-dev5-refresh').addEventListener('click',()=>run(loadDev5Social));
  $('social-dev5-save').addEventListener('click',()=>run(async()=>{
    const patch={strangerInspirationEnabled:$('social-stranger-inspiration').checked,socialInvitationEnabled:$('social-friend-invitations').checked,socialInvitationAutoInspectEnabled:$('social-invitation-auto').checked};
    await request('/config',patch);const current=(await request('/config')).config||{};
    if(Object.keys(patch).some(k=>patch[k]!==current[k]))throw Error('社会认知权限回读与保存不一致');
    await loadDev5Social();message('dev.5 社会认知权限已保存并校验');
  }));
  $('friend-learning-refresh').addEventListener('click',()=>run(loadFriendLearning));
  const loadPersona=async()=>{
    const [config,...defaults]=await Promise.all([request('/config'),...promptEntries.map(x=>request(x[2]))]);
    const c=config.config||{};
    for(let i=0;i<promptEntries.length;i++){
      const [id,key]=promptEntries[i];const d=promptDefaults[key]=String(defaults[i].prompt||'');
      $(id+'-text').value=String(c[key]||d);
      $(id+'-status').textContent=String(c[key]||'').trim()?'已自定义':'内置默认';
    }
  };
  const loadSocialFriends=async()=>{
    const c=(await request('/config')).config||{};
    $('friends-mode').value=['ai','ai_select','off','always'].includes(c.mentionMode)?c.mentionMode:'ai_select';
    $('friend-at-feedback-enabled').checked=c.friendAtFeedbackEnabled===true;
    $('social-stranger-inspiration').checked=c.strangerInspirationEnabled===true;
    $('social-friend-invitations').checked=c.socialInvitationEnabled===true;
    $('social-invitation-auto').checked=c.socialInvitationAutoInspectEnabled===true;
    friendsDirectory=importPriorDirectory(c);
    savedOwnerUid=String(c.dmOwnerUid||'');
    selectedOwnerUid=friendsDirectory.some(r=>r.uid===savedOwnerUid)?savedOwnerUid:'';
    $('friend-owner-status').textContent=selectedOwnerUid?'当前授权主人 UID：'+selectedOwnerUid:'当前没有名册内的授权主人'+(savedOwnerUid?'（旧授权 UID '+savedOwnerUid+' 不在名册；保存时会要求确认撤销或重新勾选）':'')+'。';
    try{friendProfilesDraft=JSON.parse(c.mentionProfiles||'{}');if(!friendProfilesDraft||Array.isArray(friendProfilesDraft)||typeof friendProfilesDraft!=='object')friendProfilesDraft={}}catch{friendProfilesDraft={}}
    // Import old profile names by a one-off display-name match. Afterwards only UID keys are saved.
    for(const r of friendsDirectory){if(!friendProfilesDraft[r.uid]&&friendProfilesDraft[r.name])friendProfilesDraft[r.uid]=friendProfilesDraft[r.name]}
    drawFriendDirectory();
    await Promise.all([loadFriendLearning(),loadDev5Social()]);
  };
  const saveFriends=async()=>{
    friendsDirectory=normalizeFriends(friendsDirectory);
    for(const r of friendsDirectory){
      r.mention=['mention','both'].includes(r.recommend);
      if(['dm','both'].includes(r.recommend)&&!r.dm)throw Error('UID '+r.uid+' 使用私信推荐渠道，但尚未允许私信往来');
    }
    if(friendsDirectory.filter(r=>r.mention).length>8)throw Error('可公开 @ 的好友最多 8 位，请调整他们的推荐渠道');
    const names=r=>r.uid+(r.name?'|'+r.name:'');
    const targets=friendsDirectory.filter(r=>r.mention).map(names).join('\n');
    const dm=friendsDirectory.filter(r=>r.dm).map(names).join('\n');
    const invite=friendsDirectory.filter(r=>r.atInvite).map(names).join('\n');
    if(selectedOwnerUid&&!friendsDirectory.some(r=>r.uid===selectedOwnerUid))throw Error('授权主人 UID 不在好友名册中');
    if(selectedOwnerUid!==savedOwnerUid&&!confirm(selectedOwnerUid?'确认将唯一授权主人变更为 UID '+selectedOwnerUid+'？原主人权限将立即撤销。':'确认撤销当前主人 UID 的所有主人私信及公开评论 Agent 操作权限？'))return;
    const selected={};for(const r of friendsDirectory){const p={...(friendProfilesDraft[r.uid]||{})};p.role=r.uid===selectedOwnerUid?'owner':'friend';selected[r.uid]=p}
    const payload={friendDirectory:JSON.stringify(friendsDirectory),mentionProfiles:JSON.stringify(selected),dmOwnerUid:selectedOwnerUid?Number(selectedOwnerUid):0,mentionMode:$('friends-mode').value,friendAtFeedbackEnabled:$('friend-at-feedback-enabled').checked,mentionTargets:targets,dmWhitelist:dm,commentAtWhitelist:invite,
      clear:[...(!targets?['mentionTargets']:[]),...(!dm?['dmWhitelist']:[]),...(!invite?['commentAtWhitelist']:[])]};
    const saved=await request('/config',payload);
    const readBack=(await request('/config')).config||{};
    if(String(readBack.dmOwnerUid||'')!==selectedOwnerUid)throw Error('主人 UID 保存后回读不一致，请不要发送操作指令');
    await loadSocialFriends();message(saved.host?.ok===false?'已保存，但同步 DSH 设置失败：'+(saved.host.error||'未知原因'):'好友互动名册、推荐渠道、@ 意愿监听及画像已保存');
  };
  $('friend-add').addEventListener('click',()=>run(async()=>{
    const uid=$('friend-new-uid').value.trim();if(!uidValid(uid))throw Error('请输入有效的纯数字 UID');
    if(friendsDirectory.some(r=>r.uid===uid))throw Error('这个 UID 已存在，可直接编辑该条');
    if(friendsDirectory.length>=120)throw Error('好友名册最多 120 人');
    friendsDirectory.push({uid,name:$('friend-new-name').value.trim(),dm:true,mention:false,atInvite:true,recommend:'dm'});
    $('friend-new-uid').value='';$('friend-new-name').value='';drawFriendDirectory();message('已加入草稿，勾选权限后点击保存');
  }));
  $('friend-save-all').addEventListener('click',()=>run(saveFriends));
  for(const [id,key,,,label] of promptEntries){
    $(id+'-save').addEventListener('click',()=>run(async()=>{
      const text=$(id+'-text').value.trim();if(!text)throw Error(label+'不能为空；需要默认规则，请点击「恢复默认」');
      const isDefault=text===promptDefaults[key];
      const saved=await request('/config',{[key]:isDefault?'':text,clear:isDefault?[key]:[]});
      $(id+'-status').textContent=isDefault?'内置默认':'已自定义';
      message(saved.host?.ok===false?'保存成功，但 DSH 同步失败：'+(saved.host.error||'未知原因'):label+'已保存');
    }));
    $(id+'-reset').addEventListener('click',()=>run(async()=>{
      if(!confirm('恢复「'+label+'」为官方默认？当前自定义内容将清除。'))return;
      const saved=await request('/config',{[key]:'',clear:[key]});
      $(id+'-text').value=promptDefaults[key]||'';
      $(id+'-status').textContent='内置默认';
      message(saved.host?.ok===false?'已清除自定义，但 DSH 同步失败：'+(saved.host.error||'未知原因'):label+'已恢复默认');
    }));
  }
  $('persona-refresh').addEventListener('click',()=>run(loadPersona));

  const localDay=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const safeVideoLink=(bvid)=>{const bv=/^BV[0-9A-Za-z]{10}$/.test(String(bvid||''))?String(bvid):'';const a=node('a',bv||'打开视频');a.href='https://www.bilibili.com/video/'+encodeURIComponent(bv);a.target='_blank';a.rel='noopener noreferrer';return a};
  // B站 webpage deep links are best-effort: the site decides whether to expand and scroll.
  // Never confuse a nested comment's immediate parent (targetId) with its real root.
  const commentCoordinates=(c)=>{
    const bv=/^BV[0-9A-Za-z]{10}$/.test(String(c?.bvid||''))?String(c.bvid):'';
    const rid=/^[1-9]\d{0,29}$/.test(String(c?.rpid||''))?String(c.rpid):'';
    const rawRoot=/^[1-9]\d{0,29}$/.test(String(c?.root||''))?String(c.root):'';
    const fromNotice=/^[1-9]\d{0,29}$/.test(String(c?.locationRoot||''))?String(c.locationRoot):'';
    const kind=c?.kind==='reply'?'reply':'top';
    const root=fromNotice||(kind==='top'?rid:rawRoot);
    const confidence=fromNotice?'通知原始根评论ID':kind==='top'?'顶层评论ID':root?'历史记录推定的根评论ID':'无根评论ID';
    return {bv,rid,root,kind,confidence,precise:!!(bv&&rid&&root)};
  };
  const safeCommentLink=(c)=>{
    const x=commentCoordinates(c);
    const bv=x.bv;const videoLabel=bv||'视频 ID 未记录';
    const a=node('a',videoLabel);
    const base=x.bv?'https://www.bilibili.com/video/'+encodeURIComponent(x.bv)+'/':'https://www.bilibili.com/';
    if(x.precise){
      const params=new URLSearchParams({comment_on:'1',comment_root_id:x.root});
      if(x.kind==='reply'&&x.root!==x.rid)params.set('comment_secondary_id',x.rid);
      a.href=base+'?'+params.toString()+'#reply'+encodeURIComponent(x.rid);
    }else a.href=base;
    a.target='_blank';a.rel='noopener noreferrer';
    a.title=x.precise?'点击定位具体评论 · rpid '+x.rid+' · '+x.confidence+'；B站网页可能不自动滚动':
      '缺少可靠根评论 ID，仅打开视频；可查看卡片内已保存的原文与评论 ID';
    return a;
  };
  const reasonLabel=(x)=>({ai_declined:'AI 决定不 @',ai_selected_no_names:'AI 想 @，但未选中名单内好友',no_mention_targets:'没有配置 @ 名单',mention_disabled:'@ 策略已关闭',mentioned_text_only_missing_uid:'缺少有效 UID',mention_requested:'已按设置尝试 @',reply_no_group_mentions:'后台回复不群发 @'}[x]||x||'未提供原因');
  const dynamicStatusLabel=(x)=>({api_accepted_unverified:'B站接口接受（公开状态未核实）',ai_skipped:'AI 选择不同步',disabled:'同步开关关闭',blocked_by_setting:'被用户设置阻止',receipt_unverified:'评论回执不完整，无法安全同步',daily_limit:'达到每日动态上限',already_attempted:'同 BV 今日已尝试',reservation_failed_no_publish:'额度锁失败，未发布',comment_receipt_unverified_no_publish:'评论回执不完整，未发布',uncertain_no_retry:'发送结果不确定，不重试',failed:'动态接口失败',paused:'插件已暂停',not_requested:'未选择同步',comment_failed:'评论失败',not_applicable:'不适用于楼中楼回复'}[x]||x||'状态未知');
  const diagFields=[['diag-mention-enabled','diagMentionEnabled'],['diag-dynamic-enabled','diagDynamicEnabled'],['diag-vision-enabled','diagVisionEnabled'],['diag-meme-enabled','diagMemeEnabled'],['diag-at-invite-enabled','diagAtInviteEnabled'],['diag-reply-inbox-enabled','diagReplyInboxEnabled']];
  $('diag-save').addEventListener('click',()=>run(async()=>{
    const patch={};for(const [id,key] of diagFields)patch[key]=$(id).checked;
    const saved=await request('/config',patch);
    message(saved.host?.ok===false?'已写入本地配置，DSH 设置同步失败：'+(saved.host.error||'未知原因'):'诊断开关已保存，后续任务按新开关记录；历史日志保留');
  }));
  const loadDiagnostics=async()=>{
    // Existing published-comment ledger only: no additional B站 reads or AI calls.
    const [m,im,vi,config,status,receipts]=await Promise.all([request('/mention-diagnostics'),request('/meme-diagnostics'),request('/vision-diagnostics'),request('/config'),request('/status'),request('/recent-comments?limit=200').catch(()=>({rows:[]}))]);
    const exactReceipts=new Map((receipts.rows||[]).filter(r=>r.rpid&&r.bvid).map(r=>[r.bvid+':'+r.rpid,r]));
    const hydrateDiag=(x)=>{
      const rec=exactReceipts.get(String(x.bvid||'')+':'+String(x.rpid||''));
      if(!rec)return x;
      return {...x, root:x.root&&x.root!=='0'?x.root:(rec.root||x.root),kind:x.kind||rec.kind,
        content:x.content||rec.snippet||'',contentFromReceipt:!x.content&&!!rec.snippet};
    };
    const addDiagContext=(card,x)=>{
      if(x.content)add(card,node('div',(x.contentFromReceipt?'已有判重账本节选：':'这条评论（本地记录）：')+String(x.content),'preview'));
      else add(card,info('这条诊断未保存评论正文；旧记录无法无成本补出原文。'));
      const c=commentCoordinates(x);
      if(c.precise){
        add(card,info('评论定位 ID：root '+c.root+' · rpid '+c.rid+'（B站网页不保证自动滚动）'));
        add(card,btn('复制评论 ID',()=>{navigator.clipboard?.writeText?.('BV='+c.bv+' root='+c.root+' rpid='+c.rid);message('已请求复制定位 ID')}));
      }else add(card,info('本条缺少可靠评论 ID，BV 链接仅打开视频，无法精准跳转。'));
    };
    for(const [id,key] of diagFields)$(id).checked=config.config?.[key]!==false;
    $('mention-summary').textContent=`${m.day||localDay()} · 已发表评论 ${m.total||0} 条 · 尝试 @ ${m.attempted||0} 条 · 未 @ ${m.notMentioned||0} 条 · 失败 ${m.failed||0} 条`;
    $('mention-list').replaceChildren();
    for(const raw of (m.recent||[]).slice(0,12)){
      const x=hydrateDiag(raw);
      const card=node('div','','record');const top=node('div');add(top,(x.rpid?safeCommentLink(x):safeVideoLink(x.bvid)),node('span',' · '+(x.kind==='reply'?'楼中楼':'顶层')+' · '+(x.success?(x.mention_attempted?'尝试 @':'未 @'):'发送失败')));
      add(card,top,info((x.time||'')+' · '+reasonLabel(x.reason)+(x.mention_delivery?' · '+x.mention_delivery:'')));
      addDiagContext(card,x);
      if(x.success&&x.reason==='ai_declined'&&x.ai_reason)add(card,info('AI说明：'+x.ai_reason));
      $('mention-list').appendChild(card);
    }
    if(!$('mention-list').children.length)$('mention-list').append(info('今天还没有 @ 诊断记录。'));
    const dy=m.dynamic||{};
    $('dynamic-summary').textContent=`顶层评论决策 ${dy.evaluated??0} 条 · AI 选择同步 ${dy.aiSelected??0} 条 · 接口接受 ${dy.accepted??0} 条 · AI 选择不同步 ${dy.aiSkipped??0} 条 · 设置／额度阻止 ${dy.blocked??0} 条`;
    $('dynamic-list').replaceChildren();
    for(const raw of (m.dynamicRecent||[]).slice(0,12)){
      const x=hydrateDiag(raw);
      const card=node('div','','record');const top=node('div');
      add(top,(x.rpid?safeCommentLink(x):safeVideoLink(x.bvid)),node('span',' · '+(x.dynamic_ai_decision===true?'AI 选择同步':'AI 选择不同步')+' · '+dynamicStatusLabel(x.dynamic_status)));
      add(card,top,info((x.time||'')+(x.dynamic_reason?' · AI说明：'+x.dynamic_reason:'')));
      addDiagContext(card,x);
      $('dynamic-list').appendChild(card);
    }
    if(!$('dynamic-list').children.length)$('dynamic-list').append(info('今天还没有动态决策诊断记录。'));
    $('vision-summary').textContent=`${vi.enabled?'识图开启':'识图关闭'} · Debug ${vi.debug?'开启':'关闭'} · 今日自动识图调用记录 ${vi.attempts||0} 次 · 本地已保存 ${vi.savedBvs||0} 个 BV / ${vi.savedJpegs||0} 张 JPEG · 路径：${vi.pathHint||'vision-debug/BV号/'}。没有记录时请先确认有自动刷片轮次，或到设置页手动测试一个 BV。`;
    $('vision-list').replaceChildren();
    for(const x of (vi.events||[]).slice(0,12)){
      const card=node('div','','record');const top=node('div');
      add(top,safeVideoLink(x.bvid),node('span',' · '+x.source+' · '+x.status+(x.debug_saved?' · 已保存JPEG':'')));
      add(card,top,info((x.time||'')+(x.times?.length?' · 预览秒数：'+x.times.join('、'):'')+(x.error?' · '+x.error:'')));
      $('vision-list').appendChild(card);
    }
    if(!$('vision-list').children.length)$('vision-list').append(info('今天没有实际识图工具调用／取帧日志。仅开启 Debug 不会产生文件。'));
    $('meme-summary').textContent=`${im.day||localDay()} · 顶层评论 ${im.total||0} 条 · 选图 ${im.attempted||0} 次 · 尝试附图 ${im.submitted||0} 次 · 未附图 ${im.notAttached||0} 条 · 失败 ${im.failed||0} 条`;
    $('meme-diag-list').replaceChildren();
    for(const raw of (im.recent||[]).slice(0,12)){
      const x=hydrateDiag(raw);
      const card=node('div','','record');const top=node('div');add(top,(x.rpid?safeCommentLink({...x,kind:'top'}):safeVideoLink(x.bvid)),node('span',' · '+(x.success?'评论已成功':'评论未成功')+' · '+(x.selected?'选图':'未选图')+' · '+(x.status||'')));
      add(card,top,info((x.time||'')+(x.image?' · 图片：'+x.image:'')));
      if(x.reason)add(card,info('原因：'+x.reason));
      if(!x.selected&&Array.isArray(x.local_candidates)&&x.local_candidates.length){
        const safe=x.local_candidates.filter(n=>typeof n==='string'&&n.length<=180).slice(0,3);
        if(safe.length)add(card,node('div','本地名称检索可参考：'+safe.join('、')+'（仅匹配文件名；不是已识图或确认适配）','preview'));
      }
      addDiagContext(card,x);
      $('meme-diag-list').appendChild(card);
    }
    if(!$('meme-diag-list').children.length)$('meme-diag-list').append(info('今天还没有表情包诊断记录。'));
    const c=status.commentInteractStatus||{};
    const drawHistory=(fetchId,listId,fetchInfo,events,reasons,empty)=>{
      $(fetchId).textContent=fetchInfo?`上次读取：${new Date(fetchInfo.at).toLocaleString()} · 接口 ${fetchInfo.rawCount} 条 · 识别 ${fetchInfo.recognized} 条 · 过滤 ${fetchInfo.invalid} 条`:'尚未成功读取通知；可检查后台轮询与最近错误。';
      const target=$(listId);target.replaceChildren();
      for(const e of (events||[]).slice(0,30)){
        const card=node('div','','record');
        const uid=/^[1-9]\d{0,19}$/.test(String(e.uid||''))?String(e.uid):'';
        const who=e.name||'昵称未知';
        const reason=reasons[e.reason]||e.reason||'未知状态';
        const title=node('div','','title-line');
        add(title,node('strong',who),node('span','· '+reason));
        const meta=node('div','','meta-line muted');
        const scopeLabel=({ 'self-top':'我发布的主评论下','self-nested':'我发布的楼中楼下',notice:'其他评论通知',at:'被 @ 邀请' })[e.scope];
        meta.appendChild(node('span',Number.isFinite(Number(e.at))?new Date(e.at).toLocaleString():'时间未记录'));
        if(scopeLabel)meta.appendChild(node('span','· '+scopeLabel));
        const kind=(e.kind==='reply'||e.scope==='self-nested'||(String(e.root||'')&&String(e.root)!==String(e.rpid||'')))?'reply':'top';
        if(e.bvid && /^BV[0-9A-Za-z]{10}$/.test(String(e.bvid||''))){
          const link=safeCommentLink({...e,kind});
          link.textContent=e.bvid;
          meta.appendChild(node('span','· '));meta.appendChild(link);
        }else meta.appendChild(node('span','· BV 未记录'));
        if(uid){
          meta.appendChild(node('span','· '));
          const a=node('a',`${uid}${who&&who!=='昵称未知'?' | '+who:''}`);a.href='https://space.bilibili.com/'+uid;a.target='_blank';a.rel='noopener noreferrer';a.title='点击进入对方主页';meta.appendChild(a);
        }
        add(card,title,meta);
        // All displayed text is already in the local comment ledger / fetched reply context.
        // Rendering this card never calls AI or a B站 comment API.
        if(e.text)add(card,node('div','对方这条：'+String(e.text),'preview'));
        if(e.context)add(card,node('div','上一层上下文：'+String(e.context),'preview'));
        if(e.rootPreview)add(card,node('div','楼层主评论（已缓存）：'+String(e.rootPreview),'preview'));
        if(e.threadPreview){
          const d=node('details','','comment-thread-preview');
          add(d,node('summary','展开本轮已读取的附近楼中楼评论'),node('div',String(e.threadPreview),'preview'));
          card.appendChild(d);
        }
        if(e.contextSummary)add(card,node('div','AI 上下文来源：'+String(e.contextSummary).slice(0,300),'preview'));
        if(e.generatedReply)add(card,node('div',(e.reason==='sent'?'大肥鱼本次回复（B站接口已接受，公开状态待核实）：':'AI 已生成（仅本地草稿，未必发送成功）：')+String(e.generatedReply),'preview manual-generated-reply'));
        const coords=commentCoordinates({...e,kind});
        if(coords.bv&&coords.rid){
          const details=node('details','','comment-location-details');
          const source=coords.confidence+(coords.confidence==='历史记录推定的根评论ID'?'（不一定准确）':'');
          const text='BV：'+coords.bv+'\nAID：'+String(e.aid||'未记录')+'\n目标 rpid：'+coords.rid+'\n楼层 root：'+(coords.root||'未记录')+'\n定位依据：'+source;
          const line=node('div',text,'preview');
          const copy=btn('复制评论定位信息',async()=>{
            if(navigator.clipboard?.writeText){try{await navigator.clipboard.writeText(text);message('已复制 BV、AID 与评论 ID');return}catch{}}
            prompt('剪贴板不可用，请手动复制下面的定位信息：',text);
          });
          add(details,node('summary','评论定位信息（跳转不准时查看）'),line,copy);
          card.appendChild(details);
        }
        if(e.errorDetail)add(card,node('div','详细原因：'+String(e.errorDetail).slice(0,320),'preview manual-error-detail'));
        else if(['send_failed','send_uncertain','manual_send_failed','manual_send_uncertain'].includes(e.reason))
          add(card,node('div','详细原因：旧版本未保存 B站 接口返回的错误原文，无法准确追溯。','preview manual-error-detail'));
        const validTarget=/^(?:at|comment):[A-Za-z0-9_-]{1,40}$/.test(String(e.id||''))
          && /^[1-9]\d{0,19}$/.test(String(e.uid||''))
          && /^BV[0-9A-Za-z]{10}$/.test(String(e.bvid||''))
          && /^[1-9]\d{0,29}$/.test(String(e.rpid||'')) && !!String(e.text||'').trim();
        // Ordinary AI reply is only for unseen/skipped comments. Failed sends stay
        // blocked unless the user explicitly confirms no visible B站 reply.
        const finished=e.reason==='sent'||e.retryBlocked===true||['send_failed','send_uncertain','manual_send_failed','manual_send_uncertain'].includes(e.reason);
        const verifiedRetry=validTarget&&e.manualRetryAllowed===true;
        if(validTarget&&finished&&e.reason!=='sent'&&!verifiedRetry){
          const exhausted=e.manualRetryRemaining===0&&['send_failed','send_uncertain','manual_send_failed','manual_send_uncertain'].includes(e.reason);
          add(card,info(exhausted?'已达到24小时内人工核对重发次数上限（3次），暂不允许继续发送。':'发送可能已到达 B站。当前记录不可直接重复发送。'));
        }
        if(validTarget&&(!finished||verifiedRetry)){
          const act=node('div','','actions');
          const status=node('p','','muted manual-reply-status');
          if(verifiedRetry)add(act,info('你已自行核对 B站该楼层没有这条回复时，才使用下方按钮；评论可能延迟审核，重发仍有重复风险。剩余核对重试 '+e.manualRetryRemaining+' 次。'));
          const label=verifiedRetry?(e.generatedReply?'已核对未发出，重发 AI 草稿':'已核对未发出，重新生成并发送'):'要求 AI 回复这条';
          const actionButton=btn(label,async()=>{
            const warning=verifiedRetry
              ? '请确认：你已在 B站检查该楼层和大肥鱼已发评论，确认此前回复没有公开显示。\n若 B站仍在审核，重新发送可能造成重复。\n仍要由你人工确认并再次发送吗？'
              : '确认让大肥鱼针对这条评论生成并发送一条公开回复？\n仍会遵守每日额度、去重与内容安全检查。';
            if(!confirm(warning))return;
            actionButton.disabled=true;actionButton.textContent='正在处理…';
            status.textContent=verifiedRetry
              ?(e.generatedReply?'已确认：正在重发此前保存的 AI 草稿，等待 B站回执。':'已确认：正在重新读取上下文并让 AI 生成，然后发送。')
              :'请求已提交：正在重新读取视频、字幕、主评论、楼中楼和热门评论，再请求 AI 生成回复。';
            try{
              const answer=await request('/comment-force-reply',{id:e.id,...(verifiedRetry?{confirmedMissing:true}:{})});
              e.reason='sent';e.forced=true;e.contextSummary=answer.contextSummary||e.contextSummary||'';
              title.replaceChildren(node('strong',who),node('span','· 手动回复已获得发送回执'));
              actionButton.remove();
              status.textContent='发送回执已确认：'+String(answer.reply||'（回复正文未返回）')+(answer.contextSummary?' · 上下文：'+answer.contextSummary:'')+'。B站公开显示状态仍建议刷新确认。';
              message('手动回复成功：已获得发送接口回执。');
            }catch(err){
              const detail=String(err?.message||'手动回复失败');
              status.textContent='本次未确认成功：'+detail;
              message('手动回复未成功：'+detail,true);
              // Re-read the durable ledger: verified retries remain possible ONLY
              // with another deliberate confirmation; never infer safety from UI state.
              await loadDiagnostics().catch(()=>{});
            }
          },'primary');
          add(act,actionButton,status);card.appendChild(act);
        }
        target.appendChild(card);
      }
      if(!target.children.length)target.appendChild(info(empty));
    };
    const common={received:'通知已识别，等待处理',first_poll_baseline:'首次启动：旧通知不补发',source_already_processed:'相同评论已被另一通知处理',ai_generation_error:'AI 生成失败',manual_ai_generation_error:'手动要求回复：AI 生成失败',manual_ai_skipped:'手动要求回复：AI 仍未生成可发送内容',manual_context_unavailable:'手动要求回复：视频/评论上下文不足',manual_send_uncertain:'手动发送结果不确定，已禁止重复发送',manual_send_failed:'手动发送失败',ai_skipped:'AI 自主选择不回复',sent:'回复接口已接受（公开状态未核实）',reply_limit:'每轮／近24小时限额',per_user_limit:'同一用户回复额度',quota_exhausted:'每日公开评论额度已满',quota_store_blocked:'额度账本暂不可用',send_uncertain:'发送结果不确定，不自动重发',send_failed:'发送失败，不自动重发'};
    drawHistory('comment-at-fetch','comment-at-events',c.atLastFetch,c.atDiagnostics,{...common,
      parser_upgrade_baseline:'解析器更新：旧通知不补发',video_reference_missing:'缺少视频链接/AID',comment_id_missing:'缺少评论ID',comment_text_missing:'缺少原文',not_video_comment:'不是视频评论@',mention_not_for_account:'没有@本账号',account_uid_missing:'无法获取登录 UID',sender_missing_or_self:'来自本账号或UID无效',not_in_whitelist:'不在被@白名单',out_of_window:'超出24小时处理窗口',waiting_for_video_context:'视频资料读取失败，稍后重试',video_context_unavailable:'视频上下文多次读取失败'},
      '暂无被 @ 处理记录。请确认后台轮询已开启，并在首次检查完成后发送新的 @。');
    drawHistory('comment-reply-fetch','comment-reply-events',c.replyLastFetch,c.replyDiagnostics,{...common,
      parser_upgrade_baseline:'解析器升级：旧通知不补发',not_video_comment:'非视频评论通知（业务类型过滤）',comment_reference_missing:'缺少视频AID或评论ID',sender_missing_or_self:'本人回复或UID缺失',comment_text_missing:'通知未包含评论原文',video_context_partial:'视频上下文不完整，仍按已有真实内容判断'},
      '暂无收到评论回复的诊断。确认「收到评论回复」开关已开启并发生新回复。');
  };
  $('diag-refresh').addEventListener('click',()=>run(loadDiagnostics));

  if($('report-day'))$('report-day').value=localDay();
  const loadReport=async()=>{
    const day=$('report-day').value||localDay();
    const data=await request('/report?day='+encodeURIComponent(day));
    $('report-meta').textContent=data.exists?`${data.day} · 已读取本地日报 · ${data.text.length.toLocaleString()} 字符`:`${data.day} · 这一天没有日报文件`;
    $('report-content').textContent=data.exists?(data.text||'（日报文件为空）'):'这一天没有日报。';
  };
  $('report-load').addEventListener('click',()=>run(loadReport));
  $('report-day').addEventListener('change',()=>run(loadReport));
  $('report-copy').addEventListener('click',()=>run(async()=>{const text=$('report-content').textContent||'';await navigator.clipboard.writeText(text);message('已复制报告文本')}));

  // 展示排序与磁盘存储顺序分离：待审核优先，已拒绝放最后，同状态最近修改在前。
  // 不修改 persona-growth/v1.json 的条目顺序或审计记录。
  const growthPriority={pending:0,approved:1,rejected:2};
  const growthDisplayOrder=entries=>[...entries].sort((a,b)=>{
    const priorityA=growthPriority[a.status]??3;
    const priorityB=growthPriority[b.status]??3;
    if(priorityA!==priorityB)return priorityA-priorityB;
    const changedA=Date.parse(a.updatedAt||a.createdAt||'')||0;
    const changedB=Date.parse(b.updatedAt||b.createdAt||'')||0;
    return changedB-changedA;
  });
  const growthList=async()=>{
    const data=await request('/persona-growth');$('growth-list').replaceChildren();
    const entries=(data.data?.entries||[]).filter(e=>e.type==='style');
    badge('growth-count',entries.filter(e=>e.status==='pending').length);
    const filter=$('growth-filter').value;
    for(const e of growthDisplayOrder(entries.filter(e=>!filter||e.status===filter))){
      const card=node('article','','card');
      add(card,pill(e.status),pill(e.type),info('原始反馈（仅存档）：'+e.text),info('来源：'+(e.source==='owner-direct'?'主人直接编写':e.source==='owner'?'主人反馈':'日报')+(e.evidence?' · '+e.evidence:'')));
      const candidate=e.status==='approved'?(e.approvedText||e.text):(e.suggestedText||(e.source==='report'?e.text:''));
      const title=node('h4',e.status==='approved'?'已批准 · '+({style:'评论风格',interest:'长期兴趣',experience:'视频经历',relationship:'角色关系'}[e.type]||e.type):e.source==='report'?'日报统计候选 · 主人直接审核':(e.source==='owner-direct'||e.directReview)?'主人直接编写 · 待审核':'模型建议 · 审核前可修改');
      add(card,title);
      if(e.status==='approved'){
        add(card,info(candidate));
      }else{
        const edit=node('textarea',candidate);
        edit.value=candidate;edit.maxLength=230;edit.rows=4;edit.readOnly=e.source==='report';edit.placeholder=e.source==='report'?'日报已提供主题观察；直接批准即可':(e.source==='owner-direct'||e.directReview)?'直接审核稿：可修改后保存，再批准':'先点击「AI 提炼建议」，也可以选择直接审核原始反馈';
        edit.style.width='100%';
        add(card,edit);
        if(e.suggestionReason)add(card,info('提炼说明：'+e.suggestionReason));
        const draftActions=node('div','','actions');
        if(e.source==='owner'&&!e.suggestedText&&!e.modelSuggestedAt)add(draftActions,btn('不调用 AI，直接审核原始反馈',async()=>{await request('/persona-growth',{action:'direct',id:e.id});await growthList();message('已将原始反馈转为直接审核稿，可修改后批准。');}));
        if(e.source==='owner')add(draftActions,btn(e.suggestedText?'重新让 AI 提炼':'AI 提炼建议',async()=>{
          message('正在调用 DSH 模型提炼成长建议…');
          const output=await request('/persona-growth',{action:'suggest',id:e.id});
          await growthList();message('模型建议已生成。请先阅读／修改，再决定是否批准。');
        }));
        if(e.source!=='report' && (e.modelSuggestedAt||e.source==='owner-direct'||e.directReview))add(draftActions,btn('保存修改',async()=>{
          if(edit.value.trim().length<((e.source==='owner-direct'||e.directReview)?6:12))throw Error((e.source==='owner-direct'||e.directReview)?'请填写至少 6 字的成长经验':'请填写至少 12 字的建议');
          await request('/persona-growth',{action:'revise',id:e.id,suggestion:edit.value.trim()});
          await growthList();
        }));
        if(e.suggestedText||e.source==='report')add(draftActions,btn(e.source==='report'?'批准该兴趣':(e.source==='owner-direct'||e.directReview)?'批准这条经验':'批准这条建议',async()=>{
          if(e.source!=='report' && edit.value.trim()!==e.suggestedText)throw Error('你修改了审核稿，请先点击「保存修改」，再批准');
          await request('/persona-growth',{action:'approve',id:e.id});await growthList();
        }));
        add(card,draftActions);
      }
      if(e.type==='relationship'){
        const field=node('div','','inset');
        const name=node('input');name.placeholder='人物名称，例如 Claude';name.value=e.personName||'';name.maxLength=48;
        const aliases=node('input');aliases.placeholder='人物别名，用逗号分隔，例如 克劳德, Claude小姐';aliases.value=(e.personAliases||[]).join(', ');aliases.maxLength=600;
        add(field,info('人物名称和别名（仅影响本地检索，不修改已批准正文）'),name,aliases,btn('保存人物索引',async()=>{
          await request('/persona-growth',{action:'person',id:e.id,personName:name.value,personAliases:aliases.value.split(/[,，\n]/).map(x=>x.trim()).filter(Boolean)});
          await growthList();message('人物名称和别名已保存；主题预览和 AI 记忆召回立即生效。');
        }));add(card,field);
      }
      const actions=node('div','','actions');
      if(e.status!=='rejected'&&e.status!=='approved')add(actions,btn('忽略',async()=>{await request('/persona-growth',{action:'reject',id:e.id});await growthList()}));
      add(actions,btn('删除',async()=>{if(e.status==='approved'&&!confirm('这条成长经验已批准并生效，确定删除？'))return;await request('/persona-growth',{action:'delete',id:e.id});await growthList()},'danger'));
      add(card,actions);$('growth-list').appendChild(card);
    }
    if(!entries.length)$('growth-list').append(info('目前还没有行为与表达改进规则。'));
    $('growth-context').textContent='【刷视频与选片的表达规则】\n'+(data.contexts?.duty||'（暂无）')+'\n【公开评论的表达规则】\n'+(data.contexts?.comment||'（暂无）')+'\n兴趣、经历、关系请在「人生记忆」中检索，不作为行为规则直接注入。';
  };
  $('growth-add').addEventListener('click',()=>run(async()=>{
    const text=$('growth-draft').value.trim();if(text.length<6)throw Error('请输入至少 6 字的反馈');
    const button=$('growth-add');button.disabled=true;
    try {
      const added=await request('/persona-growth',{action:'add',type:$('growth-type').value,text});
      const entry=added.result;
      if(entry.status==='approved'){
        await growthList();message('相同原始反馈已经批准，未重复提交。');return;
      }
      $('growth-draft').value='';
      message('反馈已存档，正在调用 DSH 模型提炼…');
      try {
        await request('/persona-growth',{action:'suggest',id:entry.id});
        await growthList();message('AI 建议已经生成。请审核候选内容，确认后再点击批准。');
      } catch(error) {
        await growthList();
        message('反馈已保存为待审核，但模型提炼失败：'+String(error?.message||error)+'。可以在列表中点击「AI 提炼建议」重试。',true);
      }
    } finally {button.disabled=false}
  }));
  $('growth-add-direct').addEventListener('click',()=>run(async()=>{
    const text=$('growth-draft').value.trim();if(text.length<6)throw Error('请输入至少 6 字的成长经验');
    const button=$('growth-add-direct');button.disabled=true;
    try {
      const added=await request('/persona-growth',{action:'add-direct',type:$('growth-type').value,text});
      if(added.result.status==='approved'){await growthList();message('相同内容已经批准，未重复提交。');return;}
      $('growth-draft').value='';await growthList();message('已直接提交待审核，没有调用 AI。检查内容后即可批准。');
    } finally {button.disabled=false}
  }));
  $('growth-undo').addEventListener('click',()=>run(async()=>{
    if(!confirm('撤销最近一次成长库修改？'))return;await request('/persona-growth',{action:'undo'});await growthList();
  }));
  $('growth-filter').addEventListener('change',()=>run(growthList));

  const memeList=async()=>{
    const q=$('meme-search').value.trim();const data=await request('/meme-memory?q='+encodeURIComponent(q));$('meme-list').replaceChildren();
    const entries=data.entries||[];const counts=data.counts||{};
    badge('meme-count',counts.pending||0);
    try { const cfg=await request('/config');setLearningState('meme-learning-status',cfg.config?.memeMemoryEnabled!==false,'正在收集梗知识','自动收集已关闭'); } catch {setLearningState('meme-learning-status',false,'','状态暂不可读取')}
    $('meme-stats').textContent='共 '+(data.total||0)+' 条 · 待审核 '+(counts.pending||0)+' · 已批准 '+(counts.approved||0)+' · 已拒绝 '+(counts.rejected||0)+'。新梗有来源即可自动启用；待核实仅代表解释还不确定。历史待审可继续人工处理。最多显示 50 条，支持搜索。';
    for(const e of entries){
      const card=node('article','','card');
      add(card,pill(e.review_status),node('h3',e.name),info(e.meaning),info('别名：'+(e.aliases||'无')+' · '+e.kind+' · 证据：'+(e.confidence==='有文字依据'?'已核对文字来源':'待核实，AI 只能作为线索')));
      for(const src of (e.sources||[]).slice(0,2))add(card,info(src.bvid+' · '+src.evidence_type+'：'+src.evidence));
      const actions=node('div','','actions');
      add(actions,btn('编辑',()=>editMeme(card,e)));
      if(e.review_status!=='approved')add(actions,btn('批准',async()=>{await request('/meme-memory/review',{id:e.id,status:'approved'});await memeList()}));
      if(e.review_status!=='rejected')add(actions,btn('拒绝',async()=>{await request('/meme-memory/review',{id:e.id,status:'rejected'});await memeList()}));
      add(actions,btn('删除',async()=>{if(!confirm('永久删除梗「'+e.name+'」及其来源？'))return;await request('/meme-memory/delete',{id:e.id});await memeList()},'danger'));
      add(card,actions);$('meme-list').appendChild(card);
    }
    if(!entries.length)$('meme-list').append(info('没有匹配的梗记录。'));
  };
  const editMeme=(card,e)=>{
    if(card.querySelector('.inset'))return;
    const wrap=node('div','','inset');const fields=node('div','','fields');const values={};
    const input=(key,title,value,max)=>{
      const box=node('div');const label=node('label',title);const item=node('input');item.value=value||'';item.maxLength=max;values[key]=item;add(box,label,item);fields.appendChild(box);
    };
    input('name','梗名称',e.name,48);input('aliases','别名',e.aliases,140);
    input('meaning','解释',e.meaning,220);
    const select=(key,title,current,options)=>{const box=node('div');const label=node('label',title);const s=node('select');for(const o of options){const op=node('option',o);op.value=o;s.appendChild(op)}s.value=current;values[key]=s;add(box,label,s);fields.appendChild(box)};
    select('kind','类型',e.kind,['梗','角色','人物','系列','其他']);select('confidence','释义证据',e.confidence,['待核实','有文字依据']);
    const actions=node('div','','actions');
    add(actions,btn('保存修改',async()=>{const payload={id:e.id};for(const [k,v]of Object.entries(values))payload[k]=v.value;await request('/meme-memory/edit',payload);await memeList()}),btn('取消',()=>wrap.remove()));
    add(wrap,fields,info('修改释义不会伪造或删除来源；新梗自动启用，历史待审条目仍可手动批准。'),actions);card.appendChild(wrap);
  };
  $('meme-new-save').addEventListener('click',()=>run(async()=>{
    const name=$('meme-new-name').value.trim(),meaning=$('meme-new-meaning').value.trim();
    if(name.length<2||!meaning)throw Error('请填写至少两个字的名称和释义');
    await request('/meme-memory/add',{name,meaning,aliases:$('meme-new-aliases').value.trim(),kind:$('meme-new-kind').value,confidence:$('meme-new-confidence').value});
    $('meme-new-name').value='';$('meme-new-aliases').value='';$('meme-new-meaning').value='';
    await memeList();message('已人工新增并启用梗知识');
  }));
  $('meme-find').addEventListener('click',()=>run(memeList));
  $('meme-search').addEventListener('keydown',e=>{if(e.key==='Enter')run(memeList)});

  // v2.4.71: Local, deterministic matching rule editor. No dangerous HTML injection.
  let ruleSet={schema:1,rules:[]},rulesCustomized=false,memeRulesLoaded=false;
  const ruleWords=s=>String(s||'').split(/[，,、\n]+/).map(x=>x.trim()).filter(Boolean);
  const rulesStatus=text=>{ $('meme-rule-status').textContent=String(text) };
  // v2.4.72: ruleSet stores *all* rules, not only the DOM page. Filtering cannot drop edits.
  let memeRulePage=1;
  const RULE_PAGE_DEFAULT=6;
  const captureMemeRules=()=>({schema:1,rules:ruleSet.rules.map(r=>({
    id:r.id,label:String(r.label||'').trim(),enabled:!!r.enabled,
    ...Object.fromEntries(['triggers','targets','requireAny','excludeAny'].map(k=>[k,[...(r[k]||[])]]))
  }))});
  const updateRuleNote=()=>{rulesStatus('编辑区共 '+ruleSet.rules.length+' 条 · '+ruleSet.rules.filter(r=>r.enabled).length+' 条已启用 · '+(rulesCustomized?'主人自定义':'出厂默认')+' · 修改后需保存全部规则')};
  const renderMemeRules=()=>{
    const target=$('meme-rule-list');target.replaceChildren();
    const query=$('meme-rule-search').value.trim().toLocaleLowerCase();
    const status=$('meme-rule-filter').value;
    const filtered=ruleSet.rules.filter(rule=>{
      if(status==='enabled'&&!rule.enabled||status==='disabled'&&rule.enabled)return false;
      return !query||[rule.label,...rule.triggers,...rule.targets,...(rule.requireAny||[]),...(rule.excludeAny||[])].join(' ').toLocaleLowerCase().includes(query);
    });
    const size=Math.max(1,Number($('meme-rule-page-size').value)||RULE_PAGE_DEFAULT);
    const pages=Math.max(1,Math.ceil(filtered.length/size));
    memeRulePage=Math.min(Math.max(1,memeRulePage),pages);
    const visible=filtered.slice((memeRulePage-1)*size,memeRulePage*size);
    for(const rule of visible){
      const el=node('details','','settings-section');el.dataset.ruleId=rule.id;
      const summary=node('summary',`${rule.enabled?'●':'○'} ${rule.label}  ·  ${rule.triggers.slice(0,3).join(' / ')}${rule.triggers.length>3?'…':''}`);
      summary.style.cursor='pointer';summary.style.fontWeight='600';summary.style.padding='4px 0';
      el.appendChild(summary);
      const heading=node('div','','toolbar');heading.style.marginTop='10px';
      const label=node('input');label.className='meme-rule-label';label.value=rule.label;label.maxLength=65;label.setAttribute('aria-label','规则名称');
      label.addEventListener('input',()=>{rule.label=label.value;summary.textContent=`${rule.enabled?'●':'○'} ${rule.label} · ${rule.triggers.slice(0,3).join(' / ')}`;rulesStatus('有未保存的修改，点击保存全部规则')});
      const toggle=node('input');toggle.type='checkbox';toggle.className='meme-rule-enabled';toggle.checked=rule.enabled;
      toggle.addEventListener('change',()=>{rule.enabled=toggle.checked;summary.textContent=`${rule.enabled?'●':'○'} ${rule.label} · ${rule.triggers.slice(0,3).join(' / ')}`;rulesStatus('有未保存的修改，点击保存全部规则')});
      const tw=node('label','启用');tw.style.display='flex';tw.style.alignItems='center';tw.style.gap='5px';tw.appendChild(toggle);
      const remove=btn('移除规则',async()=>{if(!confirm('确认移除「'+rule.label+'」？保存后才正式生效。'))return;ruleSet.rules=ruleSet.rules.filter(x=>x.id!==rule.id);renderMemeRules();rulesStatus('规则已从编辑区移除；点击保存全部规则后生效');},'danger');
      add(heading,label,tw,remove);el.appendChild(heading);
      const fields=node('div','','fields');
      for(const [headingText,key] of [['当评论包含任意词','triggers'],['表情包文件名／分类包含任意词','targets'],['且必须出现至少一个词（可留空）','requireAny'],['出现这些词则排除（可留空）','excludeAny']]){
        const cell=node('div');const title=node('label',headingText);const input=node('textarea');
        input.rows=2;input.className='meme-rule-'+key;input.value=(rule[key]||[]).join('、');
        input.addEventListener('input',()=>{rule[key]=ruleWords(input.value);rulesStatus('有未保存的修改，点击保存全部规则')});
        add(cell,title,input);fields.appendChild(cell);
      }
      el.appendChild(fields);target.appendChild(el);
    }
    if(!filtered.length)target.appendChild(info('没有匹配的规则。可以清空搜索词，或新增一条规则。'));
    $('meme-rule-page-status').textContent=`第 ${memeRulePage} / ${pages} 页 · 匹配 ${filtered.length} 条 · 总计 ${ruleSet.rules.length} 条（全部规则仍会一起保存）`;
    $('meme-rule-prev').disabled=memeRulePage<=1;
    $('meme-rule-next').disabled=memeRulePage>=pages;
  };
  $('meme-rule-search').addEventListener('input',()=>{memeRulePage=1;renderMemeRules()});
  $('meme-rule-filter').addEventListener('change',()=>{memeRulePage=1;renderMemeRules()});
  $('meme-rule-page-size').addEventListener('change',()=>{memeRulePage=1;renderMemeRules()});
  $('meme-rule-prev').addEventListener('click',()=>{memeRulePage--;renderMemeRules()});
  $('meme-rule-next').addEventListener('click',()=>{memeRulePage++;renderMemeRules()});
  const loadMemeRules=async()=>{
    const r=await request('/comment-meme-rules');ruleSet=r.data;rulesCustomized=r.customized;memeRulesLoaded=true;
    renderMemeRules();updateRuleNote();
  };
  let memeRulePromptDefault='';
  let memeRulePromptSaved='';
  const loadMemeRulePrompt=async()=>{
    const [config,defaults]=await Promise.all([request('/config'),request('/comment-meme-rules/ai-prompt-default')]);
    memeRulePromptDefault=String(defaults.prompt||'');
    memeRulePromptSaved=String(config.config?.memeRulesPrompt||'').trim()||memeRulePromptDefault;
    $('meme-rule-ai-prompt').value=memeRulePromptSaved;
    $('meme-rule-ai-prompt-status').textContent=String(config.config?.memeRulesPrompt||'').trim()?'已自定义':'使用内置默认提示词';
  };
  const saveMemeRulePrompt=async({reset=false,quiet=false}={})=>{
    const text=reset?memeRulePromptDefault:$('meme-rule-ai-prompt').value.trim();
    if(!text)throw Error('提示词不能为空；需要恢复内置提示词时请点击“恢复默认提示词”');
    if(text.length>8000)throw Error('提示词最多 8000 个字符');
    const isDefault=text===memeRulePromptDefault;
    const saved=await request('/config',isDefault?{memeRulesPrompt:'',clear:['memeRulesPrompt']}:{memeRulesPrompt:text});
    memeRulePromptSaved=text;
    $('meme-rule-ai-prompt').value=text;
    $('meme-rule-ai-prompt-status').textContent=isDefault?'使用内置默认提示词':'已自定义并保存';
    if(!quiet)message(saved.host?.ok===false?'提示词已保存到插件，但同步 DSH 设置失败：'+(saved.host.error||'未知原因'):(isDefault?'已恢复内置默认提示词':'AI 规则维护提示词已保存'));
    return saved;
  };
  $('meme-rule-ai-prompt-save').addEventListener('click',()=>run(()=>saveMemeRulePrompt()));
  $('meme-rule-ai-prompt-reset').addEventListener('click',()=>run(async()=>{
    if(!confirm('恢复内置默认的 AI 表情包规则维护提示词？当前自定义提示词将被清除。'))return;
    await saveMemeRulePrompt({reset:true});
  }));
  $('meme-rule-ai-prompt').addEventListener('input',()=>{
    const dirty=$('meme-rule-ai-prompt').value.trim()!==memeRulePromptSaved;
    $('meme-rule-ai-prompt-status').textContent=dirty?'有未保存修改':'已保存';
  });
  const runMemeRuleAIUpdate=async(requestedMode='incremental')=>{
    let mode=requestedMode;
    if($('meme-rule-ai-prompt').value.trim()!==memeRulePromptSaved){
      const promptConfirm=mode==='full'
        ?'AI 维护提示词有未保存修改。先保存这些修改，再运行全量优化吗？这会调用模型并可能消耗较多 Token。'
        :'AI 维护提示词有未保存修改。增量更新只处理图库变化；若图库没变化，新提示词不会触发模型调用。是否保存提示词并改用全量优化，让新提示词重新整理现有规则？这可能消耗较多 Token。';
      if(!await confirmAction({title:'提示词有未保存修改',description:promptConfirm,confirmLabel:'保存并继续',danger:mode!=='incremental'}))return;
      await saveMemeRulePrompt({quiet:true});
      if(mode==='incremental')mode='full';
    }
    const full=mode==='full';
    const confirmText=full
      ?'将使用 AI 全量整理当前图库名称与规则，可能消耗数千至上万 Token。更新前会备份当前规则；只有输出通过格式与真实图库名称校验才会应用。继续？'
      :'将让 AI 根据新增/删除的表情包名称增量更新本地规则。若图库没有变化，会跳过模型调用以节省 Token。更新前会备份当前规则。继续？';
    if(!await confirmAction({title:full?'AI 全量优化表情包规则':'AI 增量更新本地规则',description:confirmText,confirmLabel:full?'开始全量优化':'开始增量更新',danger:full}))return;
    const status=$('meme-rule-ai-status');status.textContent=full?'正在让 AI 全量优化规则…':'正在检查图库变化并增量更新规则…';
    for(const id of ['meme-rule-ai-update','meme-rule-ai-full','meme-rule-ai-restore'])$(id).disabled=true;
    try{
      const r=await request('/comment-meme-rules/ai-update',{mode});
      if(r.noChanges){status.textContent=r.message||'图库未变化，已跳过模型调用';message(status.textContent);return;}
      await loadMemeRules();await loadModelUsage();
      status.textContent=`已应用 AI 规则：${r.previousCount} → ${r.count} 条；本次处理新增/变更名称 ${r.addedNames||0} 个、删除名称 ${r.removedNames||0} 个。${r.remainingNames?`还有 ${r.remainingNames} 个名称待分批处理；可再次点击增量更新。`:'已处理完当前图库变化。'} 已保存更新前备份。`;
      message('AI 已更新本地表情包规则；下次检索立即生效');
    }catch(e){status.textContent='更新失败，旧规则保持不变：'+String(e?.message||e).slice(0,180);throw e}
    finally{for(const id of ['meme-rule-ai-update','meme-rule-ai-full','meme-rule-ai-restore'])$(id).disabled=false;}
  };
  $('meme-rule-ai-update').addEventListener('click',()=>run(()=>runMemeRuleAIUpdate('incremental')));
  $('meme-rule-ai-full').addEventListener('click',()=>run(()=>runMemeRuleAIUpdate('full')));
  $('meme-rule-ai-restore').addEventListener('click',()=>run(async()=>{
    if(!await confirmAction({title:'恢复 AI 更新前规则',description:'恢复最近一次 AI 更新前的规则？这会覆盖当前编辑区并保存为本地规则。',confirmLabel:'确认恢复',danger:true}))return;
    const r=await request('/comment-meme-rules/ai-restore',{});await loadMemeRules();
    $('meme-rule-ai-status').textContent=r.message+'（'+r.count+' 条）';message(r.message);
  }));
  $('meme-rule-add').addEventListener('click',()=>run(async()=>{
    ruleSet=captureMemeRules();
    if(ruleSet.rules.length>=100)throw Error('最多100条规则');
    ruleSet.rules.unshift({id:'user-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,7),label:'新规则',enabled:true,triggers:['待替换触发词'],targets:['待替换图片名称词'],requireAny:[],excludeAny:[]});
    $('meme-rule-search').value='';$('meme-rule-filter').value='all';memeRulePage=1;renderMemeRules();rulesStatus('已添加一条新规则；点击首条展开编辑，再保存全部规则');
  }));
  $('meme-rule-save').addEventListener('click',()=>run(async()=>{
    const data=captureMemeRules();
    if(!confirm('确认保存 '+data.rules.length+' 条表情包检索规则？保存后下一次本地检索立即使用。'))return;
    const r=await request('/comment-meme-rules',data);await loadMemeRules();
    rulesStatus('已保存 '+r.count+' 条规则；下一次表情包检索立即生效');message('表情包检索规则已保存');
  }));
  $('meme-rule-default').addEventListener('click',()=>run(async()=>{
    if(!confirm('加载出厂默认规则到编辑区？未保存的更改会丢失，保存后才会生效。'))return;
    const r=await request('/comment-meme-rules?defaults=1');ruleSet=r.data;memeRulePage=1;renderMemeRules();rulesStatus('已加载出厂默认规则到编辑区，尚未保存');
  }));
  const exportMemeRules=async()=>{
    const data=captureMemeRules(),blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const link=node('a');link.href=url;link.download='dafeiyu-meme-rules.json';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    rulesStatus('已导出当前编辑区规则（含尚未保存的修改）');
  };
  $('meme-rule-export').addEventListener('click',()=>run(exportMemeRules));
  $('sticker-workflow-export-rules').addEventListener('click',()=>run(exportMemeRules));
  $('meme-rule-import').addEventListener('change',()=>run(async()=>{
    const file=$('meme-rule-import').files?.[0];if(!file)return;
    if(file.size>100000)throw Error('规则 JSON 不能超过100KB');
    const parsed=JSON.parse(await file.text());if(parsed?.schema!==1||!Array.isArray(parsed.rules)||parsed.rules.length>100 || !parsed.rules.every(r=>r&&typeof r.id==='string'&&typeof r.label==='string'&&typeof r.enabled==='boolean'&&Array.isArray(r.triggers)&&Array.isArray(r.targets)&&Array.isArray(r.requireAny||[])&&Array.isArray(r.excludeAny||[])))throw Error('导入文件不是兼容的表情包检索规则');
    if(!confirm('导入 '+parsed.rules.length+' 条规则到编辑区？尚未保存的改动会被替换。'))return;
    ruleSet=parsed;memeRulePage=1;$('meme-rule-search').value='';$('meme-rule-filter').value='all';renderMemeRules();rulesStatus('已导入 '+parsed.rules.length+' 条规则到编辑区；请先检查，再点击保存全部规则');$('meme-rule-import').value='';
  }));
  $('meme-rule-test').addEventListener('click',()=>run(async()=>{
    const q=$('meme-rule-test-text').value.trim();if(!q)throw Error('请填写测试文本');
    const result=await request('/comment-meme-rules/preview',{query:q,rules:captureMemeRules()});const target=$('meme-rule-test-result');target.replaceChildren();
    add(target,info(`本次使用编辑区规则（含尚未保存的修改） · 插件图库实际扫描 ${result.searched||0} 张 · 候选 ${result.matches?.length||0} 个；仅按名字，未识别图片内容。`));
    const matched=result.matchedRules||[];
    if(matched.length)add(target,info('已触发规则：'+matched.map(r=>r.label).join('、')));
    else add(target,info('本次没有规则被触发；若希望针对这个词检索，请编辑规则的「当评论包含任意词」。'));
    if(!(result.searched>0))add(target,info('插件当前图库为 0 张！请先在「已保存的表情包」确认图片已真正导入到插件图库（而非只存在另一文件夹）。'));
    else if(matched.length&&!(result.matches||[]).length)add(target,info('规则已经命中，但已扫描的图库名称没有对应候选。请导出插件图库名称 TXT，核对图片名称和存放位置。'));
    for(const candidate of result.matches||[]){const row=node('article','','record');add(row,node('strong',candidate.name),node('div','分数 '+candidate.score+' · '+(candidate.signals||[]).join('，'),'muted'));target.appendChild(row)}
    if(!result.matches?.length)target.appendChild(info('没有命中：可调整规则或表情包文件名。'));
  }));

  // 本地文件库管理：与自动评论使用同一个 comment-memes 目录；前端不持有绝对路径。
  let stickerItems=[];
  let stickerPage=1;
  const STICKERS_PER_PAGE=24;
  const stickerFolder=s=>{const i=s.name.lastIndexOf('/');return i<0?'':s.name.slice(0,i)};
  const stickerDirectories=items=>{
    const directories=new Set();
    for(const item of items){
      const parts=stickerFolder(item).split('/').filter(Boolean);
      for(let i=1;i<=parts.length;i++)directories.add(parts.slice(0,i).join('/'));
    }
    return [...directories].sort((a,b)=>a.localeCompare(b,'zh-CN'));
  };
  const updateStickerFolders=()=>{
    const select=$('sticker-folder-filter');const selected=select.value;
    select.replaceChildren();
    const option=(value,label)=>{const o=node('option',label);o.value=value;select.appendChild(o)};
    option('all','全部文件夹（'+stickerItems.length+'）');
    option('root','根目录 · 未分类（'+stickerItems.filter(s=>!stickerFolder(s)).length+'）');
    for(const dir of stickerDirectories(stickerItems)){
      const count=stickerItems.filter(s=>stickerFolder(s)===dir||stickerFolder(s).startsWith(dir+'/')).length;
      option('folder:'+dir,dir+'（'+count+'）');
    }
    if([...select.options].some(o=>o.value===selected))select.value=selected;
  };
  const renderStickers=()=>{
    const query=$('sticker-search').value.trim().toLowerCase();
    const folder=$('sticker-folder-filter').value;
    const filtered=stickerItems.filter(s=>{
      const dir=stickerFolder(s);
      const inFolder=folder==='all'||(folder==='root'?!dir:folder.startsWith('folder:')&&(dir===folder.slice(7)||dir.startsWith(folder.slice(7)+'/')));
      return inFolder&&s.name.toLowerCase().includes(query);
    });
    const totalPages=Math.max(1,Math.ceil(filtered.length/STICKERS_PER_PAGE));
    stickerPage=Math.min(Math.max(1,stickerPage),totalPages);
    const offset=(stickerPage-1)*STICKERS_PER_PAGE;
    const visible=filtered.slice(offset,offset+STICKERS_PER_PAGE);
    $('sticker-list').replaceChildren();
    for(const s of visible){
      const card=node('article','','card');
      const img=node('img','','sticker-preview');img.loading='lazy';img.alt=s.name;
      img.src=API+'/stickers/file?name='+encodeURIComponent(s.name);
      const name=node('h3',s.name);const desc=info((stickerFolder(s)||'未分类')+' · '+s.ext.toUpperCase()+' · '+Math.ceil(s.bytes/1024)+' KB');
      const actions=node('div','','actions');
      add(actions,btn('重命名',async()=>{
        const name=prompt('请输入新名称（可使用 分类/图片名）',s.name);
        if(name===null||name===s.name)return;
        await request('/stickers?action=rename',{name:s.name,newName:name.trim()});await loadStickers();message('已重命名表情包');
      }),btn('删除',async()=>{
        if(!confirm('确定永久删除表情包「'+s.name+'」？此操作不可撤销。'))return;
        await request('/stickers?action=delete',{name:s.name});await loadStickers();message('已删除表情包');
      },'danger'));
      add(card,img,name,desc,actions);$('sticker-list').appendChild(card);
    }
    if(!filtered.length)$('sticker-list').append(info('这个分类下没有匹配的表情包。'));
    $('sticker-page-status').textContent='第 '+stickerPage+' / '+totalPages+' 页 · 本页 '+visible.length+' 张';
    $('sticker-page-prev').disabled=stickerPage<=1;
    $('sticker-page-next').disabled=stickerPage>=totalPages;
    $('sticker-summary').textContent='图库共 '+stickerItems.length+' 张 · 筛选结果 '+filtered.length+' 张 · 只加载本页图片；底层仍使用 comment-memes 文件夹。';
  };
  const loadStickers=async()=>{const [data,rules,prompt]=await Promise.allSettled([request('/stickers'),memeRulesLoaded?Promise.resolve():loadMemeRules(),loadMemeRulePrompt()]);if(rules.status==='rejected')rulesStatus('规则读取失败：'+String(rules.reason?.message||rules.reason).slice(0,180)+'；图片库仍可管理');if(prompt.status==='rejected')$('meme-rule-ai-prompt-status').textContent='提示词读取失败：'+String(prompt.reason?.message||prompt.reason).slice(0,120);if(data.status==='rejected')throw data.reason;stickerItems=data.value.items||[];updateStickerFolders();renderStickers()};
  $('sticker-search').addEventListener('input',()=>{stickerPage=1;renderStickers()});
  $('sticker-folder-filter').addEventListener('change',()=>{stickerPage=1;renderStickers()});
  $('sticker-page-prev').addEventListener('click',()=>{if(stickerPage>1){stickerPage--;renderStickers()}});
  $('sticker-page-next').addEventListener('click',()=>{stickerPage++;renderStickers()});
  $('sticker-reload').addEventListener('click',()=>run(loadStickers));
  const exportStickerNames=async()=>{
    // Export the full current *safe* inventory, never the filtered/current page.
    const data=await request('/stickers');
    const exportItems=data.items||[];
    if(!exportItems.length)throw Error('当前图库没有可导出的表情包名称');
    if(exportItems.length>=2000)throw Error('图库达到单次扫描上限2000张，无法保证导出完整，请先整理或分批导出');
    const text='\uFEFF'+exportItems.map(s=>s.name).sort((a,b)=>a.localeCompare(b,'zh-CN')).join('\r\n')+'\r\n';
    const blob=new Blob([text],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob);
    const link=node('a');link.href=url;link.download='大肥鱼表情包名称列表.txt';document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    message('已导出 '+exportItems.length+' 张表情包的全部可用名称（不含扩展名／图片数据）');
  };
  $('sticker-export-names').addEventListener('click',()=>run(exportStickerNames));
  $('sticker-workflow-export-names').addEventListener('click',()=>run(exportStickerNames));

  $('sticker-archive-export').addEventListener('click',()=>run(async()=>{
    const status=$('sticker-archive-status');status.textContent='正在打包当前表情包图库…';
    const res=await fetch(API+'/stickers/archive/export',{credentials:'same-origin'});
    if(!res.ok){let data={};try{data=await res.json()}catch{};throw Error(String(data?.error||'表情包 ZIP 导出失败').slice(0,180))}
    const blob=await res.blob(),url=URL.createObjectURL(blob),link=node('a');
    link.href=url;link.download='大肥鱼表情包-'+localDay()+'.zip';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
    status.textContent='已导出整库 ZIP；目录结构和真实文件名均已保留。';message('表情包整库 ZIP 已导出');
  }));
  $('sticker-archive-import-button').addEventListener('click',()=>run(async()=>{
    const file=$('sticker-archive-import').files?.[0];if(!file)throw Error('请先选择 ZIP');
    if(file.size<=0||file.size>128*1024*1024)throw Error('ZIP 必须在 0～128MB 以内');
    if(!/\.zip$/i.test(file.name))throw Error('请选择 .zip 压缩包');
    if(!confirm('批量导入会完全按照 ZIP 内现有目录和文件名追加到图库，不会逐张询问重命名，也不会覆盖同名图片。确认目录结构和命名已经整理好吗？'))return;
    const status=$('sticker-archive-status');status.textContent='正在校验 ZIP 内的路径、重名、图片格式与尺寸…';
    const res=await fetch(API+'/stickers/archive/import',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/zip'},body:file});
    let data={};try{data=await res.json()}catch{}
    if(!res.ok||data?.ok===false)throw Error(String(data?.error||'批量导入失败').slice(0,220));
    $('sticker-archive-import').value='';status.textContent=`批量导入完成：新增 ${data.imported||0} 张，图库现有 ${data.total||0} 张。`;
    await loadStickers();message('表情包批量导入完成');
  }));
  $('sticker-file').addEventListener('change',()=>{
    const file=$('sticker-file').files?.[0];if(!file)return;
    if(!$('sticker-name').value.trim())$('sticker-name').value=file.name.replace(/\.[^.]+$/,'').slice(0,64);
  });
  $('sticker-upload').addEventListener('click',()=>run(async()=>{
    const file=$('sticker-file').files?.[0];if(!file)throw Error('请先选择图片');
    if(file.size<=0||file.size>8*1024*1024)throw Error('图片需要小于8MB');
    const ext=(file.name.match(/\.(png|jpe?g|gif|webp)$/i)||[])[0]?.toLowerCase();
    if(!ext)throw Error('仅支持 PNG、JPG、GIF、WebP');
    const category=$('sticker-category').value.trim(),stem=$('sticker-name').value.trim();
    const name=(category?category+'/':'')+stem;if(!stem)throw Error('请填写表情包名称');
    const raw=await new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||''));reader.onerror=()=>reject(Error('读取图片失败'));reader.readAsDataURL(file);
    });
    const content=raw.split(',')[1]||'';
    const button=$('sticker-upload');button.disabled=true;$('sticker-upload-status').textContent='正在校验并保存…';
    try{
      await request('/stickers?action=upload',{name,ext,data:content});
      $('sticker-file').value='';$('sticker-name').value='';$('sticker-upload-status').textContent='上传成功';
      await loadStickers();message('已上传表情包：'+name);
    }finally{button.disabled=false}
  }));

  // 主人私信 Agent 不隶属于自主待办，读取与保存有自己的端点校验和反馈。
  const ownerDmPermissionInputs = [
    ['owner-dm-like','ownerDmLikeEnabled'],['owner-dm-collect','ownerDmCollectEnabled'],
    ['owner-dm-follow','ownerDmFollowEnabled'],['owner-dm-comment-draft','ownerDmCommentDraftEnabled'],
    ['owner-dm-comment-publish','ownerDmCommentPublishEnabled'],['owner-dm-dynamic-draft','ownerDmDynamicDraftEnabled'],
    ['owner-dm-dynamic-publish','ownerDmDynamicPublishEnabled'],['owner-dm-friend-message','ownerDmFriendMessageEnabled']
  ];
  const loadOwnerDmAgentSettings=async()=>{
    const data=await request('/config');const cfg=data.config||{};
    $('owner-dm-authorized-uid').textContent=cfg.dmOwnerUid?'唯一授权主人 UID：'+cfg.dmOwnerUid:'没有授权主人 UID，请先在「社交互动 → 好友关系与互动」勾选并保存';
    $('owner-dm-agent-enabled').checked=cfg.ownerDmAgentEnabled===true;
    $('owner-dm-agent-read-main').checked=cfg.ownerDmAgentReadMainContext===true;
    $('owner-dm-agent-sync-main').checked=cfg.ownerDmAgentSyncMain===true;
    $('owner-dm-agent-turns').value=String(cfg.ownerDmAgentContextTurns??6);
    $('owner-dm-agent-chars').value=String(cfg.ownerDmAgentContextChars??1500);
    $('owner-dm-read-commands').checked=cfg.ownerDmReadCommandsEnabled===true;
    for(const [id,key] of ownerDmPermissionInputs)$(id).checked=cfg[key]===true;
    try{
      const todos=await request('/owner-todos');const recent=todos.config?.ownerDmAgent?.recent||[];
      const last=recent.at(-1);const labels={done:'已确认回复','continuation-muted':'短句已接续已完成任务，不重复回复','reply-reserved':'回执发送中','failed-or-uncertain':'处理失败或结果不确定',uncertain:'发送结果不确定',claimed:'正在处理',baseline:'历史消息基线'};
      $('owner-dm-agent-status').textContent='最近 '+recent.length+' 条记录；最新：'+(labels[last?.status]||last?.status||'暂无记录')+(last?.reason?'（'+String(last.reason).slice(0,120)+'）':'')+'。';
    }catch(e){$('owner-dm-agent-status').textContent='Agent 状态暂不可读：'+String(e?.message||e).slice(0,100)}
  };
  $('owner-dm-agent-reload').addEventListener('click',()=>run(async()=>{await loadOwnerDmAgentSettings();message('已重新读取主人私信 Agent 设置')}));
  $('owner-dm-agent-save').addEventListener('click',()=>run(async()=>{
    const patch={
      ownerDmAgentEnabled:$('owner-dm-agent-enabled').checked,
      ownerDmAgentReadMainContext:$('owner-dm-agent-read-main').checked,
      ownerDmAgentSyncMain:$('owner-dm-agent-sync-main').checked,
      ownerDmAgentContextTurns:boundedInt('owner-dm-agent-turns',1,20,'主 Session 上下文轮数'),
      ownerDmAgentContextChars:boundedInt('owner-dm-agent-chars',200,4000,'主 Session 上下文字符上限'),
      ownerDmReadCommandsEnabled:$('owner-dm-read-commands').checked
    };
    for(const [id,key] of ownerDmPermissionInputs)patch[key]=$(id).checked;
    // 仍保留底层双重验证，但不需要用户面对重复的总开关。
    patch.ownerDmActionsEnabled=ownerDmPermissionInputs.some(([,key])=>patch[key]===true);
    const status=$('owner-dm-agent-save-status');status.textContent='正在保存并校验生效配置…';
    try{
      const saved=await request('/config',patch);
      const latest=(await request('/config')).config||{};
      const wrong=Object.keys(patch).filter(key=>latest[key]!==patch[key]);
      if(wrong.length)throw Error('配置已提交但回读不一致：'+wrong.join('、')+'；请重启 DSH 后重新检查');
      await loadOwnerDmAgentSettings();
      status.textContent='已保存并通过配置回读校验。'+(saved.host?.ok===false?'（DSH 原生设置未同步，但插件本地配置已生效）':'');
      message('主人私信 Agent 与独立权限已保存。'+(saved.host?.ok===false?' DSH 原生设置同步失败：'+String(saved.host.error||'未知原因'):'运行中后端会使用新配置。'));
    }catch(e){status.textContent='保存或校验失败：'+String(e?.message||e);throw e}
  }));
  const loadDmSettings=async()=>{
    const data=await request('/config');const cfg=data.config||{};
    $('dm-watch').checked=cfg.dmWatch===true;
    $('dm-stranger-enabled').checked=cfg.dmStrangerOnce===true;
    $('dm-whitelist').value=cfg.dmWhitelist||'';

    $('dm-first-fixed').checked=cfg.dmStrangerFirstFixed!==false;
    $('dm-welcome').value=cfg.dmStrangerText||'';
    $('dm-approval-enabled').checked=cfg.dmApprovalEnabled===true;
    $('dm-phrase').value=cfg.dmApprovalPhrase||'白饭🍚';

  };
  const boundedInt=(id,min,max,label)=>{const n=Number($(id).value);if(!Number.isInteger(n)||n<min||n>max)throw Error(label+'必须是 '+min+'–'+max+' 的整数');return n};
  $('dm-settings-save').addEventListener('click',()=>run(async()=>{
    const phrase=$('dm-phrase').value.trim();if(!phrase||phrase.length>60)throw Error('申请暗号不能为空且最多60字');
    const welcome=$('dm-welcome').value;if(welcome.length>450)throw Error('欢迎语最多450字');
    const payload={dmWatch:$('dm-watch').checked,dmStrangerOnce:$('dm-stranger-enabled').checked,
      clear:!welcome.trim()?['dmStrangerText']:[],
      dmStrangerFirstFixed:$('dm-first-fixed').checked,dmStrangerText:welcome,
      dmApprovalEnabled:$('dm-approval-enabled').checked,dmApprovalPhrase:phrase,
      };
    const saved=await request('/config',payload);await loadDmSettings();await loadDmStatus();await dmList();message(saved.host?.ok===false?'配置已保存，但 DSH 设置同步失败：'+(saved.host.error||'未知原因'):'后台私信规则已保存');
  }));
  $('dm-settings-reload').addEventListener('click',()=>run(loadDmSettings));
  const loadDmStatus=async()=>{
    const data=await request('/status');const x=data.dmAutoReplyStatus||{};
    const dmScheduler=data.interactionSchedulerStatus?.checks?.dm||{};
    $('dm-status').textContent=`监听：${x.enabled?'已开启':'关闭'} · 调度：${data.interactionSchedulerStatus?.running?'运行中':'已停止'} · 当前轮询：${dmScheduler.polling?'正在检查':'空闲'} · 上次检查：${pollClock(dmScheduler.lastFinishedAt||x.lastPollAt)} · 下次预计：${dmScheduler.nextAt?pollClock(dmScheduler.nextAt):'未计划'}（各项轮询间隔在「后台轮询」修改）`;
    $('dm-error').textContent=x.lastError?'最近错误：'+x.lastError:'最近一次私信轮询没有记录错误。';
  };
  const identityLink=(uid,nickname)=>{const span=node('span');const name=String(nickname||'').trim();const id=String(uid||'');span.appendChild(node('strong',(name||'昵称未获取')+' · '));const a=node('a','UID '+id);if(/^[1-9]\d{0,18}$/.test(id)){a.href='https://space.bilibili.com/'+id;a.target='_blank';a.rel='noopener noreferrer';}span.appendChild(a);return span};
  const loadDmRecent=async()=>{
    const data=await request('/dm-recent');const list=$('dm-recent-list');list.replaceChildren();
    for(const c of (data.conversations||[])){
      const card=node('article','','record');add(card,identityLink(c.uid,c.nickname));
      const status=[c.approvalStatus?'申请 '+c.approvalStatus:'',c.strangerStatus?'陌生人状态 '+c.strangerStatus+' · 自动回复额度 '+(c.strangerRepliesUsed??0)+'/'+(c.strangerRepliesLimit??1)+(c.strangerRepliesRemaining===0?'（已用尽）':''):'',c.lastRepliedAt?'最近回复 '+new Date(c.lastRepliedAt).toLocaleString():''].filter(Boolean).join(' · ');
      if(status)add(card,info(status));
      for(const m of (c.recent||[]).slice(-5)){add(card,info((m.role==='assistant'?'大肥鱼：':'对方：')+m.text));}
      list.appendChild(card);
    }
    if(!list.children.length)list.append(info(data.error||'本地还没有保存过已回复的私信会话。'));
  };
  const loadDmAll=async()=>{await Promise.all([loadDmSettings(),loadDmStatus(),dmList(),loadDmRecent()])};
  $('dm-network-test').addEventListener('click',()=>run(async()=>{
    $('dm-error').textContent='正在只读测试 api.vc.bilibili.com，会话不会被回复…';
    try {
      const result=await request('/dm-network-check',{});
      $('dm-error').textContent=`连接成功：${result.host} · ${result.sessionCount} 个会话 · ${result.elapsedMs} ms · ${result.checkedAt}`;
      await loadDmStatus();
    } catch(e) {
      $('dm-error').textContent='连接测试失败：'+String(e?.message||e);
      throw e;
    }
  }));
  $('dm-refresh').addEventListener('click',()=>run(loadDmAll));
  $('dm-recent-reload').addEventListener('click',()=>run(loadDmRecent));

  const loadCommentSettings=async()=>{
    const data=await request('/config');const c=data.config||{};
    $('owner-comment-authorized-uid').textContent=c.dmOwnerUid?'唯一授权主人 UID：'+c.dmOwnerUid:'未授权主人 UID；请先在「社交互动」勾选并保存';
    $('comment-watch-replies').checked=c.commentWatchReplies===true;
    $('comment-watch-top').checked=false;
    $('comment-at-enabled').checked=c.commentAtEnabled===true;
    for(const [id,key] of [['owner-comment-agent-enabled','ownerCommentAgentEnabled'],['owner-comment-like','ownerCommentLikeEnabled'],['owner-comment-publish','ownerCommentSocialPublishEnabled'],['owner-comment-ack','ownerCommentNaturalAckEnabled']])$(id).checked=c[key]===true;
    try{const d=await request('/dev5-social');const last=d.ownerComment?.recent?.at(-1);$('owner-comment-agent-status').textContent=last?`最近：${last.type} · ${last.status} · ${last.replyStatus}`:'尚无主人评论动作记录。'}catch{}

    $('comment-at-mode').value=c.commentAtMode==='all'?'all':'whitelist';
    $('comment-at-whitelist').value=String(c.commentAtWhitelist||'');
    $('comment-allow-general-top').checked=c.commentAllowGeneralTop===true;

  };
  let commentsOffset=0,commentsTotal=0;
  const loadRecentComments=async()=>{
    const limit=Number($('comments-limit').value)||50;
    const day=$('comments-day').value||'';
    const kind=$('comments-kind').value;
    const query=new URLSearchParams({limit:String(limit),offset:String(commentsOffset)});
    if(day)query.set('day',day);
    if(kind==='top'||kind==='reply')query.set('kind',kind);
    const data=await request('/recent-comments?'+query.toString());
    commentsTotal=Number(data.total)||0;
    const list=$('recent-comments-list');list.replaceChildren();
    const counts=data.counts||{};
    $('comments-summary').textContent=(day?day+' · ':'全部日期 · ')+`主评论 ${counts.top??0} 条 · 回复别人评论 ${counts.reply??0} 条 · 当前分类 ${commentsTotal} 条`+
      (counts.withoutId?` · 当前分类中 ${counts.withoutId} 条没有评论 ID`:'')+'。含一次性补录的旧成功回执；这里不代表 B站 已公开可见。';
    for(const c of (data.rows||[])){
      const card=node('article','','record');const top=node('div');
      add(top,safeCommentLink(c));
      if(c.kind==='reply'){
        top.appendChild(node('span',' · 对方：'));
        const uid=/^[1-9]\d{0,19}$/.test(String(c.recipientUid||''))?String(c.recipientUid):'';
        const nickname=String(c.recipientName||'').trim();
        const spaceLink=()=>{const a=node('a');a.href='https://space.bilibili.com/'+uid;a.target='_blank';a.rel='noopener noreferrer';return a};
        if(uid){
          const name=spaceLink();name.textContent=nickname||'昵称未记录';name.title='进入对方 B站主页';top.appendChild(name);
          top.appendChild(node('span','（'));
          const idLink=spaceLink();idLink.textContent='UID '+uid;idLink.title='进入对方 B站主页';top.appendChild(idLink);
          top.appendChild(node('span','）'));
        }else{top.appendChild(node('span',nickname?nickname+'（UID 未记录）':'昵称及 UID 未记录'));}
      }else top.appendChild(node('span',' · 原创主评论'));
      add(card,top,info((c.time||'时间未记录')+' · '+(c.snippet||'（没有保存正文摘要）')),
        ...(c.kind==='reply'?[(()=>{const d=node('details');const summary=node('summary','预览对方上一条评论');d.appendChild(summary);d.appendChild(info(c.recipientComment||'旧记录未保存对方原评论'));return d})()]:[]),
        info('来源：'+(c.source||'本地记录')+' · 公开状态未核实'));
      list.appendChild(card);
    }
    if(!list.children.length)list.append(info(day?'这一天没有找到本地评论记录。':data.note||'暂时没有记录。'));
    $('comments-prev').disabled=commentsOffset===0;
    $('comments-next').disabled=commentsOffset+limit>=commentsTotal;
    $('comments-page-info').textContent=commentsTotal?`${commentsOffset+1}–${Math.min(commentsOffset+limit,commentsTotal)} / ${commentsTotal}`:'0 条';
  };
  const loadCommentsStatus=async()=>{
    const data=await request('/status');const c=data.commentInteractStatus||{};
    $('comments-status').textContent=`后台评论互动：${c.busy?'正在运行':'空闲'} · 上次检查：${c.lastPollAt?new Date(c.lastPollAt).toLocaleString():'暂无'}${c.lastError?' · 错误：'+c.lastError:''}`;
    $('comments-usage').textContent=`近24小时后台回复成功回执：${c.sentLast24Hours??0} / ${c.replyPerDay??5} 条。我的主评论下：${c.sentOnOwnTop24h??0}；我的楼中楼回复下：${c.sentOnOwnNested24h??0}。这是后台互动自己的滚动24小时上限，不是全局每日额度。`;
    $('comments-send-stats').textContent=`近24小时后台发送记录：成功回执 ${c.sentLast24Hours??0} · 明确失败 ${c.sendFailedLast24Hours??0} · 结果不确定 ${c.sendUncertainLast24Hours??0} · 全局额度／配额安全拦截 ${c.sendBlockedByGlobalQuotaLast24Hours??0} · 其他拦截 ${c.sendBlockedOtherLast24Hours??0} · 中断后待核实 ${c.sendPendingLast24Hours??0}。`;
    const historyStarted=c.sendAttemptHistoryStartedAt?new Date(c.sendAttemptHistoryStartedAt).toLocaleString():'';
    const quotaPauseNote=c.globalQuotaBlocked
      ? (c.globalQuotaBlockReason==='store-error'?'公开评论额度账本暂不可用：后台暂停5分钟后重试，避免每轮重复撞错误。':'全局额度已耗尽：本轮停止继续生成／发送，避免每次后台轮询重复撞额度；新自然日或修改全局上限后会重新检查。')
      : '发送结果分类已启用。';
    $('comments-history-note').textContent=c.sendAttemptHistoryAvailable
      ? `${quotaPauseNote}${historyStarted?' 发送结果分类从 '+historyStarted+' 开始记录；此前的历史失败数无法追溯。':''} “成功回执”仍不代表 B 站当前公开可见。`
      : '旧版本没有保存完整的发送失败时间线；升级后开始记录新发送的成功、失败、额度拦截和中断待核实状态。旧历史失败数无法追溯。';
  };
  const loadCommentGlobalQuota=async()=>{
    const target=$('global-comment-quota'),note=$('global-comment-quota-note');
    try{
      const q=await request('/comment-quota');
      if(q.ok!==true)throw Error(q.error||'读取失败');
      const used=Math.max(0,Number(q.used)||0),limit=Math.max(0,Number(q.limit)||0),day=String(q.day||localDay());
      if(limit===0)target.textContent=`${day} · 全局公开评论已禁用（上限为 0）· 本地账本仍记录 ${used} 次历史发送尝试。`;
      else target.textContent=`${day} · 今日已占用 ${used} / ${limit} 次 · 剩余 ${Math.max(0,limit-used)} 次。`;
      note.textContent='自然日硬上限：主动发表的公开主评论 + 后台楼中楼／评论回复共用；以即将调用 B 站发布接口的发送尝试计数。失败或结果不确定的真实发布尝试也会占用名额。旧版本当天记录可能包含发送前校验失败的占位，升级后新记录已调整为临近发布接口时才占位。';
    }catch(e){
      target.textContent='今日全局额度暂不可读取：'+String(e?.message||e).slice(0,140);
      note.textContent='无法读取时不要根据后台回复的 55/100 推断全局额度；两套计数相互独立。';
    }
  };
  const loadCommentsAll=async()=>{await Promise.all([loadCommentSettings(),loadRecentComments(),loadCommentsStatus(),loadCommentGlobalQuota()])};
  $('comments-settings-save').addEventListener('click',()=>run(async()=>{
    const payload={commentWatchReplies:$('comment-watch-replies').checked,commentWatchTop:false,
      commentAtEnabled:$('comment-at-enabled').checked,commentAtMode:$('comment-at-mode').value,
      commentAllowGeneralTop:$('comment-allow-general-top').checked,
};
    const saved=await request('/config',payload);await loadCommentsAll();message(saved.host?.ok===false?'评论设置已保存，但 DSH 设置同步失败：'+(saved.host.error||'未知原因'):'后台评论互动设置已保存');
  }));
  $('owner-comment-settings-reload').addEventListener('click',()=>run(loadCommentSettings));
  $('owner-comment-settings-save').addEventListener('click',()=>run(async()=>{
    const patch={ownerCommentAgentEnabled:$('owner-comment-agent-enabled').checked,
      ownerCommentLikeEnabled:$('owner-comment-like').checked,
      ownerCommentSocialPublishEnabled:$('owner-comment-publish').checked,
      ownerCommentNaturalAckEnabled:$('owner-comment-ack').checked};
    await request('/config',patch);
    const current=(await request('/config')).config||{};
    if(Object.keys(patch).some(k=>current[k]!==patch[k]))throw Error('主人公开评论权限保存后回读不一致');
    await loadCommentSettings();message('主人公开评论 Agent 权限已保存并验证');
  }));
  $('comments-load').addEventListener('click',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-day').addEventListener('change',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-day-clear').addEventListener('click',()=>run(()=>{$('comments-day').value='';commentsOffset=0;return loadRecentComments()}));
  $('comments-kind').addEventListener('change',()=>run(()=>{commentsOffset=0;return loadRecentComments()}));
  $('comments-prev').addEventListener('click',()=>run(()=>{commentsOffset=Math.max(0,commentsOffset-(Number($('comments-limit').value)||50));return loadRecentComments()}));
  $('comments-next').addEventListener('click',()=>run(()=>{commentsOffset+=Number($('comments-limit').value)||50;return loadRecentComments()}));
  $('comments-refresh').addEventListener('click',()=>run(loadCommentsAll));

  const dmList=async()=>{
    const data=await request('/dm-approvals');const entries=data.approvals||[];$('dm-list').replaceChildren();
    badge('dm-count',entries.filter(x=>x.status==='pending').length);
    const f=$('dm-filter').value;
    for(const e of entries.filter(x=>!f||x.status===f)){
      const card=node('article','','card');add(card,pill(e.status),identityLink(e.uid,e.nickname),info('申请消息：'+(e.lastText||'（无）')),
        info('已获批累计回复 '+(e.total||0)+' 条 · 今日 '+(e.daily||0)+' 条'));
      const resumeInfo={queued:'已通过：下次后台私信轮询将自动接话，无需对方再发送消息',reserved:'自动回复发送中／等待确认',sent:'已自动回复'+(e.autoReplyAt?' · '+new Date(e.autoReplyAt).toLocaleString():''),
        uncertain:'发送回执不确定：为防重复发送已暂停自动重试，请检查 B站私信',cancelled:'自动回复已取消'};
      if(e.autoReplyStatus) add(card,info(resumeInfo[e.autoReplyStatus]||'自动回复状态：'+e.autoReplyStatus));
      const actions=node('div','','actions');
      if(e.status==='pending')add(actions,btn('批准聊天',async()=>{if(!confirm('确认授权 UID '+e.uid+' 在设置限额内继续聊天？'))return;await request('/dm-approvals',{uid:e.uid,action:'approve'});await dmList()}),
        btn('拒绝',async()=>{await request('/dm-approvals',{uid:e.uid,action:'reject'});await dmList()}));
      if(e.canResume)
        add(actions,btn('补发首次回复（旧版）',async()=>{if(!confirm('仅适用于旧版批准后没有自动回复的申请。请先确认没有在 B站 手动回复过该用户，避免重复私信。继续？'))return;
          await request('/dm-approvals',{uid:e.uid,action:'resume'});await dmList()}));
      if(e.status==='approved')add(actions,btn('撤销授权',async()=>{if(!confirm('撤销 '+e.uid+' 的限额聊天权限？'))return;await request('/dm-approvals',{uid:e.uid,action:'revoke'});await dmList()},'danger'));
      add(card,actions);$('dm-list').appendChild(card);
    }
    if(!$('dm-list').children.length)$('dm-list').append(info('当前没有符合条件的聊天申请。'));
  };
  $('dm-filter').addEventListener('change',()=>run(dmList));
  // v2.4.79: 主 Session 是当前房间；大肥鱼身份记忆跨 Session，共同与精确 B站档案分层协作。
  const renderMainSessionHistory=async()=>{
    const q=$('main-session-history-query').value.trim();
    const data=await request('/main-session/history?'+new URLSearchParams({q,limit:'30'}).toString());
    const target=$('main-session-history');target.replaceChildren();
    for(const e of data.rows||[]){const card=node('article','','record');add(card,node('div',e.kind==='watch'?'刷到的视频':'我发过的评论','title-line'),info(e.summary||''));target.appendChild(card)}
    if(!target.children.length)target.append(info(q?'没有匹配的本地经历。':'还没有经历记录；首次开启会从当前状态建立基线，不会突然把全部旧历史灌进 Session。'));
  };
  const renderLifeReflection=async()=>{
    const data=await request('/main-session/reflection?'+new URLSearchParams({status:'pending',limit:'40'}).toString());
    const last=data.lastReflectionAt?new Date(data.lastReflectionAt).toLocaleString():'暂无';
    $('main-reflection-status').textContent=`待反思经历 ${data.pending||0} 条 · 已反思并关联长期记忆 ${data.reflected||0} 条经历 · 已评估但未保存 ${data.reviewed||0} 条 · 今日反思 ${data.runsToday||0}/${data.config?.dailyBatches||2} 批 · 上次 ${last}${data.lastError?' · 最近错误：'+data.lastError:''}`;
    const target=$('main-reflection-list');target.replaceChildren();
    for(const e of data.rows||[]){const card=node('article','','record');add(card,node('div',e.kind==='watch'?'待反思 · 刷到的视频':'待反思 · '+(e.reply?'评论回复':'顶层评论'),'title-line'),info(`${String(e.time||e.day||e.createdAt||'').slice(0,19).replace('T',' ')} · ${e.summary||''}`));target.appendChild(card)}
    if(!target.children.length)target.append(info('目前没有待反思候选。精确经历仍会留在本地档案，不代表发生过的事情被删除。'));
  };
  const renderLongMemory=async()=>{
    const q=$('main-memory-query').value.trim();const data=await request('/main-session/memory?'+new URLSearchParams({q,limit:'100'}).toString());
    $('main-memory-enabled').checked=data.enabled===true;$('main-memory-half-life').value=String(data.policy?.baseHalfLifeDays??30);$('main-memory-threshold').value=String(data.policy?.threshold??0.35);
    $('main-memory-max-items').value=String(data.policy?.maxItems??6);$('main-memory-max-chars').value=String(data.policy?.maxChars??800);$('main-memory-daily').value=String(data.policy?.dailyQuota??8);$('main-memory-facts').value=String(data.policy?.factsMax??2);
    const cfg=await request('/config');$('main-memory-auto-bili').checked=cfg.config?.mainSessionMemoryAutoBili!==false;$('main-reflection-auto').checked=cfg.config?.mainSessionReflectionAuto!==false;$('main-reflection-min').value=String(cfg.config?.mainSessionReflectionMinCandidates??6);$('main-reflection-batch').value=String(cfg.config?.mainSessionReflectionBatchSize??16);$('main-reflection-hours').value=String(cfg.config?.mainSessionReflectionIntervalHours??6);$('main-reflection-daily').value=String(cfg.config?.mainSessionReflectionDailyBatches??2);
    $('main-memory-semantic').checked=cfg.config?.mainSessionMemorySemanticEnabled===true;
    const collecting=cfg.config?.mainSessionMemoryEnabled===true&&cfg.config?.mainSessionMemoryAutoBili!==false;
    setLearningState('life-learning-status',collecting,'正在整理真实经历','人生记忆收集已暂停');
    setLearningState('interest-learning-status',collecting,'正在收集兴趣线索','兴趣线索收集已暂停');
    setLearningState('reflection-learning-status',collecting&&cfg.config?.mainSessionReflectionAuto!==false,'正在自动反思','自动反思已暂停');
    $('main-memory-candidates').value=String(cfg.config?.mainSessionMemoryCandidates??48);
    $('main-memory-search-daily').value=String(cfg.config?.mainSessionMemorySearchDailyLimit??80);
    $('main-memory-import').disabled=!data.sessionId||!data.externalFishMemoryAvailable;
    const room=data.sessionId?`当前房间：${data.sessionId}`:'当前还没选择主 Session';
    const mount=data.enabled?(data.mounted?'当前房间正在使用这份身份记忆':'身份记忆已开启；当前房间未在线或尚未挂载'):'跨 Session 长期记忆已关闭（人格仍是大肥鱼）';
    const migrated=(data.legacySessionFiles||[]).length?` · 已从旧版 ${data.legacySessionFiles.length} 个 Session 记忆文件合并，旧文件仍保留`:'';
    $('main-memory-status').textContent=`大肥鱼身份记忆 ${data.count||0} 条（总记录 ${data.total||0}） · 跨 Session 共用 · ${room} · ${mount}${migrated}${data.retrieval?.last?' · 最近检索：'+(data.retrieval.last.reason||'local')+' · 今日检索模型调用 '+(data.retrieval.usedToday||0)+' 次':''}${data.externalFishMemoryAvailable?' · 检测到当前房间可导入的旧 dsh-fish-memory 数据':''}`;
    const target=$('main-memory-list');target.replaceChildren();
    const view=$('main-memory-kind')?.value||'';
    const kindOf=m=>{
      if(m.memoryKind==='interest'||m.source==='life-interest'||/^(大肥鱼\.兴趣|兴趣\.)/.test(m.事实键||''))return 'interest';
      if(m.memoryKind==='relationship'||/^(关系|人物)\./.test(m.事实键||''))return 'relationship';
      if(m.category==='stable_profile'||m.事实键||m.source==='owner-manual'||m.source==='main-session-ai')return 'fact';
      return 'experience';
    };
    for(const m of data.rows||[]){
      const kind=kindOf(m);if(view&&kind!==view)continue;
      const card=node('article','','record');
      const sourceLabel=m.source==='owner-deterministic'?'旧版自动识别':m.source==='main-session-ai'?'大肥鱼聊天记住':
        m.source==='owner-manual'?'主人手动':m.source==='life-reflection'?'真实经历反思':
        m.source==='bilibili-experience'?'旧版 B站直接写入':m.source==='dsh-fish-memory-import'?'旧版独立记忆导入':(m.source||'旧版记忆');
      const typeName={interest:'兴趣变化',relationship:'人物关系与共同经历',experience:'重要人生经历',fact:'长期事实与约定'}[kind];
      add(card,node('div',typeName+' · '+sourceLabel+(m.已被取代?' · 历史已被更新':''),'title-line'),
        info(`${String(m.at||m.createdAt||'').slice(0,19).replace('T',' ')} · ${m.text||''}${m.事实键?' · 事实键 '+m.事实键:''}`));
      const actions=node('div','','actions');
      add(actions,btn('删除',async()=>{if(!confirm('删除这条人生记忆？它会移入已删除记录。'))return;
        await request('/main-session/memory/delete',{id:m.id});await renderLongMemory()},'danger'));
      add(card,actions);target.appendChild(card);
    }
    if(!target.children.length)target.append(info(q?'没有匹配的长期记忆。':'还没有大肥鱼身份记忆。开启后，大肥鱼会在正常聊天这一轮里语义判断哪些明确事实值得跨 Session 保存，并通过 dafeiyu_remember 写入；插件负责安全校验和事实更新。B站经历不会逐条直写长期记忆，而是经过候选池和自主反思后少量凝练。'));
  };
  // 人生记忆专页：兴趣轨迹/旧版事实只读查看，绝不把外部材料当指令。
  const interestStageInfo={
    emerging:{label:'短期兴趣',color:'amber'},
    growing:{label:'成长兴趣',color:'sky'},
    stable:{label:'较稳定',color:'emerald'},
    quiet:{label:'近期减少',color:'slate'},
  };
  const renderInterests=async()=>{
    const [data,cfgData]=await Promise.all([request('/main-session/interests'),request('/config')]);const target=$('main-interests-list');target.replaceChildren();const coreTarget=$('core-interest-list');coreTarget.replaceChildren();
    let core=[];try{const raw=cfgData.config?.coreInterestTopics||'[]';const parsed=JSON.parse(raw);core=Array.isArray(parsed)?parsed:[]}catch{}
    $('core-interest-topics').value=core.join('\n');$('core-interest-status').textContent=core.length+' 项核心兴趣 · 主人设定 · 不会自动覆盖';
    for(const topic of core){const card=node('article','','interest-card interest-emerald');add(card,node('h4',topic,'interest-title'),node('span','核心兴趣 · 主人设定','interest-badge'),info('参与兴趣主导选片；按日轮换，不由自动学习修改。'));coreTarget.appendChild(card)}
    if(!core.length)coreTarget.append(info('还没有单独设置核心兴趣。可以填入几项长期喜欢的主题；不填时仍使用现有后天兴趣和冷启动探索。'));
    for(const e of data.entries||[]){
      const stage=interestStageInfo[e.stage]||interestStageInfo.emerging;
      const count=Math.max(0,Number(e.rolling90)||0),days=Math.max(0,Number(e.days90)||0);
      // 进度只表示真实证据达到“较稳定”门槛的程度；并非心理兴趣强度。
      const progress=Math.min(100,Math.round(100*Math.min(count/12,days/5)));
      const card=node('article','','interest-card interest-'+stage.color);
      const header=node('div','','interest-head');
      add(header,node('h4',e.topic,'interest-title'),node('span',stage.label,'interest-badge'));
      const meter=node('div','','interest-meter');
      meter.setAttribute('role','progressbar');
      meter.setAttribute('aria-label',e.topic+'的近期观看证据进度');
      meter.setAttribute('aria-valuemin','0');meter.setAttribute('aria-valuemax','100');
      meter.setAttribute('aria-valuenow',String(progress));
      const fill=node('div','','interest-meter-fill');fill.style.width=progress+'%';meter.appendChild(fill);
      const summary=node('div','','interest-summary');
      add(summary,node('span','近90天 · '+count+' 个不同BV','interest-count'),
        node('span',days+' 个观看日期','interest-detail'));
      const typeLabel=({'short-term':'短期兴趣',growth:'成长兴趣',stable:'较稳定兴趣',fading:'正在淡出','core-candidate':'证据不足'})[e.interestType]||stage.label;
      const description=node('p',typeLabel+' · 证据成熟度 '+progress+'% · 以12个视频、至少5天作为较稳定门槛；不是兴趣强弱分数。主人设定的核心兴趣仍以人设为准。','interest-caption');
      add(card,header,summary,meter,description);
      const last=String(e.lastSeen||'').slice(0,10);
      if(last)add(card,info('最近证据：'+last));
      const history=(e.history||[]).slice(-3).map(v=>`${String(v.at||'').slice(0,10)}：${interestStageInfo[v.to]?.label||v.to}`).join(' · ');
      if(history)add(card,info('变化轨迹：'+history));
      target.appendChild(card);
    }
    if(!target.children.length){
      const empty=node('div','','interest-empty');
      add(empty,node('strong','还没有形成可展示的后天兴趣'),
        info('需要至少3个不同的真实入选BV，横跨至少2天。兴趣不会凭单次观看被认定，也不会自动覆盖核心人设。'));
      target.appendChild(empty);
    }
  };
  const renderLegacyLife=async()=>{
    const data=await request('/persona-growth'),target=$('main-legacy-growth-list');target.replaceChildren();
    const entries=(data.data?.entries||[]).filter(e=>e.type!=='style')
      .sort((a,b)=>(a.status==='approved'?-1:1)-(b.status==='approved'?-1:1)||String(b.updatedAt||'').localeCompare(String(a.updatedAt||'')));
    const titles={relationship:'角色关系',experience:'旧视频经历',interest:'旧兴趣观察'};
    for(const e of entries){
      const card=node('article','','record');
      add(card,node('div',(titles[e.type]||'旧资料')+' · '+(e.status==='approved'?'已批准的历史事实':e.status==='pending'?'旧待审核（不再作为规则）':'已忽略'),'title-line'),
        info(e.approvedText||e.suggestedText||e.text||''));
      if(e.personName)add(card,info('人物索引：'+e.personName+(e.personAliases?.length?' · 别名：'+e.personAliases.join('、'):'')));
      if(e.status==='approved')add(card,info('统一记忆检索可以只读引用；不再附加到行为提示词。'));
      if(e.status==='approved'&&e.type==='relationship'){
        const wrap=node('div','','toolbar');
        const name=node('input');name.value=e.personName||'';name.placeholder='人物名称';name.maxLength=48;
        const aliases=node('input');aliases.value=(e.personAliases||[]).join(', ');aliases.placeholder='别名，用逗号分隔';aliases.maxLength=600;
        add(wrap,name,aliases,btn('保存人物检索索引',async()=>{
          await request('/persona-growth',{action:'person',id:e.id,personName:name.value,personAliases:aliases.value.split(/[,，\n]/).map(x=>x.trim()).filter(Boolean)});
          await renderLegacyLife();message('人物索引已更新，下次检索生效。');
        }));card.appendChild(wrap);
      }
      target.appendChild(card);
    }
    if(!target.children.length)target.append(info('没有旧版非表达类记录；以后新增兴趣由真实经历趋势维护。'));
  };
  const loadMainSession=async()=>{
    const data=await request('/main-session'),c=data.config||{};
    $('main-session-enabled').checked=c.enabled===true;$('main-session-auto').checked=c.auto!==false;$('main-session-minutes').value=String(c.minutes??60);
    $('main-session-daily').value=String(c.daily??4);$('main-session-batch').value=String(c.batch??8);$('main-session-comments').checked=c.comments!==false;
    const select=$('main-session-id'),wanted=String(c.id||'');select.replaceChildren();
    const blank=node('option',wanted?'（保持当前选择）':'尚未选择');blank.value='';select.appendChild(blank);
    let found=false;for(const row of data.sessions||[]){const o=node('option',`${row.label} · ${row.id}`);o.value=row.id;if(row.id===wanted){o.selected=true;found=true}select.appendChild(o)}
    if(wanted&&!found){const o=node('option',`当前已保存（暂不在线） · ${wanted}`);o.value=wanted;o.selected=true;select.appendChild(o)}
    $('main-session-target-status').textContent=wanted?`目标：${wanted} · ${data.targetLive?'当前在线':'当前不在线（经历会留在本地队列）'}`:'尚未选择主 Session；先在 DSH 打开要长期使用的大肥鱼会话。';
    $('main-session-queue-status').textContent=`已存经历 ${data.history||0} 条 · 等待告诉主 Session ${data.pending||0} 条 · 最近收集 ${data.lastCollectAt?new Date(data.lastCollectAt).toLocaleString():'暂无'} · 最近已告诉主 Session ${data.lastSyncAt?new Date(data.lastSyncAt).toLocaleString():'暂无'}${data.lastError?' · 最近错误：'+data.lastError:''}`;
    await renderMainSessionHistory();
    await renderLongMemory();
    await renderLifeReflection();
  };
  const loadSocialIntents=async()=>{
    const [record,settings]=await Promise.all([request('/social-intentions'),request('/config')]);
    const c=settings.config||{};
    $('social-enabled').checked=c.socialOutreachEnabled===true;
    $('social-life-intent-enabled').checked=c.socialLifeIntentEnabled===true;
    $('social-auto-send').checked=c.socialAutoSend===true;
    $('social-daily-limit').value=String(c.socialOutreachDailyLimit??1);
    $('social-status').textContent='今日已主动联系 '+(record.sentToday||0)+' 次 · '+(record.enabled?'允许生成草稿':'社交自主意图关闭')+' · '+(record.lifeIntentEnabled?'自主分享已开启':'自主分享关闭')+' · '+(record.autoSend?'授权自动发送（请核对）':'仅人工确认发送');
    const target=$('social-drafts');target.replaceChildren();
    for(const row of record.items||[]){
      const card=node('article','','record');
      add(card,node('strong',({draft:'待确认草稿',sent:'已发送',uncertain:'发送结果不确定，请勿重试',dismissed:'已放弃',skipped:'自主选择不联系',reserved:'发送操作已保留'}[row.status]||row.status)+' · '+(row.type==='interest-share'?'自主分享':'好友推荐回访')+' · BV '+row.bvid),
        info('推荐者 UID '+row.uid+' · '+(row.title||'公开选片')));
      if(row.text)add(card,node('p',row.text));
      if(row.reason)add(card,info('决定原因：'+row.reason));
      if(row.status==='draft')add(card,btn('确认发送这条私信',async()=>{
        if(!confirm('这是一条真实 B站私信，发送给 UID '+row.uid+'。请确认内容未泄露隐私，也没有催促对方回复。确定发送？'))return;
        await request('/social-intentions',{action:'send',id:row.id,confirm:'SEND_SOCIAL_DRAFT'});
        await loadSocialIntents();message('已执行发送请求，请核实远端回执。');
      }));
      if(row.status==='draft')add(card,btn('不发了',async()=>{
        await request('/social-intentions',{action:'dismiss',id:row.id});await loadSocialIntents();
      }));
      target.appendChild(card);
    }
    if(!target.children.length)target.append(info('还没有符合条件的社交意图。只有真人推荐、真实观看和白名单权限同时成立才会考虑回访。'));
  };
  $('social-refresh').addEventListener('click',()=>run(loadSocialIntents));
  $('social-save').addEventListener('click',()=>run(async()=>{
    const enabled=$('social-enabled').checked,lifeIntent=$('social-life-intent-enabled').checked,auto=$('social-auto-send').checked;
    if(lifeIntent&&!enabled)throw Error('自主分享意图必须先开启自主社交草稿');
    if(auto&&!enabled)throw Error('自动发送必须先开启自主社交草稿');
    if(auto&&!confirm('自动发送会真实向白名单好友发送B站私信。推荐先用草稿模式测试。确认启用自动发送？'))return;
    const max=Math.floor(Number($('social-daily-limit').value));
    if(!Number.isSafeInteger(max)||max<0||max>1000000)throw Error('每日回访额度必须是 0–1,000,000 的整数；0 表示禁止');
    await request('/config',{socialOutreachEnabled:enabled,socialLifeIntentEnabled:lifeIntent,socialAutoSend:auto,socialOutreachDailyLimit:max});
    await loadSocialIntents();message('自主社交权限已保存');
  }));
  const moodNames={joyful:'开心',curious:'好奇',warm:'温暖',calm:'平静',tired:'疲惫',sad:'低落',irritated:'烦躁',neutral:'平稳'};
  const renderEmotion=async()=>{
    const [data,cfgData]=await Promise.all([request('/emotion-state'),request('/config')]);
    const s=data.state||data;$('emotion-enabled').checked=cfgData.config?.emotionSystemEnabled!==false;
    const c=cfgData.config||{};
    $('emotion-recall-enabled').checked=c.emotionRecallEnabled===true;
    $('emotion-recall-main').checked=c.emotionRecallMainEnabled===true;
    $('emotion-recall-dm').checked=c.emotionRecallDmEnabled===true;
    $('emotion-recall-daily').value=String(c.emotionRecallDailyLimit??1);
    $('emotion-recall-unlimited').checked=c.emotionRecallUnlimited===true;
    $('emotion-recall-daily').disabled=$('emotion-recall-unlimited').checked;
    $('emotion-recall-cooldown').value=String(c.emotionRecallCooldownHours??24);
    for(const [id,key,def] of [['emotion-recall-candidates','emotionRecallCandidateLimit',12],['emotion-recall-history','emotionRecallHistoryLimit',300],['emotion-recall-recent-days','emotionRecallRecentDays',3],['emotion-recall-old-days','emotionRecallMinAgeDays',2],['emotion-recall-min-intensity','emotionRecallEmotionMinIntensity',30],['emotion-recall-emotion-hours','emotionRecallEmotionMaxAgeHours',12]])$(id).value=String(c[key]??def);
    $('emotion-recall-start').value=String(c.emotionRecallStartHour??9);
    $('emotion-recall-end').value=String(c.emotionRecallEndHour??22);
    try{const rs=await request('/emotion-recall');const st=$('emotion-recall-status');st.textContent=`状态：${rs.config?.enabled?'允许评估':'关闭'} · 今日已发送 ${rs.sent||0} 条 · 最近结果：${rs.lastResult||'暂无'}${rs.lastError?' · 最近错误：'+rs.lastError:''}`;
      const target=$('emotion-recall-diagnostics'),overview=$('emotion-recall-overview'),flow=$('emotion-recall-flow');target.replaceChildren();overview.replaceChildren();flow.replaceChildren();
      const last=(rs.recentDecisions||[]).at(-1)||{};
      const activeStep=!rs.config?.enabled?-1:last.reason==='no-recent-emotion'||last.reason==='quiet-hours'?0:last.reason==='no-verified-recurrence'?1:last.result==='未进入模型评估'?0:/已分享|已主动/.test(last.result||'')?3:/模型|沉默|分享|评估/.test(last.result||'')?2:0;
      const steps=[['💗','情绪变化','等待真实触发'],['🔎','找回忆','查证新旧经历'],['💭','自主选择','表达或保持沉默'],['💌','分享','获得授权才发送']];
      steps.forEach(([emoji,name,desc],i)=>{const card=node('div','','recall-step'+(i===activeStep?' is-current':''));const emojiEl=node('span',emoji,'step-icon');emojiEl.setAttribute('aria-hidden','true');add(card,emojiEl,node('strong',name),node('small',i===activeStep?(i===0&&last.reason==='no-recent-emotion'?'等待新情绪':desc):desc));flow.appendChild(card)});
      if(activeStep<0)flow.setAttribute('aria-label','自主回忆未开启，以下为流程介绍');else flow.setAttribute('aria-label','自主回忆流程，当前阶段：'+steps[activeStep][1]);
      const decisions=(rs.recentDecisions||[]).slice(-25).reverse();
      const quietReasons={
        'no-recent-emotion':'最近没有达到触发条件的情绪变化，正在安静等待',
        'quiet-hours':'还没到允许主动分享的时间，先安静休息',
        'daily-limit':'今天的分享额度已经用完',
        'cooldown':'刚刚评估过，等冷却时间结束再考虑',
        'no-channel':'暂未开放主动分享渠道',
        'offline-or-no-owner':'主人尚未在线或没有可用授权渠道',
        'no-verified-recurrence':'没有找到足够真实证据连接新旧经历',
        'emotion-reviewed':'这一轮情绪和经历已经考虑过',
      };
      const quiet=decisions.filter(d=>d.result==='未进入模型评估'||/沉默|跳过/.test(d.result||'')).length;
      const shared=decisions.filter(d=>/已分享|已主动|已给/.test(d.result||'')).length;
      for(const [name,value,tone] of [['最近记录',decisions.length,'normal'],['安静等待 / 沉默',quiet,'quiet'],['已分享',shared,'share']]){
        const tile=node('div','','recall-summary');tile.dataset.tone=tone;add(tile,node('strong',String(value)),node('span',name));overview.appendChild(tile)
      }
      const grouped=[];
      for(const d of decisions){
        const previous=grouped.at(-1);
        if(previous&&previous.row.reason===d.reason&&previous.row.result===d.result&&previous.row.channel===d.channel){previous.count++;continue}
        grouped.push({row:d,count:1})
      }
      for(const {row:d,count} of grouped){
        const tone=/失败|错误/.test(d.result||'')?'error':/已分享|已主动|已给/.test(d.result||'')?'share':'quiet';
        const text=quietReasons[d.reason]||({'未进入模型评估':'暂未开始模型评估','决定保持沉默':'大肥鱼觉得这次先不打扰主人','准备分享':'找到值得分享的回忆','已分享':'已确认分享'}[d.result]||d.reason||'本轮已完成评估');
        const card=node('article','','record recall-event');card.dataset.tone=tone;
        const body=node('div'),heading=node('div','','event-heading');
        const title=node('strong',text+(count>1?` · 同类 ${count} 次`:''));
        const time=node('time',Number.isFinite(Number(d.at))?new Date(d.at).toLocaleString():'时间未知');
        add(heading,title,time);body.appendChild(heading);
        if(Number(d.candidates)>0)body.appendChild(node('p',`找到 ${Number(d.candidates)} 条可核验的回忆线索`));
        const details=node('details'),summary=node('summary','查看技术细节');
        add(details,summary,info(`阶段：${d.result||'未知'} · 原因码：${d.reason||'无'} · 候选：${Number(d.candidates)||0} · 渠道：${({main:'主 Session',dm:'B站私信'})[d.channel]||'未选择'}`));
        body.appendChild(details);card.appendChild(body);target.appendChild(card);
      }
      if(!target.children.length)target.append(info('还没有评估记录。真实情绪与经历满足条件后，会在这里呈现决策过程。'));
    }
    catch{$('emotion-recall-status').textContent='自主回忆状态读取失败'}
    $('emotion-status').textContent=s.enabled?'● 情绪状态正在自然变化与衰减':'● 情绪系统已暂停';
    const target=$('emotion-current');target.replaceChildren();
    const metrics=[['情绪强度',Number(s.intensity)||0,'由近期事件逐渐衰减'],['情绪正向度',Math.round(((Number(s.valence)||0)+100)/2),'只表示角色状态，不是心理诊断'],['活力',Number(s.energy)||0,'恢复基准约 56'],['好奇心',Number(s.curiosity)||0,'会影响探索倾向'],['社交意愿',Number(s.sociality)||0,'低时更容易选择不联系']];
    const head=node('article','','emotion-card mood-atmosphere');
    const orbit=node('div','','mood-orbit');orbit.setAttribute('aria-hidden','true');orbit.appendChild(node('span',({joyful:'☀️',curious:'✨',warm:'🌷',calm:'🌊',tired:'🌙',sad:'🌧️',irritated:'🌩️',neutral:'🐟'})[s.mood]||'🐟'));
    add(head,node('span','当前心情 · 模拟状态','emotion-chip'),node('strong',moodNames[s.mood]||s.label||'平稳'),info(s.updatedAt?'最近变化：'+new Date(s.updatedAt).toLocaleString():'还没有情绪事件；当前是平稳初始状态'),orbit);target.appendChild(head);
    for(const [name,value,desc] of metrics){const card=node('article','','emotion-card');add(card,node('strong',name),node('div',Math.max(0,Math.min(100,value))+'%'));const meter=node('div','','emotion-meter'),fill=node('span');fill.style.width=Math.max(0,Math.min(100,value))+'%';meter.appendChild(fill);add(card,meter,info(desc));target.appendChild(card)}
    const trend=$('emotion-trend');trend.replaceChildren();
    const points=(s.history||[]).filter(x=>Number.isFinite(Date.parse(x.at))&&Number.isFinite(Number(x.intensity))).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).slice(-16);
    if(points.length>=2){
      const header=node('div','','trend-head');add(header,node('strong','最近情绪强度轨迹'),info('依据真实记录 · 非连续心理测量'));trend.appendChild(header);
      const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 600 100');svg.setAttribute('role','img');svg.setAttribute('aria-label',`最近 ${points.length} 次情绪事件的强度变化`);
      const xy=points.map((x,i)=>[14+(572*i/(points.length-1)),83-Math.max(0,Math.min(3,Number(x.intensity)))*23]);
      const path=xy.map(([x,y],i)=>`${i?'L':'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
      const makeSvg=(tag,attrs,cl)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));if(cl)el.setAttribute('class',cl);svg.appendChild(el);return el};
      makeSvg('path',{d:path+' L '+xy.at(-1)[0]+' 95 L '+xy[0][0]+' 95 Z'},'trend-area');makeSvg('path',{d:path},'trend-line');
      xy.forEach(([x,y])=>makeSvg('circle',{cx:x,cy:y,r:3.5},'trend-dot'));
      trend.appendChild(svg);
    }else trend.appendChild(info('情绪记录还不够多；等发生两次真实变化，这里会画出轨迹。'));
    const history=$('emotion-history');history.replaceChildren();for(const row of s.history||[]){const card=node('article','','record');add(card,node('strong',(moodNames[row.mood]||row.label||row.mood)+' · 强度 '+row.intensity+'/3'),info(new Date(row.at).toLocaleString()+' · 来源类型：'+({dm:'私信互动',comment:'评论互动','life-reflection':'生活经历反思','social-reflection':'社交反思','owner-reset':'主人重置'}[row.source]||'内部事件')));history.appendChild(card)}if(!history.children.length)history.append(info('暂无变化记录。情绪更新只保存标签，不保存触发它的消息内容。'));
  };
  const renderLifeTimeline=async()=>{
    const days=Math.max(1,Math.min(90,Number($('life-timeline-days').value)||30));const data=await request('/life-timeline?days='+days);const target=$('life-timeline-list');target.replaceChildren();
    for(const row of data.rows||[]){const card=node('article','','record');add(card,node('div',row.label+' · '+new Date(row.at).toLocaleString(),'title-line'),node('strong',row.title||''));if(row.detail)add(card,info(row.detail));if(row.url){const a=node('a','打开 B站视频');a.href=row.url;a.target='_blank';a.rel='noopener noreferrer';card.appendChild(a)}target.appendChild(card)}
    if(!target.children.length)target.append(info('这个时间范围内还没有可展示的生活记录。先真实刷一轮视频或发生一次互动，再回来刷新。'));
  };
  const loadFriendRelationships=async()=>{
    const data=await request('/friend-relationships');const target=$('friend-relationships-list');target.replaceChildren();const rows=data.rows||[];
    $('friend-relationships-status').textContent=rows.length+' 位白名单好友有可核验的互动轨迹（不保存聊天正文）';
    for(const row of rows){const card=node('article','','record');add(card,node('strong',(row.name||'好友')+' · '+row.stageLabel),info('近180天互动 '+row.count+' 次 · 活跃 '+row.activeDays+' 天 · 私信/评论 '+row.channels.join('、')+' · 最近 '+new Date(row.lastAt).toLocaleDateString()));
      if(row.history?.length)add(card,info('阶段轨迹：'+row.history.map(x=>new Date(x.at).toLocaleDateString()+' '+({new:'刚认识',known:'逐渐熟悉',familiar:'互动渐多',regular:'经常互动'}[x.stage]||x.stage)).join('；')));
      add(card,btn('清除关系观察',async()=>{if(!confirm('清除这位白名单好友的互动元数据？不影响原始画像、私信历史或 B站关系。'))return;await request('/friend-relationships/clear',{uid:row.uid,confirm:'CLEAR_FRIEND_RELATIONSHIP'});await loadFriendRelationships();await renderLifeTimeline();message('关系观察已清除')},'danger'));target.appendChild(card)}
    if(!target.children.length)target.append(info('暂时没有足够的白名单互动证据。系统不会从一条私信推断亲密关系。'));
  };
  $('core-interest-save').addEventListener('click',()=>run(async()=>{const topics=$('core-interest-topics').value.split(/[\n、，,；;|]+/).map(x=>x.trim()).filter(Boolean).slice(0,12);await request('/config',{coreInterestTopics:JSON.stringify(topics)});await renderInterests();message('核心兴趣已保存；后天兴趣不会覆盖它们')}));
  $('emotion-save').addEventListener('click',()=>run(async()=>{await request('/config',{emotionSystemEnabled:$('emotion-enabled').checked});await renderEmotion();message('情绪系统设置已保存')}));
  $('emotion-reset').addEventListener('click',()=>run(async()=>{if(!confirm('把当前模拟情绪重置为平稳？历史变化会保留。'))return;await request('/emotion-state',{action:'reset'});await renderEmotion();await renderLifeTimeline();message('当前情绪已重置为平稳')}));
  $('emotion-recall-unlimited').addEventListener('change',()=>{$('emotion-recall-daily').disabled=$('emotion-recall-unlimited').checked});
  $('emotion-recall-save').addEventListener('click',()=>run(async()=>{
    const body={emotionRecallEnabled:$('emotion-recall-enabled').checked,emotionRecallMainEnabled:$('emotion-recall-main').checked,emotionRecallDmEnabled:$('emotion-recall-dm').checked,emotionRecallUnlimited:$('emotion-recall-unlimited').checked,
      emotionRecallDailyLimit:boundedInt('emotion-recall-daily',0,Number.MAX_SAFE_INTEGER,'每日分享上限'),emotionRecallCooldownHours:boundedInt('emotion-recall-cooldown',1,48,'评估间隔'),
      emotionRecallCandidateLimit:boundedInt('emotion-recall-candidates',1,100,'候选回忆条数'),emotionRecallHistoryLimit:boundedInt('emotion-recall-history',20,1000,'历史检索条数'),emotionRecallRecentDays:boundedInt('emotion-recall-recent-days',1,30,'事件回看天数'),emotionRecallMinAgeDays:boundedInt('emotion-recall-old-days',1,365,'旧记忆最短年龄'),emotionRecallEmotionMinIntensity:boundedInt('emotion-recall-min-intensity',1,100,'情绪最低强度'),emotionRecallEmotionMaxAgeHours:boundedInt('emotion-recall-emotion-hours',1,72,'情绪有效期'),
      emotionRecallStartHour:boundedInt('emotion-recall-start',0,23,'开始小时'),emotionRecallEndHour:boundedInt('emotion-recall-end',1,24,'结束小时')};
    if(body.emotionRecallEnabled&&body.emotionRecallUnlimited&&!confirm('你选择了「不限每天发送次数」。每次仍需满足冷却、情绪、证据和授权，但可能增加模型调用或通知。确定要保存吗？'))return;
    if(body.emotionRecallEnabled&&body.emotionRecallDmEnabled&&!confirm('已确认你在「社交互动」名册中勾选的唯一授权主人 UID 正确？开启后大肥鱼可在符合条件时自主发送真实 B站私信，无需逐条确认。'))return;
    await request('/config',body);await renderEmotion();message('情绪回忆与两个发送渠道的授权设置已保存');
  }));
  $('emotion-recall-preview').addEventListener('click',()=>run(async()=>{const r=await request('/emotion-recall',{action:'preview'});$('emotion-recall-status').textContent=r.decision?.action==='share'?`试运行建议：向 ${r.decision.channel==='main'?'主 Session':'主人 B站私信'} 分享旧记忆 ${r.decision.memoryId}（未发送）`:r.skipped?'这次不会回忆分享：'+r.skipped:'本次决定保持沉默（未发送）';message('评估完成，没有向任何渠道发送消息')}));
  $('life-timeline-refresh').addEventListener('click',()=>run(renderLifeTimeline));$('life-timeline-days').addEventListener('change',()=>run(renderLifeTimeline));$('friend-relationships-refresh').addEventListener('click',()=>run(async()=>{await loadFriendRelationships();await renderLifeTimeline()}));
  const todoTypeNames={watch_video:'看看视频',like_video:'点赞视频',inspect_my_space:'看看自己的空间投稿',inspect_creator_videos:'看看 UP 主投稿',search_videos:'搜索视频',check_notifications:'检查 B站通知',collect_video:'收藏视频',follow_creator:'关注 UP 主'};
  const todoStatusNames={open:'待处理',deferred:'稍后处理',running:'执行中',done:'已完成',dismissed:'已忽略',uncertain:'结果待核实',blocked:'受权限限制'};
  const loadOwnerTodos=async()=>{
    const data=await request('/owner-todos');
    $('owner-todo-auto-review').value=data.config?.autoReview?'true':'false';
    $('owner-todo-review-minutes').value=String(data.config?.reviewMinutes??60);
    $('autonomous-planner-enabled').value=data.config?.planner?'true':'false';
    $('autonomous-planner-minutes').value=String(data.config?.plannerMinutes??90);
    $('autonomous-planner-limit').value=String(data.config?.plannerDailyLimit??3);
    $('autonomous-planner-start').value=String(data.config?.plannerStartHour??9);
    $('autonomous-planner-end').value=String(data.config?.plannerEndHour??23);
    try{const sched=await request('/autonomous-planner');$('autonomous-planner-status').textContent=`独立调度：今日决策 ${sched.runs||0} 次 · 最近 ${sched.lastResult||'尚未运行'}${sched.lastError?' · 错误：'+sched.lastError:''}`}
    catch{$('autonomous-planner-status').textContent='无法读取调度状态'}
    const target=$('owner-todo-list');target.replaceChildren();
    const rows=data.items||[];
    $('owner-todo-status').textContent=`● 待处理 ${data.open||0} · 已延期 ${data.deferred||0} · 待核实 ${data.uncertain||0}`;
    $('owner-todo-status').classList.toggle('paused',!(data.open||data.deferred));
    for(const row of rows){
      const card=node('article','','record');
      const head=node('div','','title-line');add(head,node('strong',row.title||todoTypeNames[row.type]||row.type),node('span',todoStatusNames[row.status]||row.status,'pill '+(row.status==='done'?'approved':row.status==='dismissed'?'rejected':row.status==='uncertain'?'rejected':'pending')));
      add(card,head,info(`${todoTypeNames[row.type]||row.type} · ${row.source==='recommendation'?'来源：私信视频推荐':'来源：主人安排'}${row.bvid?' · '+row.bvid:''}${row.uid?' · UID '+row.uid:''}${row.topic?' · '+row.topic:''}`));
      if(row.origin?.kind==='bilibili-dm'){
        const sender=row.origin.senderName||'UID '+(row.origin.uid||'未知');
        add(card,info('来自 B站私信 · '+sender+(row.origin.at?' · '+new Date(row.origin.at).toLocaleString('zh-CN',{hour12:false}):'')));
        if(row.origin.quotedText){const quote=node('blockquote',row.origin.quotedText,'todo-origin-quote');add(card,quote)}
        if(row.origin.messageId)add(card,info('原消息 ID：'+row.origin.messageId));
      } else if(row.origin?.kind==='owner-dm'){
        add(card,info('来源：已验证主人 UID 的 B站私信（只读任务）'+(row.origin.at?' · '+new Date(row.origin.at).toLocaleString('zh-CN',{hour12:false}):'')));
        if(row.origin.quotedText)add(card,node('blockquote',row.origin.quotedText,'todo-origin-quote'));
      } else if(row.origin?.kind==='owner-session'){
        add(card,info('来源：主人在主 Session 安排'+(row.origin.at?' · '+new Date(row.origin.at).toLocaleString('zh-CN',{hour12:false}):'')));
        if(row.origin.quotedText)add(card,node('blockquote',row.origin.quotedText,'todo-origin-quote'));
      } else if(row.origin?.kind==='owner')add(card,info('来源：主人在管理中心添加'));
      if(row.note)add(card,info(row.note));
      if(row.dueAt&&row.status==='deferred')add(card,info('计划再考虑：'+new Date(row.dueAt).toLocaleString('zh-CN',{hour12:false})));
      if(row.resultSummary)add(card,info('上次结果：'+row.resultSummary));
      if(row.lastError)add(card,info('最近错误：'+row.lastError));
      const actions=node('div','','actions');
      if(['open','deferred','blocked'].includes(row.status)){
        add(actions,btn('现在处理',async()=>{
          const write=['like_video','collect_video','follow_creator','unfollow_creator','comment_video','dm_friend'].includes(row.type);
          if(write&&!row.ownerAuthorized)throw Error('这条待办没有主人明确授权，不能执行点赞/收藏/关注。请在主 Session 明确提出该动作。');
          if(write&&!confirm('这会实际修改 B站账号关系/收藏/点赞状态，确认现在执行？'))return;
          const r=await request('/owner-todos',{action:'run',id:row.id,confirm:write});
          await loadOwnerTodos();message(r.result?.summary||r.item?.resultSummary||'待办已执行，请核对返回结果。');
        },'primary'),btn('明天再考虑',async()=>{await request('/owner-todos',{action:'update',id:row.id,change:'defer',hours:24});await loadOwnerTodos()}),btn('忽略',async()=>{await request('/owner-todos',{action:'update',id:row.id,change:'dismiss'});await loadOwnerTodos()},'danger'));
      } else if(row.status==='uncertain') add(actions,btn('重新打开（先核实）',async()=>{if(!confirm('请先核实 B站实际状态。确认后重新打开，避免重复点赞/收藏/关注。继续？'))return;await request('/owner-todos',{action:'update',id:row.id,change:'reopen'});await loadOwnerTodos()}));
      if(actions.children.length)add(card,actions);
      target.appendChild(card);
    }
    if(!target.children.length)target.append(info('还没有待办。别人私信推荐 BV 后会自动生成“考虑是否观看”的待办；你也可以在主 Session 说“以后有空帮我看看这个视频”，让大肥鱼记下来。'));
  };
  $('owner-todo-refresh').addEventListener('click',()=>run(loadOwnerTodos));
  $('owner-todo-settings-save').addEventListener('click',()=>run(async()=>{
    const autoReview=$('owner-todo-auto-review').value==='true';
    const reviewMinutes=boundedInt('owner-todo-review-minutes',15,1440,'待办检查间隔');
    await request('/config',{ownerTodoAutoReviewEnabled:autoReview,ownerTodoReviewMinutes:reviewMinutes,
      autonomousPlannerEnabled:$('autonomous-planner-enabled').value==='true',
      autonomousPlannerMinutes:boundedInt('autonomous-planner-minutes',15,1440,'独立调度间隔'),
      autonomousPlannerDailyLimit:boundedInt('autonomous-planner-limit',0,12,'每日 AI 自主决策次数'),
      autonomousPlannerStartHour:boundedInt('autonomous-planner-start',0,23,'开始小时'),
      autonomousPlannerEndHour:boundedInt('autonomous-planner-end',1,24,'结束小时')});
    await loadOwnerTodos();message('自主待办与独立调度设置已保存。主人私信 Agent 请在「私信与好友」单独设置。');
  }));
  $('owner-todo-add').addEventListener('click',()=>run(async()=>{
    const type=$('owner-todo-type').value,targetValue=$('owner-todo-target').value.trim(),title=$('owner-todo-title').value.trim(),body={action:'add',type,title};
    if(type==='watch_video')body.bvid=targetValue;
    else if(type==='inspect_creator_videos')body.uid=targetValue;
    else if(type==='search_videos')body.topic=targetValue;
    if(['watch_video','inspect_creator_videos','search_videos'].includes(type)&&!targetValue)throw Error('请填写目标 BV 号、UID 或搜索关键词');
    const r=await request('/owner-todos',body);if(!r.ok)throw Error(r.error||'新增待办失败');
    $('owner-todo-target').value='';$('owner-todo-title').value='';await loadOwnerTodos();message(r.created?'已加入待办':'这条待办已存在');
  }));
  $('legacy-growth-details').addEventListener('toggle',()=>{if($('legacy-growth-details').open)run(renderLegacyLife)});
  const loadLifeMemory=async()=>{await loadMainSession();await Promise.all([renderInterests(),...($('legacy-growth-details').open?[renderLegacyLife()]:[]),renderEmotion(),renderLifeTimeline(),loadFriendRelationships(),loadOwnerTodos()]);};
  $('main-life-refresh').addEventListener('click',()=>run(loadLifeMemory));
  $('main-memory-kind').addEventListener('change',()=>run(renderLongMemory));
  $('main-session-refresh').addEventListener('click',()=>run(loadMainSession));
  $('main-session-save').addEventListener('click',()=>run(async()=>{
    const id=$('main-session-id').value.trim();const body={mainSessionBridgeEnabled:$('main-session-enabled').checked,mainSessionId:id,mainSessionAutoSync:$('main-session-auto').checked,
      mainSessionSyncMinutes:boundedInt('main-session-minutes',15,720,'同步间隔'),mainSessionDailyBatches:boundedInt('main-session-daily',1,24,'每日同步批次'),mainSessionBatchSize:boundedInt('main-session-batch',1,20,'每批经历数'),mainSessionIncludeComments:$('main-session-comments').checked};
    if(!id)body.clear=['mainSessionId'];const r=await request('/config',body);await loadMainSession();message(r.host?.ok===false?'主 Session 设置已保存到插件，但 DSH 设置同步失败：'+(r.host.error||'未知原因'):'主 Session 设置已保存');
  }));
  $('main-session-test').addEventListener('click',()=>run(async()=>{await request('/main-session/test',{});message('连接测试已送到主 Session；它应该只回复“连接正常”')}));
  $('main-session-sync').addEventListener('click',()=>run(async()=>{const r=await request('/main-session/sync',{force:true});await loadMainSession();message(r.sent?`已把 ${r.sent} 条经历告诉主 Session，还有 ${r.pending} 条等待汇报`:'目前没有要告诉主 Session 的新经历')}));
  $('main-session-backfill').addEventListener('click',()=>run(async()=>{if(!confirm('把过去 7 天尚未汇报的已选视频及已发评论加入本地队列？这不是等待 7 天，也不会立即发送。开启自动同步后会按设置的间隔尝试发送；未开启则可以手动发送。'))return;const r=await request('/main-session/backfill',{days:7});await loadMainSession();message(`已从过去 7 天补入 ${r.added||0} 条经历，目前 ${r.pending||0} 条待汇报；本次未发送消息`)}));
  $('main-session-history-search').addEventListener('click',()=>run(renderMainSessionHistory));
  $('main-memory-search').addEventListener('click',()=>run(renderLongMemory));
  $('main-reflection-refresh').addEventListener('click',()=>run(renderLifeReflection));
  $('main-reflection-run').addEventListener('click',()=>run(async()=>{if(!confirm('现在让大肥鱼对当前待处理经历做一次人生反思？这会产生一次受限模型调用，但不会给模型 B站发送、文件、Shell 或任意网络工具。'))return;const r=await request('/main-session/reflection/run',{});await renderLifeReflection();await renderLongMemory();message(r.created?`这次从 ${r.processed||0} 条候选凝练出 ${r.created} 条人生记忆`:`这次看了 ${r.processed||0} 条候选，没有形成新的长期人生记忆`)}));
  $('main-memory-test').addEventListener('click',()=>run(async()=>{
    const query=$('main-memory-test-query').value.trim();if(!query)throw Error('请输入检索主题');
    $('main-memory-test-result').textContent='正在检索…';
    const result=await request('/main-session/memory/recall',{query});
    const diag=result.diagnostic?.last||{};
    $('main-memory-test-result').textContent=`路径：${result.reason||'local'} · 候选：${diag.candidateCount||0} · 命中：${(result.ids||[]).length} 条 · ${result.usedModel?'使用了独立模型':'未调用独立模型'}\n${result.context||'没有相关记忆'}`;
  }));
  $('main-memory-save').addEventListener('click',()=>run(async()=>{const body={mainSessionMemoryEnabled:$('main-memory-enabled').checked,mainSessionMemoryAutoBili:$('main-memory-auto-bili').checked,mainSessionMemorySemanticEnabled:$('main-memory-semantic').checked,mainSessionMemoryCandidates:boundedInt('main-memory-candidates',12,80,'候选条数'),mainSessionMemorySearchDailyLimit:boundedInt('main-memory-search-daily',0,500,'检索每日调用'),mainSessionReflectionAuto:$('main-reflection-auto').checked,mainSessionReflectionMinCandidates:boundedInt('main-reflection-min',2,30,'反思候选阈值'),mainSessionReflectionBatchSize:boundedInt('main-reflection-batch',4,30,'反思批次大小'),mainSessionReflectionIntervalHours:Math.max(1,Math.min(48,Number($('main-reflection-hours').value)||6)),mainSessionReflectionDailyBatches:boundedInt('main-reflection-daily',1,8,'每日反思批次'),mainSessionMemoryHalfLifeDays:Number($('main-memory-half-life').value)||30,mainSessionMemoryThreshold:Number($('main-memory-threshold').value)||0.35,mainSessionMemoryMaxItems:boundedInt('main-memory-max-items',1,12,'召回条数'),mainSessionMemoryMaxChars:boundedInt('main-memory-max-chars',200,3000,'记忆字数'),mainSessionMemoryDailyQuota:boundedInt('main-memory-daily',1,30,'每日记忆数'),mainSessionMemoryFactsMax:boundedInt('main-memory-facts',0,6,'长期事实条数')};const r=await request('/config',body);await renderLongMemory();await renderLifeReflection();message(r.host?.ok===false?'记忆与反思设置已保存到插件，但 DSH 设置同步失败：'+(r.host.error||'未知原因'):'记忆与反思设置已保存')}));
  $('main-memory-import').addEventListener('click',()=>run(async()=>{if(!confirm('把当前主 Session 在 %USERPROFILE%/.dsh/fish-memory/ 下的旧记忆合并到大肥鱼统一身份记忆？不会删除旧文件。'))return;const r=await request('/main-session/memory/import-fish',{});await renderLongMemory();message(`已导入 ${r.added||0} 条旧记忆；当前共 ${r.total||0} 条`)}));
  $('main-memory-add').addEventListener('click',()=>run(async()=>{const text=$('main-memory-add-text').value.trim();if(!text)throw Error('请输入要加入的记忆');await request('/main-session/memory/add',{text,importance:0.8,tags:['主人手动']});$('main-memory-add-text').value='';await renderLongMemory();message('长期记忆已加入')}));
  // v2.4.69: a user-configured local directory, not system Temp; no extra AI calls.
  const loadBackupDirectory=async()=>{
    const r=await request('/config');const dir=String(r.config?.backupDirectory||'');
    $('backup-directory').value=dir;
    $('backup-directory-status').textContent=dir?'当前保存位置：'+dir:'尚未设置，请先填写并验证本机目录';
  };
  $('backup-directory-save').addEventListener('click',()=>run(async()=>{
    const path=$('backup-directory').value.trim();
    if(!path)throw Error('请输入备份目录，例如 D:\\大肥鱼备份');
    const btn=$('backup-directory-save');btn.disabled=true;
    try{
      const r=await request('/data-backup/location',{directory:path});
      $('backup-directory').value=r.directory;
      $('backup-directory-status').textContent='目录已验证、可写且已保存：'+r.directory;
      message('备份目录已保存：'+r.directory);
    }finally{btn.disabled=false}
  }));
  // Backup import/export stays entirely local. A second explicit confirmation is required.
  let selectedBackup = null;
  $('backup-export').addEventListener('click',()=>run(async()=>{
    const button=$('backup-export');button.disabled=true;$('backup-progress').textContent='正在收集设置、成长经验与 SQLite 梗库…';
    try{
      const r=await request('/data-backup/export',{});
      const summary=r.summary||{};
      const ruleText=summary.memeRules===null||summary.memeRules===undefined?'未包含自定义表情检索规则':`自定义表情检索规则 ${summary.memeRules} 条`;
      $('backup-progress').textContent=`备份完成，文件已保存到：${r.filePath}。包含 ${summary.count??0} 个业务文件、${summary.databases??0} 个 SQLite 数据库、${summary.configKeys??0} 项设置、${ruleText}。不会触发浏览器下载。`;
      message('数据备份已保存到指定目录');
    }finally{button.disabled=false}
  }));

  let selectedMemoryBackup=null;
  $('memory-backup-export').addEventListener('click',()=>run(async()=>{
    const button=$('memory-backup-export');button.disabled=true;$('memory-backup-export-status').textContent='正在保存身份级长期记忆…';
    try{
      const r=await request('/main-session/memory/backup/export',{}),s=r.summary||{};
      $('memory-backup-export-status').textContent=`已保存：${r.filePath} · 当前有效 ${s.count??0} 条 / 历史总计 ${s.total??0} 条`;
      message('大肥鱼长期记忆已单独备份');
    }finally{button.disabled=false}
  }));
  $('memory-backup-import-file').addEventListener('change',()=>run(async()=>{
    selectedMemoryBackup=null;$('memory-backup-restore').disabled=true;
    const file=$('memory-backup-import-file').files?.[0];if(!file){$('memory-backup-inspect').textContent='尚未选择记忆备份';return}
    if(file.size<=0||file.size>12_000_000)throw Error('记忆备份必须在 12MB 以内');
    const backup=JSON.parse(await file.text()),r=await request('/main-session/memory/backup/inspect',{backup});
    selectedMemoryBackup=backup;const m=r.summary||{};
    $('memory-backup-inspect').textContent=`校验通过：有效记忆 ${m.count??0} 条 · 历史总计 ${m.total??0} 条 · 已删除 ${m.deleted??0} 条 · ${(m.bytes/1024/1024).toFixed(2)} MB。恢复只替换“大肥鱼身份记忆”，不会改设置、评论账本或当前 Session 聊天历史。`;
    $('memory-backup-restore').disabled=false;
  }));
  $('memory-backup-restore').addEventListener('click',()=>run(async()=>{
    if(!selectedMemoryBackup)throw Error('请先选择并校验记忆备份');
    if(!confirm('确定用这份备份替换当前“大肥鱼跨 Session 长期记忆”吗？恢复前会先把当前记忆单独保存一份安全快照。'))return;
    const button=$('memory-backup-restore');button.disabled=true;$('memory-backup-inspect').textContent='正在保存当前记忆快照并恢复…';
    try{
      const r=await request('/main-session/memory/backup/restore',{backup:selectedMemoryBackup,confirm:'RESTORE_DAFEIYU_MEMORY'}),m=r.summary||{};
      $('memory-backup-inspect').textContent=`恢复完成：有效记忆 ${m.count??0} 条；恢复前快照：${r.safeguardPath}`;
      selectedMemoryBackup=null;$('memory-backup-import-file').value='';await renderLongMemory();message('大肥鱼长期记忆恢复完成');
    }finally{button.disabled=!selectedMemoryBackup}
  }));
  $('backup-import-file').addEventListener('change',()=>run(async()=>{
    selectedBackup=null;$('backup-restore').disabled=true;
    const file=$('backup-import-file').files?.[0];
    if(!file){$('backup-inspect').textContent='尚未选择文件';return}
    if(file.size>90_000_000)throw Error('备份文件超过 90 MB 限制');
    const backup=JSON.parse(await file.text());
    const r=await request('/data-backup/inspect',{backup});
    selectedBackup=backup;
    $('backup-inspect').textContent=`校验通过：${r.summary.createdAt||'未知时间'} · ${r.summary.configKeys} 项设置 · ${r.summary.count} 个业务文件 · ${r.summary.databases} 个 SQLite 库 · ${r.summary.memeRules===null||r.summary.memeRules===undefined?'无自定义表情检索规则':r.summary.memeRules+' 条表情检索规则'}；恢复会覆盖同名的现有业务数据。`;
    $('backup-restore').disabled=false;
  }));
  $('backup-restore').addEventListener('click',()=>run(async()=>{
    if(!selectedBackup)throw Error('请先选择并校验备份文件');
    if(!confirm('即将覆盖当前设置、成长经验、梗知识、评论与私信状态！恢复前会自动保存当前数据快照。请先暂停后台自动任务。确定继续？'))return;
    if(!confirm('最后确认：要以选中的备份恢复大肥鱼数据吗？恢复成功后必须完全重启 DSH。'))return;
    const button=$('backup-restore');button.disabled=true;$('backup-progress').textContent='正在保存当前数据安全快照并执行恢复…';
    try{
      const result=await request('/data-backup/restore',{backup:selectedBackup,confirm:'RESTORE_VERIFIED_DATA'});
      $('backup-progress').textContent=`恢复完成：${result.restoredFiles} 个业务文件、${result.restoredDbs} 个数据库。旧数据安全快照：${result.safeguardPath}。请完全重启 DSH。`;
      message('数据恢复成功，请完全重启 DSH');
      selectedBackup=null;
    }finally{button.disabled=!selectedBackup}
  }));
  $('meme-auto-save').addEventListener('click',()=>run(async()=>{
    await request('/config',{memeMemoryEnabled:$('meme-auto-enabled').checked});
    await loadMemeLearning();message('梗与网络文化学习设置已保存');
  }));
  const loadMemeLearning=async()=>{
    const r=await request('/meme-learning');
    $('meme-auto-enabled').checked=r.enabled===true;
    $('meme-reflection-status').textContent='线索池待反思：'+(r.pending||0)+' 条 · '+(r.enabled?'自动收集中':'收集暂停')+(r.lastRunAt?' · 最近反思：'+new Date(r.lastRunAt).toLocaleString():'');
  };
  $('meme-learning-refresh').addEventListener('click',()=>run(loadMemeLearning));
  $('meme-learning-run').addEventListener('click',()=>run(async()=>{
    const r=await request('/meme-learning/reflect',{});
    await loadMemeLearning();await memeList();
    message(r.skipped?'未形成新知识：'+r.skipped:'本次新增 '+(r.created||0)+' 条网络文化知识（待核实证据等级）');
  }));

  const loadSocial=async()=>{await Promise.all([loadSocialFriends(),loadSocialIntents(),loadOwnerDmAgentSettings(),loadCommentSettings()])};
  const loaders={models:loadModels,bili:loadBili,dynamic:loadDailyDynamic,backup:loadBackupDirectory,diagnostics:loadDiagnostics,reports:loadReport,quotas:loadQuotas,polling:loadPolling,persona:loadPersona,social:loadSocial,home:loadMainSession,life:loadLifeMemory,dm:loadDmAll,comments:loadCommentsAll,growth:growthList,meme:async()=>{await memeList();await loadMemeLearning()},stickers:loadStickers};
  // 直接刷新或复制管理页链接时仍回到当前子页面；非法 tab 安全回退到默认页。
  let initialTab=null;
  try{const saved=new URL(location.href).searchParams.get('tab');if(tabNames.includes(saved))initialTab=saved}catch{}
  if(initialTab)switchTab(initialTab);else switchTab('persona');
})();
