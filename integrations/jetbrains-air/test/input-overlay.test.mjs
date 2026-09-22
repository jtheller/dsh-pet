import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installInputOverlay} from '../src/input-overlay.mjs';

test('input overlay restricts only input, relays screen coordinates, and follows panel/visibility lifecycle',{skip:process.platform!=='win32'},async()=>{
  const created=[],handlers={},sent=[],ignores=[];
  class Window extends EventEmitter {
    constructor(options){super();this.options=options;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.shapes=[];this.visible=false;this.destroyed=false;this.webContents=new EventEmitter();this.webContents.getZoomFactor=()=>1.5;this.webContents.setWindowOpenHandler=()=>{};this.webContents.send=(...args)=>sent.push(args);created.push(this);}
    static fromWebContents(sender){return created.find(w=>w.webContents===sender);}
    isDestroyed(){return this.destroyed;}getContentBounds(){return this.bounds;}
    setContentBounds(b){this.bounds=b;}setShape(rects){this.shapes.push(rects);}
    isVisible(){return this.visible;}showInactive(){this.visible=true;}hide(){this.visible=false;}
    focus(){this.focusCount=(this.focusCount||0)+1;}
    isMinimized(){return false;}isAlwaysOnTop(){return true;}moveTop(){this.raiseCount=(this.raiseCount||0)+1;}
    setAlwaysOnTop(){}loadURL(){return Promise.resolve();}
    destroy(){this.destroyed=true;this.emit('closed');}
  }
  const win=new Window({x:-100,y:200,width:900,height:650});win.visible=true;
  const windows=new Map([['main',win]]);
  const router=installInputOverlay({BrowserWindow:Window,ipcMain:{on:(key,cb)=>handlers[key]=cb},windows,setWindowIgnore:(w,i)=>ignores.push(i),preload:'test'});
  const event={sender:win.webContents},payload={rects:[{x:200,y:100,width:120,height:160}],panelOpen:false};
  handlers['fatfish:input-regions']({sender:{}},payload);assert.equal(created.length,1);
  handlers['fatfish:input-regions'](event,payload);
  const overlay=created[1];overlay.webContents.emit('did-finish-load');
  assert.equal(overlay.options.focusable,true,'Windows must be able to activate a real press after chat closes');
  assert.equal(overlay.options.parent,undefined,'independent native z-order, paired lifecycle in the adapter');
  assert.equal(overlay.options.skipTaskbar,true);assert.equal(overlay.focusCount,undefined,'showing the input layer must not proactively take focus');
  assert.equal(router.ignore(win),true);assert.equal(overlay.visible,true);
  router.raise(win);assert.equal(overlay.raiseCount,1);assert.equal(overlay.focusCount,undefined);
  win.isMinimized=()=>true;win.emit('minimize');assert.equal(overlay.visible,false);
  handlers['fatfish:input-regions'](event,payload);assert.equal(overlay.visible,false,'polling must not revive a minimized input window');
  win.isMinimized=()=>false;win.emit('restore');assert.equal(overlay.visible,true);
  assert.deepEqual(overlay.shapes,[[{x:300,y:150,width:180,height:240}]]);assert.deepEqual(win.shapes,[]);
  handlers['fatfish:input-regions'](event,payload);assert.equal(overlay.shapes.length,1,'unchanged region is not reset');
  win.bounds={...win.bounds,x:50};win.emit('move');assert.equal(overlay.bounds.x,50);
  handlers['fatfish:overlay-input']({sender:overlay.webContents},{type:'pointermove',pointerType:'touch',pointerId:1,button:0,buttons:1,clientX:330,clientY:180});
  const routed=sent.find(([channel])=>channel==='fatfish:overlay-input')[1];assert.equal(routed.screenX,380);assert.equal(routed.clientX,220);
  handlers['fatfish:input-regions'](event,{...payload,panelOpen:true});assert.equal(router.ignore(win),false);assert.equal(overlay.visible,false);
  assert.equal(win.focusCount,1);
  router.raise(win);assert.equal(overlay.raiseCount,1,'chat/menu input layer remains hidden');
  handlers['fatfish:input-regions'](event,{...payload,panelOpen:true,cursor:'grabbing'});assert.equal(win.focusCount,1);
  assert.ok(sent.some(([channel,cursor])=>channel==='fatfish:overlay-cursor'&&cursor==='grabbing'));
  handlers['fatfish:input-regions'](event,payload);assert.equal(router.ignore(win),true);
  handlers['fatfish:overlay-input']({sender:overlay.webContents},{type:'pointerdown',pointerType:'mouse',pointerId:1,button:0,buttons:1,clientX:330,clientY:180});assert.equal(win.focusCount,2);
  const shapeCount=overlay.shapes.length;
  handlers['fatfish:input-regions'](event,{...payload,rects:[{x:210,y:110,width:120,height:160}]});
  assert.equal(overlay.shapes.length,shapeCount,'moving hit rectangle must not reset native capture mid-drag');
  handlers['fatfish:overlay-input']({sender:overlay.webContents},{type:'pointercancel',pointerType:'mouse',pointerId:1,button:0,buttons:0,clientX:330,clientY:180});
  assert.equal(overlay.shapes.length,shapeCount+1,'apply deferred input shape after release');
  handlers['fatfish:overlay-input']({sender:overlay.webContents},{type:'mousedown',pointerType:'mouse',pointerId:0,button:0,buttons:1,clientX:330,clientY:180});assert.equal(sent.at(-1)[1].type,'mousedown');
  for(let cycle=0;cycle<3;cycle++){
    handlers['fatfish:input-regions'](event,{...payload,panelOpen:true});
    const focusBeforeClose=win.focusCount;
    handlers['fatfish:input-regions'](event,payload);
    assert.equal(overlay.visible,true);assert.equal(router.ignore(win),true);
    assert.equal(win.focusCount,focusBeforeClose,'closing a panel does not steal focus');
    for(const type of ['pointerdown','pointerup'])handlers['fatfish:overlay-input']({sender:overlay.webContents},{type,pointerType:'mouse',pointerId:1,button:0,buttons:type==='pointerdown'?1:0,clientX:330,clientY:180});
    assert.equal(win.focusCount,focusBeforeClose+1,'a real press returns keyboard input to the original pet window');
    assert.equal(sent.at(-1)[1].type,'pointerup');assert.equal(overlay.focusCount,undefined);
  }
  win.emit('hide');assert.equal(overlay.visible,false);win.emit('show');assert.equal(overlay.visible,true);
  overlay.webContents.emit('render-process-gone');assert.equal(router.ignore(win),null);assert.equal(overlay.destroyed,true);
  assert.equal(win.listenerCount('move'),0);assert.equal(win.listenerCount('closed'),0);
  handlers['fatfish:input-regions'](event,payload);const replacement=created[2];replacement.webContents.emit('did-finish-load');
  assert.equal(win.listenerCount('move'),1);assert.equal(router.ignore(win),true);
  win.destroy();assert.equal(replacement.destroyed,true);assert.equal(router.ignore(win),null);
});
