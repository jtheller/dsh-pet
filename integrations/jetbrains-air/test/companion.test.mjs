import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCompanion,decodeCompanion} from '../src/companion.mjs';
import {decodeTheaterReply,decodeTheaterPlan} from '../src/theater.mjs';

function harness(options={}){
  let clock=1000000,active=1,visible=true,input=null;const shown=[],requests=[];
  const monitor={refreshCompletion:async()=>{},completionSummary:()=> 'Codex：5小时未知；7天已用20%，余80%。',summary:()=>`FACTS ${active}`,snapshot:()=>({activeSessions:active,pendingInput:input}),showNotice:(text,mood)=>shown.push({text,mood}),showAttention:(text,revision)=>shown.push({text,revision,mood:'waiting'}),clearNotice:()=>{}};
  monitor.quotaPresentation=()=>({kind:'quota',slot:4,at:clock,label:'5小时',usedPercent:80});
  const c=createCompanion({monitor,now:()=>clock,available:()=>visible,generate:async(e,f)=>{requests.push({e,f});return JSON.stringify({reply:'本鱼已就位。',mood:e.kind==='input_required'?'waiting':e.kind==='completed'?'success':'result'});},...options});
  return {c,monitor,shown,requests,idle:async()=>{active=0;await c.tick();clock+=2000;},advance:ms=>clock+=ms,setActive:n=>active=n,setInput:value=>input=value,hide:()=>visible=false,show:()=>visible=true,event:kind=>({kind,at:clock})};
}
test('urgent input bypasses completion-only and ordinary cooldown; late replies stop on resolution',async()=>{
  let finish;
  const h=harness({generate:()=>new Promise(resolve=>finish=resolve)});
  h.c.configure({mode:'until_complete',minutes:0});h.setInput({count:1,revision:1});
  assert.equal(h.c.canPresent(true),true);
  h.c.observe([{...h.event('input_required'),revision:1}]);const work=h.c.tick();
  finish('{"reply":"主人，该你出场啦！","mood":"waiting"}');await work;
  assert.equal(h.shown[0].mood,'waiting');assert.equal(h.c.context().policy.mode,'until_complete');
  h.setInput({count:1,revision:2});h.c.observe([{...h.event('input_required'),revision:2}]);const next=h.c.tick();
  h.setInput({count:0,revision:3});finish('{"reply":"回来看看！","mood":"waiting"}');await next;assert.equal(h.shown.length,1);
  h.c.configure({mode:'quiet',minutes:10});assert.equal(h.c.canPresent(true),false);
});

test('next completion is a one-shot after acceptance, bypasses chatter limits, and preserves the final group report',async()=>{
  const h=harness({hourlyLimit:0});h.setActive(3);
  h.c.observe([h.event('completed')]);h.c.configure({mode:'next_complete',minutes:0});
  assert.deepEqual(h.c.context().nextCompletion,{requestedAt:1000000,captured:false});
  h.c.observe([{kind:'completed',at:999999}]);await h.c.tick();assert.equal(h.shown.length,0,'delayed historical completion cannot fulfill a new request');
  h.advance(1);h.c.observe([h.event('completed'),h.event('completed')]);await h.c.tick();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].e.scope,'next');assert.equal(h.requests[0].e.count,1);
  assert.equal(h.c.context().nextCompletion,null);assert.equal(h.c.context().policy.mode,'normal');
  await h.c.tick();assert.equal(h.shown.length,1,'one-shot cannot replay while other tasks run');
  h.c.observe([h.event('completed')]);await h.idle();await h.c.tick();
  assert.equal(h.shown.length,2);assert.equal(h.requests[1].e.scope,undefined,'the settled group still reports normally');
});

