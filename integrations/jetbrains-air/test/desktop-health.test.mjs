import {test} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installDesktopHealth} from '../src/desktop-health.mjs';

function setup(){
  const app=new EventEmitter(),exits=[];app.exit=code=>exits.push(code);
  let log='';
  let tick;const order=[],cleared=[];
  const watch=installDesktopHealth({app,readFileSync:()=>log,writeFileSync:(_,s)=>{log=s;},logPath:'test',now:()=>123,raiseInput:()=>order.push('input'),setInterval:fn=>{tick=fn;return 42;},clearInterval:id=>cleared.push(id)});
  const win=new EventEmitter();win.webContents=new EventEmitter();win.isDestroyed=()=>false;
  win.isVisible=()=>true;win.isMinimized=()=>false;win.getBounds=()=>({x:10,y:20,width:300,height:200});
  win.isAlwaysOnTop=()=>true;win.moveTop=()=>order.push('pet');win.setAlwaysOnTop=()=>order.push('topmost');
  watch(win,'main');return {app,win,watch,exits,log:()=>log,tick:()=>tick(),order,cleared};
}
test('visible topmost pet reasserts actual z-order without focus or showing hidden windows',{skip:process.platform!=='win32'},()=>{
  const s=setup();s.tick();assert.deepEqual(s.order,['pet','input'],'topmost flag alone is insufficient');
  s.order.length=0;s.win.isAlwaysOnTop=()=>false;s.tick();assert.deepEqual(s.order,['topmost','pet','input']);
  s.order.length=0;s.win.isVisible=()=>false;s.tick();assert.deepEqual(s.order,[]);
  s.win.isVisible=()=>true;s.win.isMinimized=()=>true;s.tick();assert.deepEqual(s.order,[]);
  s.win.isMinimized=()=>false;s.app.emit('before-quit');s.tick();assert.deepEqual(s.order,[]);
  s.win.emit('closed');assert.deepEqual(s.cleared,[42]);
});
test('dead renderer exits the live helper once so upstream bounded restart can run',()=>{
  const s=setup();
  s.win.webContents.emit('render-process-gone',{}, {reason:'crashed',exitCode:2});
  s.win.webContents.emit('render-process-gone',{}, {reason:'killed',exitCode:1});
  assert.deepEqual(s.exits,[1]);
  const rows=s.log().trim().split('\n').map(JSON.parse);
  assert.equal(rows[1].reason,'crashed');assert.equal(rows[1].visible,true);
});
test('explicit hiding, minimizing, closing and app shutdown do not force a pet back',()=>{
  const s=setup();
  for(const event of ['hide','minimize','restore','show','closed'])s.win.emit(event);
  assert.deepEqual(s.exits,[]);
  s.app.emit('before-quit');s.win.webContents.emit('render-process-gone',{}, {reason:'clean-exit',exitCode:0});
  assert.deepEqual(s.exits,[]);
});
test('window health records are bounded and logging failure does not prevent crash recovery',()=>{
  const s=setup();for(let i=0;i<900;i++)s.win.emit('hide');
  assert.ok(s.log().length<34000);s.log().trim().split('\n').forEach(JSON.parse);
  const app=new EventEmitter();let code;app.exit=value=>{code=value;};
  const watch=installDesktopHealth({app,readFileSync:()=>{throw Error('unavailable');},writeFileSync:()=>{throw Error('read-only');}});
  watch(s.win,'second');s.win.webContents.emit('render-process-gone',{}, {reason:'oom',exitCode:-1});assert.equal(code,1);
});
