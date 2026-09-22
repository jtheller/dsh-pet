import {test} from 'node:test';
import assert from 'node:assert/strict';
import {patchTouchAsset} from '../src/touch-patch.mjs';
import {desktopTouchEvent} from '../src/touch.mjs';
import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
test('touch installer rejects mismatched native bridge instead of partially patching',()=>{
  assert.throws(()=>patchTouchAsset('runtime/electron-helper/main.js','unexpected',''),/anchor mismatch/);
  assert.throws(()=>patchTouchAsset('runtime/electron-helper/preload.js','unexpected',''),/anchor mismatch/);
});
test('desktop touch enables input once, never reshapes windows, validates ownership',()=>{
  const name='runtime/electron-helper/main.js';
  const original=readFileSync(new URL('../.local/upstream-package/package/'+name,import.meta.url),'utf8');
  const code=patchTouchAsset(name,original,'');
  assert.equal(code.includes('win.setShape('),false);
  const start=code.indexOf('const windowIgnore = new Map();');
  const fn=code.indexOf('function setWindowIgnore(win, ignore) {',start);
  const end=code.indexOf('\n}',fn)+2;
  const handlers={},calls=[];
  const win={id:1,isDestroyed:()=>false,webContents:{getZoomFactor:()=>2},getContentBounds:()=>({x:0,y:0,width:100,height:100}),setIgnoreMouseEvents:value=>calls.push(value)};
  const owned=new Map([['main',win]]);
  const setIgnore=new Function('ipcMain','BrowserWindow','process','windows','screen','path','__dirname',code.slice(start,end)+';return setWindowIgnore;')(
    {on:(key,cb)=>handlers[key]=cb,handle:(key,cb)=>handlers[key]=cb},{fromWebContents:()=>win},{platform:'win32'},owned,{getDisplayMatching:()=>({workArea:{x:0,y:0,width:100,height:100}})},{join:()=>''},'');
  handlers['fatfish:touch-enabled']({sender:{}},true);
  handlers['fatfish:touch-enabled']({sender:{}},true);
  setIgnore(win,true);assert.deepEqual(calls,[false]);
  assert.deepEqual(handlers['fatfish:touch-viewport']({sender:{}}),{x:0,y:0,width:50,height:50});
  const event={sender:{}};handlers['fatfish:touch-frame'](event);
  assert.deepEqual(event.returnValue,{x:0,y:0,width:100,height:100,zoom:2});
  owned.clear();assert.equal(handlers['fatfish:touch-viewport']({sender:{}}),null);
  handlers['fatfish:touch-frame'](event);assert.equal(event.returnValue,null);
});

test('native touch displacement survives moving windows at 100%, 150%, 200% and negative origins',()=>{
  for(const zoom of [1,1.5,2])for(const origin of [-1200,200]){
    const down={pointerType:'touch',clientX:150/zoom,clientY:90/zoom,screenX:150,screenY:90};
    const start=desktopTouchEvent(down,{x:origin,y:-200,zoom});
    // Finger moves 150 physical pixels while the window follows 80 pixels.
    const move={...down,clientX:220/zoom,screenX:220};
    const next=desktopTouchEvent(move,{x:origin+80,y:-200,zoom});
    assert.ok(Math.abs(next.screenX-start.screenX-150)<0.001);
    assert.equal(next.screenY,start.screenY);
    const mouse={...down,pointerType:'mouse'};
    assert.equal(desktopTouchEvent(mouse,{x:origin,y:0,zoom}),mouse);
    assert.equal(desktopTouchEvent(down,null),down);
  }
});