test('next completion keeps the captured first event through chat, input, and new work during generation',async()=>{
  let finish;const seen=[];const h=harness({generate:async e=>{seen.push(e);return new Promise(r=>finish=r);}});
  h.c.configure({mode:'next_complete',minutes:0});h.c.observe([h.event('completed')]);
  const first=h.c.tick();await Promise.resolve();h.c.interrupt();
  finish('{"reply":"叫你回来看看啦。","mood":"result"}');await first;assert.equal(h.shown.length,0);
  h.c.observe([h.event('completed')]);h.advance(60000);h.setInput({count:1,revision:2});
  await h.c.tick();assert.equal(seen.length,1,'input takes priority even without a fresh input event');
  h.setInput({count:0,revision:3});const retry=h.c.tick();await Promise.resolve();
  h.setActive(4);h.c.observe([h.event('started')]);
  finish('{"reply":"答应你的，忙完一件就叫你。","mood":"result"}');await retry;
  assert.equal(h.shown.length,1);assert.equal(seen[1].at,seen[0].at);assert.equal(h.c.context().nextCompletion,null);
});

test('next completion can be replaced or cancelled without late replies consuming a newer promise',async()=>{
  for(const mode of ['normal','quiet','until_complete','next_complete']){
    let finish;const h=harness({generate:()=>new Promise(r=>finish=r)});
    h.c.configure({mode:'next_complete',minutes:0});h.c.observe([h.event('completed')]);const run=h.c.tick();await Promise.resolve();
    h.advance(1);h.c.configure({mode,minutes:mode==='quiet'?10:0});
    finish('{"reply":"回来看看吧。","mood":"result"}');await run;
    assert.equal(h.shown.length,0);assert.equal(h.c.context().nextCompletion?.captured,mode==='next_complete'?false:undefined);
  }
});

test('next completion fallback is held once, a lone final turn does not report twice, captured requests expire',async()=>{
  const h=harness({generate:async()=>{throw Error('offline');}}),kinds=[];
  h.monitor.showNotice=(text,mood,duration,expression,kind)=>{h.shown.push(text);kinds.push({duration,kind});};
  h.c.configure({mode:'next_complete',minutes:0});h.c.observe([h.event('completed')]);h.setActive(0);await h.c.tick();
  assert.deepEqual(kinds,[{duration:300000,kind:'next_completed'}]);assert.match(h.shown[0],/Codex/);
  h.advance(2000);await h.c.tick();assert.equal(h.shown.length,1);
  h.c.configure({mode:'next_complete',minutes:0});h.c.observe([h.event('completed')]);h.hide();h.advance(3600000);h.show();await h.c.tick();
  assert.equal(h.c.context().nextCompletion,null);assert.equal(h.shown.length,1);
});

test('next-completion intent is accepted by both tool and dedicated JSON protocols, with zero minutes only',()=>{
  const args={reply:'好，接下来谁先忙完我就叫你。',mode:'next_complete',minutes:0};
  const tool=decodeTheaterReply([{type:'tool-call',name:'pet_notify',arguments:JSON.stringify(args)}],{kind:'tool-calls'});
  const plan=decodeTheaterPlan([{type:'text',text:JSON.stringify({tool:'pet_notify',...args})}],{kind:'stop'});
  assert.deepEqual(tool,plan);assert.deepEqual(tool.policy,{mode:'next_complete',minutes:0});
  assert.throws(()=>decodeTheaterPlan([{type:'text',text:JSON.stringify({tool:'pet_notify',...args,minutes:5})}],{kind:'stop'}));
});
test('coalesces completion events, retains explanation, caps autonomous calls',async()=>{
  const h=harness({hourlyLimit:2});await h.idle();
  h.c.observe([h.event('usage'),h.event('completed'),h.event('completed')]);await h.c.tick();
  assert.equal(h.requests.length,1);assert.equal(h.requests[0].e.count,2);assert.equal(h.shown[0].mood,'success');
  assert.equal(h.shown[0].text,'本鱼已就位。\nCodex：5小时未知；7天已用20%，余80%。');assert.equal(h.c.context().lastNotice.facts,'FACTS 0');assert.equal(h.c.context().lastNotice.event.kind,'completed');
  h.c.observe([h.event('quota')]);await h.c.tick();assert.equal(h.requests.length,1);
  h.advance(300001);h.c.observe([h.event('quota')]);await h.c.tick();assert.equal(h.requests.length,2);
  h.advance(60001);h.c.observe([h.event('usage')]);await h.c.tick();assert.equal(h.requests.length,2);
});

