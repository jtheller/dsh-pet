import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {matchAirAccount,quotaBuckets,createCodexQuota,quotaResetText} from '../src/codex-quota.mjs';

test('account equality requires account and user identity; reserve is never ordinary quota',()=>{
  assert.equal(matchAirAccount({accountId:'a',userId:'u'},{accountId:'a',userIds:['u']}),'matched');
  assert.equal(matchAirAccount({accountId:'a',userId:'u'},{accountId:'b',userIds:['u']}),'mismatch');
  assert.equal(matchAirAccount({accountId:'a',userId:'u'},{accountId:'a',userIds:['v']}),'mismatch');
  assert.equal(matchAirAccount(null,{accountId:'a',userIds:['u']}),'air_unknown');
  assert.equal(matchAirAccount({accountId:'a',userId:'u'},null),'identity_unknown');
  const buckets=quotaBuckets({rateLimitsByLimitId:{reserve:{limitId:'base_model_inference',limitName:'gpt-reserve',primary:{usedPercent:0,windowDurationMins:10080}},codex:{limitId:'codex',primary:{usedPercent:101,windowDurationMins:300}}}});
  assert.equal(buckets[0].id,'base_model_inference');assert.equal(buckets[1].primary,null);
});

function harness(limits){
 let air={type:'has_account',account:{accountId:'a',userId:'u',email:'air@example.test'}},clock=1000000,auth=false,authorized='a',calls=[],children=[],mismatches=[];
 const token=()=>Buffer.from(JSON.stringify({sub:'u',email:'web@example.test','https://api.openai.com/auth':{chatgpt_account_id:authorized,chatgpt_user_id:'u'}})).toString('base64url');
 const files={existsSync:()=>auth,mkdirSync(){},readFileSync(file){return JSON.stringify(file==='air'?air:{tokens:{account_id:authorized,id_token:'x.'+token()+'.secret'}});}};
 const q=createCodexQuota({root:'isolated',airFile:'air',exe:'codex',join:(...p)=>p.join('/'),fs:files,now:()=>clock,env:{PATH:'system',OPENAI_API_KEY:'private',CODEX_HOME:'other-account'},onMismatch:e=>mismatches.push(e),spawn(exe,args,options){
   assert.equal(options.env.CODEX_HOME,'isolated');assert.equal(options.env.OPENAI_API_KEY,undefined);assert.equal(options.windowsHide,true);assert.ok(args.includes('cli_auth_credentials_store="file"'));
   const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.write=(line,cb)=>{const m=JSON.parse(line);calls.push(m.method);if(!m.id)return;
     let result={};if(m.method==='account/read')result={account:{type:'chatgpt',email:'web@example.test'}};
     if(m.method==='account/login/start')result={loginId:'login',authUrl:'https://auth.openai.com/authorize?state=private'};
     if(m.method==='account/rateLimits/read')result={rateLimitsByLimitId:{codex:limits??{limitId:'codex',primary:{usedPercent:27,windowDurationMins:300,resetsAt:9999999},secondary:{usedPercent:8,windowDurationMins:10080,resetsAt:9999999}}}};
     queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify({id:m.id,result})+'\n'));cb?.();});
   };child.kill=()=>child.emit('exit');children.push(child);return child;
 }});
 return {q,calls,mismatches,children,setAuth:v=>auth=v,setAuthorized:v=>authorized=v,setAir:v=>air=v,advance:ms=>clock+=ms};
}
test('isolated login is explicit, matching gates reads, switching Air instantly removes cached limits',async()=>{
 const h=harness();try{
   await h.q.refresh();assert.equal(h.children.length,0);assert.equal(h.q.snapshot().state,'signed_out');
   const login=await h.q.login();assert.match(login.authUrl,/auth.openai.com/);assert.equal(h.q.snapshot().state,'pending');
   h.setAuth(true);h.children[0].stdout.emit('data',Buffer.from(JSON.stringify({method:'account/login/completed',params:{loginId:'login',success:true}})+'\n'));
   await new Promise(r=>setImmediate(r));assert.equal(h.q.snapshot().state,'matched');assert.match(h.q.summary(),/剩余 73%/);
   const visual=h.q.presentation();assert.equal(visual.slot,1);assert.equal(visual.label,'5小时');assert.equal(visual.usedPercent,27);
   assert.ok(h.q.presentation({...visual,level:20}));assert.equal(h.q.presentation({...visual,accountRevision:visual.accountRevision+1}),null);
   assert.doesNotMatch(JSON.stringify(h.q.snapshot()),/secret|private|accountId|userIds/);
   const reads=h.calls.filter(m=>m==='account/rateLimits/read').length;
   h.setAir({type:'has_account',account:{accountId:'other',userId:'u',email:'other@example.test'}});
   assert.equal(h.q.snapshot().state,'mismatch');assert.deepEqual(h.q.snapshot().buckets,[]);
   assert.equal(h.q.presentation(),null);assert.equal(h.q.presentation(visual),null);assert.deepEqual(h.q.windows(),[]);
   await h.q.refresh();assert.equal(h.mismatches.length,1);assert.equal(h.calls.filter(m=>m==='account/rateLimits/read').length,reads);
   h.advance(61000);await h.q.refresh();assert.equal(h.mismatches.length,1);
   h.setAir(null);await h.q.refresh(true);assert.equal(h.q.snapshot().state,'air_unknown');assert.equal(h.mismatches.length,1);
 }finally{h.q.dispose();}
});
test('unknown identity and expired samples never become zero percent remaining',async()=>{
 const h=harness();try{h.setAuth(true);await h.q.refresh();h.advance(300001);assert.deepEqual(h.q.snapshot().buckets,[]);assert.match(h.q.summary(),/未知/);assert.doesNotMatch(h.q.summary(),/剩余 100%/);}finally{h.q.dispose();}
});

