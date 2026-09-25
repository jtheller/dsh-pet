import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as io from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createUsageMonitor} from '../src/usage-monitor.mjs';
import {createCompanion} from '../src/companion.mjs';
import {fatfishWorkView,fatfishWorkText,fatfishWorkMetadata} from '../src/touch.mjs';

test('Air working quota decorates only ordinary work text, preserving notices, state and lifecycle',async t=>{
 let lifecycle={running:1,count:0,revision:0},windows=[{label:'7天',usedPercent:76}],present=true,speak=true;
 const f=await fixture(t,'air',{attention:{snapshot:()=>lifecycle},quota:{windows:()=>windows,snapshot:()=>({state:'matched'})},canPresent:()=>present,canSpeak:()=>speak});
 await f.monitor.poll();const native={state:null,ts:0},memory={defaultText:'我在忙呢'};
 let snapshot=f.monitor.prefer(native),view=fatfishWorkView(snapshot,memory,f.now());
 assert.equal(snapshot.state,'working','already-running Air is sufficient');
 assert.equal(fatfishWorkMetadata(snapshot).fatfishWorkingQuota,'Codex 7天还剩 24%');
 assert.equal(fatfishWorkText(view,memory.defaultText),'我在忙呢\nCodex 7天还剩 24%');
 const oldTs=snapshot.ts;windows=[{label:'5小时',usedPercent:12.5},{label:'7天',usedPercent:78}];f.advance(60000);
 snapshot=f.monitor.prefer(native);view=fatfishWorkView(snapshot,memory,f.now());
 assert.ok(snapshot.ts>oldTs);assert.equal(view.animate,false);assert.equal(view.until,0);
 assert.equal(fatfishWorkText(view,memory.defaultText),'我在忙呢\nCodex 5小时还剩 87.5% · 7天还剩 22%');
 f.monitor.showNotice('下一个做完了','result',300000,null,'next_completed');
 snapshot=f.monitor.prefer(native);const deadline=snapshot.fatfishNoticeUntil;
 assert.equal(fatfishWorkText(fatfishWorkView(snapshot,memory,f.now()),memory.defaultText),'下一个做完了');
 windows=[];f.advance(1000);snapshot=f.monitor.prefer(native);assert.equal(snapshot.fatfishNoticeUntil,deadline);
 memory.dismissed=deadline;view=fatfishWorkView(snapshot,memory,f.now());assert.equal(fatfishWorkText(view,memory.defaultText),'我在忙呢\nCodex 余量暂时未知');
 speak=false;assert.equal(fatfishWorkView(f.monitor.prefer(native),memory,f.now()).visible,false,'chat/quiet bubble mute unchanged');speak=true;
 lifecycle={running:1,count:1,revision:1};snapshot=f.monitor.prefer(native);assert.equal(snapshot.state,'waiting');assert.equal(snapshot.fatfishWorkingQuota,undefined);
 lifecycle={running:0,count:0,revision:2};f.monitor.clearNotice();snapshot=f.monitor.prefer(native);assert.equal(snapshot.state,null);assert.equal(snapshot.fatfishWorkingQuota,undefined);
 lifecycle.running=1;present=false;assert.equal(f.monitor.prefer(native),native,'explicit ignore Air unchanged');
});