test('every completion refreshes quota despite chatter budget/cooldown; failure still reports facts',async()=>{
  const h=harness({hourlyLimit:1});let reads=0;
  h.monitor.refreshCompletion=async()=>{reads++;};
  h.c.observe([h.event('usage')]);await h.c.tick();
  await h.idle();
  for(let i=0;i<3;i++){h.c.observe([h.event('completed')]);await h.c.tick();}
  assert.equal(reads,3);assert.equal(h.requests.length,4);assert.equal(h.shown.length,4);
  h.c.observe([h.event('usage')]);h.advance(60001);await h.c.tick();assert.equal(h.requests.length,4);
  const bad=harness({generate:async()=>{throw Error('unavailable');}});
  await bad.idle();
  bad.c.observe([bad.event('completed')]);await bad.c.tick();
  assert.equal(bad.shown[0].text,'Codex：5小时未知；7天已用20%，余80%。');
});

test('quota animation and numeric suffix use current verified window; late account changes discard the whole alert',async()=>{
  let finish;const h=harness({generate:()=>new Promise(resolve=>finish=resolve)});
  h.monitor.showNotice=(text,mood,duration,expression)=>h.shown.push({text,mood,duration,expression});
  h.c.observe([h.event('quota')]);const pending=h.c.tick();
  h.monitor.quotaPresentation=()=>null;finish('{"reply":"钱袋瘪了点啦。","mood":"result"}');await pending;assert.equal(h.shown.length,0);
  h.advance(300001);const visual={kind:'quota',slot:4,at:1000000,label:'7天',usedPercent:95};h.monitor.quotaPresentation=()=>visual;
  h.c.observe([h.event('quota')]);const next=h.c.tick();finish('{"reply":"本鱼替你捂紧钱袋！","mood":"result"}');await next;
  assert.equal(h.shown[0].expression,visual);assert.match(h.shown[0].text,/Codex 7天：已用95%，余5%/);assert.equal(h.shown[0].duration,10000);
});

test('completion waits for input resolution and manual chat, but explicit quiet discards it',async()=>{
  const h=harness();h.setInput({count:1,revision:1});
  h.c.observe([h.event('completed')]);await h.c.tick();assert.equal(h.shown.length,0);
  h.c.interrupt();h.advance(60001);await h.c.tick();assert.equal(h.shown.length,0);
  h.setInput({count:0,revision:2});await h.idle();await h.c.tick();assert.equal(h.shown.length,1);
  h.c.observe([h.event('completed')]);h.hide();await h.c.tick();h.show();await h.c.tick();assert.equal(h.shown.length,2);
  h.c.configure({mode:'quiet',minutes:1});h.c.observe([h.event('completed')]);h.advance(60001);await h.c.tick();assert.equal(h.shown.length,2);
});

test('completion reads current account after model delay and requeues when interrupted',async()=>{
  let finish,accountText='old',reads=0;
  const h=harness({generate:()=>new Promise(resolve=>finish=resolve)});
  h.monitor.refreshCompletion=async()=>{reads++;};h.monitor.completionSummary=()=>accountText;
  await h.idle();
  h.c.observe([h.event('completed')]);const first=h.c.tick();await Promise.resolve();
  h.c.interrupt();finish('{"reply":"忙完啦。","mood":"success"}');await first;assert.equal(h.shown.length,0);
  h.advance(60001);const second=h.c.tick();await Promise.resolve();accountText='Codex 余量未知：账号已切换。';
  finish('{"reply":"忙完啦。","mood":"success"}');await second;
  assert.equal(reads,2);assert.equal(h.shown[0].text,'忙完啦。\nCodex 余量未知：账号已切换。');
  await h.c.tick();assert.equal(h.shown.length,1);
});

test('new work during completion generation suppresses both successful and failed late reports',async()=>{
  for(const failure of [false,true]){
    let finish,fail;const h=harness({generate:()=>new Promise((resolve,reject)=>{finish=resolve;fail=reject;})});
    await h.idle();h.c.observe([h.event('completed')]);const first=h.c.tick();await Promise.resolve();
    h.setActive(1);h.c.observe([h.event('started')]);await h.c.tick();
    if(failure)fail(Error('offline'));else finish('{"reply":"忙完啦","mood":"success"}');
    await first;assert.equal(h.shown.length,0,'including fallback: no completion while another task runs');
    h.c.observe([h.event('completed')]);await h.c.tick();h.setActive(0);await h.c.tick();
    h.advance(1999);await h.c.tick();assert.equal(h.shown.length,0);
    h.advance(1);const next=h.c.tick();await Promise.resolve();finish('{"reply":"这阵忙完啦","mood":"success"}');await next;
    assert.equal(h.shown.length,1);assert.equal(h.c.context().lastNotice.event.count,2,'the suppressed report merges into the next settled group');
  }
});