test('completion waits for an overlapping refresh; concise numbers remain account bound',async()=>{
 const h=harness();try{
   h.setAuth(true);const first=h.q.refresh();const second=h.q.refresh(true);
   assert.equal(first,second);await second;
   assert.equal(h.calls.filter(m=>m==='account/rateLimits/read').length,1);
   assert.equal(h.q.completionSummary(),'Codex：5小时已用27%，余73%；7天已用8%，余92%。');
   await h.q.refresh(true);assert.equal(h.calls.filter(m=>m==='account/rateLimits/read').length,2);
   h.advance(300001);assert.doesNotMatch(h.q.completionSummary(),/73|92|100%/);assert.match(h.q.completionSummary(),/未知/);
   h.setAir({type:'has_account',account:{accountId:'other',userId:'u'}});assert.match(h.q.completionSummary(),/不一致/);
 }finally{h.q.dispose();}
});

test('quota queries show separate live countdowns, never invent a reset for missing or expired data',async()=>{
 const h=harness({limitId:'codex',primary:{usedPercent:30,windowDurationMins:300,resetsAt:1000+3660},secondary:{usedPercent:76,windowDurationMins:10080,resetsAt:1000+2*86400+3*3600}});
 try{
  h.setAuth(true);await h.q.refresh();
  assert.match(h.q.summary(),/5小时：[^\n]*约1小时1分钟后重置/);
  assert.match(h.q.summary(),/7天：[^\n]*约2天3小时后重置/);
  h.advance(60000);assert.match(h.q.summary(),/5小时：[^\n]*约1小时后重置/);
  h.advance(300001);assert.doesNotMatch(h.q.summary(),/后重置/,'stale reads must not expose a countdown');
  h.setAir({type:'has_account',account:{accountId:'other',userId:'u'}});assert.doesNotMatch(h.q.summary(),/后重置/);
 }finally{h.q.dispose();}
 const missing=harness({limitId:'codex',secondary:{usedPercent:76,windowDurationMins:10080}});
 try{missing.setAuth(true);await missing.q.refresh();assert.match(missing.q.summary(),/7天：[^\n]*剩余 24%；重置时间未知/);assert.match(missing.q.summary(),/5小时：未知/);}finally{missing.q.dispose();}
 assert.equal(quotaResetText(1030,1000000),'不到1分钟后重置');
 assert.equal(quotaResetText(1061,1000000),'约2分钟后重置');
 for(const value of [null,undefined,NaN,0,999,1000])assert.equal(quotaResetText(value,1000000),'重置时间未知');
});
