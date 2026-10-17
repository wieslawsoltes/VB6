// Stable editor entry point; the data-only language service is shared with the compiler.
import {parameterSymbol,scanDeclarations as scanVisualBasicDeclarations} from '../language/declaration-index.js';
import {moduleLanguage} from '../project/language.js';
import {scanPascalDeclarations} from './pascal-service.js';
export {parameterSymbol};
export function scanDeclarations(module,project=null){return moduleLanguage(module,project)==='pascal'?scanPascalDeclarations(module):scanVisualBasicDeclarations(module);}
