import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const helper=fileURLToPath(new URL('../.local/test-runtime/runtime/electron-helper',import.meta.url));
const runtime=readFileSync(new URL('../src/touch.mjs',import.meta.url),'utf8').replaceAll('export function ','function ');

async function setup(page){
  await page.setContent(readFileSync(join(helper,'index.html'),'utf8').replace(/<meta\b[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
  for(const name of ['shared-core.js','constants.js','sprite.js','events.js'])await page.addScriptTag({path:join(helper,name)});
  await page.evaluate(()=>{
    config={physics:S.DEFAULT_PHYSICS};window.regions=[];
    window.petBridge={getTouchFrame:()=>({x:0,y:0,zoom:1}),setBounds(){},setInteractive(){},setInputBusy(){},reportFlight(){},updateInputRegions:r=>regions.push(r),onOverlayInput:callback=>{window.forwardInput=callback;return ()=>{};}};
    window.pet=new PetSprite({id:'test',name:'test',size:462,position:{corner:'bottom-right',marginX:20,marginY:20},animations:{idle:[],drag:[],clicks:[],turn:[],events:{whisper:['talk']},moves:{actions:[]}},animationWeights:{}});
    sprites.push(pet);pet.switchTo=()=>{};
  });
  await page.addScriptTag({content:runtime+'\ninstallTouchUI();'});
}

test('forwarded mouse and touch taps acknowledge a report and immediately render current work without polling',{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage({hasTouch:true,viewport:{width:1000,height:800}});await setup(page);
    const result=await page.evaluate(()=>{
      pet.pet.workStatusEnabled=true;pet.pet.workStatusTexts=[['thinking'],['Still working'],['result'],['waiting'],['done'],['error']];
      pet.animations.events.workStatus=['thinking',['work-a','work-b'],'result','waiting','success','error'];pet.animations.clicks=['click'];
      pet.switchTo=function(name){this.anim=name;};let tick=0;const views=[];
      for(const pointerType of ['mouse','touch']){
        const deadline=Date.now()+300000+tick;
        pet.onWorkTick({state:'working',task:'Completed report',fatfishManaged:true,fatfishNoticeUntil:deadline},++tick);
        const r=pet.hit.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
        const data={pointerType,pointerId:1,isPrimary:true,button:0,clientX:x,clientY:y,screenX:x,screenY:y};
        for(const type of ['pointerdown','mousedown','pointerup','mouseup','click'])forwardInput({...data,type,buttons:type.endsWith('down')?1:0});
        views.push({text:pet.bubble.textContent,on:pet.workOn,state:pet.workState,active:pet.dragState.active,anim:pet.anim});
        pet.handleEnded();views.push({restored:pet.anim});
      }
      pet.onWorkTick({state:null,task:'Idle completion',fatfishManaged:true,fatfishNoticeUntil:Date.now()+300001},++tick);
      pet.hit.dispatchEvent(new MouseEvent('click',{bubbles:true}));views.push({idleOn:pet.workOn});
      return views;
    });
    for(const i of [0,2]){assert.deepEqual(result[i],{text:'Still working',on:true,state:'working',active:false,anim:'click'});assert.match(result[i+1].restored,/^work-/);}
    assert.deepEqual(result[4],{idleOn:false});
  }finally{await browser.close();}
});

test('capture loss and missing touch-up recover; secondary fingers and cancellation cannot fling',{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage({hasTouch:true,viewport:{width:1000,height:800}});await setup(page);
    const result=await page.evaluate(()=>{
      const fire=(type,id,x,primary=true)=>pet.hit.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerType:'touch',pointerId:id,isPrimary:primary,button:0,buttons:type==='pointerup'?0:1,screenX:x,screenY:200,clientX:x,clientY:200}));
      fire('pointerdown',1,200);fire('pointermove',1,260);
      pet.dragTrail=[{t:performance.now()-20,x:200,y:200},{t:performance.now(),x:400,y:200}];
      fire('lostpointercapture',1,260);const cancelled=!pet.dragState.active&&pet.throwRef===null;
      fire('pointerdown',2,260);fire('pointermove',2,320);const recovered=pet.dragState.active&&pet.dragState.dragging;
      const primaryX=pet.pos.x;fire('pointerdown',3,900,false);fire('pointermove',3,950,false);fire('lostpointercapture',3,950,false);
      const secondaryIgnored=pet.dragState.active&&pet.pos.x===primaryX;
      // Deliberately omit pointerup for #2. A new primary contact must work.
      fire('pointerdown',4,330);fire('pointermove',4,390);const renewed=pet.dragState.active&&pet.dragState.dragging&&pet.dragState.sx===330;
      window.dispatchEvent(new Event('blur'));const blurred=!pet.dragState.active&&pet.throwRef===null;
      fire('pointerdown',5,400);fire('pointermove',5,450);const afterBlur=pet.dragState.dragging;
      fire('pointercancel',5,450);return {cancelled,recovered,secondaryIgnored,renewed,blurred,afterBlur};
    });
    assert.deepEqual(result,{cancelled:true,recovered:true,secondaryIgnored:true,renewed:true,blurred:true,afterBlur:true});
  }finally{await browser.close();}
});