test('queued turns defer completion until settled and a new task retires the report for both policies',async t=>{
  for(const mode of ['normal','until_complete']){
    const events=[],requests=[];let companion;
    const f=await fixture(t,'air',{onEvents:batch=>events.push(...batch),canPresent:()=>companion.canPresent(),canSpeak:input=>companion.canSpeak(input)});
    companion=createCompanion({monitor:f.monitor,now:f.now,generate:async event=>{requests.push(event);return JSON.stringify({reply:'Observed group finished',mood:event.kind==='completed'?'success':'result'});}});
    t.after(()=>companion.dispose());companion.configure({mode,minutes:0});await f.monitor.poll();
    const idle={state:null,ts:0};
    await f.append('task_started',{turn_id:'a'});await f.monitor.poll();
    assert.equal(f.monitor.prefer(idle).state,'working');
    assert.equal(f.monitor.prefer(idle).fatfishBubbleMuted,mode==='until_complete');
    await f.append('task_complete',{turn_id:'a'});await f.append('task_started',{turn_id:'b'});
    await f.append('task_complete',{turn_id:'a'});
    await f.monitor.poll();companion.observe(events.splice(0));await companion.tick();
    f.advance(20000);await companion.tick();
    assert.equal(f.monitor.prefer(idle).state,'working');assert.equal(requests.filter(e=>e.kind==='completed').length,0);
    await f.append('task_complete',{turn_id:'b'});await f.monitor.poll();companion.observe(events.splice(0));await companion.tick();
    f.advance(1999);await companion.tick();assert.equal(requests.filter(e=>e.kind==='completed').length,0);
    assert.equal(f.monitor.prefer(idle).state,null,'raw finish does not independently announce success during queue grace');
    f.advance(1);await companion.tick();
    assert.equal(requests.filter(e=>e.kind==='completed').length,1);assert.equal(requests.at(-1).count,2);
    const held=f.monitor.prefer(idle);assert.match(held.task,/Observed group/);assert.equal(held.fatfishNoticeUntil-f.now(),300000);assert.equal(held.state,'success');
    assert.equal(companion.context().policy.mode,'normal');
    await f.append('task_started',{turn_id:'c'});await f.monitor.poll();companion.observe(events.splice(0));await companion.tick();
    const next=f.monitor.prefer(idle);assert.equal(next.state,'working');assert.equal(next.task,null);assert.equal(next.fatfishNoticeUntil,undefined);
    companion.interrupt(10000);assert.equal(f.monitor.prefer(idle).fatfishBubbleMuted,true);
    f.advance(10000);assert.equal(f.monitor.prefer(idle).fatfishBubbleMuted,false,'timer alone restores speech without progress');
    companion.configure({mode:'quiet',minutes:1});assert.equal(f.monitor.prefer(idle),idle);
    f.advance(60001);assert.equal(f.monitor.prefer(idle).state,'working');
  }
});

test('live lifecycle running keeps long work visible without fabricating token freshness',async t=>{
  let lifecycle={running:1,count:0,revision:0};
  const f=await fixture(t,'air',{attention:{snapshot:()=>lifecycle}});await f.monitor.poll();
  f.advance(600000);const idle={state:null,ts:0};
  assert.equal(f.monitor.prefer(idle).state,'working');assert.equal(f.monitor.snapshot().stale,true);
  lifecycle={running:0,count:0,revision:0};assert.equal(f.monitor.prefer(idle).state,null);
});

