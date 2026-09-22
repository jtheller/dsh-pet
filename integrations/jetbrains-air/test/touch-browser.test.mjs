import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from '@playwright/test';
const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
test('real browser touch: menu button opens upstream menu, tap branches, send chat, IME guard', {skip:!existsSync(edge),timeout:30000},async()=>{
  const browser=await chromium.launch({executablePath:edge,headless:true});
  try{
    const context=await browser.newContext({hasTouch:true,viewport:{width:1000,height:800}});
    const page=await context.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent('<html><head></head><body><div class="pet-hit" style="position:absolute;left:200px;top:200px;width:150px;height:150px;background:skyblue"></div></body></html>');
    await page.addScriptTag({path:fileURLToPath(new URL('../.local/test-runtime/runtime/electron-helper/shared-core.js',import.meta.url))});
    await page.evaluate(()=>{
      window.testActions=[];window.testClicks=0;window.active=false;
      window.testEvents=[];
      for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','contextmenu','mousedown','click'])document.addEventListener(type,e=>window.testEvents.push([type,e.pointerType,e.pointerId,e.target.className]),true);
      const hit=document.querySelector('.pet-hit');
      hit.addEventListener('pointerdown',()=>window.active=true);
      window.addEventListener('pointerup',()=>window.active=false);
      hit.addEventListener('click',()=>window.testClicks++);
      hit.addEventListener('contextmenu',event=>{
        event.preventDefault();if(window.active)return;
        window.PetShared.mountContextMenu({x:event.clientX,y:event.clientY,tree:[{label:'动作',children:[{label:'跳舞',anim:'dance'}]},{label:'对话',action:'chat'}],onAction:node=>{
          window.testActions.push(node.anim||node.action);
          if(node.action==='chat')window.PetShared.mountChatDialog({petId:'main',x:200,y:200,onReply:reply=>window.testReply=reply});
        }});
      });
      window.fetch=async(url,options)=>({json:async()=>options?.method==='POST'?(window.sent=JSON.parse(options.body),{ok:true,reply:'测试回复'}):{ok:true,messages:[]}});
    });
    const runtime=readFileSync(new URL('../src/touch.mjs',import.meta.url),'utf8').replaceAll('export function ','function ');
    await page.addScriptTag({content:runtime+'\ninstallTouchUI();'});
    const cdp=await context.newCDPSession(page);
    await page.clock.install();
    const menuButton=page.locator('.fatfish-touch-menu');
    assert.equal(await menuButton.isVisible(),false);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:230,y:230}]});
    await page.clock.fastForward(4000);
    assert.equal(await menuButton.isVisible(),true,'holding keeps the button visible');
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    await page.clock.fastForward(2000);
    assert.equal(await menuButton.isVisible(),true);
    await page.locator('.pet-hit').tap();
    await page.clock.fastForward(2000);
    assert.equal(await menuButton.isVisible(),true,'another touch restarts the timeout');
    await page.clock.fastForward(1100);
    assert.equal(await menuButton.isVisible(),false,'idle button disappears');
    await page.locator('.pet-hit').tap();
    const clicksBeforeMenu=await page.evaluate(()=>window.testClicks);
    const open=async()=>{
      await page.getByRole('button',{name:'肥鱼菜单'}).tap();
      assert.deepEqual(errors,[]);
      assert.ok(await page.locator('.dsh-pet-menu-column').count(),JSON.stringify(await page.evaluate(()=>({events:window.testEvents,active:window.active,html:document.body.innerHTML}))));
      await page.locator('.dsh-pet-menu-column:visible').first().waitFor();
    };
    await open();assert.equal(await page.evaluate(()=>window.testClicks),clicksBeforeMenu);
    await page.locator('.dsh-pet-menu').dispatchEvent('mouseleave');
    await page.clock.fastForward(250);
    assert.equal(await page.locator('.dsh-pet-menu').count(),1,'touch does not require hover');
    await page.getByText('动作',{exact:true}).tap();
    await page.getByText('跳舞',{exact:true}).tap();
    assert.deepEqual(await page.evaluate(()=>window.testActions),['dance']);
    await open();await page.getByText('对话',{exact:true}).tap();
    await page.locator('.dsh-pet-chat-input').fill('触屏发送测试');
    await page.locator('.dsh-pet-chat-input').evaluate(input=>{
      input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,isComposing:true}));
    });
    assert.equal(await page.evaluate(()=>window.sent),undefined);
    await page.locator('.dsh-pet-chat-input').evaluate(input=>input.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    assert.ok(await page.getByRole('button',{name:'发送'}).evaluate(el=>el.getBoundingClientRect().height)>=44);
    await page.getByRole('button',{name:'发送'}).tap();
    await page.waitForFunction(()=>window.testReply==='测试回复');
    assert.equal(await page.evaluate(()=>window.sent.text),'触屏发送测试');
    await page.locator('.pet-hit').click({button:'right'});
    await page.locator('.dsh-pet-menu').dispatchEvent('mouseleave');
    await page.clock.fastForward(250);
    assert.equal(await page.locator('.dsh-pet-menu').count(),0,'mouse keeps upstream leave-to-close on a touch device');
    await page.locator('.pet-hit').tap();await open();await page.getByText('对话',{exact:true}).tap();
    await page.evaluate(()=>{window.fetch=()=>new Promise(()=>{});});
    await page.locator('.dsh-pet-chat-input').fill('pending');
    await page.getByRole('button',{name:'发送'}).tap();
    assert.equal(await page.locator('.dsh-pet-chat-input').isDisabled(),true);
    await page.getByRole('button',{name:'关闭'}).tap();
    assert.equal(await page.locator('.dsh-pet-chat').count(),0,'close remains available during generation');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();}
});
