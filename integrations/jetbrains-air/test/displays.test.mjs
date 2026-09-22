import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '@playwright/test';

for(const scale of [1,1.5,2])test(`display hotplug at ${scale}: drag/flight, removed screen, chat and hidden state`,async()=>{
  const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try{
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const helper=fileURLToPath(new URL('../.local/test-runtime/runtime/electron-helper',import.meta.url));
    await page.setContent(readFileSync(join(helper,'index.html'),'utf8').replace(/<meta\b[^>]*>/g,'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,''));
    for(const name of ['shared-core.js','constants.js','sprite.js'])await page.addScriptTag({path:join(helper,name)});
    await page.addScriptTag({content:readFileSync(new URL('../src/touch.mjs',import.meta.url),'utf8').replaceAll('export function ','function ')});
    const results=await page.evaluate(async(scale)=>{
      CONFIG.scale=scale;
      const rect=(x,width)=>({x:x*scale,y:0,width:width*scale,height:900*scale});
      const one={hull:rect(0,1200),areas:[rect(0,1200)]};
      const two={hull:rect(-1000,2200),areas:[rect(-1000,1000),rect(0,1200)],primaryIndex:1};
      applyDeskGeometry(one);config={physics:S.DEFAULT_PHYSICS};
      window.petBridge={setBounds(){},setInteractive(){},setInputBusy(){},reportFlight(){}};
      const pet=new PetSprite({id:'test',size:240,position:{corner:'bottom-right',marginX:20,marginY:20},animations:{idle:[],drag:[],clicks:[],turn:[],events:{},categories:[],moves:{actions:[]}},animationWeights:{}});
      sprites.push(pet);pet.sendBounds(300,300);
      pet.onContextMenu(new MouseEvent('contextmenu',{clientX:200,clientY:200}));
      handleDesktopDisplays(two);const idle=pet.pos.x+VIEW.x===300;
      const menuClosed=!pet.menuOpen;
      pet.dragState={active:true,dragging:true,sx:100,sy:100,petX:pet.pos.x,petY:pet.pos.y};pet.dragTarget={...pet.pos};
      pet.dragTrail=[{t:performance.now(),x:100,y:100}];
      handleDesktopDisplays(one);
      const drag=pet.dragState.active&&pet.dragState.petX===300&&pet.dragTarget.x===300&&pet.dragTrail.length===1;
      pet.dragState.active=false;pet.dragState.dragging=false;
      pet.startThrow(300,300,800,-200);
      await new Promise(requestAnimationFrame);
      const previous={...pet.throwState};
      handleDesktopDisplays(two);
      await new Promise(requestAnimationFrame);
      const flight=pet.throwState.x>=previous.x+1000&&pet.throwState.x<previous.x+1100&&pet.throwState.vx===previous.vx;
      pet.stopThrow();pet.sendBounds(100,300);
      pet.dragState={active:true,dragging:true,sx:0,sy:0,petX:100,petY:300};pet.dragTrail=[{t:performance.now(),x:900,y:0}];
      const chat=S.mountChatDialog({petId:'test',x:200,y:200,onReply(){}});
      const input=document.querySelector('.dsh-pet-chat-input');input.value='keep draft';
      handleDesktopDisplays(one);
      const rescued=!pet.dragState.active&&pet.throwRef===null&&pet.pos.x+pet.halfW>=0;
      const draft=input.isConnected&&input.value==='keep draft';
      const before=JSON.stringify(pet.pos);handleDesktopDisplays({});const invalid=before===JSON.stringify(pet.pos);
      chat.close();pet.dispose();sprites.length=0;handleDesktopDisplays(two);
      return {idle,drag,flight,rescued,draft,invalid,menuClosed,hidden:sprites.length===0};
    },scale);
    for(const key of ['idle','drag','flight','rescued','draft','invalid','menuClosed','hidden'])assert.equal(results[key],true,key);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