test('parallel completions coalesce, queued starts restart idle grace, and input is still immediate',async()=>{
  const h=harness();h.setActive(2);h.c.observe([h.event('completed')]);await h.c.tick();assert.equal(h.requests.length,0);
  h.setActive(1);h.advance(10000);await h.c.tick();assert.equal(h.requests.length,0);
  h.setInput({count:1,revision:9});h.c.observe([{...h.event('input_required'),revision:9}]);await h.c.tick();
  assert.equal(h.shown[0].mood,'waiting');
  h.setInput({count:0,revision:10});h.setActive(0);h.c.observe([h.event('completed')]);await h.c.tick();
  h.advance(1999);await h.c.tick();assert.equal(h.requests.filter(r=>r.e.kind==='completed').length,0);
  h.setActive(1);h.c.observe([h.event('started')]);await h.c.tick();
  h.setActive(0);h.c.observe([h.event('completed')]);await h.c.tick();h.advance(2000);await h.c.tick();
  const completed=h.requests.filter(r=>r.e.kind==='completed');assert.equal(completed.length,1);assert.equal(completed[0].e.count,3);
});
test('quiet expires without replay; completion-only waits for the whole observed group to settle',async()=>{
  const h=harness();h.c.configure({mode:'quiet',minutes:1});
  h.c.observe([h.event('completed')]);await h.c.tick();assert.equal(h.requests.length,0);assert.equal(h.c.canPresent(),false);
  h.advance(60001);await h.c.tick();assert.equal(h.requests.length,0);assert.equal(h.c.canPresent(),true);
  h.c.configure({mode:'until_complete',minutes:0});
  assert.equal(h.c.canPresent(),true);assert.equal(h.c.canSpeak(),false);
  h.c.observe([h.event('usage'),h.event('completed')]);await h.c.tick();assert.equal(h.requests.length,0);
  await h.idle();await h.c.tick();assert.equal(h.requests.length,1);assert.equal(h.c.context().policy.mode,'normal');
});

test('explicit and subsequent normal completions keep model and fallback bubbles for five minutes',async()=>{
  for(const failure of [false,true]){
    const h=harness(failure?{generate:async()=>{throw Error('offline');}}:{}),durations=[];
    h.monitor.showNotice=(text,mood,duration)=>durations.push(duration);
    await h.idle();h.c.configure({mode:'until_complete',minutes:0});
    h.c.observe([h.event('completed')]);await h.c.tick();
    assert.deepEqual(durations,[300000]);assert.equal(h.c.context().policy.mode,'normal');
    h.advance(300001);h.c.observe([h.event('completed')]);await h.c.tick();assert.deepEqual(durations,[300000,300000]);
    assert.equal(h.c.context().lastNotice.durationMs,300000);
    assert.equal(h.c.context().lastNotice.expiresAt-h.c.context().lastNotice.at,300000);
  }
});

test('completion reading time starts after slow generation and optional chatter cannot replace it',async()=>{
  let h;h=harness({generate:async()=>{h.advance(30000);return '{"reply":"这一轮忙完啦。","mood":"success"}';}});
  await h.idle();h.c.configure({mode:'until_complete',minutes:0});h.c.observe([h.event('completed')]);await h.c.tick();
  h.advance(240000);h.c.observe([h.event('usage')]);await h.c.tick();assert.equal(h.shown.length,1);
  h.c.interrupt();assert.equal(h.c.canPresent(),true);assert.equal(h.c.canSpeak(),false);
});
test('manual chat yields while generating, then restores work after the actual ten-second reply',()=>{
  const h=harness();
  assert.equal(h.c.canPresent(),true);
  h.c.interrupt();
  assert.equal(h.c.canPresent(),true);assert.equal(h.c.canSpeak(),false);assert.equal(h.c.canSpeak(true),false);
  h.advance(59000);h.c.interrupt(10000);h.advance(9999);
  assert.equal(h.c.canPresent(),true);assert.equal(h.c.canSpeak(),false);
  h.advance(1);assert.equal(h.c.canSpeak(),true);assert.equal(h.c.canSpeak(true),true);
  h.c.configure({mode:'quiet',minutes:10});h.c.interrupt();h.advance(60000);
  assert.equal(h.c.canPresent(),false);
});

