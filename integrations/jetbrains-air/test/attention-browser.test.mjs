import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import {createCompanion} from '../src/companion.mjs';
import {installCompletionBubble,installWorkStatusTransport,fatfishWorkMetadata,fatfishWorkText,fatfishWorkView,fatfishCalmWaiting} from '../src/touch.mjs';
import {patchTouchAsset} from '../src/touch-patch.mjs';
import {WORKING_POOL,WORKING_ALIASES} from '../scripts/configure-work-animations.mjs';
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const helper=fileURLToPath(new URL('../.local/test-runtime/runtime/electron-helper',import.meta.url));

test('actual desktop fetch decoder and polling loop deliver typed metadata and restore stable work after startup',{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage();await page.clock.install({time:1000000});await page.clock.pauseAt(1001000);
    await page.setContent(readFileSync(join(helper,'index.html'),'utf8').replace(/<meta\b[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
    for(const name of ['shared-core.js','constants.js','sprite.js','events.js'])await page.addScriptTag({path:join(helper,name)});
    await page.addScriptTag({content:[fatfishWorkMetadata,fatfishWorkText,fatfishWorkView,fatfishCalmWaiting,installWorkStatusTransport].map(f=>f.toString()).join('\n')+`\n(${installCompletionBubble.toString()})();`});
    const events=readFileSync(join(helper,'events.js'),'utf8');
    const loop=events.slice(events.indexOf('let workBaseline = null;'),events.indexOf('void workLoop();'));
    const result=await page.evaluate(async loop=>{
      config={physics:S.DEFAULT_PHYSICS};window.petBridge={setBounds(){},setInteractive(){},setInputBusy(){},reportFlight(){}};
      const pet=new PetSprite({id:'main',name:'test',size:240,workStatusEnabled:true,position:{corner:'bottom-right',marginX:20,marginY:20},animations:{idle:['idle'],turn:[],drag:[],clicks:['response'],events:{workStatus:['thinking',['work-a','work-b'],'result',['angry','pace'],'success','error']},moves:{actions:[]}},animationWeights:{}});
      let plays=0;pet.switchTo=function(name){this.anim=name;plays++;};
      pet.pet.workStatusTexts=[[],['Still working']];
      let raw={state:'working',task:null,ts:123,fatfishManaged:true,fatfishBubbleMuted:false,fatfishWorkingQuota:'Codex 7天还剩 24%'};
      window.fetch=async()=>({ok:true,json:async()=>raw});
      const stripped=await S.fetchWorkStatus('fixture');
      installWorkStatusTransport();
      const poll=new Function('S','sprites','WORK_STATUS_URL','setTimeout',`let workTick=0;${loop}return workLoop;`)(S,[pet],'fixture',()=>{});
      await poll();await poll();const restored=pet.workState;
      const ordinary=pet.workText,previousPlays=plays;
      raw={...raw,ts:123.5,fatfishWorkingQuota:'Codex 7天还剩 23%'};await poll();
      const updated={text:pet.workText,replayed:plays!==previousPlays};
      raw={...raw,task:'Completed earlier',ts:124,fatfishNoticeUntil:Date.now()+300000};await poll();
      window.transportPet=pet;
      const held={state:pet.workState,text:pet.bubble.textContent,on:pet.workOn};
      raw={...raw,state:'waiting',task:'Need input',ts:125,fatfishAttentionRevision:9};await poll();pet.onClick();pet.handleEnded();
      const waiting={revision:pet.__fatfishWork.attention,anim:pet.anim,on:pet.workOn};
      raw={state:'working',task:'Completed earlier',ts:126,fatfishManaged:true,fatfishNoticeUntil:Date.now()+300001};await poll();
      return {oldDecoderDroppedMetadata:stripped.fatfishManaged===undefined,restored,ordinary,updated,held,waiting};
    },loop);
    assert.equal(result.oldDecoderDroppedMetadata,true);assert.equal(result.restored,'working');
    assert.equal(result.ordinary,'Still working\nCodex 7天还剩 24%');
    assert.deepEqual(result.updated,{text:'Still working\nCodex 7天还剩 23%',replayed:false});
    assert.deepEqual(result.held,{state:'working',text:'Completed earlier',on:true});assert.deepEqual(result.waiting,{revision:9,anim:'pace',on:false});
    await page.clock.fastForward(299000);assert.equal(await page.evaluate(()=>transportPet.workOn),true);
    await page.clock.fastForward(1001);assert.equal(await page.evaluate(()=>transportPet.workText),'Still working');
  }finally{await browser.close();}
});

test('actual Web network decoder preserves only declared presentation fields',async()=>{
  const clean=readFileSync(new URL('../.local/upstream-package/package/lib/client.js',import.meta.url),'utf8');
  const patched=patchTouchAsset('lib/client.js',clean,'');
  const start=patched.indexOf('async function fetchWorkStatus('),end=patched.indexOf('\n}',start)+2;
  const raw={state:'working',task:'old completion',ts:55,fatfishManaged:true,fatfishBubbleMuted:false,fatfishNoticeUntil:301000,
    fatfishAttentionRevision:9,fatfishStateRevision:'bad',fatfishStateUntil:-1,unknown:'must not pass'};
  const decode=new Function('fetch','fatfishWorkMetadata','WORK_STATUS_STATES','TIMEOUT_MS',`${patched.slice(start,end)}return fetchWorkStatus();`);
  const view=await decode(async()=>({ok:true,json:async()=>raw}),fatfishWorkMetadata,['working'],10000);
  assert.deepEqual(view,{state:'working',task:'old completion',ts:55,fatfishManaged:true,fatfishBubbleMuted:false,fatfishNoticeUntil:301000,fatfishAttentionRevision:9});
});

test('desktop queued work keeps its unread bubble, restores after interaction, and softens only acknowledged waiting',{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage();await page.clock.install();
    await page.setContent(readFileSync(join(helper,'index.html'),'utf8').replace(/<meta\b[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
    for(const name of ['shared-core.js','constants.js','sprite.js','events.js'])await page.addScriptTag({path:join(helper,name)});
    await page.addScriptTag({content:`${fatfishWorkText.toString()}\n${fatfishWorkView.toString()}\n${fatfishCalmWaiting.toString()}\n(${installCompletionBubble.toString()})();`});
    const result=await page.evaluate(()=>{
      config={physics:S.DEFAULT_PHYSICS};window.petBridge={setBounds(){},setInteractive(){},setInputBusy(){},reportFlight(){}};
      const pet=new PetSprite({id:'main',name:'test',size:240,workStatusEnabled:true,position:{corner:'bottom-right',marginX:20,marginY:20},animations:{idle:['idle'],turn:[],drag:['drag'],clicks:['response'],events:{workStatus:['thinking',['work-a','work-b'],'result',['angry','wave','pace'],'success','error']},moves:{actions:[]}},animationWeights:{}});
      const plays=[];pet.switchTo=function(name,once){this.anim=name;this.once=once;plays.push(name);};
      let tick=0;const send=s=>pet.onWorkTick({...s,fatfishManaged:true},++tick),deadline=Date.now()+300000;
      send({state:'success',task:'old completion',fatfishNoticeUntil:deadline});
      send({state:'working',task:'old completion',fatfishNoticeUntil:deadline});
      const running={state:pet.workState,anim:pet.anim,text:pet.bubble.textContent};
      const beforeText=plays.length;send({state:'working',task:'late model completion',fatfishNoticeUntil:deadline});
      const noReplay=plays.length===beforeText;
      pet.justDragged=true;pet.onClick();const dragKeeps=pet.workOn;pet.justDragged=false;
      pet.onClick();pet.handleEnded();const clicked={on:pet.workOn,anim:pet.anim,state:pet.workState};
      send({state:'working',task:'late model completion',fatfishNoticeUntil:deadline});const dismissedStays=!pet.workOn;
      pet.dragState.active=true;const beforeDrag=plays.length;send({state:'waiting',task:'input',fatfishAttentionRevision:1});
      const noDragInterrupt=plays.length===beforeDrag;
      pet.dragState.active=false;pet.resumeWorkStatusAnim();pet.onClick();const response=pet.anim;pet.handleEnded();
      const calm={anim:pet.anim,state:pet.workState,on:pet.workOn,once:pet.once};
      send({state:'waiting',task:'late input wording',fatfishAttentionRevision:1});const stillCalm={anim:pet.anim,on:pet.workOn};
      send({state:'waiting',task:'new input',fatfishAttentionRevision:2});const newInput=pet.workOn;
      send({state:'working',task:'back to work'});pet.handleEnded();const resumed=pet.anim;
      pet.onWorkTick({state:null,task:null},++tick);const paused={state:pet.workState,anim:pet.anim,on:pet.workOn};
      return {running,noReplay,dragKeeps,clicked,dismissedStays,noDragInterrupt,response,calm,stillCalm,newInput,resumed,paused};
    });
    assert.equal(result.running.state,'working');assert.match(result.running.anim,/^work-/);assert.equal(result.running.text,'old completion');
    assert.equal(result.noReplay,true);assert.equal(result.dragKeeps,true);assert.equal(result.clicked.on,true);assert.match(result.clicked.anim,/^work-/);
    assert.equal(result.dismissedStays,false);assert.equal(result.noDragInterrupt,true);assert.equal(result.response,'response');
    assert.deepEqual(result.calm,{anim:'pace',state:'waiting',on:false,once:false});assert.deepEqual(result.stillCalm,{anim:'pace',on:false});
    assert.equal(result.newInput,true);assert.match(result.resumed,/^work-/);assert.deepEqual(result.paused,{state:null,anim:'idle',on:false});
  }finally{await browser.close();}
});

test('working clips rotate through original event logic and preserve click and random-animation behavior',{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(readFileSync(join(helper,'index.html'),'utf8').replace(/<meta\b[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
    for(const name of ['shared-core.js','constants.js','sprite.js','events.js'])await page.addScriptTag({path:join(helper,name)});
    const result=await page.evaluate(({pool,sources})=>{
      config={physics:S.DEFAULT_PHYSICS};window.petBridge={setBounds(){},setInteractive(){},setInputBusy(){},reportFlight(){}};
      const pet=new PetSprite({id:'main',name:'test',size:240,workStatusEnabled:true,position:{corner:'bottom-right',marginX:20,marginY:20},animations:{idle:['idle'],turn:[],drag:[],clicks:['click'],events:{workStatus:['thinking',pool,'result','waiting','success','error']},moves:{actions:[]}},animationWeights:{}});
      pet.switchTo=name=>{pet.anim=name;};pet.onWorkTick({state:'working',task:'busy',ts:1},1);
      const sequence=[pet.anim];for(let i=0;i<12;i++){pet.handleEnded();sequence.push(pet.anim);}
      pet.playOnce('click');pet.handleEnded();const afterClick=pet.anim;
      const randomIndependent=sources.every(name=>!S.isEventAnim(pet.animations.events,name));
      pet.onWorkTick({state:'waiting',task:'input',ts:2},2);const waiting=pet.anim;
      pet.onWorkTick({state:'success',task:'done',ts:3},3);pet.handleEnded();const done=pet.anim;
      return {sequence,afterClick,randomIndependent,waiting,done};
    },{pool:WORKING_POOL,sources:WORKING_ALIASES.map(([name])=>name)});
    assert.ok(result.sequence.every((name,i)=>WORKING_POOL.includes(name)&&(!i||name!==result.sequence[i-1])));
    assert.ok(WORKING_POOL.includes(result.afterClick));assert.equal(result.randomIndependent,true);
    assert.equal(result.waiting,'waiting');assert.equal(result.done,'idle');
  }finally{await browser.close();}
});

test('real sprite holds explicit completion without looping success, ordinary terminal still expires',{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage();await page.clock.install();
    await page.setContent(readFileSync(join(helper,'index.html'),'utf8').replace(/<meta\b[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
    for(const name of ['shared-core.js','constants.js','sprite.js','events.js'])await page.addScriptTag({path:join(helper,name)});
    await page.addScriptTag({content:`${fatfishWorkText.toString()}\n${fatfishWorkView.toString()}\n${fatfishCalmWaiting.toString()}\n(${installCompletionBubble.toString()})();`});
    await page.evaluate(()=>{
      config={physics:S.DEFAULT_PHYSICS};window.petBridge={setBounds(){},setInteractive(){},setInputBusy(){},reportFlight(){}};
      window.heldPet=new PetSprite({id:'main',name:'test',size:240,workStatusEnabled:true,position:{corner:'bottom-right',marginX:20,marginY:20},animations:{idle:['idle'],turn:[],drag:[],clicks:[],events:{whisper:['talk'],workStatus:['thinking','working','result','waiting','success','error']},moves:{actions:[]}},animationWeights:{}});
      window.plays=[];heldPet.playOnce=name=>plays.push(name);heldPet.switchTo=()=>{};
      heldPet.onWorkTick({state:'success',task:'Finished; quota',ts:1,fatfishNoticeUntil:Date.now()+300000},1);
    });
    await page.clock.fastForward(11000);
    assert.deepEqual(await page.evaluate(()=>({on:heldPet.workOn,text:heldPet.bubble.textContent,plays})),{on:true,text:'Finished; quota',plays:['success']});
    await page.clock.fastForward(288000);assert.equal(await page.evaluate(()=>heldPet.workOn),true);
    await page.clock.fastForward(1001);assert.equal(await page.evaluate(()=>heldPet.workOn),false);
    await page.evaluate(()=>{window.nextNotice={state:'success',task:'Next completion',ts:2,fatfishNoticeUntil:Date.now()+300000};heldPet.onWorkTick(nextNotice,2);});
    assert.equal(await page.evaluate(()=>heldPet.workOn),true);
    await page.evaluate(()=>{heldPet.justDragged=true;heldPet.onClick();});
    assert.equal(await page.evaluate(()=>heldPet.workOn),true,'drag release is not an acknowledgement');
    await page.evaluate(()=>{heldPet.justDragged=false;heldPet.onClick();heldPet.onWorkTick(nextNotice,20);});
    assert.equal(await page.evaluate(()=>heldPet.workOn),false,'click dismisses and polling cannot redisplay the same notice');
    await page.evaluate(()=>heldPet.onWorkTick({...nextNotice,fatfishNoticeUntil:nextNotice.fatfishNoticeUntil+1},21));
    assert.equal(await page.evaluate(()=>heldPet.workOn),true,'a new completion is still visible');
    await page.evaluate(()=>{heldPet.onWorkTick({state:null,ts:3},3);heldPet.showWhisper('Manual chat');});
    assert.equal(await page.evaluate(()=>heldPet.bubble.textContent),'Manual chat');
    await page.evaluate(()=>heldPet.onWorkTick({state:'success',task:'Original completion',ts:4},4));
    await page.clock.fastForward(10001);assert.equal(await page.evaluate(()=>heldPet.workOn),false);
    await page.evaluate(()=>heldPet.onWorkTick({state:'success',task:'Same native state',ts:5},5));
    assert.equal(await page.evaluate(()=>heldPet.workOn),false);
  }finally{await browser.close();}
});

test('actual patched Web effect separates work and speech, acknowledges waiting and preserves native behavior',()=>{
  const clean=readFileSync(new URL('../.local/upstream-package/package/lib/client.js',import.meta.url),'utf8');
  const patched=patchTouchAsset('lib/client.js',clean,'');
  const start=patched.indexOf('useEffect(() => {',patched.indexOf('const prevWorkTickRef'))+'useEffect(() => {'.length;
  const end=patched.indexOf('}, [workStatusTick]);',start);
  assert.ok(start>0&&end>start);
  let clock=1000,durations=[],values=[],animations=[],text;
  const ctx={fatfishWorkText,fatfishWorkView,fatfishCalmWaiting,console:{log(){},error(){}},Date:class extends Date{constructor(){super(clock);}static now(){return clock;}},
    cfg:{workStatusEnabled:true,workStatusTexts:[['thinking'],['busy'],['result'],['waiting'],['done'],['error']]},
    petAnims:{idle:['idle'],events:{workStatus:['thinking',['working-a','working-b'],'result',['angry','wave','pace'],'success','error']}},
    WORK_STATUS_INDEX:{thinking:0,working:1,result:2,waiting:3,success:4,error:5},
    prevWorkTickRef:{current:0},prevWorkStateRef:{current:'success'},workBubbleTimerRef:{current:null},
    animRef:{current:'idle'},dragRef:{current:{active:false,dragging:false}},justDraggedRef:{current:false},workStatusRef:{current:null},
    window:{clearTimeout(){},setTimeout(fn,ms){durations.push(ms);return 1;}},BUBBLE_DURATION_MS:10000,
    setWorkBubbleOn:v=>values.push(v),setWorkText:v=>text=v,setAnim:v=>{animations.push(v);ctx.animRef.current=v;},setOnce(){},setSeq(){},stopMove(){},pickSlot:s=>Array.isArray(s)?s[0]:s};
  const apply=new Function('ctx',`with(ctx){${patched.slice(start,end)}}`);
  const run=s=>{ctx.workStatus=s;ctx.workStatusRef.current=s;ctx.workStatusTick=(ctx.workStatusTick||0)+1;apply(ctx);};
  run({state:'success',task:'native'});assert.deepEqual(values,[]);
  run({state:'success',task:'held',fatfishManaged:true,fatfishNoticeUntil:301000});assert.equal(durations.at(-1),300000);assert.equal(values.at(-1),true);
  clock+=11000;run({state:'working',task:'held',fatfishManaged:true,fatfishNoticeUntil:301000});
  assert.equal(animations.at(-1),'working-a');assert.equal(text,'held');assert.equal(durations.at(-1),289000);
  const n=animations.length;
  run({state:'working',task:'new completed text',fatfishManaged:true,fatfishNoticeUntil:302000});
  assert.equal(animations.length,n,'new text must not restart busy animation');
  const clickStart=patched.indexOf('const handleClick = () => {'),clickEnd=patched.indexOf('if (pressScoreFiredRef.current)',clickStart);
  const click=new Function('ctx',`with(ctx){${patched.slice(clickStart,clickEnd)}};handleClick();}`);
  ctx.dragRef.current.active=true;click(ctx);assert.notEqual(ctx.prevWorkStateRef.fatfish.dismissed,302000);
  ctx.dragRef.current.active=false;click(ctx);assert.equal(ctx.prevWorkStateRef.fatfish.dismissed,302000);
  assert.equal(text,'busy','click restores current work immediately, without a progress tick');
  run(ctx.workStatus);assert.equal(values.at(-1),true);assert.equal(text,'busy');assert.equal(animations.length,n);
  run({state:'working',task:null,fatfishManaged:true,fatfishWorkingQuota:'Codex 7天还剩 24%'});
  assert.equal(text,'busy\nCodex 7天还剩 24%');
  run({...ctx.workStatus,fatfishWorkingQuota:'Codex 7天还剩 23%'});
  assert.equal(text,'busy\nCodex 7天还剩 23%');assert.equal(animations.length,n,'quota refresh is text-only');
  run({state:'working',task:null,fatfishManaged:true,fatfishBubbleMuted:true});assert.equal(values.at(-1),false);assert.equal(animations.length,n);
  run({state:'waiting',task:'come back',fatfishManaged:true,fatfishAttentionRevision:1});click(ctx);run(ctx.workStatus);assert.equal(values.at(-1),false);
  const resumeStart=patched.indexOf('const resumeWorkStatusAnim = () => {'),resumeEnd=patched.indexOf('const handleEnded =',resumeStart);
  const resume=new Function('ctx',`with(ctx){${patched.slice(resumeStart,resumeEnd)}return resumeWorkStatusAnim();}`);
  assert.equal(resume(ctx),true);assert.equal(animations.at(-1),'pace');
  run({state:'waiting',task:'new request',fatfishManaged:true,fatfishAttentionRevision:2});assert.equal(values.at(-1),true);assert.equal(animations.at(-1),'angry');
  run({state:'success',task:'native'});assert.equal(durations.at(-1),10000);
  const v=values.length;run({state:'success',task:'same native'});assert.equal(values.length,v);
});

test('manual reply becomes visible when external work yields, then work resumes',{skip:!existsSync(edge),timeout:30000},async()=>{
  let clock=1000;
  const companion=createCompanion({now:()=>clock,monitor:{clearNotice(){}},generate:async()=>''});
  const work={state:'working',task:'External work',ts:1,fatfishManaged:true};
  const snapshots=[{...work,fatfishBubbleMuted:!companion.canSpeak()}];
  companion.interrupt();snapshots.push({...work,fatfishBubbleMuted:!companion.canSpeak()});
  clock+=60000;snapshots.push({...work,fatfishBubbleMuted:!companion.canSpeak()});
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(readFileSync(join(helper,'index.html'),'utf8').replace(/<meta\b[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
    for(const name of ['shared-core.js','constants.js','sprite.js','events.js'])await page.addScriptTag({path:join(helper,name)});
    await page.addScriptTag({content:`${fatfishWorkText.toString()}\n${fatfishWorkView.toString()}\n${fatfishCalmWaiting.toString()}\n(${installCompletionBubble.toString()})();`});
    const result=await page.evaluate(snapshots=>{
      config={physics:S.DEFAULT_PHYSICS};
      window.petBridge={setBounds(){},setInteractive(){},setInputBusy(){},reportFlight(){}};
      const pet=new PetSprite({id:'main',name:'test',size:240,workStatusEnabled:true,position:{corner:'bottom-right',marginX:20,marginY:20},animations:{idle:['idle'],turn:[],drag:[],clicks:[],events:{whisper:['talk'],workStatus:['thinking','working','result','waiting','success','error']},moves:{actions:[]}},animationWeights:{}});
      pet.switchTo=()=>{};
      pet.onWorkTick(snapshots[0],1);pet.showWhisper('Manual reply');
      const before=pet.bubble.textContent;
      pet.onWorkTick(snapshots[1],2);const during=pet.bubble.textContent;
      if(pet.workState!=='working')throw Error('Chat must not turn off the work state');
      pet.onWorkTick(snapshots[2],3);return {before,during,after:pet.bubble.textContent};
    },snapshots);
    assert.deepEqual(result,{before:'External work',during:'Manual reply',after:'External work'});
  }finally{companion.dispose();await browser.close();}
});
test('original sprite rotates attention aliases, clears waiting, and preserves ordinary click classification',{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage();
    const html=readFileSync(join(helper,'index.html'),'utf8').replace(/<meta\b[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
    await page.setContent(html);
    for(const name of ['shared-core.js','constants.js','sprite.js','events.js'])await page.addScriptTag({path:join(helper,name)});
    const result=await page.evaluate(()=>{
      config={physics:S.DEFAULT_PHYSICS};
      window.petBridge={setBounds(){},setInteractive(){},setInputBusy(){},reportFlight(){}};
      const waiting=['fatfish-attention-angry','fatfish-attention-wave','pace'];
      const pet=new PetSprite({id:'main',name:'test',size:240,workStatusEnabled:true,position:{corner:'bottom-right',marginX:20,marginY:20},animations:{idle:['idle'],turn:[],drag:[],clicks:['ordinary-click'],events:{workStatus:['thinking','working','result',waiting,'success','error']},moves:{actions:[]}},animationWeights:{}});
      const played=[];pet.switchTo=name=>played.push(name); // Media loading is outside this state-machine regression.
      pet.onWorkTick({state:'waiting',task:'Air needs input',ts:1},1);
      const first=pet.anim;pet.handleEnded();const next=pet.anim;
      const active={text:pet.workText,on:pet.workOn};
      pet.onWorkTick({state:null,task:null,ts:2},2);pet.handleEnded();
      const cleared={on:pet.workOn,anim:pet.anim};
      pet.onWorkTick({state:'working',task:'running',ts:3},3);pet.playOnce('ordinary-click');pet.handleEnded();
      return {first,next,waiting,active,cleared,afterClick:played.at(-1),played};
    });
    assert.ok(result.waiting.includes(result.first));assert.ok(result.waiting.includes(result.next));assert.notEqual(result.first,result.next);
    assert.deepEqual(result.active,{text:'Air needs input',on:true});assert.deepEqual(result.cleared,{on:false,anim:'idle'});assert.equal(result.afterClick,'working');
  }finally{await browser.close();}
});
