/** Shared VB6 parser/binder and helper graph, with Linux-only target semantics. */
import {normalizeProject} from '../../../src/project/model.js';
import {compileProject} from '../../../src/language/compiler.js';
import {DirectLowering} from '../../macos-native/src/aot-compiler.js';
import {prepareMacOSResources} from '../../macos-native/src/resources.js';
import {AOT_ABI} from '../../macos-native/src/aot-abi.js';
import {emitLinuxAOTFunctions} from './aot-emitter.js';
import {linuxOptions,LinuxCompileError,linuxTarget} from './target.js';
import {linuxControlReport,resolveLinuxDeclaration} from './catalog.js';
function linuxFailure(error){
  if(error instanceof LinuxCompileError)return error;
  const result=new LinuxCompileError(error.message||String(error));
  if(Array.isArray(error.diagnostics))result.diagnostics=error.diagnostics.map(d=>({...d,code:String(d.code||'LIN001').replace(/^MAC/,'LIN')}));
  result.cause=error;return result;
}
/** Printer selection is a Linux host operation. User declarations named
 * Printer keep ordinary VB6 Set assignment and normal scope resolution. */
export class LinuxDirectLowering extends DirectLowering {
  builtinName(key){
    const named=value=>String(value?.name||'').toLowerCase()===key,p=this.procedure,m=this.module;
    if((p?.params||[]).some(named)||(p?.redimDeclarations||[]).some(named)||(p?.code||[]).some(ins=>(ins.decls||[]).some(named)))return false;
    if(p&&named(p)&&(p.kind==='function'||p.accessor==='get'))return false;
    if(m.declarations.some(named)||[...m.procedures.values()].some(named))return false;
    if([...(m.form?.controls||[]),...(m.form?.menus||[])].some(named)||this.program.modules.has(key))return false;
    return ![...this.program.modules.values()].some(module=>module.kind==='module'&&(
      module.declarations.some(declaration=>named(declaration)&&declaration.scope!=='private')||
      [...module.procedures.values()].some(procedure=>named(procedure)&&procedure.scope!=='private')));
  }
  expressionInner(node){
    // The shared host builtin returns the collection without arguments. Its
    // indexed VB6 syntax invokes that collection's default Item member.
    if(node?.kind==='call'&&node.callee?.kind==='id'&&String(node.callee.name).toLowerCase()==='printers'&&node.args.length&&this.builtinName('printers')){
      const printers=this.f.call('get',this.n('Printers'));return this.f.call('call_value',printers,this.arguments(node.args));
    }
    return super.expressionInner(node);
  }
  instructionCode(ins,index){
    if(ins.op==='assign'&&ins.objectSet&&ins.target?.kind==='id'&&String(ins.target.name).toLowerCase()==='printer'&&this.builtinName('printer')){
      this.instruction=ins;this.usedOps.add(ins.op);
      const printer=this.f.call('get',this.n('Printer')),args=this.f.call('args'),value=this.expression(ins.expr);
      this.f.call('arg_value',args,value,this.n(''));
      this.f.call('call_member',printer,this.n('__selectprinter'),args);
      return;
    }
    return super.instructionCode(ins,index);
  }
}
export function compileLinuxAOT(input,options={}){
  try{
    const project=normalizeProject(input),normalized=linuxOptions({name:project.name,...options}),target=linuxTarget(normalized.architecture),arm64=normalized.architecture==='arm64',resources=prepareMacOSResources(project);
    project.settings={...project.settings,conditionalConstants:{...project.settings.conditionalConstants,
      VBWEB:0,Win16:0,Win32:0,Win64:0,Mac:0,MacOS:0,ARM64:arm64?-1:0,AARCH64:arm64?-1:0,Linux:-1,Unix:-1,X86_64:arm64?0:-1,AMD64:arm64?0:-1,GTK:-1,GTK3:-1}};
    const program=compileProject(project);
    if(!program.valid){const error=new LinuxCompileError('VB6 frontend rejected the Linux project');error.diagnostics=program.diagnostics;throw error;}
    const controls=linuxControlReport(project),lowering=new LinuxDirectLowering(program,normalized,{
      CompileError:LinuxCompileError,diagnosticPrefix:'LIN',resolveDeclaration:resolveLinuxDeclaration,
      emitFunctions:(functions,optimization)=>emitLinuxAOTFunctions(functions,optimization,normalized.architecture),
      validateCallback(node,lowering,owner,procedure){if(procedure.params.length!==4||procedure.params.some(p=>String(p.storageType||p.type).toLowerCase()!=='long'))lowering.fail('Linux AddressOf requires a SetTimer callback with four fixed ByVal As Long parameters','LIN230');}
    }),emitted=lowering.emit();
    const report={target:target.id,architecture:target.architecture,format:'ELF64',machine:target.machine,callingConvention:target.callingConvention,toolkit:'gtk3',artifact:'native-object-code',
      compiled:false,codegen:target.codegen,runtime:'vb6-native',abi:AOT_ABI,modules:program.modules.size,
      procedures:lowering.procedures,instructions:lowering.instructions,codeBytes:emitted.section.length,
      optimization:emitted.section.optimization,metadataBytes:new TextEncoder().encode(JSON.stringify(emitted.metadata)).length,
      operations:[...lowering.usedOps].sort(),controls,imports:lowering.external,resources:resources.report,diagnostics:[]};
    return {...emitted,resourceFiles:resources.files,options:normalized,project,report,sourceMap:lowering.sourceMap};
  }catch(error){throw linuxFailure(error);}
}
