// Dedicated official app-server auth. Never use ~/.codex credentials or Air tokens.
export function quotaResetText(resetsAt,now=Date.now()){
  if(!Number.isFinite(resetsAt)||resetsAt<=0||resetsAt*1000<=now)return '重置时间未知';
  const remaining=resetsAt*1000-now;
  if(remaining<60000)return '不到1分钟后重置';
  const minutes=Math.ceil(remaining/60000),days=Math.floor(minutes/1440),hours=Math.floor(minutes%1440/60),rest=minutes%60;
  const duration=[days?`${days}天`:'',hours?`${hours}小时`:'',rest?`${rest}分钟`:''].join('');
  return `约${duration}后重置`;
}
export function matchAirAccount(air,identity){
  if(!air?.accountId||!air?.userId)return 'air_unknown';
  if(!identity?.accountId||!identity?.userIds?.length)return 'identity_unknown';
  return air.accountId===identity.accountId&&identity.userIds.includes(air.userId)?'matched':'mismatch';
}
export function quotaBuckets(result){
  const values=result?.rateLimitsByLimitId?Object.values(result.rateLimitsByLimitId):[result?.rateLimits];
  const window=w=>w&&Number.isFinite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100&&Number.isFinite(w.windowDurationMins)&&w.windowDurationMins>0?{usedPercent:w.usedPercent,windowMinutes:w.windowDurationMins,resetsAt:Number.isFinite(w.resetsAt)?w.resetsAt:null}:null;
  return values.filter(b=>b&&typeof b.limitId==='string').map(b=>({id:b.limitId,label:typeof b.limitName==='string'?b.limitName:b.limitId,primary:window(b.primary),secondary:window(b.secondary)})).slice(0,20);
}
export function ordinaryQuotaWindows(snapshot,now=Date.now()){
  if(snapshot?.state!=='matched'||snapshot.stale)return [];
  const codex=snapshot.buckets?.find(b=>b.id==='codex');
  return [[300,'5小时'],[10080,'7天']].flatMap(([minutes,label])=>{
    const w=[codex?.primary,codex?.secondary].find(w=>w?.windowMinutes===minutes&&Number.isFinite(w.usedPercent)&&w.usedPercent>=0&&w.usedPercent<=100&&(!w.resetsAt||w.resetsAt>now/1000));
    return w?[{...w,label,accountRevision:snapshot.accountRevision||0,observedAt:snapshot.observedAt}]:[];
  });
}
export function createCodexQuota({spawn,fs,join,root,airFile,exe,env,now=Date.now,onMismatch=()=>{}}){
  let child=null,ready=null,disposed=false,sequence=0,pending=new Map(),buffer='',timer=null,refreshInFlight=null,loginId=null;
  let phase='signed_out',identity=null,buckets=[],observedAt=0,boundKey='',lastMismatch='',generation=0,lastRefresh=0,accountRevision=0;
  const authFile=join(root,'auth.json');
  const mask=value=>typeof value==='string'?value.replace(/^(.{1,2}).*(@.*)$/,'$1***$2'):null;
  function readAir(){try{const value=JSON.parse(fs.readFileSync(airFile,'utf8'));return value.type==='has_account'?value.account:null;}catch{return null;}}
  function key(a){return a?.accountId&&a?.userId?JSON.stringify([a.accountId,a.userId]):'';}
  function readIdentity(){
    try{
      const auth=JSON.parse(fs.readFileSync(authFile,'utf8')),token=auth.tokens?.id_token;
      if(typeof token!=='string')return null;
      const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
      const account=claims['https://api.openai.com/auth']||{};
      const accountId=auth.tokens?.account_id||account.chatgpt_account_id;
      // JWT payload is only used for local identity comparison after official account/read.
      return typeof accountId==='string'?{accountId,userIds:[claims.sub,account.chatgpt_user_id,account.user_id].filter(v=>typeof v==='string'),email:typeof claims.email==='string'?claims.email:null}:null;
    }catch{return null;}
  }
  function snapshot(){
    const air=readAir(),matching=matchAirAccount(air,identity);
    const state=phase==='ready'?matching:phase;
    const valid=state==='matched'&&boundKey===key(air)&&now()-observedAt<300000;
    return {state,airEmail:mask(air?.email),authorizedEmail:mask(identity?.email),basis:'Air最近已知账号记录；不证明每个运行中任务的账号',observedAt:valid?observedAt:null,buckets:valid?buckets:[],stale:!valid,accountRevision};
  }
  const windows=()=>ordinaryQuotaWindows(snapshot(),now());
  function presentation(event){
    const candidates=windows().filter(w=>!event||(w.windowMinutes===event.windowMinutes&&w.accountRevision===event.accountRevision&&w.resetsAt===event.resetsAt&&w.usedPercent>=event.level));
    const w=candidates.sort((a,b)=>b.usedPercent-a.usedPercent)[0];
    return w?{kind:'quota',slot:w.usedPercent===100?5:Math.floor(w.usedPercent/20),at:now(),windowMinutes:w.windowMinutes,label:w.label,usedPercent:w.usedPercent,accountRevision:w.accountRevision,resetsAt:w.resetsAt,level:w.usedPercent}:null;
  }
  function summary(){
    const s=snapshot();
    if(s.state==='mismatch')return '网页授权账号与Air最近账号记录不一致，请重新授权选择Air里的账号；额度不可用。';
    if(s.state==='air_unknown'||s.state==='identity_unknown')return '暂时无法核对Air账号，不能判断选错账号；额度未知。';
    if(s.state==='pending')return '浏览器授权还没完成，账号额度暂时未知。';
    if(s.state!=='matched')return '还没有可用的独立网页授权，GPT账号额度未知。';
    const lines=['网页授权身份与Air最近账号记录一致；以下仅为该账号Codex额度，不代表所有GPT产品。'];
    const codex=s.buckets.find(b=>b.id==='codex');
    for(const [minutes,label] of [[300,'5小时'],[10080,'7天']]){
      const w=[codex?.primary,codex?.secondary].find(w=>w?.windowMinutes===minutes&&(!w.resetsAt||w.resetsAt>now()/1000));
      lines.push(w?`${label}：已用 ${w.usedPercent}%，剩余 ${Math.max(0,100-w.usedPercent)}%；${quotaResetText(w.resetsAt,now())}`:`${label}：未知，接口没有当前对应读数`);
    }
    return lines.join('\n');
  }
  function completionSummary(){
    const s=snapshot();
    if(s.state==='mismatch')return 'Codex 余量未知：网页账号与 Air 不一致，需要重新授权。';
    if(s.state!=='matched'||s.stale)return 'Codex 余量暂时查不到，5小时和7天均未知。';
    const codex=s.buckets.find(b=>b.id==='codex');
    const parts=[[300,'5小时'],[10080,'7天']].map(([minutes,label])=>{
      const w=[codex?.primary,codex?.secondary].find(w=>w?.windowMinutes===minutes&&(!w.resetsAt||w.resetsAt>now()/1000));
      return w?`${label}已用${w.usedPercent}%，余${Math.round((100-w.usedPercent)*100)/100}%`:`${label}未知`;
    });
    return `Codex：${parts.join('；')}。`;
  }
  function failPending(){for(const item of pending.values()){clearTimeout(item.timer);item.reject(Error('quota-connection'));}pending.clear();}
  function rpc(method,params={}){
    if(!child||disposed)return Promise.reject(Error('quota-unavailable'));
    const id=++sequence;
    return new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{pending.delete(id);reject(Error('quota-timeout'));},25000);
      pending.set(id,{resolve,reject,timer:timeout});
      child.stdin.write(JSON.stringify({id,method,params})+'\n',error=>{if(error){clearTimeout(timeout);pending.delete(id);reject(Error('quota-write'));}});
    });
  }
  async function ensure(){
    if(disposed)throw Error('quota-disposed');if(ready)return ready;
    ready=(async()=>{
      fs.mkdirSync(root,{recursive:true});
      const clean={};for(const k of ['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','COMSPEC','PATHEXT','HTTP_PROXY','HTTPS_PROXY','NO_PROXY'])if(env[k])clean[k]=env[k];
      clean.CODEX_HOME=root;
      child=spawn(exe,['app-server','-c','model_provider="openai"','-c','cli_auth_credentials_store="file"'],{cwd:root,env:clean,windowsHide:true,stdio:['pipe','pipe','pipe']});
      child.stderr.on('data',()=>{});child.stdin.on('error',()=>{});
      child.on('error',()=>{phase='error';failPending();});
      child.on('exit',()=>{child=null;ready=null;buffer='';buckets=[];observedAt=0;loginId=null;phase='error';failPending();});
      child.stdout.on('data',chunk=>{
        buffer+=chunk.toString();if(buffer.length>2097152){buffer='';phase='error';child?.kill();return;}
        let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}
          if(message.id!=null&&pending.has(message.id)){const item=pending.get(message.id);pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(Error('quota-rpc')):item.resolve(message.result);}
          else if(message.method==='account/login/completed'&&loginId&&message.params?.loginId===loginId){loginId=null;phase=message.params.success?'checking':'error';if(message.params.success)void refresh(true);}
          else if(message.id!=null&&message.method)child?.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Unsupported'}})+'\n');
        }
      });
      await rpc('initialize',{clientInfo:{name:'fatfish_usage',version:'0.1.0'}});
      child.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');
    })();
    try{await ready;}catch{child?.kill();ready=null;throw Error('quota-start');}
  }
  function refresh(force=false){
    // Completion reports must await an overlapping periodic read, not reuse its old sample.
    if(refreshInFlight)return refreshInFlight;
    refreshInFlight=refreshOnce(force).finally(()=>{refreshInFlight=null;});
    return refreshInFlight;
  }
  async function refreshOnce(force){
    if(disposed||loginId)return;
    if(!fs.existsSync(authFile)){identity=null;phase='signed_out';return;}
    const air=readAir(),airKey=key(air);
    if(!force&&airKey===boundKey&&now()-lastRefresh<60000)return;
    lastRefresh=now();const ticket=generation;
    try{
      await ensure();const account=await rpc('account/read',{refreshToken:false});
      if(ticket!==generation||disposed)return;
      if(account?.account?.type!=='chatgpt'){phase='signed_out';identity=null;buckets=[];return;}
      identity=readIdentity();phase='ready';buckets=[];observedAt=0;if(boundKey!==airKey)accountRevision++;boundKey=airKey;
      const matching=matchAirAccount(air,identity);
      if(matching==='mismatch'){
        const mismatch=airKey+':'+identity.accountId+':'+identity.userIds.join(',');
        if(lastMismatch!==mismatch){lastMismatch=mismatch;onMismatch({kind:'account_mismatch',at:now(),count:1});}return;
      }
      if(matching!=='matched')return;
      lastMismatch='';const limits=await rpc('account/rateLimits/read');
      if(ticket!==generation||disposed||key(readAir())!==airKey||matchAirAccount(air,readIdentity())!=='matched')return;
      buckets=quotaBuckets(limits);observedAt=now();
    }catch{if(ticket===generation){phase='error';buckets=[];observedAt=0;}}
  }
  async function login(){
    if(disposed)throw Error('quota-disposed');generation++;buckets=[];observedAt=0;identity=null;lastMismatch='';
    await ensure();if(loginId){await rpc('account/login/cancel',{loginId});loginId=null;}
    const result=await rpc('account/login/start',{type:'chatgpt'});
    const url=new URL(result.authUrl);
    if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(url.hostname))throw Error('quota-login-origin');
    loginId=result.loginId;phase='pending';return {authUrl:result.authUrl};
  }
  function start(){if(timer)return;void refresh();timer=setInterval(()=>void refresh(),2000);timer.unref?.();}
  function dispose(){disposed=true;generation++;clearInterval(timer);failPending();child?.kill();child=null;}
  return {start,dispose,login,refresh,snapshot,summary,completionSummary,windows,presentation};
}
