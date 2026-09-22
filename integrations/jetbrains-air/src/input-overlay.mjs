// A separate, invisible input window. Never shape/crop the animated pet window.
export function installInputOverlay({BrowserWindow,ipcMain,windows,setWindowIgnore,preload}) {
  const overlays=new Map(),owners=new Map();
  const owned=event=>{const win=BrowserWindow.fromWebContents(event.sender);return win&&!win.isDestroyed()&&[...windows.values()].includes(win)?win:null;};
  const html=`<!doctype html><html><body style="margin:0;width:100vw;height:100vh;touch-action:none;user-select:none;background:rgba(0,0,0,0.004)"><script>
    const active=new Map();
    const cancel=e=>{const previous=active.get(e.pointerId);if(!previous)return;active.delete(e.pointerId);window.petBridge.routeOverlayInput({...previous,type:'pointercancel',buttons:0});};
    window.addEventListener('lostpointercapture',cancel);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)for(const pointerId of [...active.keys()])cancel({pointerId});});
    window.petBridge.onOverlayCursor(cursor=>{document.body.style.cursor=cursor;});
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','mousedown','mouseup','click','contextmenu','wheel'])window.addEventListener(type,e=>{
      if(type==='contextmenu')e.preventDefault();
      const data={type,pointerId:e.pointerId||0,pointerType:e.pointerType||'mouse',isPrimary:e.isPrimary!==false,clientX:e.clientX,clientY:e.clientY,button:e.button,buttons:e.buttons,...(type==='wheel'?{deltaY:e.deltaY,deltaMode:e.deltaMode}:{})};
      if(type==='pointerdown'){active.set(e.pointerId,data);try{document.body.setPointerCapture(e.pointerId)}catch{}}
      if(type==='pointermove'&&!active.has(e.pointerId))return;
      if(type==='pointermove'&&e.pointerType==='mouse'&&e.buttons===0){cancel(e);return;}
      if(type==='pointermove')active.set(e.pointerId,data);
      window.petBridge.routeOverlayInput(data);
      if(type==='pointerup'||type==='pointercancel')active.delete(e.pointerId);
    },{passive:false});
  </script></body></html>`;
  const sync=win=>{
    const state=overlays.get(win);if(!state||state.overlay.isDestroyed())return;
    const b=win.getContentBounds();const key=JSON.stringify(b);
    if(state.bounds!==key){state.bounds=key;state.overlay.setContentBounds(b,false);}
  };
  ipcMain.on('fatfish:input-regions',(event,payload)=>{
    const win=owned(event);if(!win||process.platform!=='win32')return;
    if(!payload||!Array.isArray(payload.rects)||payload.rects.length>32||typeof payload.panelOpen!=='boolean')return;
    const zoom=win.webContents.getZoomFactor(),b=win.getContentBounds(),rects=[];
    for(const r of payload.rects){
      if(!r||![r.x,r.y,r.width,r.height].every(Number.isFinite)||r.width<=0||r.height<=0)return;
      const x=Math.max(0,Math.floor(r.x*zoom)),y=Math.max(0,Math.floor(r.y*zoom));
      const right=Math.min(b.width,Math.ceil((r.x+r.width)*zoom)),bottom=Math.min(b.height,Math.ceil((r.y+r.height)*zoom));
      if(right>x&&bottom>y)rects.push({x,y,width:right-x,height:bottom-y});
    }
    if(!rects.length)return;
    let state=overlays.get(win);
    if(!state){
      // Keep native click activation enabled: a non-focusable overlay can lose
      // mouse-down after a menu/chat hide-show cycle on Windows (WM_MOUSEACTIVATE).
      // showInactive avoids stealing focus on updates; a real press below hands
      // keyboard focus back to the pet, which owns menus, chat and Escape.
      const overlay=new BrowserWindow({...b,show:false,frame:false,transparent:true,hasShadow:false,resizable:false,skipTaskbar:true,focusable:true,parent:win,webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
      state={overlay,ready:false,panelOpen:false,shape:'',bounds:'',pointers:new Set(),pendingShape:null};overlays.set(win,state);owners.set(overlay,win);
      const onMove=()=>sync(win),onShow=()=>{if(!overlay.isDestroyed()&&state.ready&&!state.panelOpen)overlay.showInactive();},onHide=()=>{state.pointers.clear();if(!overlay.isDestroyed())overlay.hide();};
      const recover=()=>{if(overlays.get(win)!==state)return;for(const [type,fn] of [['move',onMove],['resize',onMove],['show',onShow],['hide',onHide],['closed',recover]])win.removeListener(type,fn);owners.delete(overlay);overlays.delete(win);if(!win.isDestroyed())setWindowIgnore(win,false);if(!overlay.isDestroyed())overlay.destroy();};
      overlay.webContents.once('render-process-gone',recover);
      overlay.once('closed',recover);
      overlay.setAlwaysOnTop(true,'screen-saver');
      overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));
      overlay.webContents.on('will-navigate',e=>e.preventDefault());
      overlay.webContents.once('did-finish-load',()=>{state.ready=true;sync(win);overlay.webContents.send('fatfish:overlay-cursor',state.cursor||'grab');setWindowIgnore(win,false);if(win.isVisible()&&!state.panelOpen)overlay.showInactive();});
      win.on('move',onMove);win.on('resize',onMove);win.on('show',onShow);win.on('hide',onHide);win.once('closed',recover);
      overlay.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(html)).catch(recover);
    }
    const opening=payload.panelOpen&&!state.panelOpen;
    state.panelOpen=payload.panelOpen;
    if(typeof payload.cursor==='string'&&payload.cursor.length<=4096&&payload.cursor!==state.cursor){state.cursor=payload.cursor;if(state.ready)state.overlay.webContents.send('fatfish:overlay-cursor',state.cursor);}
    const shape=JSON.stringify(rects);
    if(shape!==state.shape){if(state.pointers.size)state.pendingShape={rects,shape};else{state.overlay.setShape(rects);state.shape=shape;state.pendingShape=null;}}else state.pendingShape=null;
    sync(win);setWindowIgnore(win,false);
    if(state.panelOpen){state.overlay.hide();if(opening&&win.isVisible())win.focus();}else if(state.ready&&win.isVisible()&&!state.overlay.isVisible())state.overlay.showInactive();
  });
  ipcMain.on('fatfish:overlay-input',(event,data)=>{
    const overlay=BrowserWindow.fromWebContents(event.sender),win=owners.get(overlay);
    if(!win||win.isDestroyed()||!data||!['pointerdown','pointermove','pointerup','pointercancel','mousedown','mouseup','click','contextmenu','wheel'].includes(data.type))return;
    if(![data.clientX,data.clientY,data.pointerId,data.button,data.buttons].every(Number.isFinite))return;
    if(data.type==='wheel'&&(!Number.isFinite(data.deltaY)||![0,1,2].includes(data.deltaMode)))return;
    const state=overlays.get(win);
    if(data.type==='pointerdown')state?.pointers.add(data.pointerId);
    // A real press focused the original focusable pet window. Preserve keyboard
    // input (including score-popup Escape) after the input layer's native activation.
    if(data.type==='pointerdown'&&win.isVisible())win.focus();
    const b=overlay.getContentBounds(),target=win.getContentBounds(),zoom=win.webContents.getZoomFactor();
    win.webContents.send('fatfish:overlay-input',{...data,screenX:b.x+data.clientX,screenY:b.y+data.clientY,clientX:(b.x+data.clientX-target.x)/zoom,clientY:(b.y+data.clientY-target.y)/zoom});
    if(data.type==='pointerup'||data.type==='pointercancel'){
      state?.pointers.delete(data.pointerId);
      if(state&&!state.pointers.size&&state.pendingShape){state.overlay.setShape(state.pendingShape.rects);state.shape=state.pendingShape.shape;state.pendingShape=null;}
    }
  });
  return {ignore(win){const state=overlays.get(win);return state?.ready?!state.panelOpen:null;}};
}
