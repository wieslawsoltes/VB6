/** Source-level sequential I/O lowers to owned real Win32 file handles. This is
 * not the browser virtual disk, a JavaScript VM, or an EXE extraction wrapper.
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/open-statement
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/freefile-function
 */
import {planNativeArguments} from './call-plan.js';
import {nativePrintImage} from './print.js';
import {nativeWriteImage} from './file-write.js';
import {nativeReadText,nativeReadLine,nativeReadField} from './file-input.js';
import {nativeFileRecord} from './file-records.js';
import {mem32} from './x86-operands.js';
const P='native:file:',key=v=>String(v).toLowerCase(),at=(base,displacement=0)=>mem32({base,displacement});
const local=o=>at('ebp',o.offset),arg=argument=>({argument}),lit=value=>({kind:'literal',value});
export const NATIVE_FILE_SLOT_BYTES=64;
export function useNativeFiles(c){if(!c.nativeFilesUsed){c.nativeFilesUsed=true;c.slot(P+'table');}}
function save(c,name){const s=c.arrayWorkspace(4,name);c.x.mov(local(s),'eax');return s;}
const fileTypes=Object.freeze({freefile:'integer',eof:'boolean',lof:'long',loc:'long',seek:'long',fileattr:'long',input:'string',filelen:'long',kill:'long'});
export function nativeFileType(c,node){
  const callee=node.kind==='call'?node.callee:node,name=key(callee.name).replace(/\$$/,'');
  return callee.kind==='id'&&Object.hasOwn(fileTypes,name)&&!c.variable(callee)&&!c.resolveProcedure(callee)?fileTypes[name]:null;
}
export function nativeFileBuiltin(c,node,name){
  if(!Object.hasOwn(fileTypes,name)||c.resolveProcedure(node.callee))return false;
  useNativeFiles(c);const x=c.x;
  if(name==='filelen'||name==='kill'){
    if(node.args.length!==1)c.fail(name+' requires one file path');
    c.textExpression(node.args[0]);x.push().call(P+(name==='filelen'?'path-length':'delete-path'));return true;
  }
  const params=name==='freefile'?[{name:'rangenumber',optional:true}]:name==='input'?[{name:'number'},{name:'filenumber'}]:name==='fileattr'?[{name:'filenumber'},{name:'returntype',optional:true}]:[{name:'filenumber'}];
  const plan=planNativeArguments({name,params},node.args,m=>c.fail(m)),slots=[];
  for(const field of plan.order){c.numeric(field.omitted?lit(name==='freefile'?0:1):field.node);slots[field.index]=save(c,'file-argument');}
  if(name==='freefile'){x.push(arg(slots[0].offset)).call(P+'free');return true;}
  x.push(arg(slots[name==='input'?1:0].offset)).call(P+'resolve');const entry=save(c,'file-builtin-entry');
  if(name==='input'){
    x.mov('eax',at('eax',12)).push().push(arg(entry.offset)).call(P+'require-input');
    nativeReadText(c,c.nativeKernelValue(arg(entry.offset)),c.nativeKernelValue(arg(slots[0].offset)));return true;
  }
  if(name==='fileattr')x.push(arg(slots[1].offset));
  x.push(arg(entry.offset)).call(P+({lof:'length',seek:'seek-position',fileattr:'attr'}[name]||name));return true;
}
export function nativeFileInstruction(c,ins){
  const x=c.x;
  if(ins.op==='print'){
    c.nativeDebugColumn ||= c.slot('native:print:debug-column');
    const image=nativePrintImage(c,ins,{memory:c.nativeDebugColumn});
    // A standalone EXE has no IDE Immediate pane. Send the real print image to
    // an attached native debugger instead of silently discarding Debug.Print.
    x.push().invoke('kernel32.dll','OutputDebugStringW').value(arg(image.position.offset)).store(c.nativeDebugColumn);return true;
  }
  if(!['fileOpen','fileClose','filePrint','fileSeek','fileInput','fileRecord','fileRename','fileCopy'].includes(ins.op))return false;
  useNativeFiles(c);
  if(ins.op==='fileRename'||ins.op==='fileCopy'){
    c.textExpression(ins.sourcePath);const source=save(c,'file-source');
    c.textExpression(ins.destination);x.push().push(arg(source.offset)).call(P+(ins.op==='fileRename'?'rename-path':'copy-path'));return true;
  }
  if(ins.op==='fileOpen'){
    const binary=['binary','random'].includes(ins.mode);
    if(!['input','output','append','binary','random'].includes(ins.mode))c.fail('Unknown native file mode: '+ins.mode);
    if(!binary&&ins.access&&ins.access!==(ins.mode==='input'?'read':'write'))c.fail('Native Input requires Read access; Output/Append requires Write access');
    c.textExpression(ins.path);const path=save(c,'file-path');c.numeric(ins.handle);const number=save(c,'file-number');
    c.numeric(ins.recordLength||lit(ins.mode==='random'?128:512));x.compare(1).branch('l','error:5').compare(32767).branch('g','error:5');const length=save(c,'file-buffer-length');
    const sharing={shared:3,'lock read':2,'lock write':1,'lock read write':0}[ins.sharing]??0;
    const mode={output:1,append:2,input:3,binary:4,random:5}[ins.mode],access=binary?({'read':1,'write':2,'read write':3}[ins.access||'read write']):0;
    if(binary&&!access)c.fail('Invalid native Binary/Random access mode');
    x.push(arg(length.offset)).push(sharing).push(mode|(access<<8)).push(arg(number.offset)).push(arg(path.offset)).call(P+'open');return true;
  }
  if(ins.op==='fileClose'){
    if(!ins.handles.length)x.call(P+'close-all');
    else for(const handle of ins.handles){c.numeric(handle);x.push().call(P+'close');}
    return true;
  }
  c.numeric(ins.handle);x.push().call(P+'resolve');const entry=save(c,'file-entry');
  x.mov('eax',at('eax',12));const generation=save(c,'file-generation');
  if(ins.op==='fileRecord'){nativeFileRecord(c,ins,entry,generation);return true;}
  if(ins.op==='fileSeek'){
    c.numeric(ins.position);x.push().push(arg(generation.offset)).push(arg(entry.offset)).call(P+'seek-to');return true;
  }
  if(ins.op==='fileInput'){
    for(const target of ins.targets){
      const variable=c.variable(target);
      const types=ins.whole?{string:8,variant:12}:{byte:17,integer:2,long:3,single:4,double:5,currency:6,date:7,boolean:11,string:8,variant:12};
      if(!variable||variable.nativeArray&&!variable.elementOf||variable.recordFieldArray||!Object.hasOwn(types,key(variable.type)))c.fail('Native Input requires a supported scalar variable/element (Line Input: String or Variant)');
      const pin=c.address(variable),destination=save(c,'file-input-destination');
      x.push(arg(generation.offset)).push(arg(entry.offset)).call(P+'require-input');
      if(ins.whole)nativeReadLine(c,c.nativeKernelValue(arg(entry.offset)));
      else nativeReadField(c,c.nativeKernelValue(arg(entry.offset)),lit(types[key(variable.type)]));
      const value=save(c,'file-input-value'),alias={type:variable.type,fixedLength:variable.fixedLength,nativeInlineString:variable.nativeInlineString,nativeKernelPointer:arg(destination.offset)};
      c.storageExpression(alias,c.nativeKernelValue(arg(value.offset),ins.whole?'string':'variant'));c.store(alias);c.releaseArrayPin(pin);
    }
    return true;
  }
  x.mov('eax',local(entry)).mov('eax',at('eax',16));const column=save(c,'file-column');
  const image=ins.csv?nativeWriteImage(c,ins):nativePrintImage(c,ins,arg(column.offset));
  const ansi=c.temporaryString();c.nativeConvertString(ansi,'to-ansi');const buffer=save(c,'file-bytes');
  x.push(arg(image.position.offset)).push(arg(buffer.offset)).push(arg(generation.offset)).push(arg(entry.offset)).call(P+'write');return true;
}
