// Observe Air's explicit lifecycle transitions, never infer a question from prose.
export function parseAirLifecycle(line) {
  const match=/^\[(\d{4})(\d{2})(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}) INFO\s+(\d+):[^\]\r\n]*\bTaskLifecycleReports\] Logging task\.stateChanged: startState=(\w+), endState=(\w+), [^\r\n]*\btask_id=([a-f0-9-]{36})\s*$/.exec(line);
  if(!match)return null;
  const at=new Date(+match[1],+match[2]-1,+match[3],+match[4],+match[5],+match[6],+match[7]).getTime();
  return {at,pid:+match[8],state:match[10],id:match[11]};
}
export function createAttentionMonitor({file,io,now=Date.now,isAlive=pid=>{try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}},intervalMs=1000}) {
  let offset=null,identity=null,pending=Buffer.alloc(0),discard=false,timer=null,busy=false,disposed=false,revision=0,error=null,lastReadAt=null;
  const tasks=new Map(),seen=new Map();
  function clear(){if(tasks.size){tasks.clear();revision++;}}
  function ingest(line,baseline=false){
    const event=parseAirLifecycle(line);
    if(!event||event.at>now()+5000||(!baseline&&now()-event.at>30000)||!isAlive(event.pid))return;
    const key=event.pid+':'+event.id;
    const last=seen.get(key);
    // Queued transitions can share a millisecond; preserve their file order.
    if(last&&(event.at<last.at||event.at===last.at&&event.state===last.state))return;
    seen.set(key,{at:event.at,state:event.state});
    const previous=tasks.get(key);
    const waiting=event.state==='UserInputRequired'&&!baseline;
    if(previous?.state==='UserInputRequired'&&!waiting)revision++;
    if(waiting&&previous?.state!=='UserInputRequired')revision++;
    if(event.state==='Running'||waiting)tasks.set(key,{at:event.at,pid:event.pid,state:event.state});
    else tasks.delete(key);
    if(seen.size>512)seen.delete(seen.keys().next().value);
  }
  function snapshot(){
    const waiting=[...tasks.values()].filter(t=>t.state==='UserInputRequired');
    return {source:'Air task.stateChanged',available:!error&&offset!==null,count:waiting.length,running:[...tasks.values()].filter(t=>t.state==='Running').length,since:waiting.length?Math.min(...waiting.map(t=>t.at)):null,revision,lastReadAt,error};
  }
  // Air rotates air.log to air1.log. Recover only state, never replay notifications.
  // Read in 1 MiB chunks; each file is bounded to its last 32 MiB.
  async function restoreRunning(path){
    const stat=await io.stat(path),handle=await io.open(path,'r');
    let cursor=Math.max(0,stat.size-33554432),tail=Buffer.alloc(0),skip=cursor>0;
    try{
      while(cursor<stat.size){
        const buffer=Buffer.alloc(Math.min(1048576,stat.size-cursor));
        const {bytesRead}=await handle.read(buffer,0,buffer.length,cursor);if(!bytesRead)break;cursor+=bytesRead;
        let data=Buffer.concat([tail,buffer.subarray(0,bytesRead)]);
        if(skip){const end=data.indexOf(10);skip=end<0;data=end<0?Buffer.alloc(0):data.subarray(end+1);}
        const end=data.lastIndexOf(10);
        if(end<0){skip=skip||data.length>2048;tail=skip?Buffer.alloc(0):data;continue;}
        for(const line of data.subarray(0,end).toString('utf8').split('\n'))if(line.length<2048)ingest(line,true);
        tail=data.subarray(end+1);if(tail.length>2048){tail=Buffer.alloc(0);skip=true;}
      }
    }finally{await handle.close();}
    return {offset:cursor,identity:String(stat.ino),pending:tail,discard:skip};
  }
  async function restorePrevious(){
    const previous=file.replace(/air\.log$/,'air1.log');if(previous===file)return;
    try{await restoreRunning(previous);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  async function poll(){
    if(disposed||busy)return;busy=true;
    try{
      const stat=await io.stat(file),id=String(stat.ino);
      if(offset===null){
        await restorePrevious();
        const restored=await restoreRunning(file);
        ({offset,identity,pending,discard}=restored);lastReadAt=now();error=null;return;
      }
      if(id!==identity||stat.size<offset){
        if(id===identity)clear();
        else{
          for(const [key,task] of tasks)if(task.state==='UserInputRequired'){tasks.delete(key);revision++;}
          await restorePrevious();
        }
        offset=0;identity=id;pending=Buffer.alloc(0);discard=false;
      }
      if(stat.size>offset){
        const handle=await io.open(file,'r');
        try{
          // Bound each read and partial line even if tool output is very large.
          const size=Math.min(stat.size-offset,1048576),buffer=Buffer.alloc(size);
          const {bytesRead}=await handle.read(buffer,0,size,offset);offset+=bytesRead;
          let data=Buffer.concat([pending,buffer.subarray(0,bytesRead)]);
          if(discard){const end=data.indexOf(10);discard=end<0;data=end<0?Buffer.alloc(0):data.subarray(end+1);}
          const end=data.lastIndexOf(10);
          if(end<0){discard=discard||data.length>1048576;pending=discard?Buffer.alloc(0):data;}
          else{pending=data.subarray(end+1);for(const line of data.subarray(0,end).toString('utf8').split('\n'))if(line.length<2048)ingest(line);}
        }finally{await handle.close();}
      }
      for(const [key,task] of tasks)if(!isAlive(task.pid)){tasks.delete(key);if(task.state==='UserInputRequired')revision++;}
      lastReadAt=now();error=null;
    }catch{clear();error='Air 状态日志暂不可读';offset=null;pending=Buffer.alloc(0);discard=false;}
    finally{busy=false;if(disposed)clear();}
  }
  return {poll,snapshot,ingest,
    start(){if(timer||disposed)return;void poll();timer=setInterval(()=>void poll(),intervalMs);timer.unref?.();},
    dispose(){disposed=true;if(timer)clearInterval(timer);timer=null;clear();seen.clear();}};
}
