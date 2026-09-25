// Read-only Air/Codex telemetry. Never retain message, reasoning or tool payloads.
export function createUsageMonitor({root,io,join,now=Date.now,enabled=true,intervalMs=1000,reminderMs=300000,onEvents=null,canPresent=()=>true,canSpeak=()=>true,attention=null,quota=null}) {
  const files=new Map();let timer=null,busy=false,disposed=false,lastScan=0,lastNotice=0,noticeUntil=0;
  let notice='',noticeKind=null,noticeStarted=0,noticeExpression=null,lastError=null,lastGood=0,viewKey='',viewTs=0,boot=true;
  const events=[];const quotaLevels=new Map();
  let attentionRevision=-1,attentionText=null,attentionTextRevision=-1;
  const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
  const counts=info=>info?{input:number(info.input_tokens),cached:number(info.cached_input_tokens),output:number(info.output_tokens),total:number(info.total_tokens)}:null;
  const windowOf=w=>w&&number(w.used_percent)!==null&&w.used_percent<=100&&number(w.window_minutes)>0?{usedPercent:w.used_percent,windowMinutes:w.window_minutes,resetsAt:number(w.resets_at)}:null;
  const fresh=s=>now()-s<=300000;
  const amount=n=>n===null?'未知':new Intl.NumberFormat('zh-CN').format(n);
  function ingest(state,record,baseline=false) {
    if(record.type!=='event_msg')return;
    const p=record.payload;if(!p||typeof p!=='object')return;
    const timestamp=Date.parse(record.timestamp);if(!Number.isFinite(timestamp)||timestamp<state.changed)return;
    if(p.type==='task_started'){
      state.active=true;state.turn=p.turn_id;state.changed=timestamp;state.started=timestamp;
      state.base=state.total;state.last=null;state.finished=null;
      if(!baseline&&now()-timestamp<30000)events.push({kind:'started',at:timestamp});
    }else if(p.type==='token_count'){
      state.changed=timestamp;state.last=counts(p.info?.last_token_usage);state.total=counts(p.info?.total_token_usage);
      // Recent inference is evidence of activity even if the initial tail omitted task_started.
      if(!state.finished)state.active=true;
      const r=p.rate_limits;
      if(r&&typeof r.limit_id==='string'){
        const primary=windowOf(r.primary),secondary=windowOf(r.secondary);
        if(primary||secondary)state.buckets.set(r.limit_id,{id:r.limit_id.slice(0,100),label:typeof r.limit_name==='string'?r.limit_name.slice(0,100):r.limit_id.slice(0,100),primary,secondary,observedAt:timestamp});
      }
    }else if(['task_complete','turn_aborted'].includes(p.type)){
      if(state.turn&&p.turn_id&&state.turn!==p.turn_id)return;
      if(state.finished)return;
      state.active=false;state.changed=timestamp;state.finished=p.type==='task_complete'?'success':'cancelled';
      state.announce=!baseline&&timestamp>now()-30000;
      if(state.announce)events.push({kind:p.type==='task_complete'?'completed':'aborted',at:timestamp});
    }
  }
  const initial=()=>({offset:0,pending:Buffer.alloc(0),buckets:new Map(),active:false,changed:0,total:null,last:null,finished:null,announce:false});
  async function discover() {
    const candidates=[];
    // Only recent local telemetry; long-running already discovered sessions remain tracked.
    for(let day=0;day<14;day++){
      const date=new Date(now()-day*86400000),folder=join(root,String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0'));
      let entries;try{entries=await io.readdir(folder,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')continue;throw e;}
      for(const entry of entries){if(!entry.isFile()||!entry.name.endsWith('.jsonl'))continue;
        const file=join(folder,entry.name);const stat=await io.stat(file);candidates.push({file,mtime:stat.mtimeMs});
      }
    }
    candidates.sort((a,b)=>b.mtime-a.mtime);
    for(const {file} of candidates.slice(0,32)){
      if(files.has(file))continue;
      const handle=await io.open(file,'r');try{
        const header=Buffer.alloc(262144);const {bytesRead}=await handle.read(header,0,header.length,0);
        const first=header.subarray(0,bytesRead).toString('utf8').split('\n')[0];let meta;
        try{meta=JSON.parse(first);}catch{continue;}
        if(meta.type!=='session_meta'||meta.payload?.originator!=='air')continue;
        const state=initial();state.origin='Air / Codex';state.bootstrap=true;files.set(file,state);
      }finally{await handle.close();}
    }
    for(const [file,state] of files)if(now()-state.changed>86400000&&!candidates.slice(0,32).some(x=>x.file===file))files.delete(file);
  }
  async function readUpdates(file,state) {
    const stat=await io.stat(file);
    if(stat.size<state.offset){Object.assign(state,initial(),{bootstrap:true});}
    if(stat.size===state.offset)return;
    const handle=await io.open(file,'r');try{
      let skip=false;
      if(state.bootstrap&&stat.size>2097152){state.offset=stat.size-2097152;skip=true;}
      const length=Math.min(stat.size-state.offset,2097152),buffer=Buffer.alloc(length);
      const {bytesRead}=await handle.read(buffer,0,length,state.offset);state.offset+=bytesRead;
      let data=Buffer.concat([state.pending,buffer.subarray(0,bytesRead)]);
      if(skip||state.discard){const end=data.indexOf(10);state.discard=end<0;data=end<0?Buffer.alloc(0):data.subarray(end+1);}
      const end=data.lastIndexOf(10);if(end<0){state.discard=state.discard||data.length>2097152;state.pending=state.discard?Buffer.alloc(0):data;return;}
      state.pending=data.subarray(end+1);
      for(const line of data.subarray(0,end).toString('utf8').split('\n')){
        // Avoid parsing unrelated potentially large content records at all.
        if(!line.includes('"event_msg"'))continue;
        try{ingest(state,JSON.parse(line),state.bootstrap||boot);}catch{}
      }
      state.bootstrap=false;
    }finally{await handle.close();}
  }
  function snapshot() {
    const sessions=[...files.values()];const active=sessions.filter(s=>s.active&&now()-s.changed<120000);
    // Preserve bucket identity and source session; do not merge possibly different accounts.
    const source=(active.length?active:sessions).sort((a,b)=>b.changed-a.changed)[0];
    const buckets=source?[...source.buckets.values()].map(b=>({...b,stale:!fresh(b.observedAt)||(b.primary?.resetsAt&&now()/1000>=b.primary.resetsAt)||(b.secondary?.resetsAt&&now()/1000>=b.secondary.resetsAt)?true:false})):[];
    return {enabled,source:'Air / Codex 本机结构化日志',scope:'最近14天内发现的最多32个会话；日志额度未经账号核对，独立授权见account',activeSessions:Math.max(active.length,attention?.snapshot().running||0),lastRequest:source?.last||null,buckets,lastObservedAt:source?.changed||null,lastReadAt:lastGood||null,error:lastError,stale:!source||!fresh(source.changed),pendingInput:attention?.snapshot()||null,account:quota?.snapshot()||null};
  }
  function summary(topic='all') {
    const s=snapshot(),lines=[s.activeSessions?`Air / Codex：${s.activeSessions} 个会话正在工作`:'Air / Codex：暂无近期推理活动'];
    if(s.pendingInput?.count)lines.unshift(`Air：${s.pendingInput.count} 个任务需要你输入，请切回 Air 查看。`);
    const tokenText=s.lastRequest?`最近请求：输入 ${amount(s.lastRequest.input)}（缓存 ${amount(s.lastRequest.cached)}，已包含在输入中）；输出 ${amount(s.lastRequest.output)} tokens`:'最近请求的 token 记录暂时未知。';
    if(topic==='tokens')return tokenText+(s.stale?'\n这是历史采样，不代表当前请求。':'');
    if(s.lastRequest)lines.push(tokenText);
    // Logs do not establish the current Air account. Keep raw buckets in snapshot
    // for diagnostics, but never give the conversational model unbound percentages.
    const quotaText=quota?quota.summary():'当前 GPT 账号额度未知：尚未确认 Air 当前账号与额度的对应关系，5小时/7天剩余均未知。reserve池和历史读数不能代替账号额度，不能推算剩余百分比。';
    if(topic==='quota')return quotaText;
    lines.push(quotaText);
    if(s.lastObservedAt)lines.push(`采样 ${new Date(s.lastObservedAt).toLocaleTimeString('zh-CN',{hour12:false})}${s.stale?'（已过期）':''}`);
    return lines.join('\n');
  }
  function prefer(native) {
    const input=attention?.snapshot();
    if(!enabled||!canPresent(!!input?.count))return native;
    const active=snapshot().activeSessions;
    // A new live task retires a finished-group report, including its reading timer.
    if(active&&noticeKind==='completed'){noticeUntil=0;noticeKind=null;noticeExpression=null;}
    // Native DSH work resumes when Air has neither running work nor an input request.
    if(!input?.count&&!active&&native?.state&&!['success','error'].includes(native.state))return native;
    // Reduce the whole log batch first: queued work wins over an earlier completion.
    // Notice text never supplies the animation state, even after a slow model reply.
    const expressionCurrent=!noticeExpression||!!quota?.presentation?.(noticeExpression);
    const held=!input?.count&&now()<noticeUntil&&expressionCurrent;
    // Only the settled completion report owns the one-shot completion animation.
    // A raw per-turn finish must not independently flash success between queued turns.
    const state=input?.count?'waiting':active?'working':held&&noticeKind==='completed'&&now()-noticeStarted<10000?'success':null;
    const task=input?.count?(attentionTextRevision===input.revision?attentionText:null):held?notice:null;
    const workingQuota=state==='working'?(quota?.windows?.()||[]).map(w=>`${w.label}还剩 ${Math.round((100-w.usedPercent)*100)/100}%`).join(' · '):'';
    const view={state,task,fatfishManaged:true,fatfishBubbleMuted:!canSpeak(!!input?.count),
      ...(state==='working'?{fatfishWorkingQuota:workingQuota?'Codex '+workingQuota:'Codex 余量暂时未知'}:{}),
      ...(input?.count?{fatfishAttentionRevision:input.revision}:{}),
      ...(state==='success'?{fatfishStateRevision:noticeStarted,fatfishStateUntil:noticeStarted+10000}:{}),
      ...(held?{fatfishNoticeUntil:noticeUntil}:{}),
      ...(held&&noticeExpression&&now()-noticeExpression.at<15000&&quota?.presentation?.(noticeExpression)?{fatfishExpression:noticeExpression}:{})};
    if(!state&&!held&&native?.state)return native;
    const key=JSON.stringify(view);if(key!==viewKey){viewKey=key;viewTs=Math.max(now(),viewTs+1);}
    return {...view,ts:viewTs};
  }
  async function poll() {
    if(disposed||busy||!enabled)return;busy=true;
    try{
      if(!lastScan||now()-lastScan>=5000){await discover();lastScan=now();}
      for(const [file,state] of files){try{await readUpdates(file,state);}catch(e){if(e.code==='ENOENT')files.delete(file);else throw e;}}
      lastGood=now();lastError=null;
      const s=snapshot();
      if(s.pendingInput?.revision!==attentionRevision){
        attentionRevision=s.pendingInput?.revision;
        if(s.pendingInput?.count)events.push({kind:'input_required',at:now(),count:s.pendingInput.count,revision:attentionRevision});
        else {attentionText=null;attentionTextRevision=-1;}
      }
      if(s.activeSessions&&now()-lastNotice>=reminderMs){
        if(onEvents)events.push({kind:'usage',at:now()});
        lastNotice=now();
      }
      for(const w of quota?.windows?.()||[]){
        const key=JSON.stringify([w.accountRevision,w.windowMinutes,w.resetsAt]),level=w.usedPercent>=95?95:w.usedPercent>=80?80:0;
        if(!boot&&quotaLevels.has(key)&&level>quotaLevels.get(key))events.push({kind:'quota',at:now(),windowMinutes:w.windowMinutes,accountRevision:w.accountRevision,resetsAt:w.resetsAt,level});
        quotaLevels.set(key,level);
      }
      if(quotaLevels.size>256)quotaLevels.delete(quotaLevels.keys().next().value);
      const batch=events.splice(0);if(onEvents&&!disposed)onEvents(batch);
      boot=false;
    }catch{lastError='无法读取本机 Air/Codex 遥测；等待重试';}finally{busy=false;if(disposed)files.clear();}
  }
  return {poll,snapshot,summary,prefer,
    refreshCompletion:()=>quota?.refresh(true),
    completionSummary:()=>quota?.completionSummary()||'Codex 余量暂时查不到，5小时和7天均未知。',
    quotaPresentation:event=>quota?.presentation?.(event)||null,
    showAttention(text,revision){if(attention?.snapshot().revision===revision){attentionText=text;attentionTextRevision=revision;viewKey='';}},
    showNotice(text,_expression='result',durationMs=10000,expression=null,kind=null){notice=text;noticeKind=kind;noticeStarted=now();noticeExpression=expression;noticeUntil=noticeStarted+(Number.isFinite(durationMs)?Math.min(300000,Math.max(1000,durationMs)):10000);viewKey='';},
    hasNextNotice:()=>noticeKind==='next_completed'&&now()<noticeUntil,
    clearNotice(preserveNext=false){if(preserveNext&&noticeKind==='next_completed'&&now()<noticeUntil)return;noticeUntil=0;noticeKind=null;noticeExpression=null;viewKey='';},
    start(){if(timer||disposed)return;void poll();timer=setInterval(()=>void poll(),intervalMs);timer.unref?.();},
    dispose(){disposed=true;if(timer)clearInterval(timer);timer=null;files.clear();},
    // Export pure event reduction through the instance for schema regression tests.
    ingest,initial};
}
