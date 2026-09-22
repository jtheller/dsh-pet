// Reuse the host's existing helper restart/backoff instead of a second watchdog.
export function installDesktopHealth({app,readFileSync,writeFileSync,logPath,raiseInput=()=>{},now=Date.now,setInterval=globalThis.setInterval,clearInterval=globalThis.clearInterval}) {
  let stopping=false;
  app.on('before-quit',()=>{stopping=true;});
  return (win,petId)=>{
    const record=(event,details={})=>{
      try{
        const state=win.isDestroyed()?{destroyed:true}:{visible:win.isVisible(),minimized:win.isMinimized(),bounds:win.getBounds()};
        const line=JSON.stringify({at:now(),petId,event,...state,...details})+'\n';
        let previous='';try{previous=readFileSync(logPath,'utf8');}catch{}
        // Keep complete records, bounded; never store chat, URLs or credentials.
        if(previous.length>32768)previous=previous.slice(previous.indexOf('\n',previous.length-32768)+1);
        writeFileSync(logPath,previous+line,'utf8');
      }catch{} // Diagnostics must never prevent a window from opening or closing.
    };
    for(const event of ['show','hide','minimize','restore','closed'])win.on(event,()=>record(event));
    // Windows can leave WS_EX_TOPMOST set while ordinary windows cover the pet.
    // isAlwaysOnTop alone misses that state. Reassert z-order without show/focus,
    // and lift the separate input window last to preserve hit-test order.
    const topTimer=process.platform==='win32'?setInterval(()=>{
      if(stopping||win.isDestroyed()||!win.isVisible()||win.isMinimized())return;
      if(!win.isAlwaysOnTop())win.setAlwaysOnTop(true,'screen-saver');
      win.moveTop();
      raiseInput(win);
    },2000):null;
    topTimer?.unref?.();
    win.once('closed',()=>{if(topTimer!==null)clearInterval(topTimer);});
    win.webContents.on('render-process-gone',(_event,details)=>{
      record('render-process-gone',{reason:details.reason,exitCode:details.exitCode});
      if(stopping||win.isDestroyed())return;
      stopping=true;
      // A dead renderer leaves a live helper and a transparent, unusable window.
      // Exiting lets the upstream host cleanly recreate pet + input windows,
      // using its existing retry limit. Explicit hiding/disposal stops that host.
      app.exit(1);
    });
    record('created');
  };
}
