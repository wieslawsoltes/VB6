/** Form/PictureBox drawing-surface lowering. Private VB services become ordinary
 * x86 procedures; native exports do not carry an interpreted graphics runtime.
 * Each receiver is resolved once and its generation is captured before operands.
 */
import {SURFACE_DRAWING_KERNEL} from './surface-drawing-kernel.js';
import {nativePrintImage} from './print.js';
import {SURFACE_KERNEL} from './surface-kernel.js';
import {mem16,mem32} from './x86-operands.js';
const key=v=>String(v).toLowerCase(),arg=argument=>({argument}),mem=(memory,addend=0)=>({memory,addend});
const at=(base,displacement=0)=>mem32({base,displacement});
const supported=o=>!!o?.form&&o.form.type==='Form'||o?.model?.type==='PictureBox';
const fields={autoredraw:'redraw',scalemode:'scale',backcolor:'back',forecolor:'fore',currentx:'x',currenty:'y',drawwidth:'penWidth',drawstyle:'penStyle',drawmode:'drawMode',fillcolor:'fillColor',fillstyle:'fillStyle'};
const properties=new Set(['hdc','scalewidth','scaleheight',...Object.keys(fields)]);
export const nativeSurfaceMethods={
  prepareNativeSurfaceDemand(){
    const saved=this.context;
    try{for(const module of [...this.modules.values()])if(!module.nativeInternal)for(const context of module.procedures.values()){
      this.context=context;
      // Discovery must not call indexedControl(): it allocates runtime frame
      // slots. Resolve only statically addressable designer identities here.
      const resolveObject=n=>{
        if(!n)return null;
        if(n.kind==='group')return resolveObject(n.expr);
        if(n.kind==='with')return context.withBindings?.at(-1)?.object||null;
        if(n.kind==='id')return key(n.name)==='me'?(module.form?module:null):module.controls.get(key(n.name))||(this.modules.get(key(n.name))?.form?this.modules.get(key(n.name)):null);
        if(n.kind==='member'&&n.object.kind==='id')return this.modules.get(key(n.object.name))?.controls.get(key(n.name))||null;
        if(n.kind==='call'){
          const group=n.callee.kind==='id'?module.controlArrays.get(key(n.callee.name)):n.callee.kind==='member'&&n.callee.object.kind==='id'?this.modules.get(key(n.callee.object.name))?.controlArrays.get(key(n.callee.name)):null;
          return group?{group,module:group.module,model:group.entries.values().next().value.model}:null;
        }
        return null;
      };
      const walk=n=>{
        if(!n||typeof n!=='object')return;
        if(n.op==='graphics'){const owner=resolveObject(n.object);if(supported(owner))this.prepareNativeSurface(owner);}
        if(n.kind==='member'&&(fields[key(n.name)]||['hdc','cls','print','refresh','textwidth','textheight'].includes(key(n.name)))){
          const owner=resolveObject(n.object);if(supported(owner))this.prepareNativeSurface(owner);
        }
        if(n.kind==='id'&&module.form&&(fields[key(n.name)]||['hdc','cls'].includes(key(n.name)))&&!this.variable(n)&&!this.resolveProcedure(n))this.prepareNativeSurface(module);
        for(const v of Array.isArray(n)?n:Object.values(n))walk(v);
      };
      // Demand discovery precedes code emission. Resolve With lexically without
      // calling ensure(), emitting a receiver or borrowing runtime frame slots.
      // Runtime early exits do not pop this lexical stack (only withPop does).
      const prior=context.withBindings;context.withBindings=[];
      try{for(const instruction of context.proc.code){
        walk(instruction);
        if(instruction.op==='withPush'){
          const record=this.variable(instruction.expr),object=record?.nativeRecord?null:resolveObject(instruction.expr);
          context.withBindings.push({record,object});
        }else if(instruction.op==='withPop')context.withBindings.pop();
      }}finally{context.withBindings=prior;}
    }}finally{this.context=saved;}
  },

  prepareSurfaceKernel(){
    if(this.surfaceKernel)return this.surfaceKernel;
    const kernel=this.privateNativeKernel('NativeDrawingSurface',SURFACE_KERNEL+SURFACE_DRAWING_KERNEL,{seedpicture:(c,p)=>c.emitSurfacePictureSeed(p),surfacelinelength:(c,p)=>c.emitSurfaceLineLength(p)});
    this.surfaceKernel=kernel;
    this.surfaceLayout=this.recordLayouts.resolve('Surface',kernel.module);
    return kernel;
  },
  prepareNativeSurface(object){
    if(!supported(object))this.fail('Native drawing requires a Form or PictureBox');
    this.prepareSurfaceKernel();
    for(const owner of object.group?[...object.group.entries.values()]:[object])if(!owner.nativeSurface){
      const module=owner.form?owner:owner.module,p=owner.form?.properties||owner.model.properties;
      const initial={scale:Number(p.ScaleMode??1),redraw:p.AutoRedraw?-1:0,back:Number(p.BackColor??-2147483633),fore:Number(p.ForeColor??-2147483640),penWidth:Number(p.DrawWidth??1),penStyle:Number(p.DrawStyle??0),drawMode:Number(p.DrawMode??13),fillColor:Number(p.FillColor??0),fillStyle:Number(p.FillStyle??1)};
      if(![1,3].includes(initial.scale))this.fail('Native surface ScaleMode supports Twips (1) or Pixels (3)',module);
      for(const [name,min,max]of [['penWidth',1,32767],['penStyle',0,6],['drawMode',1,16],['fillStyle',0,7]])if(!Number.isInteger(initial[name])||initial[name]<min||initial[name]>max)this.fail('Invalid native drawing property: '+name,module);
      owner.nativeSurface={name:'surface:'+module.name+':'+(owner.key||'form'),type:'Surface',label:'surface:'+module.name+':'+(owner.key||'form'),nativeRecord:this.surfaceLayout,nativeBytes:this.surfaceLayout.size,initial};
      this.allocateStorage(owner.nativeSurface);
      if(owner.form)this.allocateNativeFormPictureState(owner);
      else if(!owner.oldProcedure)owner.oldProcedure=this.slot('control-old-procedure:'+module.name+':'+owner.key);
    }
  },
  initializeNativeSurfaceClasses(){
    if(![...this.modules.values()].some(m=>[...m.controls.values()].some(c=>c.nativeSurface)))return;
    // Superclass only our drawing PictureBoxes, not the process-wide STATIC
    // class. CS_OWNDC makes non-retained hDC handles and their GDI attributes
    // live for the HWND lifetime; native ReleaseDC calls do not recycle them.
    // https://learn.microsoft.com/windows/win32/gdi/private-display-device-contexts
    const x=this.x,wc='native:surface:window-class';this.data.align(4).label(wc).zero(40);
    x.api('user32.dll','GetClassInfoW',[0,this.string('STATIC'),wc]).test().branch('e','error:7');
    x.value(mem(wc)).and('eax',~0x40c0).or('eax',0x20).store(wc)
      .value(mem('instance')).store(wc,16).value(this.string('VB6.Native.PictureSurface')).store(wc,36)
      .api('user32.dll','RegisterClassW',[wc]).test().branch('e','error:7');
  },
  nativeSurfaceType(node){
    if(node.kind==='call'&&node.callee.kind==='member'&&['textwidth','textheight'].includes(key(node.callee.name))&&supported(this.object(node.callee.object)))return 'single';
    if(!properties.has(key(node.name)))return null;
    const owner=node.kind==='member'?this.object(node.object):node.kind==='id'&&!this.variable(node)&&!this.resolveProcedure(node)?this.context?.module:null;
    if(!supported(owner))return null;
    return ['currentx','currenty','scalewidth','scaleheight'].includes(key(node.name))?'single':key(node.name)==='autoredraw'?'boolean':'long';
  },
  surfaceAccess(object){
    this.prepareNativeSurface(object);this.ensure(object);
    const x=this.x,slot=this.arrayWorkspace(8,'surface-receiver'),done=x.unique();
    if(object.group){
      x.value(this.controlHandleRef(object));
      for(const owner of object.group.entries.values()){
        const next=x.unique();x.cmp('eax',mem32({label:owner.handle})).branch('ne',next).value(owner.nativeSurface.label).jump(done).label(next);
      }
      x.jump('error:91').label(done);
    }else x.value(object.nativeSurface.label);
    x.push();this.rawStorageAddress(slot);x.popOperand('ecx').mov(at('eax'),'ecx').mov('edx',at('ecx',84)).mov(at('eax',4),'edx');
    const reference=slot.label?mem(slot.label):arg(slot.offset),epoch=slot.label?mem(slot.label,4):arg(slot.offset+4);
    return {record:this.nativeKernelStorage({name:slot.name,type:'Surface',nativeRecord:this.surfaceLayout,nativeKernelPointer:reference}),epoch:this.nativeKernelValue(epoch)};
  },
  callSurface(object,name,args=[]){
    const access=this.surfaceAccess(object);this.invokePrivateNative(this.surfaceKernel,name,[access.record,access.epoch,...args]);
  },
  directSurface(object,name,args=[]){
    if(!object.nativeSurface)return;
    const proc=this.privateNativeProcedure(this.surfaceKernel,name),x=this.x;
    for(const value of [...args].reverse())x.push(value);
    x.push(object.nativeSurface.label).call(proc.label);this.checkNativeError();
  },
  initializeNativeSurface(object){
    if(!object.nativeSurface)return;
    const s=object.nativeSurface,x=this.x;
    // Preserve the generation counter. Destruction/recreation invalidates every
    // captured receiver even when Windows recycles its numeric HWND.
    x.value(mem(s.label,84)).compare(0x7fffffff).branch('e','error:6').inc('eax').store(s.label,84);
    for(const field of this.surfaceLayout.fields.values())if(field.name!=='epoch'){
      const value=s.initial[field.name]??0;
      if(field.nativeBytes===8){x.value(0).store(s.label,field.recordOffset).store(s.label,field.recordOffset+4);}
      else x.value(value).store(s.label,field.recordOffset);
    }
    x.value(this.controlHandleRef(object)).store(s.label);
    x.value(object.form?object.pictureState:object.state).add('eax',object.form?0:76).store(s.label,76);
    if(object.form){const font={module:object,model:{properties:object.form.properties},handle:object.handle};this.applyNativeControlFont(font);x.value(mem(font.nativeFontHandle)).store(s.label,80);}
    else x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0x31,0,0]).store(s.label,80);
  },
  getNativeSurfaceProperty(object,property){
    if(!supported(object)||!properties.has(property))return false;
    if(property==='hdc'){this.callSurface(object,'SurfaceHDC');return true;}
    if(property==='scalewidth'||property==='scaleheight'){
      this.callSurface(object,'SurfaceSize',[{kind:'literal',value:property==='scaleheight'}]);this.roundSingle();return true;
    }
    const access=this.surfaceAccess(object);
    this.invokePrivateNative(this.surfaceKernel,'SurfaceValidate',[access.record,access.epoch]);
    const field=this.surfaceLayout.fields.get(key(fields[property]));
    this.load({...field,recordOf:access.record.storage});
    if(property==='currentx'||property==='currenty')this.roundSingle();return true;
  },
  setNativeSurfaceProperty(object,property,expr){
    if(!supported(object)||!properties.has(property))return false;
    if(['hdc','scalewidth','scaleheight'].includes(property))this.fail('Native surface property is read-only: '+property);
    this.callSurface(object,'SurfaceSet',[{kind:'literal',value:Object.keys(fields).indexOf(property)},expr]);return true;
  },
  nativeSurfaceMethod(object,method,args){
    if(!supported(object))return false;
    if(method==='refresh'){
      if(args.length)this.fail('Refresh takes no arguments');
      this.callSurface(object,'SurfaceRefresh');return true;
    }
    if(method==='cls'){
      if(args.length)this.fail('Cls takes no arguments');
      this.callSurface(object,'SurfaceCls');return true;
    }
    if(['textwidth','textheight'].includes(method)){
      if(args.length!==1||['named','missing'].includes(args[0].kind))this.fail(method+' expects one positional text argument');
      this.callSurface(object,'SurfaceMeasure',[args[0],{kind:'literal',value:method==='textheight'}]);this.roundSingle();return true;
    }
    if(method==='print'){
      if(args.some(a=>['named','missing'].includes(a.kind)))this.fail('Native surface Print expects positional expressions');
      const access=this.surfaceAccess(object),x=this.x;
      this.invokePrivateNative(this.surfaceKernel,'SurfaceColumn',[access.record,access.epoch]);
      const position=this.arrayWorkspace(4,'surface-print-column');x.mov(at('ebp',position.offset),'eax');
      const items=args.flatMap((expr,i)=>[...(i?[{kind:'tab',expr:null}]:[]),{kind:'value',expr}]);
      const image=nativePrintImage(this,{nativePrintPlan:{items,newline:true}},arg(position.offset));
      this.invokePrivateNative(this.surfaceKernel,'SurfaceText',[access.record,access.epoch,this.nativeKernelStorage(image.out)]);return true;
    }
    return false;
  },
  surfaceInstruction(ins){
    // The source parser represents no-parenthesis member statements separately.
    if(ins.op==='expr'&&ins.expr.kind==='member'&&['cls','print','refresh'].includes(key(ins.expr.name)))return this.nativeSurfaceMethod(this.object(ins.expr.object),key(ins.expr.name),[]);
    if(ins.op==='graphics'){
      const kind=ins.kind==='rect'?(ins.fill?2:1):{line:0,circle:3,pixel:4}[ins.kind];
      if(kind===undefined)this.fail('Native graphics instruction is not lowered: '+ins.kind);
      const coords=[...ins.coords];while(coords.length<4)coords.push({kind:'literal',value:0});
      this.callSurface(this.object(ins.object),'SurfaceDraw',[{kind:'literal',value:kind},...coords,ins.color]);return true;
    }
    return false;
  },
  nativeSurfaceWindowMessages(object,exit){
    if(!object.nativeSurface)return;
    const x=this.x,s=object.nativeSurface,after=x.unique(),destroy=x.unique(),print=x.unique(),paint=x.unique(),erase=x.unique(),font=x.unique();
    x.value(arg(8)).cmp('eax',mem32({label:s.label})).branch('ne',after);
    x.value(arg(12)).compare(0x82).branch('e',destroy).compare(0x30).branch('e',font)
      .compare(0xf).branch('e',paint).compare(0x14).branch('e',erase).compare(0x318).branch('e',print).jump(after);
    x.label(destroy);this.directSurface(object,'SurfaceDestroy');x.jump(after);
    // A replacement HFONT must leave the persistent HDC before its previous
    // owner deletes it. WM_SETFONT is synchronous with the existing font owner.
    x.label(font).value(arg(16)).store(s.label,80).value(mem(s.label,4)).test().branch('e',after).mov('ebx','eax')
      .value(arg(16)).test().branch('e',after).push().pushOperand('ebx').invoke('gdi32.dll','SelectObject').jump(after);
    x.label(erase).value(1).jump(exit);
    x.label(paint).value(mem(s.label,88)).compare(0x7fffffff).branch('e','error:28')
      .push(mem(s.label,84)).inc(mem32({label:s.label,displacement:88}));
    this.directSurface(object,'SurfacePaintWindow');
    const noEvent=x.unique(),eventDone=x.unique(),module=object.form?object:object.module;
    x.value(mem(module.loaded)).test().branch('e',noEvent).value(mem(s.label,24)).test().branch('ne',noEvent);
    if(object.form)this.handler(object,'Form_Paint');else this.controlHandler(module,object,'Paint');
    x.label(noEvent).popOperand('edx').cmp('edx',mem32({label:s.label,displacement:84})).branch('ne',eventDone)
      .dec(mem32({label:s.label,displacement:88}));
    x.label(eventDone).value(0).jump(exit);
    x.label(print).value(arg(16)).test().branch('e',after);this.directSurface(object,'SurfacePaint',[arg(16)]);x.value(1).jump(exit).label(after);
  },
  nativeSurfaceOwnerDraw(control,exit){
    if(!control.nativeSurface)return false;
    const x=this.x;x.value(arg(20)).mov('eax',at('eax',24)).push().push(control.nativeSurface.label).call(this.privateNativeProcedure(this.surfaceKernel,'SurfacePaint').label);this.checkNativeError();x.value(1).jump(exit);return true;
  },
  disposeNativeSurface(object){if(object.nativeSurface)this.directSurface(object,'SurfaceDestroy');},
  nativeSurfacePictureChanged(object){if(object.nativeSurface)this.directSurface(object,'SurfaceBackgroundChanged');},
  emitSurfaceLineLength(proc){
    const x=this.x,loop=x.unique(),done=x.unique();x.label(proc.label).enter().value(arg(8)).mov('edx','eax').value(arg(12)).mov('ecx','eax').xor('eax','eax');
    x.label(loop).cmp('eax','ecx').branch('ae',done).cmp(mem16({base:'edx',index:'eax',scale:2}),13).branch('e',done).cmp(mem16({base:'edx',index:'eax',scale:2}),10).branch('e',done).inc('eax').jump(loop);
    x.label(done).leave(8);
  },
  emitSurfacePictureSeed(proc){
    const x=this.x,done=x.unique();x.label(proc.label).enter();
    if(this.nativePictureFeatures?.size){
      x.value(arg(8)).mov('eax',at('eax',76)).test().branch('e',done).mov('eax',at('eax')).test().branch('e',done).mov('ebx','eax');
      x.push(0).push(arg(20)).push(arg(16)).push(0).push(0).push(arg(12)).pushOperand('ebx').call('native:picture:draw');
    }
    x.label(done).value(0).leave(16);
  }
};
