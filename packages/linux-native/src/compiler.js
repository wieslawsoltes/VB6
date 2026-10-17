/** Shared VB6 parser/binder and helper graph, with Linux-only target semantics. */
import {normalizeProject} from '../../../src/project/model.js';
import {compileProject} from '../../../src/language/compiler.js';
import {DirectLowering} from '../../macos-native/src/aot-compiler.js';
import {prepareMacOSResources} from '../../macos-native/src/resources.js';
import {AOT_ABI} from '../../macos-native/src/aot-abi.js';
import {emitLinuxAOTFunctions} from './aot-emitter.js';
import {linuxOptions,LinuxCompileError,LINUX_TARGET} from './target.js';
import {linuxControlReport,resolveLinuxDeclaration} from './catalog.js';
function linuxFailure(error){
  if(error instanceof LinuxCompileError)return error;
  const result=new LinuxCompileError(error.message||String(error));
  if(Array.isArray(error.diagnostics))result.diagnostics=error.diagnostics.map(d=>({...d,code:String(d.code||'LIN001').replace(/^MAC/,'LIN')}));
  result.cause=error;return result;
}
export function compileLinuxAOT(input,options={}){
  try{
    const project=normalizeProject(input),normalized=linuxOptions({name:project.name,...options}),resources=prepareMacOSResources(project);
    project.settings={...project.settings,conditionalConstants:{...project.settings.conditionalConstants,
      VBWEB:0,Win16:0,Win32:0,Win64:0,Mac:0,MacOS:0,ARM64:0,Linux:-1,Unix:-1,X86_64:-1,AMD64:-1,GTK:-1,GTK3:-1}};
    const program=compileProject(project);
    if(!program.valid){const error=new LinuxCompileError('VB6 frontend rejected the Linux project');error.diagnostics=program.diagnostics;throw error;}
    const controls=linuxControlReport(project),lowering=new DirectLowering(program,normalized,{
      CompileError:LinuxCompileError,diagnosticPrefix:'LIN',resolveDeclaration:resolveLinuxDeclaration,emitFunctions:emitLinuxAOTFunctions,
      validateCallback(node,lowering,owner,procedure){if(procedure.params.length!==4||procedure.params.some(p=>String(p.storageType||p.type).toLowerCase()!=='long'))lowering.fail('Linux AddressOf requires a SetTimer callback with four fixed ByVal As Long parameters','LIN230');}
    }),emitted=lowering.emit();
    const report={target:LINUX_TARGET.id,architecture:'x86_64',format:'ELF64',toolkit:'gtk3',artifact:'native-object-code',
      compiled:false,codegen:'x86_64-aot',runtime:'vb6-native',abi:AOT_ABI,modules:program.modules.size,
      procedures:lowering.procedures,instructions:lowering.instructions,codeBytes:emitted.section.length,
      optimization:emitted.section.optimization,metadataBytes:new TextEncoder().encode(JSON.stringify(emitted.metadata)).length,
      operations:[...lowering.usedOps].sort(),controls,imports:lowering.external,resources:resources.report,diagnostics:[]};
    return {...emitted,resourceFiles:resources.files,options:normalized,project,report,sourceMap:lowering.sourceMap};
  }catch(error){throw linuxFailure(error);}
}