test('late generated reply is discarded after user interruption, hide or disposal',async()=>{
  for(const action of ['interrupt','hide','dispose']){
    let finish;const h=harness({generate:()=>new Promise(resolve=>finish=resolve)});
    h.c.observe([h.event('started')]);const work=h.c.tick();
    if(action==='hide')h.hide();else h.c[action]();
    finish('{"reply":"来了。","mood":"working"}');await work;assert.equal(h.shown.length,0);
  }
});
test('invalid model expression retains original renderer fallback without dumping facts',async()=>{
  for(const text of ['{"reply":"剩余99%","mood":"result"}','{"reply":"完成了","mood":"success"}','{"reply":"走了","mood":"result","tool":"pet_hide"}'])assert.throws(()=>decodeCompanion(text,'usage'));
  const h=harness({generate:async()=>{throw Error('provider failed');}});h.c.observe([h.event('usage')]);await h.c.tick();
  assert.equal(h.shown.length,0);assert.ok(h.c.context().lastError);
});
test('monitor tools strictly validate quiet bounds and dedicated plan fallback',()=>{
  const scoped=decodeTheaterPlan([{type:'text',text:JSON.stringify({tool:'pet_status',reply:'给你看看。',topic:'tokens'})}],{kind:'stop'});
  assert.equal(scoped.topic,'tokens');
  assert.throws(()=>decodeTheaterReply([{type:'tool-call',name:'pet_status',arguments:JSON.stringify({reply:'x',topic:'shell'})}],{kind:'stop'}));
  const status=details=>decodeTheaterReply([{type:'tool-call',name:'pet_status',arguments:JSON.stringify({reply:'给你看看~',details})}],{kind:'tool-calls'});
  assert.equal(status(true).details,true);assert.equal(status(false).details,undefined);assert.throws(()=>status('true'));
  assert.equal(decodeTheaterPlan([{type:'text',text:'{"tool":"pet_status","reply":"看看明细~","details":true}'}],{kind:'stop'}).details,true);
  const decode=p=>decodeTheaterReply([{type:'tool-call',name:'pet_notify',arguments:JSON.stringify(p)}],{kind:'tool-calls'});
  assert.deepEqual(decode({reply:'先安静半小时。',mode:'quiet',minutes:30}).policy,{mode:'quiet',minutes:30});
  for(const p of [{mode:'quiet',minutes:0},{mode:'quiet',minutes:1441},{mode:'quiet',minutes:1.5},{mode:'normal',minutes:30},{mode:'shell',minutes:0},{mode:'quiet',minutes:10,command:'x'}])assert.throws(()=>decode({reply:'x',...p}));
  assert.equal(decodeTheaterPlan([{type:'text',text:'{"tool":"pet_notify","reply":"完成再叫你。","mode":"until_complete","minutes":0}'}],{kind:'stop'}).policy.mode,'until_complete');
});

test('account mismatch uses waiting expression and discards a late complaint after correction',async()=>{
  let account={state:'mismatch'},finish;const shown=[];
  const monitor={clearNotice(){},summary:()=> '账号不一致',snapshot:()=>({activeSessions:1,account}),showNotice:(text,mood)=>shown.push({text,mood})};
  const c=createCompanion({monitor,generate:()=>new Promise(r=>finish=r)});
  c.observe([{kind:'account_mismatch',at:Date.now()}]);const first=c.tick();finish('{"reply":"哼，选错号啦，再来一次！","mood":"waiting"}');await first;
  assert.deepEqual(shown,[{text:'哼，选错号啦，再来一次！',mood:'waiting'}]);
  c.observe([{kind:'account_mismatch',at:Date.now()}]);const second=c.tick();account={state:'matched'};finish('{"reply":"再选一次嘛！","mood":"waiting"}');await second;
  assert.equal(shown.length,1);c.dispose();
});
