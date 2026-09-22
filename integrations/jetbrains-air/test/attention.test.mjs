import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as io from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAttentionMonitor,parseAirLifecycle} from '../src/attention.mjs';
import {createUsageMonitor} from '../src/usage-monitor.mjs';

const id='77beba18-d3f8-42ac-9cf0-2b45155bba8f';

test('running survives Air log rotation and restart; unread terminal records in the archive are consumed',async t=>{
  const dir=await io.mkdtemp(join(tmpdir(),'fatfish-rotation-')),file=join(dir,'air.log'),previous=join(dir,'air1.log');
  let now=Date.now();const make=()=>createAttentionMonitor({file,io,now:()=>now,isAlive:()=>true});
  const m=make();let restarted;
  t.after(async()=>{m.dispose();restarted?.dispose();await io.rm(dir,{recursive:true,force:true});});
  await io.writeFile(file,line(now-600000,'Running')+('x'.repeat(2048)+'\n').repeat(1100));
  await m.poll();assert.equal(m.snapshot().running,1,'startup sees Running older than the last 2 MiB');
  await io.rename(file,previous);await io.writeFile(file,'');await m.poll();assert.equal(m.snapshot().running,1);
  restarted=make();await restarted.poll();assert.equal(restarted.snapshot().running,1,'restart after rotation recovers the live task');
  await io.appendFile(file,line(++now,'Finished'));await restarted.poll();assert.equal(restarted.snapshot().running,0);
  // The first monitor has not read Finished; a second rotation must not leave it running.
  await io.unlink(previous);await io.rename(file,previous);await io.writeFile(file,'');await m.poll();assert.equal(m.snapshot().running,0);
});

test('recovers live running at startup, keeps long work, and accepts same-millisecond queued transitions',async t=>{
  const dir=await io.mkdtemp(join(tmpdir(),'fatfish-lifecycle-')),file=join(dir,'air.log');
  let now=Date.now(),alive=true;
  const m=createAttentionMonitor({file,io,now:()=>now,isAlive:()=>alive});
  t.after(async()=>{m.dispose();await io.rm(dir,{recursive:true,force:true});});
  await io.writeFile(file,line(now-600000,'Running'));await m.poll();assert.equal(m.snapshot().running,1);
  now+=600000;await m.poll();assert.equal(m.snapshot().running,1,'running persists until a real transition or process exit');
  await io.appendFile(file,line(now,'Finished')+line(now,'Running'));await m.poll();assert.equal(m.snapshot().running,1);
  await io.appendFile(file,line(++now,'UserInputRequired'));await m.poll();assert.equal(m.snapshot().running,0);assert.equal(m.snapshot().count,1);
  const revision=m.snapshot().revision;
  await io.appendFile(file,line(now,'Running')+line(now,'UserInputRequired'));await m.poll();assert.equal(m.snapshot().count,1);assert.ok(m.snapshot().revision>revision);
  await io.appendFile(file,line(++now,'Running'));await m.poll();alive=false;await m.poll();assert.equal(m.snapshot().running,0);
});
function line(time,state='UserInputRequired',task=id){
  const d=new Date(time),pad=(n,size=2)=>String(n).padStart(size,'0');
  const date=`${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
  return `[${date} INFO  23500:WS:MULTIPROJECT         f.a.c.telemetry.TaskLifecycleReports] Logging task.stateChanged: startState=Running, endState=${state}, execTime=12 ms, launchType=Local, customAcpAgent=false, agent=Codex, task_id=${task}\n`;
}
test('accepts explicit lifecycle schema, rejects prose, stale events and dead Air',()=>{
  let time=Date.now(),alive=true;const m=createAttentionMonitor({file:'unused',io,now:()=>time,isAlive:()=>alive});
  assert.equal(parseAirLifecycle(line(time)).state,'UserInputRequired');
  assert.equal(parseAirLifecycle('The task may be waiting for input'),null);
  m.ingest(line(time-31000));assert.equal(m.snapshot().count,0);
  m.ingest(line(time));assert.equal(m.snapshot().count,1);const revision=m.snapshot().revision;
  m.ingest(line(time));assert.equal(m.snapshot().revision,revision);
  m.ingest(line(++time,'Running'));assert.equal(m.snapshot().count,0);
  alive=false;m.ingest(line(++time));assert.equal(m.snapshot().count,0);m.dispose();
});
test('tails partial lines, skips startup history, handles concurrent waits, rotation and exit',async t=>{
  const dir=await io.mkdtemp(join(tmpdir(),'fatfish-attention-')),file=join(dir,'air.log');
  let now=Date.now(),alive=true;const m=createAttentionMonitor({file,io,now:()=>now,isAlive:()=>alive});
  t.after(async()=>{m.dispose();await io.rm(dir,{recursive:true,force:true});});
  await io.writeFile(file,line(now));await m.poll();assert.equal(m.snapshot().count,0);
  const request=line(++now);await io.appendFile(file,request.slice(0,-8));await m.poll();assert.equal(m.snapshot().count,0);
  await io.appendFile(file,request.slice(-8));await m.poll();assert.equal(m.snapshot().count,1);
  const other='88beba18-d3f8-42ac-9cf0-2b45155bba8f';await io.appendFile(file,line(++now,'UserInputRequired',other));await m.poll();assert.equal(m.snapshot().count,2);
  await io.appendFile(file,line(++now,'Finished'));await m.poll();assert.equal(m.snapshot().count,1);
  alive=false;await m.poll();assert.equal(m.snapshot().count,0);alive=true;
  await io.rename(file,join(dir,'air1.log'));await io.writeFile(file,line(++now,'UserInputRequired',other));await m.poll();assert.equal(m.snapshot().count,1);
  await io.unlink(file);await m.poll();assert.equal(m.snapshot().count,0);assert.equal(m.snapshot().available,false);
});
test('input immediately wins over native work, clears on resolution, does not need model budget',()=>{
  let input={count:1,since:Date.now(),revision:1},allowed=true;
  const m=createUsageMonitor({root:'unused',io,join,attention:{snapshot:()=>input},canPresent:()=>allowed});
  const native={state:'working',task:'DSH running',ts:1};
  assert.equal(m.prefer(native).state,'waiting');assert.equal(m.prefer(native).task,null,'original renderer supplies its configured waiting voice');
  m.showAttention('主人快回来！',1);assert.match(m.prefer(native).task,/主人快回来/);
  const tick=m.prefer(native).ts;input={...input,count:0,revision:2};assert.equal(m.prefer(native),native);
  m.showAttention('迟到回复',1);input={...input,count:1,revision:3};assert.equal(m.prefer(native).task,null);assert.notEqual(m.prefer(native).ts,tick);
  allowed=false;assert.equal(m.prefer(native),native);m.dispose();
});
