import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const helper=fileURLToPath(new URL('../.local/test-runtime/runtime/electron-helper',import.meta.url));

for(const input of ['touch','mouse'])test(`upstream PetSprite: ${input} hold, drag, release enters real throw physics`,{skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const context=await browser.newContext({hasTouch:true,viewport:{width:1200,height:900}});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const html=readFileSync(join(helper,'index.html'),'utf8').replace(/<meta\b[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'');
    await page.setContent(html);
    for(const name of ['shared-core.js','constants.js','sprite.js'])await page.addScriptTag({path:join(helper,name)});
    await page.evaluate(()=>{
      config={physics:S.DEFAULT_PHYSICS};
      window.petBridge={getTouchFrame:()=>({x:0,y:0,zoom:1}),setBounds:()=>{},setInteractive:()=>{},setInputBusy:()=>{},reportFlight:()=>{}};
      window.pet=new PetSprite({id:'test',name:'test',size:240,position:{corner:'bottom-right',marginX:20,marginY:20},animations:{idle:[],drag:[],clicks:[],turn:[],events:{},moves:{actions:[]}},animationWeights:{}});
      pet.pos={x:300,y:300};
      window.release=null;
      const original=pet.startThrow;
      pet.startThrow=function(x,y,vx,vy){window.release={vx,vy};return original.call(this,x,y,vx,vy);};
    });
    await page.addScriptTag({content:readFileSync(new URL('../src/touch.mjs',import.meta.url),'utf8').replaceAll('export function ','function ')+'\ninstallTouchUI();'});
    const rect=await page.locator('.pet-hit').boundingBox();
    const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    const cdp=await context.newCDPSession(page);
    if(input==='touch')await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    else {await page.mouse.move(x,y);await page.mouse.down();}
    await page.waitForTimeout(700);
    assert.deepEqual(await page.evaluate(()=>({active:pet.dragState.active,menu:pet.menuOpen,release})),{active:true,menu:false,release:null});
    for(let i=1;i<=8;i++){
      if(input==='touch')await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+i*25,y:y-i*8}]});
      else await page.mouse.move(x+i*25,y-i*8);
      await page.waitForTimeout(12);
    }
    assert.ok(await page.evaluate(()=>pet.dragTrail.length)>=2);
    const following=await page.evaluate(()=>({pos:pet.pos,target:pet.dragTarget,spring:pet.dragFollow!==null}));
    assert.ok(Math.abs(following.pos.x-following.target.x)<=0.5);
    assert.ok(Math.abs(following.pos.y-following.target.y)<=0.5);
    assert.equal(following.spring,false,`${input} follows directly without spring delay`);
    if(input==='touch')await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    else await page.mouse.up();
    const result=await page.evaluate(()=>({active:pet.dragState.active,release,throwing:pet.throwRef!==null,position:pet.pos}));
    assert.equal(result.active,false);
    assert.ok(result.release?.vx>0,JSON.stringify(result));
    assert.ok(result.release?.vy<0,JSON.stringify(result));
    assert.equal(result.throwing,true);
    const compatibility=await page.evaluate(()=>{
      pet.stopThrow();pet.stopMove();pet.justDragged=false;
      const played=[];pet.playOnce=name=>played.push(name);
      pet.animations.clicks=['click-response'];
      const pointer={pointerType:'mouse',pointerId:91,button:0,clientX:200,clientY:200,screenX:200,screenY:200};
      pet.onPointerDown(pointer);pet.onPointerMove({...pointer,screenX:250,screenY:220});
      const held={...pet.pos};
      pet.dragTrail=pet.dragTrail.map(s=>({...s,t:performance.now()-1000}));
      pet.onPointerUp(pointer);
      const gentle=pet.throwRef===null&&pet.pos.x===held.x&&pet.pos.y===held.y;
      pet.onClick();const suppressed=played.length===0;
      pet.justDragged=false;pet.onClick();
      const click=played.at(-1)==='click-response'&&pet.pendingSquash;
      pet.throwState={...pet.pos,vx:800,vy:0};
      pet.onPointerDown(pointer);
      const score=!!document.querySelector('.dsh-pet-score')&&pet.pressScoreFired;
      const before=played.length;pet.onPointerUp(pointer);pet.onClick();
      const noDuplicate=played.length===before;
      pet.goHome();
      return {gentle,suppressed,click,score,noDuplicate,home:pet.customPos===null};
    });
    assert.deepEqual(compatibility,{gentle:true,suppressed:true,click:true,score:true,noDuplicate:true,home:true});
    assert.deepEqual(errors,[]);
    await page.evaluate(()=>pet.dispose());
  }finally{await browser.close();}
});
