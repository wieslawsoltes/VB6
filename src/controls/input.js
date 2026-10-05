import {Cell,truth} from '../runtime/values.js';
import {lower} from '../core/core.js';

// Browser/Windows button bitmasks agree, but `button` is an ordinal and a
// released button is no longer in `buttons`. Never infer a hover button.
export const shiftMask=event=>(event.shiftKey?1:0)|(event.ctrlKey?2:0)|(event.altKey?4:0);
export const mouseButton=(event,kind)=>kind==='MouseMove'?(Number(event.buttons)||0)&7:([1,4,2][event.button]||0);
// A chorded press/release is a pointermove, not another pointerdown/up.
export function pointerMouseEvent(event){
  if(event.type==='pointerdown')return 'MouseDown';
  if(event.type==='pointerup')return 'MouseUp';
  const button=[1,4,2][event.button]||0;
  return button?(event.buttons&button?'MouseDown':'MouseUp'):'MouseMove';
}
const namedKeys={Backspace:8,Tab:9,Enter:13,Shift:16,Control:17,Alt:18,Pause:19,CapsLock:20,Escape:27,' ':32,PageUp:33,PageDown:34,End:35,Home:36,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,PrintScreen:44,Insert:45,Delete:46,Meta:91,ContextMenu:93,NumLock:144,ScrollLock:145};
const punctuation={';':186,'=':187,',':188,'-':189,'.':190,'/':191,'`':192,'[':219,'\\':220,']':221,"'":222};
export function virtualKey(event){
  const code=String(event.code||''),key=String(event.key||'');
  if(/^Numpad[0-9]$/.test(code))return 96+Number(code.at(-1));
  const numpad={NumpadMultiply:106,NumpadAdd:107,NumpadSubtract:109,NumpadDecimal:110,NumpadDivide:111};
  if(numpad[code])return numpad[code];
  if(namedKeys[key])return namedKeys[key];
  if(/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(key))return 111+Number(key.slice(1));
  if(/^[a-z0-9]$/i.test(key))return key.toUpperCase().charCodeAt(0);
  // Preserve browser layout-specific OEM keys when available.
  if(Number(event.keyCode)>0&&Number(event.keyCode)<256)return Number(event.keyCode);
  if(punctuation[key])return punctuation[key];
  if(/^Key[A-Z]$/.test(code))return code.charCodeAt(3);
  if(/^Digit[0-9]$/.test(code))return code.charCodeAt(5);
  return 0;
}
export function characterKey(event){
  if(event.key==='Enter')return 13;if(event.key==='Backspace')return 8;if(event.key==='Tab')return 9;if(event.key==='Escape')return 27;
  const key=String(event.key||'');
  if(key.length!==1)return 0;
  // This runtime uses UTF-16 text; retain the signed Integer event ABI.
  const value=key.charCodeAt(0);return value>32767?value-65536:value;
}
const owners=new WeakMap();
function ownerOf(node){for(let current=node?.nodeType===1?node:node?.parentElement;current;current=current.parentElement){const owner=owners.get(current);if(owner)return owner;}return null;}
export function acceptsInput(control){
  if(!control||control.design||control.disposed||!control.vm||['ready','paused','stopped','error'].includes(control.vm.state))return false;
  if(!control.node.isConnected||control.node.closest('[inert],[hidden]'))return false;
  for(let node=control.node;node;node=node.parentElement){const owner=owners.get(node);if(owner&&(owner.disposed||!truth(owner.props.Enabled)||!truth(owner.props.Visible)))return false;}
  return true;
}
function eventName(control,event){return (control.type==='Form'?'Form':control.type==='MDIForm'?'MDIForm':control.model.name)+'_'+event;}
function procedure(control,event){return control.instance?.module?.procedures.get(lower(eventName(control,event)));}
function argumentsFor(control,args){return control.props.Index===undefined?args:[Number(control.props.Index),...args];}
async function invoke(control,event,args){const proc=procedure(control,event);if(proc&&acceptsInput(control))return control.vm.callProcedure(control.instance,proc,argumentsFor(control,args));}
const scaleUnits={0:1,1:15,2:.75,3:1,4:1/8,5:1/96,6:25.4/96,7:2.54/96};
// VB character units are 120 twips wide and 240 twips high (8x16 CSS pixels).
export const inputScaleFactor=(mode,vertical=false)=>Number(mode)===4&&vertical?1/16:scaleUnits[Number(mode)]??15;
export function mouseCoordinates(control,event){
  const selfScale=['Form','MDIForm','PictureBox'].includes(control.type),surface=control.content||control.node;
  const rect=surface.getBoundingClientRect(),sx=surface.offsetWidth?rect.width/surface.offsetWidth:1,sy=surface.offsetHeight?rect.height/surface.offsetHeight:1;
  const x=(event.clientX-rect.left)/(sx||1)-(surface.clientLeft||0)+(surface.scrollLeft||0);
  const y=(event.clientY-rect.top)/(sy||1)-(surface.clientTop||0)+(surface.scrollTop||0);
  let scale=control;
  if(!selfScale){scale=ownerOf(control.node.parentElement)||control.form;while(scale&&scale!==scale.form&&!['PictureBox','Form','MDIForm'].includes(scale.type))scale=ownerOf(scale.node.parentElement)||scale.form;}
  const props=scale?.props||{},mode=Number(props.ScaleMode??1),area=scale?.content||scale?.node;
  let ux=inputScaleFactor(mode),uy=inputScaleFactor(mode,true);
  if(mode===0){ux=Number(props.ScaleWidth??area?.clientWidth??1)/(area?.clientWidth||1);uy=Number(props.ScaleHeight??area?.clientHeight??1)/(area?.clientHeight||1);}
  return [x*ux+(selfScale?Number(props.ScaleLeft)||0:0),y*uy+(selfScale?Number(props.ScaleTop)||0:0)];
}

