import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
import {THEATER_EXPRESSIONS,THEATER_TOOLS,decodeTheaterReply,decodeTheaterPlan,dialogueExpression} from '../src/theater.mjs';
import {ordinaryQuotaWindows} from '../src/codex-quota.mjs';
import {fatfishExpressionClip,installExpressionUI,fatfishWorkText,fatfishWorkView,fatfishCalmWaiting,installCompletionBubble,fatfishWorkMetadata} from '../src/touch.mjs';
import {patchTouchAsset} from '../src/touch-patch.mjs';
import {DIALOGUE_ALIASES} from '../scripts/configure-dialogue-animations.mjs';

const clean=name=>readFileSync(new URL('../.local/upstream-package/package/'+name,import.meta.url),'utf8');
const animations={idle:['idle'],turn:[],drag:['drag'],clicks:['click'],moves:{actions:[]},events:{whisper:['talk'],fatfishDialogue:DIALOGUE_ALIASES.map(([,a])=>a),balance:Array.from({length:6},(_,i)=>'money-'+i),workStatus:['thinking',['work-a','work-b'],'result',['angry','pace'],'success','error']}};

test('the same tool reply chooses a bounded expression, including JSON fallback and existing actions',()=>{
  for(const tool of THEATER_TOOLS)for(const [slot,expression] of THEATER_EXPRESSIONS.entries()){
    const args={reply:'台词由模型写',expression,...(tool.name==='pet_status'?{topic:'activity'}:{}),...(tool.name==='pet_notify'?{mode:'quiet',minutes:30}:{})};
    const expected=decodeTheaterReply([{type:'tool-call',name:tool.name,arguments:JSON.stringify(args)}],{kind:'tool-calls'});
    assert.equal(expected.expression,expression);assert.deepEqual(dialogueExpression(expected.expression,100),{kind:'dialogue',slot,at:100});
    assert.deepEqual(decodeTheaterPlan([{type:'text',text:JSON.stringify({tool:tool.name,...args})}],{kind:'stop'}),expected);
  }
  for(const expression of ['../../clip','working','quota',false,null,7])assert.throws(()=>decodeTheaterReply([{type:'tool-call',name:'pet_reply',arguments:JSON.stringify({reply:'hi',expression})}],{kind:'stop'}));
  assert.equal(dialogueExpression('neutral'),null);
  assert.throws(()=>decodeTheaterPlan([{type:'text',text:'{"tool":"pet_reply","reply":"hi","expression":"happy","shell":"bad"}'}],{kind:'stop'}));
});

test('only current verified ordinary quota drives a clip; unknown, reserve, expired and malformed values do not',()=>{
  const now=1000000,window=(usedPercent,windowMinutes=300)=>({usedPercent,windowMinutes,resetsAt:2000});
  const snapshot={state:'matched',stale:false,observedAt:now,accountRevision:2,buckets:[{id:'base_model_inference',primary:window(100)},{id:'codex',primary:window(80),secondary:window(5,10080)}]};
  assert.deepEqual(ordinaryQuotaWindows(snapshot,now).map(w=>[w.label,w.usedPercent]),[['5小时',80],['7天',5]]);
  for(const s of [{...snapshot,state:'mismatch'},{...snapshot,stale:true},{...snapshot,buckets:snapshot.buckets.slice(0,1)}])assert.deepEqual(ordinaryQuotaWindows(s,now),[]);
  for(const usedPercent of [-1,101,NaN,'0'])assert.deepEqual(ordinaryQuotaWindows({...snapshot,buckets:[{id:'codex',primary:window(usedPercent)}]},now),[]);
  assert.deepEqual(ordinaryQuotaWindows(snapshot,2000001),[]);
  for(let slot=0;slot<6;slot++){
    assert.equal(fatfishExpressionClip({kind:'quota',slot,at:now},animations,now),'money-'+slot);
    assert.equal(fatfishExpressionClip({kind:'dialogue',slot,at:now},animations,now),DIALOGUE_ALIASES[slot][1]);
  }
  for(const value of [{kind:'quota',slot:6,at:now},{kind:'quota',slot:1,at:now-15000},{kind:'quota',slot:1,at:now+1001},{kind:'file',slot:1,at:now},{kind:'dialogue',slot:1.2,at:now}])assert.equal(fatfishExpressionClip(value,animations,now),null);
});

