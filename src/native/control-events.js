/** Win32 notifications and optional subclass thunks. Every thunk is scoped to an
 * actual HWND; indexed controls keep their authored Index and native parent. */
import {nativeItemClick} from './control-items.js';
import {NATIVE_SCROLL_CONTROLS,NATIVE_RANGE_CONTROLS,NATIVE_TAB_CONTROLS,NATIVE_DATE_CONTROLS,NATIVE_INPUT_EVENTS} from './control-plan.js';
const mem=memory=>({memory}),arg=argument=>({argument}),key=value=>String(value).toLowerCase();
const save=(x,offset)=>x.emit(0x89,0x45,offset&255);
export const nativeControlEventMethods={
  hasNativeControlEvent(module,control,event){return module.procedures.has(key(control.model.name+'_'+event));},
  emitNativeShiftState(){
    const x=this.x;this.nativeShiftState=true;x.call('native:control:shift');
  },
  emitNativeInputHelpers(){
    if(!this.nativeShiftState)return;
    const x=this.x;x.label('native:control:shift').enter().emit(0x31,0xdb);
    for(const [vk,mask]of [[16,1],[17,2],[18,4]]){x.api('user32.dll','GetKeyState',[vk]).emit(0xc1,0xe8,15,0x83,0xe0,1);if(mask!==1)x.emit(0x6b,0xc0,mask);x.emit(0x09,0xc3);}
    x.emit(0x89,0xd8).leave();
  },
  emitNativeControlProcedures(module){
    const x=this.x;
    for(const control of module.controls.values())if(control.oldProcedure){
      const fallback=x.unique(),exit=x.unique(),zero=x.unique(),forward=x.unique();
      x.label('control-procedure:'+module.name+':'+control.key).enter(control.nativeDescriptor.kernel?192:48);this.enterCallbackBoundary(-12);
      // Container notifications go directly to the form. Do not stop at a Frame
      // or tab HWND, and do not forward the container's own WM_SIZE/WM_PAINT.
      if(control.nativeDescriptor.container){x.value(arg(12));for(const msg of [0x111,0x4e,0x114,0x115,0x2b,0x132,0x133,0x134,0x135,0x136,0x137,0x138])x.compare(msg).branch('e',forward);}
      x.value(mem(module.loaded)).test().branch('e',fallback);
      for(const event of NATIVE_INPUT_EVENTS){
        if(!this.hasNativeControlEvent(module,control,event))continue;
        const next=x.unique(),match=x.unique();
        const messages={gotfocus:[7],lostfocus:[8],keydown:[0x100,0x104],keyup:[0x101,0x105],keypress:[0x102],mousedown:[0x201,0x204,0x207],mouseup:[0x202,0x205,0x208],mousemove:[0x200]}[event];
        x.value(arg(12));for(const msg of messages)x.compare(msg).branch('e',match);x.jump(next).label(match);
        let args=[];
        if(event.startsWith('key')){
          x.value(arg(16)).emit(0x25).imm(65535);save(x,-20);
          args=[{ref:-20}];if(event!=='keypress'){this.emitNativeShiftState();save(x,-24);args.push({ref:-24});}
        }else if(event.startsWith('mouse')){
          if(event==='mousemove')x.value(arg(16)).emit(0x89,0xc1,0x83,0xe0,3,0x83,0xe1,16,0xc1,0xe9,2,0x09,0xc8);
          else {x.value(arg(12));const middle=x.unique(),right=x.unique(),done=x.unique();x.compare(messages[1]).branch('e',right).compare(messages[2]).branch('e',middle).value(1).jump(done).label(right).value(2).jump(done).label(middle).value(4).label(done);}
          save(x,-20);this.emitNativeShiftState();save(x,-24);
          // Mouse coordinates use the container's ScaleMode. VB event X/Y are
          // ByRef Single slots, not integer bits passed through an x87 register.
          const scale=Number((control.nativeParent?.model?.properties||module.form.properties).ScaleMode??1)===3?1:15;
          for(const [offset,shift]of [[-28,0],[-32,16]]){x.value(arg(20));if(shift)x.emit(0xc1,0xf8,16);else x.emit(0x0f,0xbf,0xc0);if(scale!==1)x.emit(0x6b,0xc0,scale);save(x,offset);x.emit(0xdb,0x45,offset&255,0xd9,0x5d,offset&255);}
          args=[{ref:-20},{ref:-24},{ref:-28,type:'single'},{ref:-32,type:'single'}];
        }
        this.controlHandler(module,control,event,args);
        // A handler may unload its form. Never invoke an obsolete subclass proc
        // with a destroyed HWND, even when the form was recreated synchronously.
        x.value(arg(8)).emit(0x3b,0x05).addr(control.handle).branch('ne',zero);
        if(event.startsWith('key'))x.value(arg(-20)).emit(0x25).imm(65535).test().branch('e',zero).emit(0x89,0x45,16);
        x.jump(fallback).label(next);
      }
      x.label(fallback);this.nativeSurfaceWindowMessages(control,null,zero,exit);const nativeFallback=x.unique();this.gridWindowMessages(control,zero,exit,nativeFallback);x.label(nativeFallback);const chartFallback=x.unique();this.chartWindowMessages(control,zero,exit,chartFallback);x.label(chartFallback).api('user32.dll','CallWindowProcW',[mem(control.oldProcedure),arg(8),arg(12),arg(16),arg(20)]).jump(exit);
      x.label(forward).api('user32.dll','SendMessageW',[mem(module.handle),arg(12),arg(16),arg(20)]).jump(exit);
      x.label(zero).value(0).label(exit);this.leaveCallbackBoundary(-12);x.leave(16);
    }
  },
  nativeControlWindowMessages(module,fallback,zero,exit){
    const x=this.x,after=x.unique(),notify=x.unique(),scroll=x.unique(),change=x.unique(),tab=x.unique();
    const controls=[...module.controls.values()];
    if(!controls.some(c=>NATIVE_RANGE_CONTROLS.has(c.model.type)||NATIVE_TAB_CONTROLS.has(c.model.type)||NATIVE_DATE_CONTROLS.has(c.model.type)||['TreeView','ListView','StatusBar','RichTextBox'].includes(c.model.type)))return;
    x.value(arg(12)).compare(0x4e).branch('e',notify).compare(0x114).branch('e',scroll).compare(0x115).branch('e',scroll).compare(0x8002).branch('e',change).compare(0x8003).branch('e',tab).jump(after);
    x.label(change);
    for(const control of controls.filter(c=>NATIVE_RANGE_CONTROLS.has(c.model.type))){const next=x.unique();x.value(arg(20)).test().branch('e',zero).emit(0x3b,0x05).addr(control.handle).branch('ne',next);this.controlHandler(module,control,'Change');x.jump(zero).label(next);}
    x.jump(fallback).label(tab);
    for(const control of controls.filter(c=>NATIVE_TAB_CONTROLS.has(c.model.type))){const next=x.unique();x.value(arg(20)).test().branch('e',zero).emit(0x3b,0x05).addr(control.handle).branch('ne',next);this.nativeTabChanged(module,control,zero);x.label(next);}
    x.jump(fallback).label(scroll);
    for(const control of controls.filter(c=>NATIVE_SCROLL_CONTROLS.has(c.model.type)||c.model.type==='Slider')){
      const next=x.unique();x.value(arg(20)).test().branch('e',zero).emit(0x3b,0x05).addr(control.handle).branch('ne',next);
      if(control.model.type==='Slider')x.api('user32.dll','SendMessageW',[mem(control.handle),0x400,0,0]);
      else this.nativeScrollPosition(control,zero);
      save(x,-20);x.emit(0x3b,0x05).addr(control.state,8);const same=x.unique();x.branch('e',same).store(control.state,8);this.controlHandler(module,control,'Change');x.label(same);
      // Scroll is the live thumb-tracking event; Change also fires for keyboard,
      // page/line arrows and a changed final position.
      x.value(arg(16)).emit(0x25).imm(65535).compare(5).branch('ne',zero);this.controlHandler(module,control,'Scroll');x.jump(zero).label(next);
    }
    x.jump(fallback).label(notify).value(arg(20)).test().branch('e',fallback).emit(0x89,0xc6);
    for(const control of controls){
      const type=control.model.type;
      if(!NATIVE_DATE_CONTROLS.has(type)&&!NATIVE_TAB_CONTROLS.has(type)&&!['TreeView','ListView','StatusBar','UpDown','RichTextBox'].includes(type))continue;
      const next=x.unique();x.emit(0x8b,0x06,0x3b,0x05).addr(control.handle).branch('ne',next).emit(0x8b,0x46,8);
      if(NATIVE_DATE_CONTROLS.has(type)){x.compare(type==='DTPicker'?-759:-749).branch('ne',next);this.controlHandler(module,control,'Change');x.jump(zero);}
      else if(type==='RichTextBox'){x.compare(0x702).branch('ne',next);this.controlHandler(module,control,'SelChange');x.jump(zero);}
      else if(NATIVE_TAB_CONTROLS.has(type)){x.compare(-551).branch('ne',next);this.nativeTabChanged(module,control,zero);}
      else if(type==='UpDown'){
        x.compare(-722).branch('ne',next); // NMUPDOWN: iPos, iDelta are signed 32-bit.
        x.emit(0x8b,0x46,12,0x03,0x46,16);const low=x.unique(),high=x.unique(),valid=x.unique(),apply=x.unique();x.branch('no',valid).emit(0x83,0x7e,16,0).branch('l',low).jump(high).label(valid);
        x.emit(0x3b,0x05).addr(control.state).branch('l',low).emit(0x3b,0x05).addr(control.state,4).branch('g',high).jump(apply);
        x.label(low).value({memory:control.state,addend:control.model.properties.Wrap?4:0}).jump(apply).label(high).value({memory:control.state,addend:control.model.properties.Wrap?0:4});
        x.label(apply);save(x,-20);const same=x.unique();x.emit(0x3b,0x05).addr(control.state,8).branch('e',same).store(control.state,8).push().push(0).push(0x471).push(mem(control.handle)).invoke('user32.dll','SendMessageW');this.controlHandler(module,control,'Change');x.label(same).value(1).jump(exit); // position already applied; veto default double application.
      }else{
        for(const [code,event]of [[-2,'Click'],[-3,'DblClick']]){const another=x.unique();x.compare(code).branch('ne',another);if(code===-2)nativeItemClick(this,module,control,zero);this.controlHandler(module,control,event);x.jump(zero).label(another);}
      }
      x.label(next);
    }
    x.jump(fallback).label(after);
  },
  nativeTabChanged(module,control,zero){
    const x=this.x;x.api('user32.dll','SendMessageW',[mem(control.handle),0x130b,0,0]).emit(0x8b,0x0d).addr(control.state,24).emit(0x89,0x4d,0xec,0x39,0xc8).branch('e',zero).store(control.state,24);
    if(control.nativePageChildren?.length){save(x,-24);x.value(mem(control.handle));save(x,-28);this.applyNativeTabPages(control);
    x.value(mem(module.loaded)).test().branch('e',zero).value(mem(control.handle)).test().branch('e',zero).emit(0x3b,0x45,0xe4).branch('ne',zero).api('user32.dll','SendMessageW',[mem(control.handle),0x130b,0,0]).emit(0x3b,0x45,0xe8).branch('ne',zero);}
    this.controlHandler(module,control,'Click',control.model.type==='SSTab'?[{ref:-20}]:[]);x.jump(zero);
  },
  nativeScrollPosition(control,zero){
    const x=this.x,min={memory:control.state},max={memory:control.state,addend:4},apply=x.unique(),low=x.unique(),high=x.unique(),subtract=x.unique(),add=x.unique(),track=x.unique();
    x.api('user32.dll','GetScrollPos',[mem(control.handle),2]);save(x,-20);
    x.value(arg(16)).emit(0x25).imm(65535); // complete wParam command, not 16-bit thumb position
    const lineSub=x.unique(),lineAdd=x.unique(),pageSub=x.unique(),pageAdd=x.unique();
    x.compare(0).branch('e',lineSub).compare(1).branch('e',lineAdd).compare(2).branch('e',pageSub).compare(3).branch('e',pageAdd).compare(4).branch('e',track).compare(5).branch('e',track).compare(6).branch('e',low).compare(7).branch('e',high).jump(zero);
    x.label(lineSub).value({memory:control.state,addend:12}).jump(subtract).label(pageSub).value({memory:control.state,addend:16});
    x.label(subtract).emit(0x89,0xc1).value(arg(-20)).emit(0x29,0xc8).branch('o',low).jump(apply);
    x.label(lineAdd).value({memory:control.state,addend:12}).jump(add).label(pageAdd).value({memory:control.state,addend:16});
    x.label(add).emit(0x89,0xc1).value(arg(-20)).emit(0x01,0xc8).branch('o',high).jump(apply);
    // SCROLLINFO is callback-stack-local (28 bytes), safe under nested messages.
    // SIF_TRACKPOS retrieves the full LONG, unlike HIWORD(WM_*SCROLL.wParam).
    x.label(track).value(28);save(x,-60);x.value(0x10);save(x,-56);x.local(-60).push().push(2).push(mem(control.handle)).invoke('user32.dll','GetScrollInfo').test().branch('e',zero).value(arg(-36)).jump(apply);
    x.label(low).value(min).jump(apply).label(high).value(max);
    x.label(apply).emit(0x3b,0x05).addr(control.state);const above=x.unique(),below=x.unique();x.branch('ge',above).value(min).label(above).emit(0x3b,0x05).addr(control.state,4).branch('le',below).value(max).label(below);save(x,-20);
    x.push(1).push(arg(-20)).push(2).push(mem(control.handle)).invoke('user32.dll','SetScrollPos').value(arg(-20));
  }
};