export function bindMouseInput(control){
  owners.set(control.node,control);
  const root=control.content||control.node,moveKey={};
  root.addEventListener('contextmenu',e=>{
    // WebKit's native context menu consumes the subsequent pointerup. When VB
    // handles the right button, keep its complete down/up stream in the app.
    // Unhandled targets and keyboard-invoked native menus remain unchanged.
    if(e.button===2&&ownerOf(e.target)===control&&acceptsInput(control)&&
      (procedure(control,'MouseDown')||procedure(control,'MouseUp')))e.preventDefault();
  });
  for(const dom of ['pointerdown','pointermove','pointerup'])root.addEventListener(dom,e=>{
    if(ownerOf(e.target)!==control||!acceptsInput(control))return;
    const event=pointerMouseEvent(e);
    if(event==='MouseDown'&&control.content&&!(control.controls||[]).some(c=>c.TabStop&&acceptsInput(c)))control.SetFocus();
    if(!procedure(control,event))return;
    const args=[mouseButton(e,event),shiftMask(e),...mouseCoordinates(control,e)];
    control.vm.enqueueInput(control.instance,event==='MouseMove'?moveKey:null,()=>invoke(control,event,args),{coalesce:event==='MouseMove',valid:()=>acceptsInput(control)});
  });
}

export function bindKeyboardInput(control){
  owners.set(control.node,control);
  for(const [dom,event]of [['keydown','KeyDown'],['keypress','KeyPress'],['keyup','KeyUp']])control.node.addEventListener(dom,e=>{
    if(e.isComposing||e.keyCode===229)return;
    const owner=ownerOf(e.target);
    if(!owner||!acceptsInput(owner))return;
    if(control.content?owner.form!==control:owner!==control)return;
    // Menus and window chrome retain their own keyboard implementation.
    if(control.content&&e.target!==control.node&&!control.content.contains(e.target))return;
    const form=owner.form,preview=owner!==form&&form&&truth(form.props.KeyPreview);
    if(!procedure(owner,event)&&!(preview&&procedure(form,event)))return;
    const value=event==='KeyPress'?characterKey(e):virtualKey(e);if(!value)return;
    const key=new Cell('Integer',value),args=event==='KeyPress'?[{ref:key}]:[{ref:key},shiftMask(e)];
    // Capture once at the form, but serialize preview and target as a single VB
    // event action. Both see the SAME ByRef cell, never two independent copies.
    owner.vm.enqueueInput(owner.instance,null,async()=>{
      if(preview)await invoke(form,event,args);
      if(key.get()!==0&&acceptsInput(owner))await invoke(owner,event,args);
    },{valid:()=>acceptsInput(owner)});
  },true);
}

export function ownsInputEvent(control,event){return ownerOf(event.target)===control&&acceptsInput(control);}