async function fixture(t,originator='air',options={}){
  const root=await io.mkdtemp(join(tmpdir(),'fatfish-usage-'));
  let clock=Date.now();const date=new Date(clock);
  const folder=join(root,String(date.getFullYear()),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0'));
  await io.mkdir(folder,{recursive:true});const file=join(folder,'rollout-test.jsonl');
  await io.writeFile(file,JSON.stringify({type:'session_meta',payload:{originator,base_instructions:'PRIVATE'}})+'\n');
  const monitor=createUsageMonitor({root,io,join,now:()=>clock,...options});
  t.after(async()=>{monitor.dispose();await io.rm(root,{recursive:true,force:true});});
  const event=(type,extra={})=>JSON.stringify({timestamp:new Date(clock).toISOString(),type:'event_msg',payload:{type,...extra}})+'\n';
  return {monitor,file,event,now:()=>clock,advance:ms=>clock+=ms,append:async(type,p)=>io.appendFile(file,event(type,p))};
}
const usage={info:{last_token_usage:{input_tokens:100,cached_input_tokens:80,output_tokens:20,total_tokens:120}},rate_limits:{limit_id:'codex',primary:{used_percent:45,window_minutes:300}}};

test('requested next completion stays working and holds across progress, new work, chat and input; final group can supersede it',async t=>{
  const events=[],calls=[];let lifecycle={running:2,count:0,revision:0},c;
  const f=await fixture(t,'air',{onEvents:batch=>events.push(...batch),attention:{snapshot:()=>lifecycle},canPresent:()=>c.canPresent(),canSpeak:input=>c.canSpeak(input)});
  c=createCompanion({monitor:f.monitor,now:f.now,generate:async e=>{calls.push(e);return JSON.stringify({reply:e.kind==='input_required'?'主人，该你啦。':'答应你的，忙完一件就叫你。',mood:e.kind==='input_required'?'waiting':'result'});}});
  t.after(()=>c.dispose());await f.monitor.poll();events.splice(0);c.configure({mode:'next_complete',minutes:0});
  f.advance(1);await f.append('task_started',{turn_id:'a'});await f.append('task_complete',{turn_id:'a'});await f.monitor.poll();
  c.observe(events.splice(0));await c.tick();const idle={state:null,ts:0},first=f.monitor.prefer(idle),deadline=first.fatfishNoticeUntil;
  assert.equal(first.state,'working');assert.equal(deadline-f.now(),300000);assert.equal(calls[0].scope,'next');
  f.advance(60001);await f.append('task_started',{turn_id:'b'});await f.monitor.poll();c.observe(events.splice(0));await c.tick();
  assert.equal(f.monitor.prefer(idle).task,first.task);assert.equal(f.monitor.prefer(idle).fatfishNoticeUntil,deadline);assert.equal(calls.length,1);
  c.interrupt();assert.equal(f.monitor.prefer(idle).fatfishBubbleMuted,true);c.interrupt(10000);f.advance(10000);
  assert.equal(f.monitor.prefer(idle).fatfishBubbleMuted,false);assert.equal(f.monitor.prefer(idle).task,first.task);
  lifecycle={running:2,count:1,revision:1};await f.monitor.poll();c.observe(events.splice(0));await c.tick();
  assert.equal(f.monitor.prefer(idle).state,'waiting');assert.equal(f.monitor.prefer(idle).fatfishNoticeUntil,undefined);
  lifecycle={running:2,count:0,revision:2};await f.monitor.poll();c.observe(events.splice(0));await c.tick();
  assert.equal(f.monitor.prefer(idle).state,'working');assert.equal(f.monitor.prefer(idle).task,first.task);assert.equal(f.monitor.prefer(idle).fatfishNoticeUntil,deadline);
  lifecycle={running:0,count:0,revision:2};await f.append('task_complete',{turn_id:'b'});await f.monitor.poll();c.observe(events.splice(0));await c.tick();f.advance(2000);await c.tick();
  assert.equal(f.monitor.prefer(idle).state,'success');assert.equal(calls.at(-1).scope,undefined,'a later final group reports normally');
});

test('next notice never claims global success, expires at the original deadline and explicit reset clears it',async t=>{
  let lifecycle={running:1,count:0,revision:0};const f=await fixture(t,'air',{attention:{snapshot:()=>lifecycle}});await f.monitor.poll();
  const idle={state:null,ts:0};f.monitor.showNotice('requested report','success',300000,null,'next_completed');const first=f.monitor.prefer(idle);
  f.advance(299999);assert.equal(f.monitor.prefer(idle).state,'working');assert.equal(f.monitor.prefer(idle).fatfishNoticeUntil,first.fatfishNoticeUntil);
  lifecycle={running:0,count:0,revision:0};assert.equal(f.monitor.prefer(idle).state,null);
  f.advance(1);assert.equal(f.monitor.hasNextNotice(),false);assert.equal(f.monitor.prefer(idle).task,null);
  f.monitor.showNotice('again','result',300000,null,'next_completed');f.monitor.clearNotice(true);assert.equal(f.monitor.hasNextNotice(),true);
  f.monitor.clearNotice();assert.equal(f.monitor.hasNextNotice(),false);
});
test('structured notifications only for new events; quota crossings deduplicate and quiet gates presentation',async t=>{
  const events=[];let present=true,percent=45;
  const quota={snapshot:()=>null,summary:()=>'',windows:()=>[{accountRevision:1,windowMinutes:300,resetsAt:9999999999,usedPercent:percent}]};
  const f=await fixture(t,'air',{onEvents:batch=>events.push(...batch),canPresent:()=>present,quota});
  await f.append('task_complete',{turn_id:'old'});await f.monitor.poll();assert.deepEqual(events,[]);
  await f.append('task_started',{turn_id:'new'});await f.monitor.poll();assert.ok(events.some(e=>e.kind==='started'));
  const high={...usage,rate_limits:{limit_id:'codex',primary:{used_percent:96,window_minutes:300}}};
  await f.append('token_count',high);await f.monitor.poll();assert.equal(events.filter(e=>e.kind==='quota').length,0,'unbound log percentages cannot trigger account alerts');
  percent=96;await f.monitor.poll();await f.monitor.poll();assert.equal(events.filter(e=>e.kind==='quota').length,1);
  f.monitor.showNotice('model expression','result');assert.equal(f.monitor.prefer({state:null,ts:0}).task,'model expression');
  present=false;const native={state:null,ts:0};assert.equal(f.monitor.prefer(native),native);
});
test('Air activity, quota identities, partial records, completion and privacy',async t=>{
  const f=await fixture(t);await f.monitor.poll();
  await f.append('task_started',{turn_id:'a'});
  const line=f.event('token_count',usage);await io.appendFile(f.file,line.slice(0,-8));await f.monitor.poll();
  assert.equal(f.monitor.snapshot().buckets.length,0);
  await io.appendFile(f.file,line.slice(-8));await f.monitor.poll();
  assert.equal(f.monitor.snapshot().activeSessions,1);
  assert.equal(f.monitor.snapshot().lastRequest.total,120);
  assert.equal(f.monitor.snapshot().buckets[0].primary.usedPercent,45);
  await f.append('token_count',{...usage,rate_limits:{limit_id:'reserve',primary:{used_percent:0,window_minutes:10080}}});await f.monitor.poll();
  assert.equal(f.monitor.snapshot().buckets.length,2);
  assert.match(f.monitor.summary(),/账号额度未知/);
  assert.doesNotMatch(f.monitor.summary(),/45%|0%/);
  assert.match(f.monitor.summary('tokens'),/输入 100.*输出 20/);
  assert.doesNotMatch(f.monitor.summary('tokens'),/账号|额度/);
  assert.match(f.monitor.summary('quota'),/额度未知/);
  assert.doesNotMatch(f.monitor.summary('quota'),/最近请求|输入 100/);
  const native={state:'thinking',task:'DSH',ts:1};assert.equal(f.monitor.prefer(native).state,'working','actual Air work wins while active');
  await f.append('task_complete',{turn_id:'a',last_agent_message:'PRIVATE'});await f.monitor.poll();
  assert.equal(f.monitor.snapshot().activeSessions,0);
  assert.equal(f.monitor.prefer({state:null,ts:0}).state,null,'only the settled companion report announces completion');
  assert.ok(!JSON.stringify(f.monitor.snapshot()).includes('PRIVATE'));
  f.advance(310000);assert.ok(f.monitor.snapshot().buckets.every(b=>b.stale));
  assert.match(f.monitor.summary(),/额度未知/);
});

test('verified thresholds are account/reset bound, unknown does not mean zero, and stale quota notices yield to live work',async t=>{
  const events=[];let windows=[{accountRevision:1,windowMinutes:300,resetsAt:999999,usedPercent:79}],valid=true;
  const quota={snapshot:()=>null,summary:()=>'',windows:()=>windows,presentation:()=>valid?{kind:'quota'}:null};
  const f=await fixture(t,'air',{quota,onEvents:batch=>events.push(...batch)});await f.monitor.poll();
  const count=()=>events.filter(e=>e.kind==='quota').length;
  windows[0].usedPercent=80;await f.monitor.poll();assert.equal(count(),1);
  windows=[];await f.monitor.poll();assert.equal(count(),1);
  windows=[{accountRevision:1,windowMinutes:300,resetsAt:999999,usedPercent:80}];await f.monitor.poll();assert.equal(count(),1);
  windows[0].usedPercent=95;await f.monitor.poll();await f.monitor.poll();assert.equal(count(),2);
  windows[0].accountRevision=2;await f.monitor.poll();assert.equal(count(),2);
  windows[0].resetsAt=1999999;await f.monitor.poll();assert.equal(count(),2);
  await f.append('task_started',{turn_id:'new'});await f.monitor.poll();
  f.monitor.showNotice('old account quota','result',10000,{kind:'quota',at:f.now(),slot:4});
  assert.equal(f.monitor.prefer({state:null}).fatfishExpression.slot,4);
  valid=false;const view=f.monitor.prefer({state:null});assert.equal(view.state,'working');assert.equal(view.task,null);assert.equal(view.fatfishExpression,undefined);
});

test('completion events deduplicate within a turn and refresh uses the existing quota provider',async t=>{
  const events=[],reads=[];
  const f=await fixture(t,'air',{onEvents:batch=>events.push(...batch),quota:{snapshot:()=>null,refresh:async force=>reads.push(force),completionSummary:()=> 'verified quota'}});
  await f.monitor.poll();
  for(const turn of ['a','b']){
    await f.append('task_started',{turn_id:turn});
    await f.append('task_complete',{turn_id:turn});await f.append('task_complete',{turn_id:turn});await f.monitor.poll();
  }
  assert.equal(events.filter(e=>e.kind==='completed').length,2);
  await f.monitor.refreshCompletion();assert.deepEqual(reads,[true]);assert.equal(f.monitor.completionSummary(),'verified quota');
});
test('ignores other clients and does not replay historical completions',async t=>{
  const f=await fixture(t,'cli');await f.append('token_count',usage);await f.monitor.poll();assert.equal(f.monitor.snapshot().activeSessions,0);
  const a=await fixture(t);await a.append('task_complete',{turn_id:'old'});await a.monitor.poll();
  const idle={state:null,ts:0};assert.equal(a.monitor.prefer(idle).state,null);assert.equal(a.monitor.prefer(idle).task,null);
});
test('silent sessions become unknown, and disposal stops reads',async t=>{
  const f=await fixture(t);await f.append('task_started',{turn_id:'a'});await f.monitor.poll();
  assert.equal(f.monitor.snapshot().activeSessions,1);f.advance(121000);assert.equal(f.monitor.snapshot().activeSessions,0);
  f.monitor.dispose();await f.append('token_count',usage);await f.monitor.poll();assert.equal(f.monitor.snapshot().lastRequest,null);
});

test('held completion deadline is stable, bounded, expires and yields to native work or chat',async t=>{
  let present=true;const f=await fixture(t,'air',{canPresent:()=>present});await f.monitor.poll();
  const idle={state:null,task:null,ts:0};
  f.monitor.showNotice('Complete','success',300000);
  const first=f.monitor.prefer(idle);assert.ok(first.fatfishNoticeUntil);
  f.advance(11000);assert.deepEqual(f.monitor.prefer(idle),first);
  present=false;assert.deepEqual(f.monitor.prefer(idle),idle);present=true;
  const native={state:'waiting',task:'Native input',ts:1};assert.deepEqual(f.monitor.prefer(native),native);
  f.advance(288000);assert.deepEqual(f.monitor.prefer(idle),first);
  f.advance(1000);assert.equal(f.monitor.prefer(idle).task,null);
  f.monitor.showNotice('Complete','success',999999);f.advance(300000);assert.equal(f.monitor.prefer(idle).task,null);
  f.monitor.showNotice('Complete','success',300000);f.monitor.clearNotice();assert.equal(f.monitor.prefer(idle).task,null);
});

test('normal completion stays for five minutes while idle, then yields to a new Air task',async t=>{
  const events=[];const f=await fixture(t,'air',{onEvents:batch=>events.push(...batch)});
  const c=createCompanion({monitor:f.monitor,now:f.now,generate:async()=>'{"reply":"这一轮忙完啦。","mood":"success"}'});
  t.after(()=>c.dispose());await f.monitor.poll();
  assert.equal(c.context().policy.mode,'normal');
  await f.append('task_started',{turn_id:'a'});await f.append('task_complete',{turn_id:'a'});await f.monitor.poll();
  c.observe(events.splice(0));await c.tick();f.advance(2000);await c.tick();
  const idle={state:null,task:null,ts:0},notice=f.monitor.prefer(idle);
  assert.equal(notice.fatfishNoticeUntil-f.now(),300000);assert.match(notice.task,/这一轮忙完啦/);
  f.advance(11000);assert.equal(f.monitor.prefer(idle).task,notice.task);assert.equal(f.monitor.prefer(idle).state,null,'completion animation ends before its bubble');
  f.advance(60000);await f.append('task_started',{turn_id:'b'});await f.monitor.poll();c.observe(events.splice(0));await c.tick();
  const next=f.monitor.prefer(idle);
  assert.equal(next.state,'working');assert.equal(next.task,null);assert.equal(next.fatfishNoticeUntil,undefined);
  f.advance(228999);assert.notEqual(f.monitor.prefer(idle).task,notice.task);
});
