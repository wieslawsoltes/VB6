/** Source Form/PictureBox drawing surfaces. This module emits native code only;
 * actual allocation, painting and rollback are compiled private VB procedures.
 * HWND and generation snapshots prevent argument reentry from targeting a new
 * form instance. No global scratch is used for indexed receivers or callbacks. */
import {SURFACE_KERNEL} from './surface-kernel.js';
import {mem32} from './x86-operands.js';
const at=(base,displacement=0)=>mem32({base,displacement}),arg=argument=>({argument}),mem=(memory,addend=0)=>({memory,addend});
const key=v=>String(v).toLowerCase(),lit=value=>({kind:'literal',value}),node=variable=>({kind:'nativeVariable',variable});
const fields={autoredraw:['redraw','Boolean'],scalemode:['scale','Long'],backcolor:['back','Long'],forecolor:['fore','Long'],currentx:['x','Double'],currenty:['y','Double'],drawwidth:['penwidth','Long'],drawstyle:['penstyle','Long'],drawmode:['drawmode','Long'],fillcolor:['fillcolor','Long'],fillstyle:['fillstyle','Long']};
const limits={scalemode:[1,3],drawwidth:[1,32767],drawstyle:[0,6],drawmode:[1,16],fillstyle:[0,7]};
const isSurface=o=>!!o&&(o.form?.type==='Form'||o.model?.type==='PictureBox');
export const nativeSurfaceMethods={
  prepareNativeSurfaceDemand(){
    const saved=this.context;
    try{for(const module of [...this.modules.values()])if(!module.nativeInternal)for(const context of module.procedures.values()){
      this.context=context;
      const walk=n=>{
        if(!n||typeof n!=='object')return;
        if(n.op==='graphics'){const owner=this.object(n.object);if(isSurface(owner))this.requireNativeSurface(owner);}
        if(n.kind==='member'&&(fields[key(n.name)]||['hdc','cls','print'].includes(key(n.name)))){
          const owner=this.object(n.object);if(isSurface(owner))this.requireNativeSurface(owner);
        }
        if(n.kind==='id'&&module.form&&(fields[key(n.name)]||['hdc','cls'].includes(key(n.name)))&&!this.variable(n)&&!this.resolveProcedure(n))this.requireNativeSurface(module);
        for(const v of Array.isArray(n)?n:Object.values(n))walk(v);
      };
      // Demand discovery precedes code emission. Resolve With lexically without
      // calling ensure(), emitting a receiver or borrowing runtime frame slots.
      // Runtime early exits do not pop this lexical stack (only withPop does).
      const prior=context.withBindings;context.withBindings=[];
      try{for(const instruction of context.proc.code){
        walk(instruction);
        if(instruction.op==='withPush'){
          const record=this.variable(instruction.expr),object=record?.nativeRecord?null:this.object(instruction.expr);
          context.withBindings.push({record,object});
        }else if(instruction.op==='withPop')context.withBindings.pop();
      }}finally{context.withBindings=prior;}
    }}finally{this.context=saved;}
  },
  requireNativeSurface(object){
    if(!isSurface(object))this.fail('Native drawing requires a Form or PictureBox');
    if(!this.surfaceKernel){
      this.surfaceKernel=this.privateNativeKernel('NativeSurfaceKernel',SURFACE_KERNEL,{
        seedpicture:(c,proc)=>{
          const x=c.x,done=x.unique();x.label(proc.label).enter();
          if(c.nativePictureFeatures?.size){
            x.value(arg(8)).mov('eax',at('eax',76)).test().branch('e',done).mov('eax',at('eax')).test().branch('e',done).mov('ebx','eax');
            x.push(0).push(arg(20)).push(arg(16)).push(0).push(0).push(arg(12)).pushOperand('ebx').call('native:picture:draw');
          }
          x.label(done).value(0).leave(proc.argumentBytes);
        }
      });
      this.surfaceLayout=this.recordLayouts.resolve('Surface',this.surfaceKernel.module);
    }
    const owners=object.group?[...object.group.entries.values()]:[object];
    for(const owner of owners)if(!owner.surface){
      const p=owner.form?.properties||owner.model.properties;
      if(![1,3].includes(Number(p.ScaleMode??1)))this.fail('Native drawing surface ScaleMode supports Twips (1) and Pixels (3)');
      const label='native:surface:'+ (owner.form?owner.name:owner.module.name+':'+owner.key);
      const seed={redraw:p.AutoRedraw?-1:0,scale:Number(p.ScaleMode??1),back:Number(p.BackColor??-2147483633),fore:Number(p.ForeColor??-2147483640),penwidth:Number(p.DrawWidth??1),penstyle:Number(p.DrawStyle??0),drawmode:Number(p.DrawMode??13),fillcolor:Number(p.FillColor??0),fillstyle:Number(p.FillStyle??1)};
      for(const [property,[field]]of Object.entries(fields))if(limits[property]){
        const value=seed[field],[low,high]=limits[property];
        if(!Number.isInteger(value)||value<low||value>high)this.fail('Invalid native drawing '+property);
      }
      this.data.align(4).label(label).zero(this.surfaceLayout.size);
      owner.surface={name:label,type:'Surface',label,nativeRecord:this.surfaceLayout,nativeBytes:this.surfaceLayout.size,seed};
      if(owner.form)this.allocateNativeFormPictureState(owner);
    }
    return object.surface;
  },
  nativeSurfaceType(expr){
    if(expr.kind==='member'&&isSurface(this.object(expr.object))){const owner=this.object(expr.object),p=key(expr.name);if(owner.form&&!owner.surface&&['scalewidth','scaleheight'].includes(p))return null;return fields[p]?key(fields[p][1]):['scalewidth','scaleheight'].includes(p)?'double':p==='hdc'?'long':null;}
    if(expr.kind==='id'&&this.context?.module.form&&!this.variable(expr)&&!this.resolveProcedure(expr)){const p=key(expr.name);if(!this.context.module.surface&&['scalewidth','scaleheight'].includes(p))return null;return fields[p]?key(fields[p][1]):['scalewidth','scaleheight'].includes(p)?'double':p==='hdc'?'long':null;}
    return null;
  },
  surfacePointer(object){
    this.requireNativeSurface(object);const x=this.x;
    if(!object.group){x.value(object.surface.label);return;}
    const done=x.unique();x.value(this.controlHandleRef(object));
    for(const owner of object.group.entries.values()){const next=x.unique();x.cmp('eax',mem32({label:owner.handle})).branch('ne',next).value(owner.surface.label).jump(done).label(next);}
    x.jump('error:91').label(done);
  },
  snapshotNativeSurface(object){
    this.requireNativeSurface(object);this.ensure(object);this.surfacePointer(object);
    const x=this.x,slot=this.arrayWorkspace(12,'surface-receiver');
    x.mov(at('ebp',slot.offset),'eax').mov('edx',at('eax')).mov(at('ebp',slot.offset+4),'edx').mov('edx',at('eax',84)).mov(at('ebp',slot.offset+8),'edx');
    const record={type:'Surface',nativeRecord:this.surfaceLayout,offset:slot.offset,parameter:true,byRef:true};
    return {slot,record,object};
  },
  guardNativeSurface(receiver){
    const x=this.x,o=receiver.slot.offset;
    x.value(arg(o)).mov('edx',at('eax',84)).cmp('edx',at('ebp',o+8)).branch('ne','error:91').mov('eax',at('eax')).cmp('eax',at('ebp',o+4)).branch('ne','error:91')
      .push().invoke('user32.dll','IsWindow').test().branch('e','error:91');
  },
  surfaceField(receiver,field){return {...this.surfaceLayout.fields.get(field),recordOf:receiver.record};},
  callNativeSurface(receiver,name,values=[]){
    this.guardNativeSurface(receiver);this.invokePrivateNative(this.surfaceKernel,name,[node(receiver.record),...values]);
  },
  getNativeSurfaceProperty(object,property){
    if(!isSurface(object)||!fields[property]&&!['hdc','scalewidth','scaleheight'].includes(property))return false;
    if(object.form&&!object.surface&&['scalewidth','scaleheight'].includes(property))return false;
    const receiver=this.snapshotNativeSurface(object),x=this.x;
    if(property==='hdc'){
      this.callNativeSurface(receiver,'SurfaceDC');x.push();const painting=x.unique();x.value(arg(receiver.slot.offset)).cmp(at('eax',88),0).branch('ne',painting).api('user32.dll','InvalidateRect',[arg(receiver.slot.offset+4),0,0]).label(painting).popOperand('eax');return true;
    }
    if(fields[property]){this.guardNativeSurface(receiver);this.load(this.surfaceField(receiver,fields[property][0]));return true;}
    this.callNativeSurface(receiver,'SurfaceExtent',[lit(property==='scaleheight'?1:0)]);return true;
  },
  setNativeSurfaceProperty(object,property,expr){
    if(!isSurface(object)||!fields[property])return false;
    const receiver=this.snapshotNativeSurface(object),[field,type]=fields[property],x=this.x;
    const value=this.arrayWorkspace(type==='Double'?8:4,'surface-value');value.type=type;
    this.storageExpression(value,expr);this.store(value);this.guardNativeSurface(receiver);
    if(property==='autoredraw'){this.callNativeSurface(receiver,'SurfaceRedraw',[node(value)]);return true;}
    this.load(value);
    if(limits[property]){const [min,max]=limits[property];x.compare(min).branch('l','error:380').compare(max).branch('g','error:380');if(property==='scalemode')x.compare(2).branch('e','error:380');}
    this.store(this.surfaceField(receiver,field));
    // Native owner-drawn background/color paths remain coherent with the surface.
    if(object.model&&['backcolor','forecolor','fillcolor','fillstyle','drawwidth','drawstyle'].includes(property)){
      const offset={backcolor:32,forecolor:36,fillcolor:40,fillstyle:44,drawwidth:56,drawstyle:60}[property];
      this.load(value);x.push();this.nativeControlState({...object,indexed:false,boundIndex:!!object.group});x.popOperand('edx').mov(at('eax',offset),'edx');
    }
    if(property==='backcolor')this.callNativeSurface(receiver,'SurfaceClear');
    return true;
  },
  nativeSurfaceMethod(object,method,args){
    if(!isSurface(object)||!['cls','refresh'].includes(method))return false;
    if(args.length)this.fail('Native '+method+' takes no arguments');
    const receiver=this.snapshotNativeSurface(object);
    if(method==='cls')this.callNativeSurface(receiver,'SurfaceClear');
    else this.x.api('user32.dll','InvalidateRect',[arg(receiver.slot.offset+4),0,0]).api('user32.dll','UpdateWindow',[arg(receiver.slot.offset+4)]);
    return true;
  },
  nativeSurfaceInstruction(ins){
    if(ins.op==='expr'&&ins.expr.kind==='member')return this.nativeSurfaceMethod(this.object(ins.expr.object),key(ins.expr.name),[]);
    return false;
  },
  initializeNativeSurface(object){
    if(!object.surface)return;
    const x=this.x,s=object.surface,picture=object.form?object.pictureState:{label:object.state,offset:76};
    // Release can also be called after the OS destroys the HWND. Every create
    // resets authored state and increments the stable record's generation.
    for(const field of this.surfaceLayout.fields.values())if(key(field.name)!=='epoch')for(let i=0;i<field.nativeBytes;i+=4)x.value(0).store(s.label,field.recordOffset+i);
    x.value(mem(object.handle)).store(s.label,0);
    x.inc(mem32({label:s.label,displacement:84}));
    for(const [field,value]of Object.entries(s.seed))x.value(value).store(s.label,this.surfaceLayout.fields.get(field).recordOffset);
    if(object.form)x.value(picture);else x.value(picture.label).add('eax',picture.offset);
    x.store(s.label,76);
    if(object.model)x.api('user32.dll','SendMessageW',[mem(object.handle),0x31,0,0]).store(s.label,80);
  },
  disposeNativeSurface(object){
    if(!object.surface)return;
    const x=this.x,s=object.surface;
    x.push(s.label).call(this.privateNativeProcedure(this.surfaceKernel,'SurfaceRelease').label).value(0).store(s.label).inc(mem32({label:s.label,displacement:84}));
  },
  resetNativeSurfacePicture(object){
    const owners=object.group?[...object.group.entries.values()]:[object];
    if(!owners.some(o=>o.surface))return;
    const receiver=this.snapshotNativeSurface({...object,indexed:false,boundIndex:!!object.group});this.callNativeSurface(receiver,'SurfaceClear');
  },
  nativeSurfaceWindowMessages(object,fallback,zero,exit){
    if(!object.surface)return;
    const x=this.x,s=object.surface,done=x.unique(),paint=x.unique(),print=x.unique(),font=x.unique(),destroy=x.unique();
    const erase=x.unique();
    x.value(arg(8)).cmp('eax',mem32({label:s.label})).branch('ne',done).value(arg(12)).compare(0x82).branch('e',destroy).compare(0x30).branch('e',font)
      .compare(0x14).branch('e',erase).compare(0xf).branch('e',paint).compare(0x318).branch('e',print).jump(done);
    x.label(erase).value(1).jump(exit);
    x.label(paint).push(mem(s.label,84)).inc(mem32({label:s.label,displacement:88})).push(s.label).call(this.privateNativeProcedure(this.surfaceKernel,'SurfaceWindowPaint').label);
    this.checkNativeError('native:error:fatal');
    const noEvent=x.unique(),module=object.form?object:object.module;
    x.value(mem(module.loaded)).test().branch('e',noEvent).value(mem(s.label,24)).test().branch('ne',noEvent);
    if(object.form)this.handler(object,'Form_Paint');else this.controlHandler(object.module,object,'Paint');
    x.label(noEvent).popOperand('edx').cmp('edx',mem32({label:s.label,displacement:84})).branch('ne',zero).dec(mem32({label:s.label,displacement:88})).jump(zero);
    x.label(print).push(arg(16)).push(s.label).call(this.privateNativeProcedure(this.surfaceKernel,'SurfacePaint').label);this.checkNativeError('native:error:fatal');x.jump(zero);
    x.label(font).value(arg(16)).store(s.label,80).value(mem(s.label,4)).test().branch('e',done).mov('ebx','eax').push(arg(16)).pushOperand('ebx').invoke('gdi32.dll','SelectObject').jump(done);
    x.label(destroy);this.disposeNativeSurface(object);x.label(done);
  }
};
