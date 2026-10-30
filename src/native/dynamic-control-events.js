import {nativeCheckBoxClick} from './control-checkbox.js';
/** Demand-gated native subclass and parent-notification routes. All callback
 * paths retain a node across authored handlers and balance the Windows boundary.
 * Designer controls keep their old event routing without duplicate delivery.
 * https://learn.microsoft.com/windows/win32/api/commctrl/nf-commctrl-setwindowsubclass
 * https://learn.microsoft.com/windows/win32/api/commctrl/nf-commctrl-defsubclassproc
 */
import {mem32} from './x86-operands.js';
import {NATIVE_INPUT_EVENTS} from './control-plan.js';
const arg=argument=>({argument}),mem=memory=>({memory}),key=v=>String(v).toLowerCase(),at=(base,displacement=0)=>mem32({base,displacement});
export const nativeDynamicEventMethods={
 dynamicControlMessages(module,exit){
  if(!module.dynamicRegistry)return;
  const x=this.x,next=x.unique(),command=x.unique(),color=x.unique(),acquire=x.unique(),drop=x.unique(),handled=x.unique();
  x.value(arg(12)).compare(0x111).branch('e',acquire);
  for(const msg of [0x132,0x133,0x134,0x135,0x136,0x137,0x138])x.compare(msg).branch('e',acquire);
  x.jump(next).label(acquire).value(arg(20)).test().branch('e',next)
   .api('user32.dll','GetPropW',[arg(20),this.string('VB6.Native.ControlReference')]).test().branch('e',next).mov('ebx','eax')
   .value(module.dynamicRegistry).cmp(at('ebx',24),'eax').branch('ne',next).pushOperand('ebx').call(this.controlProcedure('Retain')).mov(at('ebp',-56),'eax');
  x.value(arg(12)).compare(0x111).branch('e',command).jump(color).label(command)
   .value(mem(module.loaded)).test().branch('e',drop).value({memory:module.dynamicRegistry,addend:16}).test().branch('ne',drop)
   .value(arg(-56)).testOperand(at('eax',20),1).branch('ne',drop);
  const notCheckClick=x.unique();x.cmp(at('eax',40),4).branch('ne',notCheckClick).value(arg(16)).shift('shr','eax',16).test().branch('ne',notCheckClick);
  nativeCheckBoxClick(this,arg(20));
  x.label(notCheckClick).value(arg(-56)).mov('edx',at('eax',12));
  for(const group of module.controlArrays.values()){
   const another=x.unique();x.value(group.dynamicDirectory).cmp('edx','eax').branch('ne',another);
   for(const [code,event]of this.nativeCommandEvents(group.type)){
    if(!module.procedures.has(key(group.name+'_'+event)))continue;
    const skip=x.unique();x.value(arg(16)).shift('shr','eax',16).compare(code).branch('ne',skip).value(arg(-56)).mov('eax',at('eax',16)).mov(at('ebp',-16),'eax');
    this.handler(module,group.name+'_'+event,[{ref:-16}]);x.value(0).jump(handled).label(skip);
   }
   x.jump(drop).label(another);
  }
  x.jump(drop).label(color).value(arg(-56)).mov('ebx',at('eax',8)).testOperand('ebx','ebx').branch('e',drop);
  this.nativeControlColors=true;x.push(arg(20)).push(arg(16)).pushOperand('ebx').call('native:control:colors').jump(handled);
  x.label(drop).push(arg(-56)).call(this.controlProcedure('Release')).jump(next);
  x.label(handled).mov(at('ebp',-60),'eax').push(arg(-56)).call(this.controlProcedure('Release')).value(arg(-60)).jump(exit).label(next);
 },
 emitDynamicSubclass(module){
  if(!module.dynamicRegistry)return;
  const x=this.x,fallback=x.unique(),destroy=x.unique(),exit=x.unique(),zero=x.unique(),forward=x.unique();
  x.label(module.dynamicSubclass).enter(64);this.enterCallbackBoundary(-12);
  x.push(arg(28)).call(this.controlProcedure('Retain')).mov(at('ebp',-40),'eax')
   .value(arg(12)).compare(0x82).branch('e',destroy)
   .value({memory:module.dynamicRegistry,addend:16}).test().branch('ne',fallback)
   .value(mem(module.loaded)).test().branch('e',fallback)
   .value(arg(-40)).testOperand(at('eax',20),1).branch('ne',fallback);
  const notFrame=x.unique(),frameForward=x.unique();x.cmp(at('eax',40),6).branch('ne',notFrame).value(arg(12)).compare(0x14).branch('ne',frameForward);
  this.nativeControlColors=true;
  x.value(arg(-40)).mov('ebx',at('eax',8)).push(arg(8)).push(arg(16)).pushOperand('ebx').call('native:control:erase').jump(exit);
  x.label(frameForward).value(arg(12));
  for(const msg of [0x111,0x4e,0x114,0x115,0x2b,0x132,0x133,0x134,0x135,0x136,0x137,0x138])x.compare(msg).branch('e',forward);
  x.label(notFrame);
  for(const group of module.controlArrays.values()){
   const nextGroup=x.unique();x.value(arg(-40)).mov('edx',at('eax',12)).value(group.dynamicDirectory).cmp('edx','eax').branch('ne',nextGroup);
   for(const event of NATIVE_INPUT_EVENTS){
    if(!module.procedures.has(key(group.name+'_'+event)))continue;
    const next=x.unique(),match=x.unique();
    const messages={gotfocus:[7],lostfocus:[8],keydown:[0x100,0x104],keyup:[0x101,0x105],keypress:[0x102],mousedown:[0x201,0x204,0x207],mouseup:[0x202,0x205,0x208],mousemove:[0x200]}[event];
    x.value(arg(12));for(const message of messages)x.compare(message).branch('e',match);x.jump(next).label(match);
    x.value(arg(-40)).mov('eax',at('eax',16)).mov(at('ebp',-16),'eax');
    const args=[{ref:-16}];
    if(event.startsWith('key')){
     x.value(arg(16)).and('eax',65535).mov(at('ebp',-20),'eax');args.push({ref:-20});
     if(event!=='keypress'){this.emitNativeShiftState();x.mov(at('ebp',-24),'eax');args.push({ref:-24});}
    }else if(event.startsWith('mouse')){
     if(event==='mousemove')x.value(arg(16)).mov('ecx','eax').and('eax',3).and('ecx',16).shift('shr','ecx',2).or('eax','ecx');
     else {const right=x.unique(),middle=x.unique(),done=x.unique();x.value(arg(12)).compare(messages[1]).branch('e',right).compare(messages[2]).branch('e',middle).value(1).jump(done).label(right).value(2).jump(done).label(middle).value(4).label(done);}
     x.mov(at('ebp',-20),'eax');this.emitNativeShiftState();x.mov(at('ebp',-24),'eax');
     const seed=group.entries.values().next().value,parent=seed.nativeParent?.model?.properties||module.form.properties,scale=Number(parent.ScaleMode??1)===3?1:15;
     for(const [offset,shift]of [[-28,0],[-32,16]]){x.value(arg(20));if(shift)x.shift('sar','eax',16);else x.emit(0x0f,0xbf,0xc0);if(scale!==1)x.emit(0x6b,0xc0,15);x.mov(at('ebp',offset),'eax').emit(0xdb,0x45,offset&255,0xd9,0x5d,offset&255);}
     args.push({ref:-20},{ref:-24},{ref:-28,type:'single'},{ref:-32,type:'single'});
    }
    this.handler(module,group.name+'_'+event,args);
    x.value(arg(-40)).mov('eax',at('eax',4)).cmp('eax',at('ebp',8)).branch('ne',zero);
    if(event.startsWith('key'))x.value(arg(-20)).and('eax',65535).test().branch('e',zero).mov(at('ebp',16),'eax');
    x.jump(fallback).label(next);
   }
   x.jump(fallback).label(nextGroup);
  }
  x.jump(fallback).label(destroy).push(arg(-40)).call(this.controlProcedure('Detach'));
  x.label(fallback).api('comctl32.dll','DefSubclassProc',[arg(8),arg(12),arg(16),arg(20)]).jump(exit);
  x.label(forward).api('user32.dll','SendMessageW',[mem(module.handle),arg(12),arg(16),arg(20)]).jump(exit);
  x.label(zero).value(0).label(exit).mov(at('ebp',-44),'eax').push(arg(-40)).call(this.controlProcedure('Release')).value(arg(-44));
  this.leaveCallbackBoundary(-12);x.leave(24);
 }
};
