/** Source-level sequential I/O lowers to owned real Win32 file handles. This is
 * not the browser virtual disk, a JavaScript VM, or an EXE extraction wrapper.
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/open-statement
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/freefile-function
 */
import {planNativeArguments} from './call-plan.js';
import {nativePrintImage} from './print.js';
import {mem32} from './x86-operands.js';
const P='native:file:',key=v=>String(v).toLowerCase(),at=(base,displacement=0)=>mem32({base,displacement});
const local=o=>at('ebp',o.offset),arg=argument=>({argument}),lit=value=>({kind:'literal',value});
export const NATIVE_FILE_SLOT_BYTES=32;
export function useNativeFiles(c){if(!c.nativeFilesUsed){c.nativeFilesUsed=true;c.slot(P+'table');}}
function save(c,name){const s=c.arrayWorkspace(4,name);c.x.mov(local(s),'eax');return s;}
export function nativeFileType(c,node){
  const callee=node.kind==='call'?node.callee:node;
  return callee.kind==='id'&&key(callee.name)==='freefile'&&!c.variable(callee)&&!c.resolveProcedure(callee)?'integer':null;
}
export function nativeFileBuiltin(c,node,name){
  if(name!=='freefile'||c.resolveProcedure(node.callee))return false;
  const plan=planNativeArguments({name:'FreeFile',params:[{name:'rangenumber',optional:true}]},node.args,m=>c.fail(m));
  c.numeric(plan.slots[0].omitted?lit(0):plan.slots[0].node);useNativeFiles(c);c.x.push().call(P+'free');return true;
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
  if(!['fileOpen','fileClose','filePrint'].includes(ins.op))return false;
  useNativeFiles(c);
  if(ins.op==='fileOpen'){
    if(!['output','append'].includes(ins.mode))c.fail('Native sequential Open currently lowers Output and Append, not '+ins.mode);
    if(ins.access&&ins.access!=='write')c.fail('Native Output/Append requires Write access');
    c.textExpression(ins.path);const path=save(c,'file-path');c.numeric(ins.handle);const number=save(c,'file-number');
    c.numeric(ins.recordLength||lit(512));x.compare(1).branch('l','error:5').compare(32767).branch('g','error:5');
    const sharing={shared:3,'lock read':2,'lock write':1,'lock read write':0}[ins.sharing]??0;
    x.push(sharing).push(ins.mode==='append'?2:1).push(arg(number.offset)).push(arg(path.offset)).call(P+'open');return true;
  }
  if(ins.op==='fileClose'){
    if(!ins.handles.length)x.call(P+'close-all');
    else for(const handle of ins.handles){c.numeric(handle);x.push().call(P+'close');}
    return true;
  }
  if(ins.csv)c.fail('Native Write # serialization is not yet lowered; use Print # for display text');
  c.numeric(ins.handle);x.push().call(P+'resolve');const entry=save(c,'file-entry');
  x.mov('eax',at('eax',12));const generation=save(c,'file-generation');
  x.mov('eax',local(entry)).mov('eax',at('eax',16));const column=save(c,'file-column');
  const image=nativePrintImage(c,ins,arg(column.offset));
  const ansi=c.temporaryString();c.nativeConvertString(ansi,'to-ansi');const buffer=save(c,'file-bytes');
  x.push(arg(image.position.offset)).push(arg(buffer.offset)).push(arg(generation.offset)).push(arg(entry.offset)).call(P+'write');return true;
}
