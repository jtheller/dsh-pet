// Windows native touch can report widget-local screenX/Y. Reconstruct screen
// coordinates from the actual content origin and page zoom, before upstream
// applies its CONFIG.scale conversion. Never use the lagging window.screenX.
export function desktopTouchEvent(event,frame) {
  if(event.pointerType!=='touch' || !frame || ![frame.x,frame.y,frame.zoom,event.clientX,event.clientY].every(Number.isFinite) || frame.zoom<=0)return event;
  const x=frame.x+event.clientX*frame.zoom,y=frame.y+event.clientY*frame.zoom;
  return new Proxy(event,{get(target,key){
    if(key==='screenX')return x;
    if(key==='screenY')return y;
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}

// Fit inside the real visible portion of the existing window, never enlarge its
// transparent input footprint. Oversized text stays readable by scrolling.
export function fitPetBubble(bubble,viewport) {
  if(!bubble.classList.contains('is-on')){bubble.classList.remove('fatfish-bubble-scroll');return;}
  const v=viewport||{x:0,y:0,width:innerWidth,height:innerHeight};
  const style=getComputedStyle(bubble),size=parseFloat(style.getPropertyValue('--pet-size')||style.getPropertyValue('--dsh-pet-size'))||462;
  const width=Math.max(1,v.width-16),height=Math.max(1,v.height-16);
  bubble.style.boxSizing='border-box';bubble.style.width='max-content';
  bubble.style.minWidth=Math.min(size*0.1,width)+'px';
  bubble.style.maxWidth=Math.min(Math.max(320,size*1.05),640,width)+'px';
  bubble.style.maxHeight='none';bubble.style.overflowY='visible';
  const scroll=bubble.getBoundingClientRect().height>height+1;
  bubble.classList.toggle('fatfish-bubble-scroll',scroll);
  bubble.style.maxHeight=height+'px';bubble.style.overflowY=scroll?'auto':'visible';
  bubble.style.transform='translateX(-50%)';
  const r=bubble.getBoundingClientRect();
  const dx=Math.max(v.x+8,Math.min(r.x,v.x+v.width-r.width-8))-r.x;
  const dy=Math.max(v.y+8,Math.min(r.y,v.y+v.height-r.height-8))-r.y;
  bubble.style.transform=`translate(calc(-50% + ${dx}px), ${dy}px)`;
}

const overlayEvents=new WeakSet();
const localDragCancels=new WeakSet();
let displayRequest=0;
// Rebase every position expressed relative to VIEW when the desktop origin moves.
// Throw integration owns a private state closure, so resume through startThrow.
export function handleDesktopDisplays(geo) {
  const request=++displayRequest;
  // Let a newly launched throw publish its first velocity sample. Newer display
  // notifications supersede this deferred request instead of replaying old geometry.
  if(sprites.some(pet=>pet.throwRef!==null&&!pet.throwState)){
    requestAnimationFrame(()=>{if(request===displayRequest)handleDesktopDisplays(geo);});
    return;
  }
  const old={...VIEW};
  if(!applyDeskGeometry(geo))return;
  const dx=old.x-VIEW.x,dy=old.y-VIEW.y;
  for(const pet of sprites){
    const flying=pet.throwState?{...pet.throwState}:null;
    const x=pet.pos.x+dx,y=pet.pos.y+dy;
    const center=S.clampPointToRegion(AREAS,x+pet.halfW,y+pet.halfH);
    const nx=center.x-pet.halfW,ny=center.y-pet.halfH;
    const displaced=Math.abs(nx-x)>0.5||Math.abs(ny-y)>0.5;
    pet.space=null;pet.others={};
    pet.stopMove();pet.closeMenu();
    pet.pos={x:nx,y:ny};
    if(pet.dragState.active){
      if(displaced){
        pet.dragTrail=[];pet.onPointerUp();
        window.dispatchEvent(new Event('fatfish:display-cancel'));
      }else{
        pet.dragState.petX+=dx;pet.dragState.petY+=dy;
        if(pet.dragTarget){pet.dragTarget.x+=dx;pet.dragTarget.y+=dy;}
      }
    }
    pet.customPos={rx:(nx+pet.halfW)/VIEW.w,ry:(ny+pet.halfH)/VIEW.h};
    pet.sendBounds(nx,ny);
    if(flying){pet.stopThrow();pet.startThrow(nx,ny,flying.vx,flying.vy);}
  }
  window.dispatchEvent(new Event('fatfish:displays'));
}
export function installDesktopTouchCoordinates() {
  if(typeof PetSprite==='undefined' || !window.petBridge?.getTouchFrame)return;
  const proto=PetSprite.prototype;
  if(proto.__fatfishTouchCoordinates)return;
  proto.__fatfishTouchCoordinates=true;
  const sendBounds=proto.sendBounds;let moveQueued=false;
  proto.sendBounds=function(...args){const result=sendBounds.apply(this,args);if(!moveQueued){moveQueued=true;requestAnimationFrame(()=>{moveQueued=false;window.dispatchEvent(new Event('fatfish:pet-moved'));});}return result;};
  const springFollow=proto.startDragFollow;
  proto.startDragFollow=function(){
    if(this.__fatfishDirectDrag&&this.dragTarget){
      // Upstream has already applied its drag threshold and sampled velocity.
      // Follow this sample immediately; release still uses upstream throw physics.
      this.sendBounds(this.dragTarget.x,this.dragTarget.y);
      return;
    }
    return springFollow.call(this);
  };
  for(const name of ['onPointerDown','onPointerMove','onPointerUp']){
    const original=proto[name];
    proto[name]=function(event){
      const forwarded=event&&overlayEvents.has(event),owner=this.__fatfishDragPointer;
      if(name==='onPointerDown'&&event?.button===0){
        this.__fatfishDragPointer={id:event.pointerId,type:event.pointerType,forwarded};
      }else if(owner&&event&&!localDragCancels.has(event)){
        // The input overlay owns capture for forwarded streams. Native hover,
        // capture loss and releases in the visual window belong to another stream.
        if(owner.forwarded!==!!forwarded||owner.id!==event.pointerId||owner.type!==event.pointerType)return;
      }
      // Interrupted gestures are a release without a throw, never stale velocity.
      if(name==='onPointerUp'&&['pointercancel','lostpointercapture'].includes(event?.type))this.dragTrail=[];
      if(event?.pointerType==='touch'&&!overlayEvents.has(event))event=desktopTouchEvent(event,window.petBridge.getTouchFrame());
      const previous=this.__fatfishDirectDrag;
      this.__fatfishDirectDrag=name==='onPointerMove'&&['touch','mouse'].includes(event?.pointerType);
      const skipCapture=name==='onPointerDown'&&forwarded;
      const ownCapture=Object.hasOwn(this.hit,'setPointerCapture'),capture=this.hit.setPointerCapture;
      if(skipCapture)this.hit.setPointerCapture=()=>{};
      try{return original.call(this,event);}finally{
        if(skipCapture){if(ownCapture)this.hit.setPointerCapture=capture;else delete this.hit.setPointerCapture;}
        if(name==='onPointerUp')this.__fatfishDragPointer=null;
        this.__fatfishDirectDrag=previous;
      }
    };
  }
}

// Shared by desktop and Web: speech lifetime is independent of the actual work state.
export function fatfishExpressionClip(value,animations,now=Date.now(),balanceEnabled=true) {
  if(!value||!['dialogue','quota'].includes(value.kind)||!Number.isInteger(value.slot)||value.slot<0||value.slot>5||!Number.isFinite(value.at)||value.at>now+1000||now-value.at>=15000)return null;
  if(value.kind==='quota'&&balanceEnabled===false)return null;
  const slot=animations?.events?.[value.kind==='quota'?'balance':'fatfishDialogue']?.[value.slot];
  return typeof slot==='string'?slot:Array.isArray(slot)?slot.find(name=>typeof name==='string'&&name):null;
}

export function installExpressionUI() {
  if(typeof PetSprite==='undefined'||PetSprite.prototype.__fatfishExpressions)return;
  const proto=PetSprite.prototype,original=proto.showWhisper;
  proto.__fatfishExpressions=true;
  proto.showWhisper=function(text,image,expression){
    const clip=fatfishExpressionClip(expression,this.animations,Date.now(),this.pet.balanceEnabled);
    const busy=this.dragState.active||this.dragState.dragging||this.throwRef!=null;
    const play=this.playOnce,stop=this.stopMove;
    // Keep the author's bubble, image, timer and animation completion path.
    // Physical interaction wins; do not replay a stale expression after release.
    if(busy){this.playOnce=()=>{};this.stopMove=()=>{};}
    else if(clip)this.playOnce=()=>play.call(this,clip);
    try{return original.call(this,text,image);}
    finally{this.playOnce=play;this.stopMove=stop;}
  };
}

export function fatfishWorkMetadata(raw) {
  const extra={};
  if(raw?.fatfishManaged===true)extra.fatfishManaged=true;
  if(typeof raw?.fatfishBubbleMuted==='boolean')extra.fatfishBubbleMuted=raw.fatfishBubbleMuted;
  for(const key of ['fatfishNoticeUntil','fatfishAttentionRevision','fatfishStateRevision','fatfishStateUntil']){
    if(Number.isFinite(raw?.[key])&&raw[key]>=0)extra[key]=raw[key];
  }
  const e=raw?.fatfishExpression;
  if(e?.kind==='quota'&&Number.isInteger(e.slot)&&e.slot>=0&&e.slot<=5&&Number.isFinite(e.at))extra.fatfishExpression={kind:e.kind,slot:e.slot,at:e.at};
  return extra;
}

export function installWorkStatusTransport() {
  if(typeof S==='undefined'||S.__fatfishWorkTransport)return;
  S.__fatfishWorkTransport=true;
  let first=true;
  // Preserve the author's validation and fetch/bridge route, adding only our typed fields.
  S.fetchWorkStatus=async(baseUrl='/dsh-pet-7340/work-status')=>{
    const res=await fetch(baseUrl,{signal:AbortSignal.timeout(10000)});
    if(!res.ok)throw Error('dsh-pet: work-status HTTP '+res.status);
    const raw=await res.json().catch(()=>null);
    if(!raw||typeof raw!=='object')throw Error('dsh-pet: work-status 响应非法');
    const snapshot={state:raw.state===null||S.WORK_STATUS_STATES.includes(raw.state)?raw.state:null,
      task:typeof raw.task==='string'?raw.task:null,ts:Number(raw.ts)||0,...fatfishWorkMetadata(raw)};
    // The desktop loop skips its first ts as a baseline. Restore current activity
    // on its next poll even when that state stays stable; never replay old terminal events.
    if(first&&snapshot.fatfishManaged&&['working','waiting'].includes(snapshot.state))snapshot.ts=0;
    first=false;return snapshot;
  };
}

export function fatfishWorkView(snapshot,memory,now) {
  const state=snapshot?.state||null,attention=snapshot?.fatfishAttentionRevision;
  const key=JSON.stringify([state,attention??null,snapshot?.fatfishStateRevision??null]);
  const animate=memory.key!==key;
  memory.key=key;memory.attention=attention;memory.state=state;
  const deadline=Number.isFinite(snapshot?.fatfishNoticeUntil)?snapshot.fatfishNoticeUntil:0;
  const dismissed=deadline>0&&memory.dismissed===deadline;
  const held=deadline>now&&!dismissed;
  memory.until=deadline;
  memory.snapshot=snapshot;
  if(animate)memory.terminalUntil=snapshot?.fatfishStateUntil||now+10000;
  const terminal=state==='success'||state==='error';
  const until=held?deadline:terminal?memory.terminalUntil:0;
  const acknowledged=state==='waiting'&&attention!=null&&memory.acknowledged===attention;
  return {state,animate,until,task:deadline&&!held?null:snapshot?.task??null,
    visible:!snapshot?.fatfishBubbleMuted&&!acknowledged&&!(dismissed&&(!state||terminal))&&
      (held||!!state&&(!terminal||until>now))};
}

export function fatfishCalmWaiting(animations) {
  const slot=animations.events?.workStatus?.[3];
  return Array.isArray(slot)?slot.at(-1):slot;
}

export function installCompletionBubble() {
  if(typeof PetSprite==='undefined'||PetSprite.prototype.__fatfishCompletionBubble)return;
  const proto=PetSprite.prototype,original=proto.onWorkTick,originalClick=proto.onClick;
  proto.__fatfishCompletionBubble=true;
  const originalResume=proto.resumeWorkStatusAnim,originalEnded=proto.handleEnded;
  const acknowledged=pet=>pet.workState==='waiting'&&pet.__fatfishWork?.attention!=null&&pet.__fatfishWork.acknowledged===pet.__fatfishWork.attention;
  proto.resumeWorkStatusAnim=function(...args){
    if(acknowledged(this)){
      const name=fatfishCalmWaiting(this.animations);
      if(name){this.anim=name;this.once=false;this.switchTo(name,false);return true;}
    }
    return originalResume.apply(this,args);
  };
  proto.handleEnded=function(...args){
    if(!this.dragState.active&&acknowledged(this)&&S.isEventAnim(this.animations.events,this.anim))return this.resumeWorkStatusAnim();
    return originalEnded.apply(this,args);
  };
  proto.onClick=function(...args){
    const memory=this.__fatfishWork;
    if(memory&&!this.dragState.active&&!this.dragState.dragging&&!this.justDragged){
      if(memory.until>Date.now())memory.dismissed=memory.until;
      if(memory.state==='waiting'&&memory.attention!=null)memory.acknowledged=memory.attention;
      if(memory.until>Date.now()||acknowledged(this)){
        if(this.workTimer!==null)window.clearTimeout(this.workTimer);
        const view=fatfishWorkView(memory.snapshot,memory,Date.now());
        this.workTimer=null;this.workText=view.task??memory.defaultText??null;this.workOn=view.visible;this.renderBubble();
      }
    }
    return originalClick.apply(this,args);
  };
  proto.onWorkTick=function(snapshot,tick){
    const changed=this.pet.workStatusEnabled&&tick!==0&&tick!==this.prevWorkTick;
    if(!snapshot?.fatfishManaged&&!Number.isFinite(snapshot?.fatfishNoticeUntil)){
      const leaving=!!this.__fatfishWork;
      if(leaving){this.__fatfishWork=null;this.prevWorkState=null;}
      const result=original.call(this,snapshot,tick);
      if(leaving&&!snapshot?.state&&!this.dragState.active&&this.animations.idle.length)this.playOnce(S.pick(this.animations.idle,this.anim));
      return result;
    }
    if(!changed)return;
    const memory=this.__fatfishWork??={};
    const previousState=memory.state;
    const view=fatfishWorkView(snapshot,memory,Date.now());
    if(view.animate){
      const group=this.pet.workStatusTexts?.[S.WORK_STATUS_INDEX[view.state]];
      memory.defaultText=Array.isArray(group)&&group.length?group[Math.floor(Math.random()*group.length)]:null;
    }
    if(view.animate&&!this.dragState.active&&!this.dragState.dragging){
      original.call(this,{...snapshot,task:null},tick);
      if(!view.state&&previousState&&!['success','error'].includes(previousState)&&this.animations.idle.length)this.playOnce(S.pick(this.animations.idle,this.anim));
    }
    this.prevWorkTick=tick;this.prevWorkState=view.state;this.workState=view.state;
    const expression=snapshot.fatfishExpression;
    if(expression&&memory.expressionAt!==expression.at){
      memory.expressionAt=expression.at;
      const clip=fatfishExpressionClip(expression,this.animations,Date.now(),this.pet.balanceEnabled);
      if(clip&&view.state!=='waiting'&&!this.dragState.active&&!this.dragState.dragging&&this.throwRef==null)this.playOnce(clip);
    }
    this.workText=view.task??memory.defaultText??null;
    this.workOn=view.visible;
    if(this.workTimer!==null)window.clearTimeout(this.workTimer);
    this.workTimer=null;
    if(view.visible&&view.until>Date.now())this.workTimer=window.setTimeout(()=>{
      const current=fatfishWorkView(memory.snapshot,memory,Date.now());
      this.workOn=current.visible;this.workText=current.task??memory.defaultText??null;this.renderBubble();
    },Math.min(300000,view.until-Date.now()));
    this.renderBubble();
  };
}

export function installTouchUI() {
  if(typeof document==='undefined' || window.__fatfishTouch) return;
  window.__fatfishTouch=true;
  installWorkStatusTransport();
  installCompletionBubble();
  installExpressionUI();
  installDesktopTouchCoordinates();
  if(typeof PetSprite!=='undefined')window.__fatfishDisplays=handleDesktopDisplays;
  const ac=new AbortController();
  const listen=(target,type,fn,extra={})=>target.addEventListener(type,fn,{signal:ac.signal,...extra});
  const hitSelector='.pet-hit,.dsh-pet-hit';
  const overlayTargets=new Map();
  const stopOverlay=window.petBridge?.onOverlayInput?.(data=>{
    let target=data.type==='pointerdown'?document.elementFromPoint(data.clientX,data.clientY):overlayTargets.get(data.pointerId)||document.elementFromPoint(data.clientX,data.clientY);
    if(!target)return;
    if(data.type==='pointerdown')overlayTargets.set(data.pointerId,target);
    const event=data.type==='wheel'?new WheelEvent('wheel',{...data,bubbles:true,cancelable:true}):data.type.startsWith('pointer')?new PointerEvent(data.type,{...data,bubbles:true,cancelable:true,isPrimary:data.isPrimary!==false}):new MouseEvent(data.type,{...data,bubbles:true,cancelable:true});
    overlayEvents.add(event);target.dispatchEvent(event);
    if(data.type==='pointerup'||data.type==='pointercancel')overlayTargets.delete(data.pointerId);
    requestAnimationFrame(updateInputRegions);
  });
  let lastInputRegions='';
  const updateInputRegions=()=>{
    if(!window.petBridge?.updateInputRegions)return;
    const rects=[];
    for(const element of document.querySelectorAll('.pet-hit,.fatfish-touch-menu,.fatfish-bubble-scroll.is-on')){
      const r=element.getBoundingClientRect();if(r.width<=0||r.height<=0)continue;
      rects.push({x:r.x,y:r.y,width:r.width,height:r.height});
    }
    const panelOpen=[...document.querySelectorAll('.dsh-pet-menu-column,.dsh-pet-chat')].some(el=>el.getBoundingClientRect().width>0);
    const hit=document.querySelector('.pet-hit');
    const cursor=hit?getComputedStyle(hit).cursor:'grab';
    const payload={rects,panelOpen,cursor},key=JSON.stringify(payload);
    if(rects.length&&key!==lastInputRegions){lastInputRegions=key;window.petBridge.updateInputRegions(payload);}
  };
  const menuTimers=new Map(),menuTouches=new Map();
  const showMenuButton=hit=>{
    clearTimeout(menuTimers.get(hit));menuTimers.delete(hit);
    hit.classList.add('fatfish-menu-visible');
    requestAnimationFrame(updateInputRegions);
  };
  const releaseMenuButton=event=>{
    const hit=menuTouches.get(event.pointerId);if(!hit)return;
    menuTouches.delete(event.pointerId);
    if([...menuTouches.values()].includes(hit))return;
    clearTimeout(menuTimers.get(hit));
    menuTimers.set(hit,setTimeout(()=>{hit.classList.remove('fatfish-menu-visible');menuTimers.delete(hit);updateInputRegions();},3000));
  };
  listen(document,'pointerdown',event=>{
    if(event.pointerType!=='touch')return;
    const hit=event.target.closest?.(hitSelector);if(!hit)return;
    menuTouches.set(event.pointerId,hit);showMenuButton(hit);
  },{capture:true});
  listen(window,'pointerup',releaseMenuButton,{capture:true});
  listen(window,'pointercancel',releaseMenuButton,{capture:true});
  listen(document,'lostpointercapture',releaseMenuButton,{capture:true});
  let touchMode=false, desktopViewport=null, activePointer=null, lastPointerType='mouse';
  listen(window,'fatfish:display-cancel',()=>{activePointer=null;overlayTargets.clear();});
  for(const type of ['pointerdown','pointermove'])listen(document,type,event=>{
    lastPointerType=event.pointerType||'mouse';
    if(type==='pointermove'&&event.pointerType==='touch'&&activePointer!==null&&event.pointerId!==activePointer){event.preventDefault();event.stopImmediatePropagation();}
  },{capture:true,passive:false});
  const enable=()=>{if(touchMode)return;touchMode=true;document.documentElement.classList.add('fatfish-touch');window.petBridge?.setTouchEnabled?.(true);};
  if(navigator.maxTouchPoints>0)enable();
  const style=document.createElement('style');
  style.dataset.fatfishTouch='true';
  style.textContent=`
    .pet-hit,.dsh-pet-hit{touch-action:none;-webkit-user-select:none;user-select:none}
    .fatfish-touch .dsh-pet-menu-item{min-height:44px;padding:8px 14px;box-sizing:border-box;font-size:15px}
    .fatfish-touch .dsh-pet-menu-column{min-width:176px;touch-action:pan-y;overscroll-behavior:contain}
    .fatfish-touch .dsh-pet-chat-input{min-height:44px;font-size:16px}
    .fatfish-touch .dsh-pet-chat{min-width:200px}
    .fatfish-touch-menu{display:none;position:absolute;right:-44px;top:0;width:44px;height:44px;border:1px solid #cdd5df;border-radius:50%;background:#f4f7fb;color:#253344;font-size:24px;pointer-events:auto;touch-action:none;z-index:5}
    .fatfish-touch .fatfish-menu-visible > .fatfish-touch-menu{display:block}
    .fatfish-touch-actions{display:none;gap:8px;padding:6px 10px 10px}
    .fatfish-touch .fatfish-touch-actions{display:flex}
    .fatfish-touch-actions button{flex:1;min-height:44px;border:1px solid #cdd5df;border-radius:8px;background:#f4f7fb;color:#253344;font:inherit;touch-action:manipulation}
    .pet-bubble.is-whisper .pet-bub-row,.dsh-pet-bubble.dsh-pet-whisper .pet-bub-row{white-space:pre-wrap;display:block;overflow-wrap:anywhere}
    .pet-bubble.fatfish-bubble-scroll,.dsh-pet-bubble.fatfish-bubble-scroll{pointer-events:auto;touch-action:none;overscroll-behavior:contain;scrollbar-width:thin}
    .fatfish-bubble-scroll::after{display:none}
  `;
  document.head.appendChild(style);
  listen(document,'pointerdown',event=>{
    if(event.pointerType!=='touch')return;
    enable();
    if(event.target.closest?.('.fatfish-touch-menu'))return;
    if(!event.target.closest?.(hitSelector))return;
    if(activePointer!==null && activePointer!==event.pointerId){
      // A new primary contact proves the old stream ended even if Windows lost its up.
      if(event.isPrimary){const old=activePointer,cancel=new PointerEvent('pointercancel',{pointerType:'touch',pointerId:old});localDragCancels.add(cancel);window.dispatchEvent(cancel);overlayTargets.delete(old);}
      else{event.preventDefault();event.stopImmediatePropagation();return;}
    }
    activePointer=event.pointerId;
  },{capture:true,passive:false});
  const end=event=>{
    if(event.pointerType!=='touch' || activePointer===null)return;
    if(event.pointerId!==activePointer){event.stopImmediatePropagation();return;}
    activePointer=null;
    requestAnimationFrame(updateInputRegions);
  };
  listen(window,'pointerup',end,{capture:true});
  listen(window,'pointercancel',end,{capture:true});
  listen(document,'lostpointercapture',end,{capture:true});
  const cancelGesture=()=>{
    if(activePointer!==null||(typeof sprites!=='undefined'&&sprites.some(pet=>pet.dragState.active))){const cancel=new PointerEvent('pointercancel',{pointerType:activePointer===null?lastPointerType:'touch',pointerId:activePointer??0});localDragCancels.add(cancel);window.dispatchEvent(cancel);}
    activePointer=null;overlayTargets.clear();
  };
  listen(window,'blur',cancelGesture);
  listen(document,'visibilitychange',()=>{if(document.hidden)cancelGesture();});
  listen(document,'contextmenu',event=>{
    if(activePointer!==null && event.target.closest?.(hitSelector)){event.preventDefault();event.stopImmediatePropagation();}
  },{capture:true});
  listen(document,'click',event=>{
    const branch=event.target.closest?.('.dsh-pet-menu-branch');
    if(branch){event.preventDefault();branch.dispatchEvent(new MouseEvent('mouseenter'));}
  },{capture:true});
  // Existing menu uses compatibility mouseleave; touch has no hover and should stay open until a selection/outside tap.
  listen(document,'mouseleave',event=>{if(lastPointerType==='touch' && event.target.matches?.('.dsh-pet-menu'))event.stopImmediatePropagation();},{capture:true});
  const composing=new WeakSet();
  listen(document,'compositionstart',e=>{if(e.target.matches?.('.dsh-pet-chat-input'))composing.add(e.target);}, {capture:true});
  listen(document,'compositionend',e=>composing.delete(e.target),{capture:true});
  listen(document,'keydown',event=>{
    if(event.target.matches?.('.dsh-pet-chat-input') && event.key==='Enter' && (event.isComposing || event.keyCode===229 || composing.has(event.target)))event.stopImmediatePropagation();
  },{capture:true});
  const clampPanels=()=>{
    const v=desktopViewport || {x:window.visualViewport?.offsetLeft||0,y:window.visualViewport?.offsetTop||0,width:window.visualViewport?.width||innerWidth,height:window.visualViewport?.height||innerHeight};
    for(const bubble of document.querySelectorAll('.pet-bubble,.dsh-pet-bubble'))fitPetBubble(bubble,v);
    updateInputRegions();
    if(!touchMode&&!desktopViewport)return;
    for(const panel of document.querySelectorAll('.dsh-pet-chat,.dsh-pet-menu-column')){
      if(getComputedStyle(panel).display==='none')continue;
      panel.style.maxHeight=Math.max(44,v.height-8)+'px';panel.style.overflowY='auto';
      const r=panel.getBoundingClientRect();
      const x=Math.max(v.x+4,Math.min(r.x,v.x+v.width-r.width-4));
      const y=Math.max(v.y+4,Math.min(r.y,v.y+v.height-r.height-4));
      if(Math.abs(r.x-x)>0.5)panel.style.left=(parseFloat(panel.style.left||'0')+x-r.x)+'px';
      if(Math.abs(r.y-y)>0.5)panel.style.top=(parseFloat(panel.style.top||'0')+y-r.y)+'px';
    }
  };
  let querying=false,viewportAgain=false;
  const refreshViewport=async()=>{
    if(!window.petBridge?.getTouchViewport)return;
    if(querying){viewportAgain=true;return;}
    querying=true;
    try{const viewport=await window.petBridge.getTouchViewport();if(!viewportAgain){desktopViewport=viewport;clampPanels();}}catch{}finally{querying=false;if(viewportAgain){viewportAgain=false;refreshViewport();}}
  };
  listen(window,'fatfish:displays',()=>{desktopViewport=null;refreshViewport();requestAnimationFrame(updateInputRegions);});
  listen(window,'fatfish:pet-moved',()=>{if(document.querySelector('.pet-bubble.is-on'))refreshViewport();});
  let reading=null;
  listen(document,'wheel',event=>{const bubble=event.target.closest?.('.fatfish-bubble-scroll');if(!bubble)return;event.preventDefault();bubble.scrollTop+=event.deltaY*(event.deltaMode===1?20:event.deltaMode===2?bubble.clientHeight:1);},{passive:false});
  listen(document,'pointerdown',event=>{
    const bubble=event.target.closest?.('.fatfish-bubble-scroll');if(!bubble||event.pointerType!=='touch')return;
    reading={bubble,id:event.pointerId,y:event.clientY,top:bubble.scrollTop};try{bubble.setPointerCapture(event.pointerId);}catch{}
  });
  listen(document,'pointermove',event=>{if(reading&&event.pointerId===reading.id){event.preventDefault();reading.bubble.scrollTop=reading.top+reading.y-event.clientY;}},{passive:false});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])listen(window,type,event=>{if(event.pointerId===reading?.id)reading=null;});
  listen(document,'load',()=>{clampPanels();},{capture:true});
  if(window.visualViewport)listen(window.visualViewport,'resize',()=>{clampPanels();refreshViewport();});
  listen(document,'input',()=>requestAnimationFrame(clampPanels));
  const enhance=()=>{
    for(const hit of document.querySelectorAll(hitSelector)){
      if(hit.querySelector('.fatfish-touch-menu'))continue;
      const button=document.createElement('button');button.type='button';button.className='fatfish-touch-menu';button.textContent='⋯';button.setAttribute('aria-label','肥鱼菜单');
      listen(button,'pointerdown',event=>event.stopPropagation());
      listen(button,'click',event=>{
        event.preventDefault();event.stopPropagation();
        hit.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:event.clientX,clientY:event.clientY}));
        refreshViewport();
      });
      hit.appendChild(button);
    }
    for(const root of document.querySelectorAll('.dsh-pet-chat')){
      if(root.querySelector('.fatfish-touch-actions'))continue;
      const input=root.querySelector('.dsh-pet-chat-input');if(!input)continue;
      const bar=document.createElement('div');bar.className='fatfish-touch-actions';
      for(const [label,key] of [['发送','Enter'],['关闭','Escape']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;
        listen(button,'click',()=>{if(key==='Escape'||(!input.disabled && !composing.has(input)))input.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true}));});
        bar.appendChild(button);
      }
      root.appendChild(bar);
      input.setAttribute('enterkeyhint','send');
    }
    clampPanels();refreshViewport();updateInputRegions();
  };
  const observer=new MutationObserver(enhance);observer.observe(document.body,{childList:true,subtree:true});enhance();
  listen(window,'resize',()=>{clampPanels();refreshViewport();});
  listen(window,'pagehide',()=>{observer.disconnect();stopOverlay?.();for(const timer of menuTimers.values())clearTimeout(timer);menuTimers.clear();menuTouches.clear();ac.abort();},{once:true});
}
