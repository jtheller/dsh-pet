import {installInputOverlay} from './input-overlay.mjs';
import {installDesktopHealth} from './desktop-health.mjs';
import {fatfishWorkText,fatfishWorkView,fatfishCalmWaiting,fatfishWorkMetadata,fatfishExpressionClip} from './touch.mjs';
export const TOUCH_MARKER='// FATFISH TOUCH v1';
function replaceOnce(code,anchor,replacement){
  if(code.split(anchor).length!==2)throw new Error('Touch patch anchor mismatch: '+anchor.slice(0,70));
  return code.replace(anchor,replacement);
}
export function patchTouchAsset(name,code,runtime){
  if(code.includes(TOUCH_MARKER))throw new Error('Expected unpatched UI asset');
  if(name==='lib/client.js'||name==='runtime/electron-helper/shared-core.js'){
    // Translate presentation only; leaf.anim and event keys remain stable IDs.
    const labels={
      'fatfish-dialogue-happy':'开心跃动','fatfish-dialogue-shy':'害羞惊讶',
      'fatfish-dialogue-angry':'傲娇生气','fatfish-dialogue-wave':'元气挥手',
      'fatfish-dialogue-relaxed':'伸个懒腰','fatfish-dialogue-bow':'屈膝行礼',
      'fatfish-working-code':'写代码','fatfish-working-notes':'轻快记录','fatfish-working-tokens':'吃Token',
      'fatfish-attention-angry':'傲娇催促','fatfish-attention-wave':'挥手招呼'
    };
    code=replaceOnce(code,'const EVENT_LABELS = {','const EVENT_LABELS = {\n\tfatfishDialogue: "对话表情",');
    code=replaceOnce(code,'const leaf = (anim) => ({\n\tlabel: anim,',
      'const FATFISH_MENU_LABELS = '+JSON.stringify(labels)+';\nconst leaf = (anim) => ({\n\tlabel: Object.hasOwn(FATFISH_MENU_LABELS,anim) ? FATFISH_MENU_LABELS[anim] : anim,');
    const from=code.indexOf('async function sendChat('),to=code.indexOf('\n}',from)+2;
    if(from<0||to<from)throw Error('Chat transport boundary missing');
    const chat=code.slice(from,to);
    if(chat.split('ts: Number(o.ts) || 0').length!==3)throw Error('Chat return layout changed');
    code=code.slice(0,from)+chat.replaceAll('ts: Number(o.ts) || 0','ts: Number(o.ts) || 0, fatfishExpression: o.fatfishExpression')+code.slice(to);
    code=replaceOnce(code,'onReply(state.reply, state.image)','onReply(state.reply, state.image, state.fatfishExpression)');
    if(name.endsWith('shared-core.js'))return TOUCH_MARKER+'\n'+code;
  }
  if(name==='runtime/electron-helper/sprite.js'){
    code=replaceOnce(code,'onReply: (reply, image) => {','onReply: (reply, image, fatfishExpression) => {');
    return TOUCH_MARKER+'\n'+replaceOnce(code,'this.showWhisper(reply, image);','this.showWhisper(reply, image, fatfishExpression);');
  }
  if(name==='runtime/electron-helper/events.js')return TOUCH_MARKER+'\n'+replaceOnce(code,"this.showWhisper(d.text, typeof d.image === 'string' ? d.image : '');","this.showWhisper(d.text, typeof d.image === 'string' ? d.image : '', d.fatfishExpression);");
  if(name==='lib/client.js' || name==='runtime/electron-helper/renderer.js'){
    if(name==='lib/client.js'){
      code=fatfishWorkText.toString()+'\n'+fatfishExpressionClip.toString()+'\n'+fatfishWorkMetadata.toString()+'\n'+fatfishWorkView.toString()+'\n'+fatfishCalmWaiting.toString()+'\n'+code;
      code=replaceOnce(code,'onReply: (reply, image) => {','onReply: (reply, image, fatfishExpression) => {');
      code=replaceOnce(code,'triggerWhisper(reply, image);','triggerWhisper(reply, image, fatfishExpression);');
      code=replaceOnce(code,'triggerWhisper(d.text, typeof d.image === "string" ? d.image : void 0);','triggerWhisper(d.text, typeof d.image === "string" ? d.image : void 0, d.fatfishExpression);');
      const whisperFrom=code.indexOf('const triggerWhisper = (text, image) => {'),whisperTo=code.indexOf('\n\t\t};',whisperFrom)+6;
      if(whisperFrom<0||whisperTo<whisperFrom)throw Error('Whisper boundary missing');
      let whisper=code.slice(whisperFrom,whisperTo);
      whisper=replaceOnce(whisper,'(text, image) =>','(text, image, fatfishExpression) =>');
      whisper=replaceOnce(whisper,'const name = pickSlot(pick(pool, animRef.current), animRef.current);','const name = fatfishExpressionClip(fatfishExpression,petAnims,Date.now(),cfg.balanceEnabled) || pickSlot(pick(pool, animRef.current), animRef.current);');
      whisper=replaceOnce(whisper,'stopMove();','const busy=dragRef.current.active || dragRef.current.dragging || throwRef.current !== null;\n          if(!busy)stopMove();');
      whisper=replaceOnce(whisper,'setOnce(true);\n\t\t\tsetAnim(name);','if(!busy){setOnce(true);setAnim(name);}');
      code=code.slice(0,whisperFrom)+whisper+code.slice(whisperTo);
      code=replaceOnce(code,'task: typeof raw.task === "string" ? raw.task : null,\n\t\tts: Number(raw.ts) || 0',
        'task: typeof raw.task === "string" ? raw.task : null,\n\t\tts: Number(raw.ts) || 0,\n\t\t...fatfishWorkMetadata(raw)');
      code=replaceOnce(code,'prevWorkTickRef.current = workStatusTick;',`prevWorkTickRef.current = workStatusTick;
      if (workStatus?.fatfishManaged || Number.isFinite(workStatus?.fatfishNoticeUntil)) {
        const memory = prevWorkStateRef.fatfish ??= {};
        const previousState = memory.state;
        const view = fatfishWorkView(workStatus, memory, Date.now());
        prevWorkStateRef.current = view.state;
        if (view.animate) {
          const idx = WORK_STATUS_INDEX[view.state];
          const group = cfg.workStatusTexts?.[idx];
          memory.defaultText = Array.isArray(group) && group.length ? group[Math.floor(Math.random()*group.length)] : null;
          if (!dragRef.current.active && !dragRef.current.dragging && (view.state || previousState && !['success','error'].includes(previousState))) {
            const slot = view.state ? petAnims.events?.workStatus?.[idx] : petAnims.idle;
            if (slot) {
              stopMove();
              setOnce(!view.state || view.state === 'success' || view.state === 'error' || Array.isArray(slot) && slot.length > 1);
              setAnim(pickSlot(slot, animRef.current));
              setSeq(s => s + 1);
            }
          }
        }
        const expression=workStatus.fatfishExpression;
        if(expression && memory.expressionAt!==expression.at){
          memory.expressionAt=expression.at;
          const clip=fatfishExpressionClip(expression,petAnims,Date.now(),cfg.balanceEnabled);
          if(clip && view.state!=='waiting' && !dragRef.current.active && !dragRef.current.dragging && throwRef.current===null){stopMove();setOnce(true);setAnim(clip);setSeq(s=>s+1);}
        }
        setWorkText(fatfishWorkText(view,memory.defaultText));
        setWorkBubbleOn(view.visible);
        if (workBubbleTimerRef.current !== null) window.clearTimeout(workBubbleTimerRef.current);
        workBubbleTimerRef.current = view.visible && view.until > Date.now()
          ? window.setTimeout(() => {
            const current=fatfishWorkView(memory.snapshot,memory,Date.now());
            setWorkText(fatfishWorkText(current,memory.defaultText));setWorkBubbleOn(current.visible);
          }, Math.min(300000, view.until - Date.now())) : null;
        return;
      }
      if (prevWorkStateRef.fatfish) {
        delete prevWorkStateRef.fatfish; prevWorkStateRef.current = undefined;
        if (!workStatus?.state && !dragRef.current.active && petAnims.idle.length) { setOnce(true); setAnim(pickSlot(petAnims.idle, animRef.current)); setSeq(s => s + 1); }
      }`);
      code=replaceOnce(code,'const handleClick = () => {\n\t\t\tconst d = dragRef.current;\n\t\t\tif (d.active || d.dragging || justDraggedRef.current) return;',
        `const handleClick = () => {
          const d = dragRef.current;
          if (d.active || d.dragging || justDraggedRef.current) return;
          const memory = prevWorkStateRef.fatfish;
          if (memory) {
            const waiting = memory.state === 'waiting' && memory.attention != null;
            if (waiting) memory.acknowledged = memory.attention;
            if (memory.until > Date.now()) memory.dismissed = memory.until;
            if (waiting || memory.until > Date.now()) {
              if (workBubbleTimerRef.current !== null) window.clearTimeout(workBubbleTimerRef.current);
              const view=fatfishWorkView(memory.snapshot,memory,Date.now());
              workBubbleTimerRef.current = null;setWorkText(fatfishWorkText(view,memory.defaultText));setWorkBubbleOn(view.visible);
            }
          }`);
      code=replaceOnce(code,'const ws = workStatusRef.current;\n\t\t\tif (!ws',`const ws = workStatusRef.current;
          const memory = prevWorkStateRef.fatfish;
          if (ws?.state === 'waiting' && ws.fatfishAttentionRevision != null && memory?.acknowledged === ws.fatfishAttentionRevision) {
            const name = fatfishCalmWaiting(petAnims);
            if (name) { setOnce(false); setAnim(name); return true; }
          }
          if (!ws`);
      code=replaceOnce(code,'const wsNow = workStatusRef.current;',`const wsNow = workStatusRef.current;
          if (isEvent && wsNow?.state === 'waiting' && wsNow.fatfishAttentionRevision != null && prevWorkStateRef.fatfish?.acknowledged === wsNow.fatfishAttentionRevision) {
            if (resumeWorkStatusAnim()) return;
          }`);
    }
    if(name==='runtime/electron-helper/renderer.js')code=replaceOnce(code,'    if (!applyDeskGeometry(geo)) return;','    if (window.__fatfishDisplays) { window.__fatfishDisplays(geo); return; }\n    if (!applyDeskGeometry(geo)) return;');
    const script=runtime.replaceAll('export function ','function ');
    return TOUCH_MARKER+'\n'+code+'\n;(()=>{'+script+'\nif(document.readyState==="loading")document.addEventListener("DOMContentLoaded",installTouchUI,{once:true});else installTouchUI();})();\n';
  }
  if(name==='runtime/electron-helper/preload.js')return TOUCH_MARKER+'\n'+replaceOnce(code,"contextBridge.exposeInMainWorld('petBridge', {","contextBridge.exposeInMainWorld('petBridge', {\n  updateInputRegions(payload) { ipcRenderer.send('fatfish:input-regions',payload); },\n  routeOverlayInput(payload) { ipcRenderer.send('fatfish:overlay-input',payload); },\n  onOverlayCursor(callback) { const listener=(_,cursor)=>callback(cursor);ipcRenderer.on('fatfish:overlay-cursor',listener);return ()=>ipcRenderer.removeListener('fatfish:overlay-cursor',listener); },\n  onOverlayInput(callback) { const listener=(_,payload)=>callback(payload);ipcRenderer.on('fatfish:overlay-input',listener);return ()=>ipcRenderer.removeListener('fatfish:overlay-input',listener); },\n  getTouchFrame() { return ipcRenderer.sendSync('fatfish:touch-frame'); },\n  setTouchEnabled(enabled) { ipcRenderer.send('fatfish:touch-enabled', enabled === true); },\n  getTouchViewport() { return ipcRenderer.invoke('fatfish:touch-viewport'); },");
  if(name==='runtime/electron-helper/main.js'){
    code=replaceOnce(code,'function createPetWindows() {',`const fatfishWatchWindow=(${installDesktopHealth.toString()})({app,readFileSync,writeFileSync,logPath:path.join(app.getPath('userData'),'fatfish-window-health.jsonl'),raiseInput:win=>fatfishInputOverlay.raise(win)});
function createPetWindows() {`);
    code=replaceOnce(code,"    win.setAlwaysOnTop(true, 'screen-saver');","    fatfishWatchWindow(win,pet.id);\n    win.setAlwaysOnTop(true, 'screen-saver');");
    code=replaceOnce(code,'const windowIgnore = new Map();',`const windowIgnore = new Map();
const fatfishTouchWindows = new WeakSet();
const fatfishInputOverlay=(${installInputOverlay.toString()})({BrowserWindow,ipcMain,windows,setWindowIgnore,preload:path.join(__dirname,'preload.js')});
ipcMain.on('fatfish:touch-frame', (event) => {
  const win=BrowserWindow.fromWebContents(event.sender);
  event.returnValue=!win || win.isDestroyed() || ![...windows.values()].includes(win)
    ? null : {...win.getContentBounds(),zoom:win.webContents.getZoomFactor()};
});
ipcMain.on('fatfish:touch-enabled', (event, enabled) => {
  const win=BrowserWindow.fromWebContents(event.sender);
  if(process.platform!=='win32' || !win || win.isDestroyed() || ![...windows.values()].includes(win) || enabled!==true)return;
  fatfishTouchWindows.add(win);setWindowIgnore(win,false);
});
ipcMain.handle('fatfish:touch-viewport', (event) => {
  const win=BrowserWindow.fromWebContents(event.sender);
  if(!win || win.isDestroyed() || ![...windows.values()].includes(win))return null;
  const zoom=win.webContents.getZoomFactor();
  const bounds=win.getContentBounds(),work=screen.getDisplayMatching(bounds).workArea;
  const left=Math.max(bounds.x,work.x),top=Math.max(bounds.y,work.y);
  return {x:(left-bounds.x)/zoom,y:(top-bounds.y)/zoom,width:Math.max(0,Math.min(bounds.x+bounds.width,work.x+work.width)-left)/zoom,height:Math.max(0,Math.min(bounds.y+bounds.height,work.y+work.height)-top)/zoom};
});`);
    code=replaceOnce(code,'function setWindowIgnore(win, ignore) {','function setWindowIgnore(win, ignore) {\n  const overlayIgnore=fatfishInputOverlay.ignore(win);\n  if (overlayIgnore!==null) ignore=overlayIgnore;\n  else if (fatfishTouchWindows.has(win)) ignore = false;\n  if (windowIgnore.get(win.id) === ignore) return;');
    return TOUCH_MARKER+'\n'+code;
  }
  throw new Error('Unsupported touch asset: '+name);
}
