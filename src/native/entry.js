/** Standalone browser/worker SDK: no Node, DOM, compiler service or binary template. */
import {compileWin32, NativeCompileError, extractNativeDeclarations} from './compiler.js';
import {PE32Image, BinarySection, PE32_BASE} from './pe32.js';
import {X86} from './x86.js';
import {X86_SIMD_INSTRUCTIONS} from './x86-extended.js';
import {X86_REGISTERS, X86_CONDITIONS, x86Memory, mem8, mem16, mem32, mem64, mem80, mem128} from './x86-operands.js';
import {nativeOptimizationLevel, foldNativeInteger, optimizeNativeSections} from './optimizer.js';
import {pruneNativeProcedures} from './reachability.js';
import {nativeGoSubLimit} from './control-flow.js';
export {pruneNativeProcedures, nativeGoSubLimit, compileWin32, NativeCompileError, extractNativeDeclarations, PE32Image, BinarySection, PE32_BASE, X86, X86_SIMD_INSTRUCTIONS, X86_REGISTERS, X86_CONDITIONS, x86Memory, mem8, mem16, mem32, mem64, mem80, mem128, nativeOptimizationLevel, foldNativeInteger, optimizeNativeSections};
