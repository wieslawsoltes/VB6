import {createWin32,Win32Error,encodeANSI,decodeANSI} from '../../packages/win32-browser/src/index.js';
import {VBError} from '../language/lexer.js';
import {VBArray,VBCurrency,numeric,coerce} from './values.js';

const align=(n,a)=>Math.ceil(n/a)*a;
const scalar={byte:[1,'Uint8'],integer:[2,'Int16'],boolean:[2,'Int16'],long:[4,'Int32'],single:[4,'Float32'],double:[8,'Float64'],currency:[8,'BigInt64']};
const bad=message=>new VBError('Win32 ABI: '+message,49);
/** A VB6 ANSI Declare adapter. All pointers belong to this VM, never the host. */
export class VBWin32Bridge {
  constructor(vm){
    this.vm=vm;this.callbacks=new Map();
    const fs=vm.fs,translate=fn=>(...args)=>{try{return fn(...args);}catch(error){if(error instanceof Win32Error)throw error;throw new Win32Error(error.message,({53:2,76:3,70:5,75:5,61:8})[error.number]||87);}};
    // Win32 paths are case insensitive; the VB filesystem is shared, not copied.
    const normalize=path=>{const target=fs.normalize(path);return [...fs.files.keys(),...fs.directories].find(k=>k.toLowerCase()===target.toLowerCase())||target;};
    const virtualFS={normalize,files:fs.files,directories:fs.directories,get cwd(){return fs.cwd;},set cwd(v){fs.cwd=v;},get dirty(){return fs.dirty;},set dirty(v){fs.dirty=v;},exists:translate(p=>fs.exists(normalize(p))),readBytes:translate(p=>fs.readBytes(normalize(p))),writeBytes:translate((p,b)=>fs.writeBytes(normalize(p),b)),read:translate(p=>fs.read(normalize(p))),write:translate((p,s)=>fs.write(normalize(p),s)),remove:translate(p=>fs.remove(normalize(p)))};
    this.api=createWin32({...vm.host.win32Options,fs:virtualFS,registry:vm.settings.__win32Registry,
      messageBox:vm.host.msgBox?(text,flags,title)=>vm.host.msgBox(text,flags,title):undefined,
      onRegistryChange:state=>{vm.settings.__win32Registry=state;vm.host.persist?.();},
      onError:error=>vm.reportError(error)});
  }
  layout(value,type,fixedLength=null,depth=0){
    if(depth>32)throw bad('structure nesting exceeds 32');type=String(type).toLowerCase();
    if(value instanceof VBArray){if(value.dynamic&&!value.data.length)throw bad('array is not allocated');const fields=value.data.map(v=>this.layout(v,value.type,value.fixedLength,depth+1));let size=0,max=1;for(const f of fields){size=align(size,f.align);f.offset=size;size+=f.size;max=Math.max(max,f.align);}return {kind:'array',fields,size:align(size,max),align:max};}
    if(value?.__fields instanceof Map){let size=0,max=1;const fields=[];for(const [name,cell]of value.__fields){const f=this.layout(cell.get(),cell.type,cell.fixedLength,depth+1);size=align(size,f.align);fields.push({...f,name,offset:size});size+=f.size;max=Math.max(max,f.align);}return {kind:'record',fields,size:align(size,max),align:max};}
    if(type==='string'&&fixedLength!=null)return {kind:'fixedString',size:fixedLength,align:1};
    const spec=scalar[type];if(!spec)throw bad('unsupported native storage type '+type+' (Variants, objects and dynamic UDT strings require an explicit adapter)');
    return {kind:'scalar',type,size:spec[0],method:spec[1],align:Math.min(spec[0],4)};
  }
  write(layout,value,pointer){const m=this.api.memory;if(layout.kind==='record'){for(const f of layout.fields)this.write(f,value.__fields.get(f.name).get(),pointer+f.offset);}
    else if(layout.kind==='array'){layout.fields.forEach((f,i)=>this.write(f,value.data[i],pointer+f.offset));}
    else if(layout.kind==='fixedString')m.bytes(pointer,layout.size).set(encodeANSI(value).subarray(0,layout.size));
    else m.view(pointer,layout.size)['set'+layout.method](0,layout.type==='currency'?value.raw:layout.type==='long'?numeric(value)|0:numeric(value),true);
  }
  read(layout,value,pointer){const m=this.api.memory;if(layout.kind==='record'){for(const f of layout.fields){const cell=value.__fields.get(f.name);cell.set(this.read(f,cell.get(),pointer+f.offset));}return value;}
    if(layout.kind==='array'){layout.fields.forEach((f,i)=>value.data[i]=this.read(f,value.data[i],pointer+f.offset));return value;}
    if(layout.kind==='fixedString')return decodeANSI(m.bytes(pointer,layout.size));
    const n=m.view(pointer,layout.size)['get'+layout.method](0,true);return layout.type==='currency'?new VBCurrency(n,true):n;
  }
  async invoke(proc,args){
    const w=this.api,m=w.memory,allocated=[],copybacks=[],pins=new Map();
    const alloc=size=>{const p=m.alloc(size);allocated.push(p);return p;};
    try{
      const api=w.resolve(proc.external.library,proc.external.entry);
      if(proc.params.length!==api.arity)throw bad('declaration for '+api.name+' requires '+api.arity+' parameters');
      if(args.length!==proc.params.length)throw new VBError('Wrong number of arguments to '+proc.name,450);
      const actual=[];
      for(let i=0;i<args.length;i++){
        const param=proc.params[i],arg=args[i],ref=arg?.ref,value=ref?await ref.get():arg?.__win32ByVal?arg.value:arg;
        let type=(param.storageType||param.type).toLowerCase(),byRef=param.byRef&&!arg?.__win32ByVal;
        if(arg?.__win32ByVal&&!param.byRef)throw bad('ByVal override requires a ByRef declaration parameter');
        if(type==='any'){type=ref?.type?.toLowerCase()||(typeof value==='string'?'string':'long');if(type==='variant'&&value instanceof VBArray)type=value.type.toLowerCase();else if(type==='variant'&&value?.__fields)type=value.__type.toLowerCase();else if(type==='variant')throw bad('As Any requires typed storage, not a Variant');}
        if(byRef&&ref&&type!=='any'&&ref.type.toLowerCase()!==type&&!(value instanceof VBArray)&&param.type.toLowerCase()!=='any')throw new VBError('ByRef argument type mismatch',13);
        if(type==='string'){
          // VB6 Declare As String is ANSI even when the export is named ...W.
          // Use explicit Integer/Byte buffers and ByVal pointers for Unicode APIs.
          const text=String(value??''),bytes=encodeANSI(text),p=alloc(bytes.length+1);m.bytes(p,bytes.length).set(bytes);
          if(byRef){const pp=alloc(4);m.writeU32(pp,p);actual.push(pp);if(ref)copybacks.push(()=>ref.set(m.readU32(pp)===p?decodeANSI(m.bytes(p,bytes.length)):m.string(m.readU32(pp))));}
          else {actual.push(p);if(ref)copybacks.push(()=>ref.set(decodeANSI(m.bytes(p,bytes.length))));}
          continue;
        }
        if(!byRef){if(!scalar[type]&&type!=='any')throw bad('ByVal structures and arrays are not supported');actual.push(numeric(value));continue;}
        if(ref&&pins.has(ref)){actual.push(pins.get(ref));continue;}
        // A pointer to an array element exposes the remaining contiguous array.
        const array=ref?.win32Array,offset=ref?.win32Offset??0;
        const storage=array?Object.assign(Object.create(VBArray.prototype),array,{data:array.data.slice(offset)}):value;
        const layout=this.layout(storage,type,ref?.fixedLength),p=alloc(layout.size);this.write(layout,storage,p);actual.push(p);if(ref)pins.set(ref,p);
        if(ref)copybacks.push(async()=>{const next=this.read(layout,storage,p);if(array){next.data.forEach((v,n)=>array.data[offset+n]=v);}else await ref.set(next);});
      }
      const result=await w.invoke(proc.external.library,proc.external.entry,actual);
      if(!w.disposed)for(const copyback of copybacks)await copyback();
      if(proc.kind==='sub')return undefined;
      const type=proc.returnType.toLowerCase();if(type==='long')return Number(result||0)|0;if(type==='integer')return (Number(result||0)<<16)>>16;if(type==='string')throw bad('pointer-returning String functions require an explicit pointer declaration');return coerce(result,type);
    }catch(error){if(error instanceof Win32Error){w.lastError=error.code;this.vm.err.LastDLLError=error.code;throw new VBError(error.message,error.code===126?48:error.code===127?453:49);}throw error;}
    finally{if(!w.disposed)for(const p of allocated.reverse())m.free(p);if(w.lastError)this.vm.err.LastDLLError=w.lastError;else if(!w.disposed)this.vm.err.LastDLLError=0;}
  }
  callback(target){
    const proc=target?.__procedure,instance=target?.instance;
    if(!proc||proc.external||instance.module.kind!=='module'||proc.params.some(p=>p.byRef||p.type.toLowerCase()!=='long')||!['long','variant'].includes(proc.returnType.toLowerCase()))throw bad('AddressOf requires a standard-module callback with ByVal Long parameters');
    if(this.callbacks.has(proc))return this.callbacks.get(proc);
    const convert=args=>args.map(n=>Number(n)|0),check=args=>{if(args.length!==proc.params.length)throw bad('callback parameter count mismatch');};
    const handle=this.api.registerCallback(async(...args)=>{check(args);if(['stopped','error'].includes(this.vm.state))return 0;return this.vm.callProcedure(instance,proc,convert(args),this.vm.currentFrame);},{onTimer:(...args)=>{check(args);return this.vm.dispatch(instance,proc.name,convert(args),{coalesce:true});}});
    this.callbacks.set(proc,handle);return handle;
  }
  registerControl(control){
    if(['Timer','ImageList','CommonDialog','Label','Shape','Line','Image'].includes(control.type))return 0;
    const c=control,isForm=['Form','MDIForm'].includes(c.type),textKey=['TextBox','RichTextBox','ComboBox'].includes(c.type)?'Text':'Caption';
    const descriptor={node:c.node,get input(){return c.input;},className:({TextBox:'ThunderRT6TextBox',CommandButton:'ThunderRT6CommandButton',Form:'ThunderRT6FormDC',PictureBox:'ThunderRT6PictureBoxDC'})[c.type]||'ThunderRT6'+c.type,
      parent:()=>isForm?0:c.form?.hWnd||0,controlId:Number(c.props.TabIndex||0)+1,
      getText:()=>c.get(textKey),setText:s=>c.set(textKey,s),isVisible:()=>!!c.props.Visible,isEnabled:()=>!!c.props.Enabled,
      setEnabled:enabled=>c.set('Enabled',enabled?-1:0),show:command=>{if(![0,1,4,5,8,9].includes(command))throw new Win32Error('Window state is not supported by this browser adapter',50);c.set('Visible',command===0?0:-1);},
      getRect:()=>c.node.getBoundingClientRect(),getClientRect:()=>({width:(c.content||c.input||c.node).clientWidth,height:(c.content||c.input||c.node).clientHeight}),clientOrigin:()=>{const r=(c.content||c.input||c.node).getBoundingClientRect();return [r.left,r.top];},
      getPosition:()=>[c.props.Left/15,c.props.Top/15,(c.props.Left+c.props.Width)/15,(c.props.Top+c.props.Height)/15],
      move:(x,y,width,height)=>{c.movedByUser=true;Object.assign(c.props,{Left:x*15,Top:y*15,Width:width*15,Height:height*15});if(isForm)Object.assign(c.props,{ClientWidth:Math.max(0,width-8)*15,ClientHeight:Math.max(0,height-32)*15});c.refresh();},
      getCheck:()=>Number(c.props.Value||0),setCheck:state=>c.set('Value',state),click:()=>c.node.click()};
    if(['Form','MDIForm','PictureBox'].includes(c.type))descriptor.draw=(operation,args,state)=>{
      const surface=c.ensureSurface(),pen=state.pen,brush=state.brush;
      if(operation==='line'){if(!pen.null)surface.add('line',args,pen.color,false,pen.width);}
      else if(operation==='rect'){if(!brush.null)surface.add('rect',args,brush.color,true);if(!pen.null)surface.add('rect',args,pen.color,false,pen.width);}
      else if(operation==='pixel')surface.add('pixel',args,args[2]);
      else if(operation==='text'){if(state.backgroundMode===2)throw new Win32Error('Opaque GDI text backgrounds require a Canvas adapter',50);surface.text(args[2],args[0],args[1],state.textColor);}
      else throw new Win32Error('Drawing operation not available on this surface',50);
    };
    return this.api.registerWindow(descriptor);
  }
  unregisterControl(handle){if(handle&&!this.api.disposed)this.api.unregisterWindow(handle);}
  dispose(){this.api.dispose();this.callbacks.clear();}
}
