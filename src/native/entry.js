/** Standalone browser/worker SDK: no Node, DOM, compiler service or binary template. */
import {compileWin32, NativeCompileError, extractNativeDeclarations} from './compiler.js';
import {PE32Image, BinarySection, PE32_BASE} from './pe32.js';
import {X86} from './x86.js';
export {compileWin32, NativeCompileError, extractNativeDeclarations, PE32Image, BinarySection, PE32_BASE, X86};
