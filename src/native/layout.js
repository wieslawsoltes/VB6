import {compileProject} from '../language/compiler.js';
import {layoutEnabled,layoutEligible,layoutDefaults,LAYOUT_CONSTANTS} from '../layout/contract.js';
import {nativeLayoutSeed} from './layout-seed.js';
import {nativeLayoutCoreSource,NATIVE_LAYOUT_COLUMNS,NATIVE_LAYOUT_FIELDS} from './layout-core.js';
const key=s=>String(s).toLowerCase(),lit=value=>({kind:'literal',value});
const constants=Object.fromEntries(Object.entries(LAYOUT_CONSTANTS).map(([k,v])=>[key(k),v]));
const fields=Object.fromEntries(Object.entries(NATIVE_LAYOUT_FIELDS).map(([k,v])=>[key(k),v]));
const enums=new Set(['anchor','dock','layoutmode','layoutalign','layoutjustify']);
const mem=memory=>({memory});
export const nativeLayoutMethods={
  prepareLayout(){
    if(!layoutEnabled(this.project))return;
    const seed=nativeLayoutSeed(this.project);if(!seed.count)return;
    let name='VB6NativeLayout',suffix=0;while(this.modules.has(key(name)))name='VB6NativeLayout'+(++suffix);
    const program=compileProject({name,modules:[{name,id:name,kind:'module',code:nativeLayoutCoreSource(seed.count)}]});
    if(!program.valid)throw new Error('Invalid internal layout kernel: '+JSON.stringify(program.diagnostics));
    const module=program.modules.get(key(name));module.nativeInternal=true;
    this.externals.set(key(name),new Map());const previous=[this.preparingModule,this.preparingProcedure];this.prepareModule(module);[this.preparingModule,this.preparingProcedure]=previous;
    this.layoutModule=this.modules.get(key(name));this.layoutSeed=seed;
    this.ro.align(8).label('native:layout:seed');const bytes=new Uint8Array(seed.rows.length*NATIVE_LAYOUT_COLUMNS*8),view=new DataView(bytes.buffer);
    seed.rows.forEach((row,i)=>row.forEach((v,j)=>view.setFloat64((i*NATIVE_LAYOUT_COLUMNS+j)*8,v,true)));for(let offset=0;offset<bytes.length;offset+=8192)this.ro.emit(...bytes.subarray(offset,offset+8192));
    for(const [name,data]of seed.forms){const form=this.modules.get(name);form.layoutIndex=data.root;form.layoutLast=data.last;for(const control of form.controls.values())control.layoutIndex=data.controls.get(control.model.id);}
  },
  layoutConstant(name){return layoutEnabled(this.project)?constants[key(name)]:undefined;},
  layoutField(object,property){
    if(!this.layoutModule||!object||object.controlArray)return undefined;
    if(object.form){if(['width','clientwidth'].includes(property))return 8;if(['height','clientheight'].includes(property))return 9;const allowed=layoutDefaults(object.form);if(!Object.keys(allowed).some(k=>key(k)===property))return undefined;}
    else if(!layoutEligible(object.model))return undefined;
    if(property==='visible')return undefined;
    return fields[property];
  },
  layoutType(node){
    if(node.kind==='layoutIndex'||node.kind==='layoutSlot')return 'long';
    if(node.kind==='layoutGet')return 'double';
    if(!this.layoutModule)return null;
    const object=node.kind==='member'?this.object(node.object):node.kind==='id'&&!this.variable(node)?this.context?.module:null;
    const property=key(node.name);return this.layoutField(object,property)!==undefined?(enums.has(property)?'long':'double'):null;
  },
  layoutNodeExpression(object){return object.indexed?{kind:'layoutIndex',object}:lit(object.layoutIndex);},
  layoutExpression(node){
    if(node.kind==='layoutSlot'){this.rawStorageAddress(node.slot);this.x.emit(0x8b,0x00);return true;}
    if(node.kind==='layoutIndex'){
      const x=this.x,done=x.unique(),object=node.object;this.rawStorageAddress(object.indexSlot);x.emit(0x8b,0x00);
      for(const [index,control]of object.group.entries){const next=x.unique();x.compare(index).branch('ne',next).value(control.layoutIndex).jump(done).label(next);}x.jump('error:340').label(done);return true;
    }
    if(node.kind==='layoutGet'){this.invokeLayout('getvalue',[node.index,lit(node.field)]);return true;}
    return false;
  },
  invokeLayout(name,args){const target=this.layoutModule.procedures.get(name);this.nativeTypedCall(target,this.nativeCallPlan(target,args));},
  getLayoutProperty(object,property){const field=this.layoutField(object,property);if(field===undefined)return false;this.ensure(object);this.invokeLayout('getvalue',[this.layoutNodeExpression(object),lit(field)]);if(enums.has(property))this.floatToInteger();return true;},
  setLayoutProperty(object,property,expr){
    const field=this.layoutField(object,property);if(field===undefined&&!(this.layoutModule&&!object.form&&layoutEligible(object.model)&&property==='visible'))return false;
    this.invokeLayout('setvalue',[this.layoutNodeExpression(object),lit(field??24),expr]);return true;
  },
  layoutMethod(object,method,args){
    if(!this.layoutModule||!object)return false;
    if(['performlayout','suspendlayout','resumelayout'].includes(method)){
      const type=object.form?.type||object.model?.type;if(!['Form','MDIForm','Frame','PictureBox','TabStrip','SSTab'].includes(type))return false;
      if(args.length>(method==='resumelayout'?1:0))this.fail(method+' has too many arguments');this.ensure(object);
      const root=object.form?object:object.module;
      this.invokeLayout(method==='performlayout'?'perform':method==='suspendlayout'?'suspend':'resumelayout',method==='resumelayout'?[lit(root.layoutIndex),args[0]||lit(-1)]:[lit(root.layoutIndex)]);return true;
    }
    if(method==='move'&&!object.form&&layoutEligible(object.model)){
      if(args.length<2||args.length>4)this.fail('Move expects Left, Top and optional Width, Height');this.ensure(object);const index=this.layoutNodeExpression(object);
      this.invokeLayout('movenode',[index,args[0],args[1],args[2]||{kind:'layoutGet',index,field:8},args[3]||{kind:'layoutGet',index,field:9}]);return true;
    }
    return false;
  },
  initializeLayout(form){
    if(!form.layoutIndex)return;const x=this.x,proc=name=>this.layoutModule.procedures.get(name).label;
    x.push(form.layoutLast).push(form.layoutIndex).call(proc('initialize'));this.checkNativeError();
    x.push(mem(form.handle)).push(form.layoutIndex).call(proc('attach'));this.checkNativeError();
    for(const control of form.controls.values())if(control.model.type!=='Timer'){x.push(mem(control.handle)).push(control.layoutIndex).call(proc('attach'));this.checkNativeError();}
    this.runLayout(form);
  },
  runLayout(form){if(form.layoutIndex){this.x.push(form.layoutIndex).call(this.layoutModule.procedures.get('perform').label);this.checkNativeError();}},
  layoutHostCall(node,name){
    if(!this.layoutModule||this.context?.module!==this.layoutModule||!['seed','hostclient','hostapply','hostresize','hostshow'].includes(name))return false;
    const x=this.x,args=node.args;
    if(name==='seed'){
      this.numeric(args[0]);x.emit(0x69,0xc0).imm(NATIVE_LAYOUT_COLUMNS).push();this.numeric(args[1]);x.emit(0x59,0x01,0xc8,0xc1,0xe0,3,0x05).addr('native:layout:seed');return true;
    }
    // HWND is captured before subsequent expressions; calls and reentrancy cannot
    // redirect a property edit or a sibling control-array element.
    const hwnd=this.arrayWorkspace(4,'layout-hwnd');this.numeric(args[0]);x.push();this.rawStorageAddress(hwnd);x.emit(0x59,0x89,0x08);
    const handle=()=>{this.rawStorageAddress(hwnd);x.emit(0x8b,0x00);};
    if(name==='hostclient'){
      const rect=this.arrayWorkspace(16,'layout-client'),axis=this.arrayWorkspace(4,'layout-axis'),out=this.floatWorkspace();this.numeric(args[1]);x.push();this.rawStorageAddress(axis);x.emit(0x59,0x89,0x08);
      this.rawStorageAddress(rect);x.push();handle();x.push().invoke('user32.dll','GetClientRect').test().branch('e','error:5');this.rawStorageAddress(axis);x.emit(0x8b,0x08);this.rawStorageAddress(rect);x.emit(0x8b,0x44,0x88,8,0x6b,0xc0,15).push();this.rawStorageAddress(out);x.emit(0xdb,0x04,0x24,0xdd,0x18,0x83,0xc4,4);return true;
    }
    if(name==='hostshow'){
      this.numeric(args[1]);const zero=x.unique();x.test().branch('e',zero).value(5).label(zero).push();handle();x.push().invoke('user32.dll','ShowWindow');return true;
    }
    if(name==='hostapply'){
      const coords=this.arrayWorkspace(20,'layout-pixels');
      for(let i=0;i<4;i++){this.numeric({kind:'binary',op:'/',left:args[i+1],right:lit(15)});x.push();this.rawStorageAddress(coords);x.emit(0x59,0x89,0x88).imm(i*4);}
      this.numeric(args[5]);const fixed=x.unique();x.compare(2).branch('ne',fixed);this.rawStorageAddress(coords);x.emit(0x81,0x40,12).imm(160).label(fixed);
      x.push(1);this.rawStorageAddress(coords);x.emit(0xff,0x70,12,0xff,0x70,8,0xff,0x70,4,0xff,0x30);handle();x.push().invoke('user32.dll','MoveWindow').test().branch('e','error:5');return true;
    }
    if(name==='hostresize'){
      const client=this.arrayWorkspace(16,'layout-client'),outer=this.arrayWorkspace(16,'layout-outer'),size=this.arrayWorkspace(8,'layout-size');
      for(let i=0;i<2;i++){this.numeric({kind:'binary',op:'/',left:args[i+1],right:lit(15)});x.push();this.rawStorageAddress(size);x.emit(0x59,0x89,0x88).imm(i*4);}
      this.rawStorageAddress(client);x.push();handle();x.push().invoke('user32.dll','GetClientRect').test().branch('e','error:5');this.rawStorageAddress(outer);x.push();handle();x.push().invoke('user32.dll','GetWindowRect').test().branch('e','error:5');
      // Expand desired client size by the actual frame/menu/DPI-adjusted chrome.
      for(let i=0;i<2;i++){this.rawStorageAddress(outer);x.emit(0x8b,0x48,i*4+8,0x2b,0x48,i*4);this.rawStorageAddress(client);x.emit(0x2b,0x48,i*4+8);this.rawStorageAddress(size);x.emit(0x01,0x48,i*4);}
      x.push(0x16);this.rawStorageAddress(size);x.emit(0xff,0x70,4,0xff,0x30);x.push(0).push(0).push(0);handle();x.push().invoke('user32.dll','SetWindowPos').test().branch('e','error:5');return true;
    }
  }
};
