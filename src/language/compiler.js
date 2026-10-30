import {compileProject as compileCoreProject,compileModule as compileBasicModule,validateCompiledModules,parseLeafStatement,parseDeclarations,parseParameters} from './compiler-core.js';
import {compilePascalModule} from './pascal/compiler.js';
import {linkPascalProject} from './pascal/project-linker.js';
import {moduleLanguage} from '../project/language.js';
import {xamlBuildDiagnostics} from '../xaml/contract.js';

/** All execution/AOT callers retain the existing compiler API. Authoring gates
 * run here so HTML, the VM, Win32 and macOS cannot build a stale XAML draft. */
export function compileProject(project,options={}) {
  const compiled=compileCoreProject(project,{...options,moduleCompiler:input=>compileModule(input,{...options,project})});
  const result=compiled.valid?linkPascalProject(compiled):compiled,diagnostics=xamlBuildDiagnostics(project);
  return diagnostics.length?{...result,diagnostics:[...diagnostics,...result.diagnostics],valid:false}:result;
}

/** Every consumer receives the same bound module contract, regardless of source
 * language. Source metadata stays on the module; execution and AOT consume the
 * shared instruction representation and never reparse Pascal as Visual Basic. */
export function compileModule(input,options={}) {
  return moduleLanguage(input,options.project)==='pascal'
    ?compilePascalModule(input,options):compileBasicModule(input);
}
export {validateCompiledModules,parseLeafStatement,parseDeclarations,parseParameters};
