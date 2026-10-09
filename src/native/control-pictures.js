/** Native picture ownership and rendering. GDI+ decodes raster formats, User32
 * owns ICO handles, and every stream outlives its decoded image. Picture values
 * may be assigned between form/control properties without borrowing ownership.
 * This is a private AOT picture record, not an exported COM IPicture interface.
 */
import {mem32} from './x86-operands.js';
import {resolveNativePicture,resolveNativeResourcePicture,resolveNativeResourceString} from './picture-resources.js';
import {toBase64} from '../project/frx.js';
const K='kernel32.dll',U='user32.dll',G='gdiplus.dll',O='oleaut32.dll',P='native:picture:';
const m=(base,displacement=0)=>mem32({base,displacement}),arg=argument=>({argument}),mem=(memory,addend=0)=>({memory,addend});
const picTypes=new Set(['Image','PictureBox']);
// refs, kind(1 bitmap/3 icon), image/HICON, IStream, cached HBITMAP, pxW, pxH, cached HICON
export const NATIVE_PICTURE_BYTES=32;
export const nativePictureMethods={
 needNativePicture(feature){(this.nativePictureFeatures ||= new Set()).add(feature);return this.nativePictureFeatures;},
 addNativePicture(value,module,resource){
  let item;try{item=resource?resolveNativeResourcePicture(this.project,value,resource.format):resolveNativePicture(this.project,value,module?.module||module);}catch(e){this.fail(e.message,module);}
  this.needNativePicture(item.kind);const bytes=item.kind==='icon'?item.selected.bytes:item.bytes,key=item.kind+':'+toBase64(bytes),all=this.nativePictures ||= new Map();
  if(!all.has(key)){const label=P+'data:'+all.size;this.ro.align(4).label(label);for(const byte of bytes)this.ro.emit(byte);all.set(key,{...item,label,length:bytes.length});}
  return all.get(key);
 },
 prepareNativeControlPictures(control){
  if(!picTypes.has(control.model.type))return;
  this.data.zero(8);control.pictureState=true;
  if(control.model.properties.Picture)control.pictureSeed=this.addNativePicture(control.model.properties.Picture,control.module);
 },
 prepareNativeFormPictures(module){
  if(!module.form.properties.Picture&&!module.form.properties.Icon)return;
  this.allocateNativeFormPictureState(module);
  for(const property of ['Picture','Icon'])if(module.form.properties[property]){
   const item=this.addNativePicture(module.form.properties[property],module);module[property.toLowerCase()+'Seed']=item;
   if(property==='Icon'){this.needNativePicture('icon-handle');if(item.kind==='icon'&&!this.nativeIconResources)this.nativeIconResources=item;}
  }
 },
 allocateNativeFormPictureState(module){if(!module.pictureState){module.pictureState=this.slot('form-picture:'+module.name);this.data.u32(0);}},
 nativePictureOwner(object){return !!object&&(!!object.form||!!object.nativeImageItem||picTypes.has(object.model?.type));},
 nativePictureObject(node){
  if(node.kind!=='member'||!['picture','icon'].includes(String(node.name).toLowerCase()))return null;
  const owner=this.object(node.object),property=String(node.name).toLowerCase();
  if(!this.nativePictureOwner(owner)||property==='icon'&&!owner.form)return null;
  return {nativePicture:true,owner,property,module:owner.form?owner:owner.module};
 },
 nativePictureAddress(object,property='picture'){
  if(object.nativeImageItem){this.nativeImageItemAddress(object);this.x.add('eax',12);}
  else if(object.form){this.allocateNativeFormPictureState(object);this.x.value(object.pictureState).add('eax',property==='icon'?4:0);}
  else {this.nativeControlState(object);this.x.add('eax',76);}
 },
 loadNativePictureSeed(item){
  this.x.push(item.height).push(item.width).push(item.kind==='icon'?3:1).push(item.length).push(item.label).call(P+'load');
 },
 initializeNativeControlPictures(control){
  if(!control.pictureState)return;
  this.x.value(0).store(control.state,76).value(control.model.properties.Stretch?-1:0).store(control.state,80);
  if(control.pictureSeed){this.loadNativePictureSeed(control.pictureSeed);this.x.store(control.state,76);}
 },
 initializeNativeFormPictures(module){
  if(!module.pictureState)return;
  for(const property of ['picture','icon']){this.x.value(0).store(module.pictureState,property==='icon'?4:0);if(module[property+'Seed']){this.loadNativePictureSeed(module[property+'Seed']);this.x.store(module.pictureState,property==='icon'?4:0);if(property==='icon')this.applyNativeFormIcon(module);}}
 },
 applyNativeFormIcon(object){
  this.needNativePicture('icon-handle');const x=this.x;this.nativePictureAddress(object,'icon');x.mov('eax',m('eax')).push().call(P+'icon-handle').mov('ebx','eax');
  for(const which of [0,1])x.pushOperand('ebx').push(which).push(0x80).push(this.controlHandleRef(object)).invoke(U,'SendMessageW');
 },
 nativePictureExpression(node){
  if(node.kind==='group')return this.nativePictureExpression(node.expr);
  const x=this.x,object=node.kind==='with'?this.nativeWithBinding().object:this.nativePictureObject(node);
  if(object?.boundPicture){this.withGuard(object.nativeWithActive);this.rawStorageAddress(object.boundPicture);x.pushOperand(m('eax')).call(P+'retain');return;}
  if(object?.nativePicture){this.needNativePicture('retain');if(!object.owner.nativeImageItem)this.ensure(object.owner);this.nativePictureAddress(object.owner,object.property);x.mov('eax',m('eax')).push().call(P+'retain');return;}
  if(node.kind==='nothing'||node.kind==='id'&&String(node.name).toLowerCase()==='nothing'){x.value(0);return;}
  if(node.kind==='call'&&node.callee.kind==='id'){
   const name=String(node.callee.name).toLowerCase(),args=node.args;
   if(name==='loadrespicture'){
    if(args.length<1||args.length>2)this.fail('LoadResPicture expects an ID and optional format');
    const id=args[0].kind==='literal'?args[0].value:this.constant(args[0]),format=args[1]?(args[1].kind==='literal'?args[1].value:this.constant(args[1])):0;
    if(id===undefined||format===undefined)this.fail('Native LoadResPicture currently requires constant resource IDs and formats');
    this.loadNativePictureSeed(this.addNativePicture(id,this.context?.module,{format}));return;
   }
   if(name==='loadpicture'){
    if(!args.length||args.length===1&&args[0].kind==='literal'&&args[0].value===''){x.value(0);return;}
    if(args.length!==1)this.fail('Native LoadPicture supports a filename or an embedded asset');
    const value=args[0].kind==='literal'?args[0].value:null;
    if(typeof value==='string'&&(value.startsWith('data:')||Object.keys(this.project.assets||{}).some(p=>p.toLowerCase().endsWith(value.toLowerCase().replaceAll('\\','/'))))){this.loadNativePictureSeed(this.addNativePicture(value,this.context?.module));return;}
    this.needNativePicture('file');this.needNativePicture('raster');this.needNativePicture('icon');this.textExpression(args[0]);x.push().call(P+'file');return;
   }
  }
  this.fail('Native Picture assignment requires Nothing, LoadPicture, LoadResPicture, or another native Picture property');
 },
 nativePictureBuiltin(node,name){
  if(name!=='loadresstring')return false;
  if(node.args.length!==1)this.fail('LoadResString expects one resource ID');
  const id=node.args[0].kind==='literal'?node.args[0].value:this.constant(node.args[0]);if(id===undefined)this.fail('Native LoadResString currently requires a constant resource ID');
  let value;try{value=resolveNativeResourceString(this.project,id);}catch(e){this.fail(e.message);}
  this.x.push(this.string(value)).call('native:string:copy');this.ownString();return true;
 },
 getNativePictureProperty(object,property){
  if(object.nativePicture){
   if(!['handle','type','width','height'].includes(property))this.fail('Native Picture property is not lowered: '+property);
   const x=this.x;if(object.boundPicture){this.withGuard(object.nativeWithActive);this.rawStorageAddress(object.boundPicture);}else{if(!object.owner.nativeImageItem)this.ensure(object.owner);this.nativePictureAddress(object.owner,object.property);}x.mov('eax',m('eax')).test().branch('e','error:91');
   if(property==='handle'){this.needNativePicture('handle');x.push().call(P+'handle');}
   else if(property==='type')x.mov('eax',m('eax',4));
   else {x.mov('ebx',m('eax',property==='width'?20:24)).push(96).push(2540).pushOperand('ebx').invoke(K,'MulDiv');}
   return true;
  }
  if(object.model?.type==='Image'&&property==='stretch'){this.ensure(object);this.nativeControlState(object);this.x.mov('eax',m('eax',80));return true;}
  return false;
 },
 setNativePictureProperty(object,property,node){
  if(object.model?.type==='Image'&&property==='stretch'){this.numeric(node);this.check('Boolean');this.x.push();this.nativeControlState(object);this.x.popOperand('ecx').mov(m('eax',80),'ecx').api(U,'InvalidateRect',[this.controlHandleRef(object),0,1]);return true;}
  if(object.nativeImageItem&&property==='picture')return this.setNativeImageItemPicture(object,node);
  if(!this.nativePictureOwner(object)||!['picture','icon'].includes(property)||property==='icon'&&!object.form)return false;
  this.needNativePicture('retain');this.nativePictureExpression(node);const x=this.x;x.push();this.nativePictureAddress(object,property);x.popOperand('edi').mov('ebx',m('eax')).mov(m('eax'),'edi').pushOperand('ebx').call(P+'release');
  if(property==='icon')this.applyNativeFormIcon(object);else {this.resetNativeSurfacePicture(object);x.api(U,'InvalidateRect',[this.controlHandleRef(object),0,1]);}return true;
 },
 disposeNativePictures(object){
  if(!this.nativePictureFeatures?.size)return;
  const x=this.x;if(object.form&&object.pictureState){for(const off of [0,4])x.push(mem(object.pictureState,off)).value(0).store(object.pictureState,off).call(P+'release');}
  else if(!object.form&&object.pictureState)x.push(mem(object.state,76)).value(0).store(object.state,76).call(P+'release');
 },
 nativeFormPictureMessage(module,after,exit){
  if(!this.nativePictureFeatures?.size||module.form.type!=='Form'||!module.pictureState)return;
  const x=this.x,next=x.unique();x.value(arg(12)).compare(0x14).branch('ne',next).value(mem(module.pictureState)).test().branch('e',next);
  x.api(U,'DefWindowProcW',[arg(8),arg(12),arg(16),arg(20)]);
  x.push(0).push(0).push(0).push(0).push(0).push(arg(16)).push(mem(module.pictureState)).call(P+'draw').value(1).jump(exit).label(next);
 },
 nativePictureResources(){
  const item=this.nativeIconResources;if(!item)return [];
  const entries=[],group=new Uint8Array(6+14*item.images.length),v=new DataView(group.buffer);v.setUint16(2,1,true);v.setUint16(4,item.images.length,true);
  item.images.forEach((image,i)=>{const at=6+i*14;group[at]=image.width&255;group[at+1]=image.height&255;v.setUint16(at+4,1,true);v.setUint16(at+6,image.bits,true);v.setUint32(at+8,image.bytes.length,true);v.setUint16(at+12,i+1,true);entries.push({type:3,name:i+1,language:0,bytes:image.bytes});});
  entries.push({type:14,name:1,language:0,bytes:group});return entries;
 },
 emitNativePictureHelpers(){
  const features=this.nativePictureFeatures;if(!features?.size)return;
  const x=this.x,raster=features.has('raster'),icons=features.has('icon');
  // One token per process; all owned pictures are destroyed before shutdown.
  if(raster){this.nativeGdipToken=this.slot(P+'token');const input=P+'startup-input';this.ro.align(4).label(input).u32(1).u32(0).u32(0).u32(1);
   const ready=x.unique();x.label(P+'startup').enter().value(mem(this.nativeGdipToken)).test().branch('ne',ready).api(G,'GdiplusStartup',[this.nativeGdipToken,input,0]).leave().label(ready).value(0).leave();
  }
  const retained=x.unique();x.label(P+'retain').enter().value(arg(8)).test().branch('e',retained).cmp(m('eax'),0x7fffffff).branch('ae','error:6').inc(m('eax')).label(retained).leave(4);
  const released=x.unique(),notIcon=x.unique(),imageDone=x.unique(),streamDone=x.unique();
  x.label(P+'release').enter().mov('esi',m('ebp',8)).testOperand('esi','esi').branch('e',released).dec(m('esi')).branch('ne',released);
  x.mov('eax',m('esi',8)).test().branch('e',imageDone);
  if(icons){x.cmp(m('esi',4),3).branch('ne',notIcon).push().invoke(U,'DestroyIcon').jump(imageDone).label(notIcon);}
  if(raster)x.push().invoke(G,'GdipDisposeImage');
  x.label(imageDone).mov('eax',m('esi',12)).test().branch('e',streamDone).push().mov('eax',m('eax')).callIndirect(m('eax',8)).label(streamDone);
  for(const [off,dll,name]of [[16,'gdi32.dll','DeleteObject'],[28,U,'DestroyIcon']]){const done=x.unique();x.mov('eax',m('esi',off)).test().branch('e',done).push().invoke(dll,name).label(done);}
  x.pushOperand('esi').push(0).api(K,'GetProcessHeap').push().invoke(K,'HeapFree').label(released).value(0).leave(4);
  // Allocate a zeroed, privately owned record. Error paths release all fields.
  const alloc=()=>x.push(32).push(8).api(K,'GetProcessHeap').push().invoke(K,'HeapAlloc').test().branch('e','error:7').mov('esi','eax').mov(m('esi'),1);
  if(this.nativePictures?.size){
   const failed=x.unique(),done=x.unique(),icon=x.unique();x.label(P+'load').enter();alloc();x.mov('eax',m('ebp',16)).mov(m('esi',4),'eax');
   if(icons)x.compare(3).branch('e',icon);
   if(raster){x.call(P+'startup').test().branch('ne',failed).api('shlwapi.dll','SHCreateMemStream',[arg(8),arg(12)]).test().branch('e',failed).mov(m('esi',12),'eax').mov('ebx','eax').lea('eax',m('esi',8)).push().pushOperand('ebx').invoke(G,'GdipCreateBitmapFromStream').test().branch('ne',failed);this.emitNativePictureDimensions(failed);x.jump(done);}
   else x.jump(failed);
   if(icons){x.label(icon).api(U,'CreateIconFromResourceEx',[arg(8),arg(12),1,0x30000,arg(20),arg(24),0]).test().branch('e',failed).mov(m('esi',8),'eax').mov('eax',m('ebp',20)).mov(m('esi',20),'eax').mov('eax',m('ebp',24)).mov(m('esi',24),'eax');}
   x.label(done).mov('eax','esi').leave(20).label(failed).pushOperand('esi').call(P+'release').jump('error:481');
  }
  if(features.has('file')){
   const failed=x.unique(),empty=x.unique(),missing=x.unique(),fallbackIcon=x.unique(),iconDone=x.unique(),iconInvalid=x.unique(),iconCleanup=x.unique();x.label(P+'file').enter(96).mov('ebx',m('ebp',8)).pushOperand('ebx').invoke(O,'SysStringLen').test().branch('e',empty).mov('edi','eax').pushOperand('ebx').invoke(K,'lstrlenW').cmp('eax','edi').branch('ne','error:5');
   x.local(-36).push().push(0).pushOperand('ebx').invoke(K,'GetFileAttributesExW').test().branch('e',missing).cmp(m('ebp',-8),0).branch('ne','error:7').cmp(m('ebp',-4),20*1024*1024).branch('a','error:7');
   alloc();x.mov(m('esi',4),1).call(P+'startup').test().branch('ne',failed).lea('eax',m('esi',8)).push().pushOperand('ebx').invoke(G,'GdipCreateBitmapFromFile').test().branch('ne',fallbackIcon);this.emitNativePictureDimensions(failed);x.mov('eax','esi').leave(4);
   x.label(fallbackIcon);
   const noRaster=x.unique();x.mov('eax',m('esi',8)).test().branch('e',noRaster).push().invoke(G,'GdipDisposeImage').mov(m('esi',8),0).label(noRaster);
   x.push(0x50).push(0).push(0).push(1).pushOperand('ebx').push(0).invoke(U,'LoadImageW').test().branch('e',failed).mov(m('esi',8),'eax').mov(m('esi',4),3);
   x.mov(m('ebp',-56),0).mov(m('ebp',-52),0).mov(m('ebp',-4),0).local(-68).push().pushOperand(m('esi',8)).invoke(U,'GetIconInfo').test().branch('e',iconInvalid);
   x.mov('ebx',m('ebp',-52)).testOperand('ebx','ebx');const haveColor=x.unique();x.branch('ne',haveColor).mov('ebx',m('ebp',-56)).label(haveColor);
   x.local(-92).push().push(24).pushOperand('ebx').invoke('gdi32.dll','GetObjectW').test().branch('e',iconInvalid).mov('eax',m('ebp',-88)).mov(m('esi',20),'eax').mov('eax',m('ebp',-84));const sizedIcon=x.unique();x.cmp(m('ebp',-52),0).branch('ne',sizedIcon).shift('sar','eax',1).label(sizedIcon).mov(m('esi',24),'eax').jump(iconCleanup);
   x.label(iconInvalid).mov(m('ebp',-4),1).label(iconCleanup);
   for(const slot of [-56,-52]){const noBitmap=x.unique();x.mov('eax',m('ebp',slot)).test().branch('e',noBitmap).push().invoke('gdi32.dll','DeleteObject').label(noBitmap);}
   x.cmp(m('ebp',-4),0).branch('ne',failed).mov('eax','esi').leave(4);
   x.label(failed).pushOperand('esi').call(P+'release').jump('error:481').label(missing).jump('error:53').label(empty).value(0).leave(4);
  }
  for(const [feature,label,offset,api]of [['handle','handle',16,'GdipCreateHBITMAPFromBitmap'],['icon-handle','icon-handle',28,'GdipCreateHICONFromBitmap']])if(features.has(feature)){
   const done=x.unique(),bitmap=x.unique(),failed=x.unique();
   x.label(P+label).enter().push(arg(8)).call(P+label+'-status').testOperand('edx','edx').branch('ne','error:481').leave(4);
   x.label(P+label+'-status').enter().mov('esi',m('ebp',8)).mov('eax','esi').test().branch('e',done);
   if(icons)x.cmp(m('esi',4),3).branch('ne',bitmap).mov('eax',m('esi',8)).jump(done).label(bitmap);
   if(raster){x.mov('eax',m('esi',offset)).test().branch('ne',done);if(offset===16)x.push(0);x.lea('eax',m('esi',offset)).push().pushOperand(m('esi',8)).invoke(G,api).test().branch('ne',failed).mov('eax',m('esi',offset));}
   else x.jump(failed);x.label(done).xor('edx','edx').leave(4).label(failed).xor('eax','eax').mov('edx',481).leave(4);
  }
  this.emitNativePictureDraw(raster,icons);
 },
 emitNativePictureDimensions(failed){
  const x=this.x;for(const [name,off]of [['Width',20],['Height',24]])x.lea('eax',m('esi',off)).push().pushOperand(m('esi',8)).invoke(G,'GdipGetImage'+name).test().branch('ne',failed).mov('eax',m('esi',off)).compare(1).branch('l',failed).compare(32768).branch('a',failed);
  x.mov('eax',m('esi',20)).imul('eax',m('esi',24)).compare(64*1024*1024).branch('a',failed);
 },
 emitNativePictureDraw(raster,icons){
  const x=this.x,done=x.unique(),sized=x.unique(),bitmap=x.unique(),failed=x.unique();x.label(P+'draw').enter(12).mov(m('ebp',-4),0).mov('esi',m('ebp',8)).testOperand('esi','esi').branch('e',done);
  x.mov('ebx',m('ebp',24)).mov('edi',m('ebp',28)).cmp(m('ebp',32),0).branch('ne',sized).mov('ebx',m('esi',20)).mov('edi',m('esi',24)).label(sized).testOperand('ebx','ebx').branch('le',done).testOperand('edi','edi').branch('le',done);
  if(icons){x.cmp(m('esi',4),3).branch('ne',bitmap).push(3).push(0).push(0).pushOperand('edi').pushOperand('ebx').pushOperand(m('esi',8)).push(arg(20)).push(arg(16)).push(arg(12)).invoke(U,'DrawIconEx').jump(done).label(bitmap);}
  if(raster){x.local(-4).push().push(arg(12)).invoke(G,'GdipCreateFromHDC').test().branch('ne',done).pushOperand('edi').pushOperand('ebx').push(arg(20)).push(arg(16)).pushOperand(m('esi',8)).push(arg(-4)).invoke(G,'GdipDrawImageRectI');x.push(arg(-4)).invoke(G,'GdipDeleteGraphics');}
  x.label(done).value(1).leave(28);
 },
 shutdownNativePictures(){if(this.nativePictureFeatures?.size)for(const module of this.modules.values())if(module.form){this.disposeNativePictures(module);for(const control of module.controls.values()){this.disposeNativeImageList(control);this.disposeNativePictures(control);}}if(this.nativeGdipToken){const done=this.x.unique();this.x.value(mem(this.nativeGdipToken)).test().branch('e',done).push().invoke(G,'GdiplusShutdown').value(0).store(this.nativeGdipToken).label(done);}}
};