test('forwarded mouse drag ignores visual-window capture loss and foreign releases; real owner still cancels',{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage({hasTouch:true,viewport:{width:1000,height:800}});await setup(page);
    const result=await page.evaluate(()=>{
      const r=pet.hit.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
      let captureCalls=0;pet.hit.setPointerCapture=()=>captureCalls++;
      const send=(type,id=1,kind='mouse',dx=0)=>forwardInput({type,pointerId:id,pointerType:kind,isPrimary:true,button:0,buttons:['pointerup','pointercancel'].includes(type)?0:1,clientX:x+dx,clientY:y,screenX:200+dx,screenY:200});
      send('pointerdown');send('pointermove',1,'mouse',60);
      const heldX=pet.pos.x;
      for(const type of ['lostpointercapture','pointercancel','pointerup'])pet.hit.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerType:'mouse',pointerId:1,buttons:0}));
      pet.hit.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',pointerId:1,buttons:0,screenX:900,screenY:900}));
      const foreignIgnored=pet.dragState.active&&pet.pos.x===heldX;
      send('pointerup',9,'touch');const oldTouchIgnored=pet.dragState.active;
      send('pointermove',1,'mouse',120);const follows=pet.pos.x===heldX+60;
      send('pointercancel');const cancelled=!pet.dragState.active&&pet.throwRef===null;
      send('pointerdown',2,'touch');send('pointermove',2,'touch',60);const touchWorks=pet.dragState.dragging;
      send('pointercancel',2,'touch');send('pointerdown');send('pointermove',1,'mouse',60);
      window.dispatchEvent(new Event('blur'));const blurred=!pet.dragState.active&&pet.throwRef===null;
      send('pointerdown');send('pointermove',1,'mouse',60);const recovered=pet.dragState.dragging;
      send('pointercancel');return {captureCalls,foreignIgnored,oldTouchIgnored,follows,cancelled,touchWorks,blurred,recovered};
    });
    assert.deepEqual(result,{captureCalls:0,foreignIgnored:true,oldTouchIgnored:true,follows:true,cancelled:true,touchWorks:true,blurred:true,recovered:true});
  }finally{await browser.close();}
});

test('long bubbles widen, retain newlines, fit visible window, and scroll without dragging pet',{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const page=await browser.newPage({hasTouch:true,viewport:{width:1000,height:800}});await setup(page);
    await page.evaluate(()=>{pet.showWhisper('刚才那次输入和输出都在这里～\n输入 152,624（缓存 151,040）；输出 208 tokens\n5小时：未知\n7天：剩余81%');});
    await page.waitForTimeout(50);
    const normal=await page.evaluate(()=>({width:pet.bubble.getBoundingClientRect().width,whiteSpace:getComputedStyle(pet.bubble.firstElementChild).whiteSpace,scroll:pet.bubble.classList.contains('fatfish-bubble-scroll')}));
    assert.ok(normal.width>300);assert.equal(normal.whiteSpace,'pre-wrap');assert.equal(normal.scroll,false);
    const result=await page.evaluate(()=>{
      pet.showWhisper(('这是很长的用量记录，需要可以滚动阅读。\n').repeat(45));
      const v={x:80,y:60,width:320,height:260};fitPetBubble(pet.bubble,v);
      const r=pet.bubble.getBoundingClientRect();
      pet.bubble.dispatchEvent(new WheelEvent('wheel',{bubbles:true,cancelable:true,deltaY:100}));const wheel=pet.bubble.scrollTop;
      pet.bubble.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:11,clientY:200}));
      pet.bubble.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,cancelable:true,pointerType:'touch',pointerId:11,clientY:150}));
      const touch=pet.bubble.scrollTop;pet.bubble.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerType:'touch',pointerId:11}));
      return {rect:{x:r.x,y:r.y,right:r.right,bottom:r.bottom},wheel,touch,active:pet.dragState.active,pointerEvents:getComputedStyle(pet.bubble).pointerEvents};
    });
    assert.ok(result.rect.x>=88&&result.rect.y>=68);assert.ok(result.rect.right<=392.1&&result.rect.bottom<=312.1);
    assert.ok(result.wheel>0);assert.ok(result.touch>result.wheel);assert.equal(result.active,false);assert.equal(result.pointerEvents,'auto');
  }finally{await browser.close();}
});