test('Web and desktop chat decoders forward expression and image without changing reply validation',async()=>{
  for(const name of ['lib/client.js','runtime/electron-helper/shared-core.js']){
    const code=patchTouchAsset(name,clean(name),'');
    const start=code.indexOf('async function sendChat('),end=code.indexOf('\n}',start)+2;
    const expression={kind:'dialogue',slot:2,at:Date.now()};let raw={ok:true,reply:'hello',image:'meme',ts:100,fatfishExpression:expression};
    const send=new Function('fetch','SEND_TIMEOUT_MS',code.slice(start,end)+'return sendChat;')(async()=>({json:async()=>raw}),10000);
    assert.deepEqual(await send('fixture','hi'),raw);
    raw={...raw,image:undefined};assert.deepEqual((await send('fixture','hi')).fatfishExpression,expression);
    raw={ok:true,reply:''};await assert.rejects(send('fixture','hi'));
    assert.ok(code.includes('onReply(state.reply, state.image, state.fatfishExpression)'));
  }
});

const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
test('real desktop dialogue callback, broadcast and work player preserve physics, image, native balance and current work',{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage();await page.clock.install();
    await page.setContent(clean('runtime/electron-helper/index.html').replace(/<meta\b[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
    for(const name of ['shared-core.js','constants.js','sprite.js','events.js']){
      const path='runtime/electron-helper/'+name;
      await page.addScriptTag({content:name==='constants.js'?clean(path):patchTouchAsset(path,clean(path),'')});
    }
    await page.addScriptTag({content:[fatfishExpressionClip,fatfishWorkText,fatfishWorkView,fatfishCalmWaiting,installCompletionBubble,installExpressionUI].map(f=>f.toString()).join('\n')+'\ninstallCompletionBubble();installExpressionUI();'});
    const result=await page.evaluate(animations=>{
      config={physics:S.DEFAULT_PHYSICS};window.petBridge={setBounds(){},setInteractive(){},setInputBusy(){},reportFlight(){}};
      const pet=new PetSprite({id:'main',name:'test',size:240,workStatusEnabled:true,balanceEnabled:true,position:{corner:'bottom-right',marginX:20,marginY:20},animations,animationWeights:{}});
      const plays=[];pet.switchTo=function(name,once){this.anim=name;this.once=once;plays.push(name);};
      let tick=0;const work=s=>pet.onWorkTick({state:'working',fatfishManaged:true,fatfishBubbleMuted:true,...s},++tick);
      work({});const at=Date.now(),expression={kind:'dialogue',slot:0,at};
      let dialog;S.mountChatDialog=options=>{dialog=options;return {close(){},root:document.createElement('div')};};
      // Exercise the actual context-menu chat callback, not just the wrapper.
      pet.showChatFromMenu();dialog.onReply('You made my day','meme',expression);
      const reply={anim:pet.anim,state:pet.workState,image:pet.whisperImage,text:pet.bubble.textContent,once:pet.once};
      pet.handleEnded();const resumed=pet.anim;
      pet.dragState.active=true;const beforeDrag=plays.length;pet.showWhisper('drag reply','',expression);const dragOK=plays.length===beforeDrag;
      pet.dragState.active=false;pet.throwRef=8;const beforeFlight=plays.length;pet.showWhisper('flight reply','',expression);const flightOK=plays.length===beforeFlight;pet.throwRef=null;
      work({fatfishExpression:{kind:'quota',slot:4,at:at+1}});const quota=pet.anim;const n=plays.length;
      work({fatfishExpression:{kind:'quota',slot:4,at:at+1}});const noReplay=plays.length===n;pet.handleEnded();const quotaResume=pet.anim;
      work({state:'waiting',fatfishAttentionRevision:7,fatfishExpression:{kind:'quota',slot:5,at:at+2}});const waiting=pet.anim;
      work({});pet.showWhisper('Plain original whisper');const ordinary=pet.anim;
      // The original DeepSeek balance routine still chooses its own money clip/data.
      pet.onBalanceTick({ok:true,kind:'deepseek',total:'10',granted:'0',toppedUp:'10',currency:'CNY',ts:1},1);
      const native={anim:pet.anim,view:pet.balanceView};
      window.expressionPet=pet;
      return {reply,resumed,dragOK,flightOK,quota,noReplay,quotaResume,waiting,ordinary,native};
    },animations);
    assert.deepEqual(result.reply,{anim:DIALOGUE_ALIASES[0][1],state:'working',image:'meme',text:'You made my day',once:true});
    assert.match(result.resumed,/^work-/);assert.equal(result.dragOK,true);assert.equal(result.flightOK,true);
    assert.equal(result.quota,'money-4');assert.equal(result.noReplay,true);assert.match(result.quotaResume,/^work-/);assert.ok(animations.events.workStatus[3].includes(result.waiting));assert.equal(result.ordinary,'talk');
    assert.match(result.native.anim,/^money-/);assert.ok(result.native.view);
    await page.evaluate(()=>{
      window.broadcastPayload={ts:0};window.fetch=async()=>({ok:true,json:async()=>window.broadcastPayload});
      expressionPet.startBroadcastLoop();
    });
    await page.evaluate(()=>{window.broadcastPayload={ts:1,text:'Broadcast hello',image:'meme',fatfishExpression:{kind:'dialogue',slot:3,at:Date.now()}};});
    await page.clock.fastForward(1000);
    assert.equal(await page.evaluate(()=>expressionPet.anim),DIALOGUE_ALIASES[3][1]);
    await page.clock.fastForward(10001);assert.equal(await page.evaluate(()=>expressionPet.whisperOn),false);
  }finally{await browser.close();}
});

test('actual Web whisper and work effects select once, retain images, skip physical interaction and keep work state',()=>{
  const code=patchTouchAsset('lib/client.js',clean('lib/client.js'),'');
  let clock=1000,plays=[],image,text,bubble;
  const ctx={fatfishExpressionClip:(e,a)=>fatfishExpressionClip(e,a,clock),fatfishWorkText,fatfishWorkView,fatfishCalmWaiting,petAnims:animations,Date:class extends Date{constructor(){super(clock);}static now(){return clock;}},
    cfg:{id:'main'},console:{log(){},error(){}},animRef:{current:'idle'},dragRef:{current:{active:false,dragging:false}},throwRef:{current:null},
    whisperBubbleTimerRef:{current:null},window:{clearTimeout(){},setTimeout(){return 1;}},BUBBLE_DURATION_MS:10000,
    setWhisperText:v=>text=v,setWhisperImage:v=>image=v,setWhisperBubbleOn:v=>bubble=v,setOnce(){},setAnim:v=>plays.push(v),stopMove(){},pick:p=>p[0],pickSlot:s=>Array.isArray(s)?s[0]:s};
  const start=code.indexOf('const triggerWhisper ='),end=code.indexOf('\n\t\t};',start)+6;
  const whisper=new Function('ctx',`with(ctx){${code.slice(start,end)}return triggerWhisper;}`)(ctx);
  whisper('hi','meme',{kind:'dialogue',slot:1,at:clock});assert.equal(plays.at(-1),DIALOGUE_ALIASES[1][1]);assert.equal(image,'meme');assert.equal(text,'hi');assert.equal(bubble,true);
  ctx.dragRef.current.active=true;const n=plays.length;whisper('drag','meme',{kind:'dialogue',slot:2,at:clock});assert.equal(plays.length,n);
  ctx.dragRef.current.active=false;ctx.throwRef.current=4;whisper('fling','',null);assert.equal(plays.length,n);ctx.throwRef.current=null;
  const effectStart=code.indexOf('useEffect(() => {',code.indexOf('const prevWorkTickRef'))+'useEffect(() => {'.length,effectEnd=code.indexOf('}, [workStatusTick]);',effectStart);
  Object.assign(ctx,{cfg:{workStatusEnabled:true},prevWorkTickRef:{current:0},prevWorkStateRef:{current:null},WORK_STATUS_INDEX:{working:1,waiting:3},workBubbleTimerRef:{current:null},setWorkText(){},setWorkBubbleOn(){},setSeq(){}});
  const effect=new Function('ctx',`with(ctx){${code.slice(effectStart,effectEnd)}}`);
  ctx.workStatus={state:'working',fatfishManaged:true,fatfishExpression:{kind:'quota',slot:3,at:clock}};ctx.workStatusTick=1;effect(ctx);assert.equal(plays.at(-1),'money-3');assert.equal(ctx.prevWorkStateRef.current,'working');
  const length=plays.length;ctx.workStatusTick++;effect(ctx);assert.equal(plays.length,length);
  assert.deepEqual(fatfishWorkMetadata({fatfishExpression:{kind:'quota',slot:3,at:clock,path:'unsafe'}}),{fatfishExpression:{kind:'quota',slot:3,at:clock}});
});
