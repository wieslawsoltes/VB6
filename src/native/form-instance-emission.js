/** HWND ownership for independent Form objects. Windows defaults own the early
 * creation messages; authored events start only after every child is registered.
 * A canonical property pins the instance until WM_NCDESTROY, and each callback
 * has its own additional pin. No live state is swapped into global form slots.
 */
import {FORM_INSTANCE,FORM_HWND_PROPERTY} from './form-instance-layout.js';
import {nativeControlStyle,NATIVE_INPUT_EVENTS} from './control-plan.js';
import {NATIVE_CONTROL_CATALOG} from './control-catalog.js';
import {nativeCheckBoxClick} from './control-checkbox.js';
import {mem32} from './x86-operands.js';
const F={...FORM_INSTANCE,creating:80},arg=argument=>({argument}),mem=memory=>({memory}),at=(base,displacement=0)=>mem32({base,displacement});
const key=v=>String(v).toLowerCase(),slot=v=>at('ebp',v.offset);
const callbacks=(c,module)=>{c.context={module,proc:{},locals:new Map(),instanceOffset:-16};};
export const formInstanceEmission={
 emitInstanceForm(module){
  callbacks(this,module);const x=this.x,d=module.nativeForm,wc='wndclass:'+module.name;
  this.data.align(4).label(wc).u32(3).reference(module.instanceWindow).u32(0).u32(0).u32(0).u32(0).u32(0).u32(16).u32(0).reference(module.className);module.wc=wc;
  const exists=x.unique();
  x.label(module.create).enter().value(mem(module.defaultForm)).test().branch('ne',exists).call(this.classProcedure('New'+d.id));this.checkNativeError('native:error:propagate');
  x.store(module.defaultForm).label(exists).mov('esi','eax').push().call(this.instanceProcedure(d,'Create'));this.checkNativeError('native:error:propagate');
  x.mov('eax',at('esi',F.hwnd)).store(module.handle).leave();
  this.emitInstanceWindow(module);this.emitInstanceControlSubclass(module);this.emitInstanceDispose(module);
 },
 emitInstanceCreate(context,d){
  const x=this.x,m=d.module,p=m.form.properties,owner=context.locals.get('owner');
  const done=x.unique();x.value(arg(owner.offset)).mov('esi','eax').cmp(at('esi',F.hwnd),0).branch('ne',done)
   .cmp(at('esi',F.creating),0).branch('ne','error:5').cmp(at('esi',F.epoch),0x7fffffff).branch('e','error:6');
  x.mov(at('esi',F.creating),1).inc(at('esi',F.epoch));
  // The rollback slot owns its own reference, independently of the ByVal owner.
  const rollback=this.arrayWorkspace(4,'instance-rollback');context.nativeOwnedTemps.push({variable:rollback,release:this.instanceProcedure(d,'Rollback'),blockScoped:true});
  x.pushOperand('esi').call(this.classProcedure('Retain')).mov(slot(rollback),'eax');
  const width=this.pixels(p.ClientWidth??p.Width??9000),height=this.pixels(p.ClientHeight??p.Height??6000),style=this.formStyle(m),ex=Number(p.BorderStyle)>=4?0x80:0;
  if(p.MDIChild){
   if(!this.mdi)this.fail('Independent MDI child requires an MDI parent');
   x.call(this.mdi.create).api('user32.dll','CreateMDIWindowW',[m.className,this.string(p.Caption||m.name),style,this.pixels(p.Left||0),this.pixels(p.Top||0),width,height,mem(this.mdi.client),mem('instance'),arg(owner.offset)]);
  }else{
   const rect=this.arrayWorkspace(16,'instance-create-rect');x.local(rect.offset).mov(at('eax'),0).mov(at('eax',4),0).mov(at('eax',8),width).mov(at('eax',12),height)
    .api('user32.dll','AdjustWindowRectEx',[{address:rect.offset},style,0,ex]).test().branch('e','error:5');
   x.value(arg(rect.offset+8)).sub('eax',at('ebp',rect.offset)).mov('edi','eax').value(arg(rect.offset+12)).sub('eax',at('ebp',rect.offset+4)).mov('ebx','eax');
   x.push(arg(owner.offset)).push(mem('instance')).push(0).push(0).pushOperand('ebx').pushOperand('edi').push(this.pixels(p.Top||0)).push(this.pixels(p.Left||0)).push(style).push(this.string(p.Caption||m.name)).push(m.className).push(ex).invoke('user32.dll','CreateWindowExW');
  }
  x.test().branch('e','error:7').mov('esi',slot(owner)).mov(at('esi',F.hwnd),'eax').mov('ebx','eax');
  x.pushOperand('esi').push(this.string(FORM_HWND_PROPERTY)).pushOperand('ebx').invoke('user32.dll','SetPropW').test().branch('e','error:7');
  x.pushOperand('esi').call(this.classProcedure('Retain')).mov(at('esi',F.phase),1).inc(mem32({label:'live-forms'}));
  x.lea('eax',at('esi',F.hwnd)).mov(at('esi',F.registry+12),'eax').mov(at('esi',F.registry+16),0);
  const ordered=[...m.controls.values()].sort((a,b)=>{const depth=c=>c.nativeParent?1+depth(c.nativeParent):0;return depth(a)-depth(b);});
  for(const control of ordered)this.emitInstanceControlCreation(context,d,control,owner);
  x.mov('esi',slot(owner)).mov(at('esi',F.phase),2).mov(at('esi',F.creating),0);
  const load=m.procedures.get('form_load');if(load){x.push(arg(owner.offset)).call(load.label);this.checkNativeError();}
  // Retain window/field changes from a successful Form_Load, including Unload.
  x.pushOperand(slot(rollback)).mov(slot(rollback),0).call(this.classProcedure('Release')).label(done);
 },
 emitInstanceControlCreation(context,d,control,owner){
  const x=this.x,p=control.model.properties,m=d.module,type=control.model.type,state=control.stateField.nativeFieldOffset,font=control.fontField.nativeFieldOffset;
  const {style,ex}=nativeControlStyle(type,p);
  x.value(arg(owner.offset)).mov('esi','eax').mov('ebx',at('esi',control.nativeParent?.hwndField.nativeFieldOffset??F.hwnd));
  x.push(0).push(mem('instance')).push(control.id).pushOperand('ebx').push(this.pixels(p.Height??420)).push(this.pixels(p.Width??1440)).push(this.pixels(p.Top||0)).push(this.pixels(p.Left||0)).push(style).push(this.string(p.Text??p.Caption??'')).push(this.string(NATIVE_CONTROL_CATALOG[type].className)).push(ex).invoke('user32.dll','CreateWindowExW').test().branch('e','error:7');
  x.mov(at('esi',control.hwndField.nativeFieldOffset),'eax').mov('edi','eax').lea('eax',at('esi',state)).mov('ebx','eax');
  // Same common-control layout used by the ordinary control property routines.
  for(const [offset,value]of [[0,p.TripleState?-1:0],[32,p.BackColor??-2147483633],[36,p.ForeColor??-2147483640],[68,p.BackStyle??1]])x.mov(at('ebx',offset),Number(value));
  x.lea('eax',at('esi',font)).mov(at('ebx',72),'eax');
  x.pushOperand('ebx').push(-21).pushOperand('edi').invoke('user32.dll','SetWindowLongW');
  if(p.Tag)x.push(this.string(p.Tag)).call('native:string:copy').mov(at('esi',state+28),'eax');
  const fs={...m.form.properties,...p},size=Number(fs.FontSize||8.25),face=String(fs.FontName||'MS Sans Serif');
  if(!Number.isFinite(size)||size<1||size>512||!face||face.length>31||face.includes('\0'))this.fail('Invalid independent native control font');
  x.lea('ebx',at('esi',font)).value(this.string(face)).mov(at('ebx',4),'eax');
  for(const [offset,value]of [[12,Math.round(size*100)],[16,fs.FontBold?700:400],[20,fs.FontItalic?1:0],[24,fs.FontUnderline?1:0],[28,fs.FontStrikethru||fs.FontStrikethrough?1:0]])x.mov(at('ebx',offset),value);
  const number=this.floatLiteral(size);x.value(mem(number)).mov(at('ebx',40),'eax').value({memory:number,addend:4}).mov(at('ebx',44),'eax');
  this.nativeMutableFonts=true;x.pushOperand('ebx').pushOperand('edi').call('native:control:set-font');this.checkNativeError();
  if(type==='TextBox'){
   if(p.MaxLength)x.push(0).push(Number(p.MaxLength)).push(0xc5).pushOperand('edi').invoke('user32.dll','SendMessageW');
   if(p.PasswordChar)x.push(0).push(String(p.PasswordChar).charCodeAt(0)).push(0xcc).pushOperand('edi').invoke('user32.dll','SendMessageW');
  }
  if(type==='CheckBox'||type==='OptionButton')x.push(0).push(type==='OptionButton'?(p.Value?1:0):Number(p.Value||0)).push(0xf1).pushOperand('edi').invoke('user32.dll','SendMessageW');
  x.lea('eax',at('esi',control.hwndField.nativeFieldOffset)).push().push(m.instanceSubclass).lea('eax',at('esi',state)).push().pushOperand('edi').push(control.kind).push(this.string(control.model.name)).push(-1).push(0).lea('eax',at('esi',F.registry)).push().call(this.controlProcedure('Register'));this.checkNativeError();
 },
 emitInstanceRollback(context,d){
  const x=this.x,owner=context.locals.get('owner'),noWindow=x.unique(),finish=x.unique();x.value(arg(owner.offset)).test().branch('e',finish).mov('esi','eax').mov('ebx',at('esi',F.hwnd)).testOperand('ebx','ebx').branch('e',noWindow);
  x.pushOperand('ebx').invoke('user32.dll','DestroyWindow').test().branch('ne',noWindow);
  // Keep the allocation alive on OS refusal; never free state under a live HWND.
  x.jump(finish).label(noWindow).mov(at('esi',F.hwnd),0).mov(at('esi',F.phase),0).mov(at('esi',F.closing),0).pushOperand('esi').call('instance-dispose:'+d.id).pushOperand('esi').call(this.classProcedure('Release')).label(finish);
 },
 emitInstanceDispose(module){
  const x=this.x,d=module.nativeForm;callbacks(this,module);
  x.label('instance-dispose:'+d.id).enter().value(arg(8)).mov('esi','eax');
  for(const c of module.controls.values()){
   const state=c.stateField.nativeFieldOffset,font=c.fontField.nativeFieldOffset;
   const free=(offset,dll,fn)=>{const skip=x.unique();x.mov('eax',at('esi',offset)).mov(at('esi',offset),0).test().branch('e',skip).push().invoke(dll,fn).label(skip);};
   free(state+28,'oleaut32.dll','SysFreeString');free(state+64,'gdi32.dll','DeleteObject');free(font,'gdi32.dll','DeleteObject');
   const borrowed=x.unique();x.cmp(at('esi',font+8),0).branch('e',borrowed);free(font+4,'oleaut32.dll','SysFreeString');x.label(borrowed).mov(at('esi',font+8),0).mov(at('esi',c.hwndField.nativeFieldOffset),0);
  }
  x.mov(at('esi',F.creating),0).value(0).leave(4);
 },
 emitInstanceWindow(module){
  const x=this.x,d=module.nativeForm;callbacks(this,module);
  const fallback=x.unique(),exit=x.unique(),zero=x.unique(),destroy=x.unique(),close=x.unique(),command=x.unique(),size=x.unique(),activate=x.unique(),deactivate=x.unique();
  x.label(module.instanceWindow).enter(96);this.enterCallbackBoundary(-12);
  x.mov(at('ebp',-16),0).api('user32.dll','GetPropW',[arg(8),this.string(FORM_HWND_PROPERTY)]).test().branch('e',fallback).push().call(this.classProcedure('Retain')).mov(at('ebp',-16),'eax');
  x.mov('edx',at('eax',F.epoch)).mov(at('ebp',-24),'edx');
  x.value(arg(12)).compare(0x82).branch('e',destroy);
  x.value(arg(-16)).cmp(at('eax',F.phase),2).branch('ne',fallback);
  x.value(arg(12)).compare(0x10).branch('e',close).compare(5).branch('e',size).compare(0x111).branch('e',command);
  if(module.form.properties.MDIChild){const after=x.unique();x.compare(0x222).branch('ne',after).value(arg(8)).cmp('eax',at('ebp',20)).branch('e',activate).cmp('eax',at('ebp',16)).branch('e',deactivate).label(after);}
  else {const after=x.unique();x.compare(6).branch('ne',after).value(arg(16)).and('eax',65535).test().branch('e',deactivate).jump(activate).label(after);}
  // Native edit/static/button foreground/background messages share current state.
  const colors=x.unique();x.value(arg(12));for(const msg of [0x132,0x133,0x134,0x135,0x136,0x137,0x138])x.compare(msg).branch('e',colors);x.jump(fallback).label(colors);
  x.value(arg(20)).test().branch('e',fallback).push(-21).push(arg(20)).invoke('user32.dll','GetWindowLongW').test().branch('e',fallback).mov('ebx','eax');
  this.nativeControlColors=true;x.push(arg(20)).push(arg(16)).pushOperand('ebx').call('native:control:colors').jump(exit);
  x.label(command);
  for(const c of module.controls.values()){
   const next=x.unique();x.value(arg(-16)).mov('eax',at('eax',c.hwndField.nativeFieldOffset)).test().branch('e',next).cmp('eax',at('ebp',20)).branch('ne',next);
   for(const [code,event]of this.nativeCommandEvents(c.model.type)){
    const other=x.unique();x.value(arg(16)).shift('shr','eax',16).compare(code).branch('ne',other);
    if(c.model.type==='CheckBox'&&event==='Click')nativeCheckBoxClick(this,arg(20));
    this.handler(module,c.model.name+'_'+event);x.jump(zero).label(other);
   }x.jump(fallback).label(next);
  }x.jump(fallback).label(size);this.handler(module,'Form_Resize');x.jump(fallback);
  x.label(activate);this.handler(module,'Form_Activate');x.jump(fallback).label(deactivate);this.handler(module,'Form_Deactivate');x.jump(fallback);
  x.label(close).value(arg(-16)).cmp(at('eax',F.closing),0).branch('ne',zero).mov(at('eax',F.closing),1).mov(at('ebp',-4),0).value(arg(16)).mov(at('ebp',-8),'eax');
  this.handler(module,'Form_QueryUnload',[{ref:-4},{ref:-8}]);this.checkInstanceCallbackLive(zero);
  const cancel=x.unique();x.cmp(at('ebp',-4),0).branch('ne',cancel);
  this.handler(module,'Form_Unload',[{ref:-4}]);this.checkInstanceCallbackLive(zero);x.cmp(at('ebp',-4),0).branch('ne',cancel);
  if(module.form.properties.MDIChild)x.api('user32.dll','SendMessageW',[mem(this.mdi.client),0x221,arg(8),0]);else x.api('user32.dll','DestroyWindow',[arg(8)]);
  x.label(cancel);this.checkInstanceCallbackLive(zero);x.value(arg(-16)).mov(at('eax',F.closing),0).jump(zero);
  x.label(destroy).value(arg(-16)).mov('esi','eax').mov(at('esi',F.phase),0).mov(at('esi',F.hwnd),0).mov(at('esi',F.closing),0).mov(at('esi',F.registry+16),1);
  x.api('user32.dll','RemovePropW',[arg(8),this.string(FORM_HWND_PROPERTY)]);
  // Child WM_NCDESTROY has already detached registry nodes. Defensive registry
  // cleanup balances any unregistered/failed child before freeing GDI resources.
  x.lea('eax',at('esi',F.registry)).push().call(this.controlProcedure('CloseRegistry'));this.checkNativeError('native:error:fatal');
  x.pushOperand('esi').call('instance-dispose:'+d.id);
  const notDefault=x.unique();x.mov('eax','esi').cmp('eax',mem32({label:module.defaultForm})).branch('ne',notDefault).value(0).store(module.handle).label(notDefault);
  x.dec(mem32({label:'live-forms'})).pushOperand('esi').call(this.classProcedure('Release'));
  const alive=x.unique();x.value(mem('live-forms')).test().branch('ne',alive).api('user32.dll','PostQuitMessage',[0]).label(alive).jump(fallback);
  x.label(fallback).api('user32.dll',module.form.properties.MDIChild?'DefMDIChildProcW':'DefWindowProcW',[arg(8),arg(12),arg(16),arg(20)]).jump(exit);
  x.label(zero).value(0).label(exit).mov(at('ebp',-28),'eax').push(arg(-16)).call(this.classProcedure('Release')).value(arg(-28));this.leaveCallbackBoundary(-12);x.leave(16);
 },
 checkInstanceCallbackLive(onStale){
  this.x.value(arg(-16)).mov('edx',at('eax',F.epoch)).cmp('edx',at('ebp',-24)).branch('ne',onStale).mov('eax',at('eax',F.hwnd)).cmp('eax',at('ebp',8)).branch('ne',onStale);
 },
 emitInstanceControlSubclass(module){
  const x=this.x;callbacks(this,module);const fallback=x.unique(),exit=x.unique(),zero=x.unique(),detach=x.unique(),forward=x.unique();
  x.label(module.instanceSubclass).enter(96);this.enterCallbackBoundary(-12);
  x.push(arg(28)).call(this.controlProcedure('Retain')).mov(at('ebp',-20),'eax').mov('eax',at('eax',24)).sub('eax',F.registry).push().call(this.classProcedure('Retain')).mov(at('ebp',-16),'eax');
  x.value(arg(12)).compare(0x82).branch('e',detach).value(arg(-16)).cmp(at('eax',F.phase),2).branch('ne',fallback);
  x.value(arg(-20)).cmp(at('eax',40),6);const notFrame=x.unique(),frameForward=x.unique();
  x.branch('ne',notFrame).value(arg(12)).compare(0x14).branch('ne',frameForward);
  this.nativeControlColors=true;
  x.value(arg(-20)).mov('ebx',at('eax',8)).push(arg(8)).push(arg(16)).pushOperand('ebx').call('native:control:erase').jump(exit);
  x.label(frameForward).value(arg(12));for(const msg of [0x111,0x132,0x133,0x134,0x135,0x136,0x137,0x138])x.compare(msg).branch('e',forward);x.label(notFrame);
  for(const control of module.controls.values()){
   const nextControl=x.unique();x.value(arg(-16)).mov('eax',at('eax',control.hwndField.nativeFieldOffset)).cmp('eax',at('ebp',8)).branch('ne',nextControl);
   for(const event of NATIVE_INPUT_EVENTS){
    if(!module.procedures.has(key(control.model.name+'_'+event)))continue;
    const next=x.unique(),match=x.unique(),messages={gotfocus:[7],lostfocus:[8],keydown:[0x100,0x104],keyup:[0x101,0x105],keypress:[0x102],mousedown:[0x201,0x204,0x207],mouseup:[0x202,0x205,0x208],mousemove:[0x200]}[event];
    x.value(arg(12));for(const msg of messages)x.compare(msg).branch('e',match);x.jump(next).label(match);let args=[];
    if(event.startsWith('key')){x.value(arg(16)).and('eax',65535).mov(at('ebp',-48),'eax');args=[{ref:-48}];if(event!=='keypress'){this.emitNativeShiftState();x.mov(at('ebp',-52),'eax');args.push({ref:-52});}}
    else if(event.startsWith('mouse')){
     if(event==='mousemove')x.value(arg(16)).mov('ecx','eax').and('eax',3).and('ecx',16).shift('shr','ecx',2).or('eax','ecx');
     else {const right=x.unique(),middle=x.unique(),done=x.unique();x.value(arg(12)).compare(messages[1]).branch('e',right).compare(messages[2]).branch('e',middle).value(1).jump(done).label(right).value(2).jump(done).label(middle).value(4).label(done);}
     x.mov(at('ebp',-48),'eax');this.emitNativeShiftState();x.mov(at('ebp',-52),'eax');
     for(const [offset,shift]of [[-56,0],[-60,16]]){x.value(arg(20));if(shift)x.shift('sar','eax',16);else x.emit(0x0f,0xbf,0xc0);if(Number(module.form.properties.ScaleMode??1)===1)x.emit(0x6b,0xc0,15);x.mov(at('ebp',offset),'eax').emit(0xdb,0x45,offset&255,0xd9,0x5d,offset&255);}
     args=[{ref:-48},{ref:-52},{ref:-56,type:'single'},{ref:-60,type:'single'}];
    }
    this.handler(module,control.model.name+'_'+event,args);
    x.value(arg(-20)).mov('eax',at('eax',4)).cmp('eax',at('ebp',8)).branch('ne',zero);
    if(event.startsWith('key'))x.value(arg(-48)).and('eax',65535).test().branch('e',zero).mov(at('ebp',16),'eax');x.jump(fallback).label(next);
   }x.jump(fallback).label(nextControl);
  }
  x.jump(fallback).label(forward).value(arg(-16)).mov('ebx',at('eax',F.hwnd)).push(arg(20)).push(arg(16)).push(arg(12)).pushOperand('ebx').invoke('user32.dll','SendMessageW').jump(exit);
  x.label(detach).push(arg(-20)).call(this.controlProcedure('Detach'));
  x.label(fallback).api('comctl32.dll','DefSubclassProc',[arg(8),arg(12),arg(16),arg(20)]).jump(exit).label(zero).value(0).label(exit).mov(at('ebp',-28),'eax');
  x.push(arg(-20)).call(this.controlProcedure('Release')).push(arg(-16)).call(this.classProcedure('Release')).value(arg(-28));this.leaveCallbackBoundary(-12);x.leave(24);
 },
 instanceFormProperty(object,property,value){
  const x=this.x,d=object.descriptor,r=this.nativeInstanceReceiver(object.expr,d),isSet=value!==undefined;
  if(property==='name'&&!isSet){x.value(r);this.formTypeName();return;}
  this.createNativeForm(d,r);const hwnd=this.arrayWorkspace(4,'instance-hwnd'),epoch=this.arrayWorkspace(4,'instance-epoch');x.value(r).mov('edx',at('eax',F.epoch)).mov(slot(epoch),'edx').mov('eax',at('eax',F.hwnd)).test().branch('e','error:91').mov(slot(hwnd),'eax');
  const revalidate=()=>x.value(r).mov('edx',at('eax',F.epoch)).cmp('edx',slot(epoch)).branch('ne','error:91').mov('eax',at('eax',F.hwnd)).cmp('eax',slot(hwnd)).branch('ne','error:91');
  if(property==='hwnd'&&!isSet)return;
  if(['caption','text'].includes(property)){
   if(isSet){this.textExpression(value);x.push();revalidate();x.pushOperand('eax').invoke('user32.dll','SetWindowTextW');}
   else {x.push(arg(hwnd.offset)).call(this.controlProcedure('WindowText'));this.checkNativeError();this.ownString();}return;
  }
  if(['visible','enabled'].includes(property)){
   if(isSet){this.truth(value);this.check('Boolean');x.neg('eax');if(property==='visible')x.emit(0x6b,0xc0,5);const v=this.arrayWorkspace(4,'instance-bool');x.mov(slot(v),'eax');revalidate();x.api('user32.dll',property==='visible'?'ShowWindow':'EnableWindow',[arg(hwnd.offset),arg(v.offset)]);}
   else{x.api('user32.dll',property==='visible'?'IsWindowVisible':'IsWindowEnabled',[arg(hwnd.offset)]).test();this.boolean('<>');}return;
  }
  if(['scalewidth','scaleheight'].includes(property)&&!isSet){
   const rect=this.arrayWorkspace(16,'instance-size'),out=this.floatWorkspace();x.api('user32.dll','GetClientRect',[arg(hwnd.offset),{address:rect.offset}]).test().branch('e','error:5').value(arg(rect.offset+(property==='scalewidth'?8:12))).mov('ebx','eax').value(r).cmp(at('eax',F.scaleMode),1);const pixels=x.unique();x.mov('eax','ebx').branch('ne',pixels).emit(0x6b,0xc0,15).label(pixels).push();this.rawStorageAddress(out);x.popOperand('edx').pushOperand('eax').pushOperand('edx').call('native:number:from-int');return;
  }
  if(property==='scalemode'){
   if(!isSet){x.value(r).mov('eax',at('eax',F.scaleMode));return;}
   this.numeric(value);const valid=x.unique();x.compare(1).branch('e',valid).compare(3).branch('ne','error:380').label(valid).push();revalidate();x.value(r).popOperand('edx').mov(at('eax',F.scaleMode),'edx');return;
  }
  if(property==='windowstate'){
   if(!isSet){const normal=x.unique(),done=x.unique();x.api('user32.dll','IsIconic',[arg(hwnd.offset)]).test().branch('e',normal).value(1).jump(done).label(normal).api('user32.dll','IsZoomed',[arg(hwnd.offset)]).shift('shl','eax',1).label(done);return;}
   this.numeric(value);x.compare(0).branch('l','error:5').compare(2).branch('g','error:5');const v=this.arrayWorkspace(4,'instance-window-state');x.mov(slot(v),'eax');revalidate();const minimized=x.unique(),maximized=x.unique(),done=x.unique();x.value(arg(v.offset)).compare(1).branch('e',minimized).compare(2).branch('e',maximized).value(9).jump(done).label(minimized).value(6).jump(done).label(maximized).value(3).label(done).push().push(arg(hwnd.offset)).invoke('user32.dll','ShowWindow');return;
  }
  this.fail('Independent native Form property is not lowered: '+property);
 },
 instanceFormMethod(object,method,args){
  const x=this.x,d=object.descriptor,r=this.nativeInstanceReceiver(object.expr,d);this.createNativeForm(d,r);
  if(method==='show'){if(args.length>1)this.fail('Independent Form.Show currently admits mode only');if(args.length){this.numeric(args[0]);x.test().branch('ne','error:5');}}
  else if(args.length)this.fail(method+' takes no arguments');
  x.value(r).mov('eax',at('eax',F.hwnd)).test().branch('e','error:91');
  if(method==='show'||method==='hide')x.mov('ebx','eax').push(method==='show'?5:0).pushOperand('ebx').invoke('user32.dll','ShowWindow').pushOperand('ebx').invoke('user32.dll','UpdateWindow');
  else if(method==='setfocus')x.push().invoke('user32.dll','SetFocus');else x.push().invoke('user32.dll','UpdateWindow');
 },
 arrangeNativeMdi(module,args){
  if(args.length!==1)this.fail('MDI Arrange expects one layout mode');const x=this.x,done=x.unique();x.call(module.create);this.numeric(args[0]);
  for(const [value,msg,flag]of [[0,0x227,0],[1,0x226,1],[2,0x226,0],[3,0x228,0]]){const next=x.unique();x.compare(value).branch('ne',next).api('user32.dll','SendMessageW',[mem(module.client),msg,flag,0]).jump(done).label(next);}x.jump('error:5').label(done);
 },
 closeNativeMdiChildren(module,cancel){
  // Enumerate live HWNDs, not a prototype's default slot. Reacquire from the OS
  // after every close because callbacks may reorder or destroy another child.
  const x=this.x,loop=x.unique(),done=x.unique();x.mov(at('ebp',-64),32768).label(loop).api('user32.dll','GetWindow',[mem(module.client),5]).test().branch('e',done).mov(at('ebp',-60),'eax');
  x.api('user32.dll','SendMessageW',[arg(-60),0x10,2,0]).api('user32.dll','IsWindow',[arg(-60)]).test().branch('ne',cancel)
   .dec(at('ebp',-64)).branch('ne',loop).jump(cancel).label(done);
 }
};
