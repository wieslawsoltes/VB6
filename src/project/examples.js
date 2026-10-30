import {createPascalExample} from './pascal-example.js';
import {createPascalNumberLab} from './pascal-number-lab.js';
export {createPascalExample,createPascalNumberLab};
import {WEB_BROWSER_EXAMPLE} from './webbrowser-example.js';
import {MACOS26_EXAMPLE} from './macos26-example.js';
// Public catalog: keep stable built-in factories separate from new API samples.
import {EXAMPLES as BUILTIN_EXAMPLES,orderEntryExample,calculatorExample,clockExample,graphicsExample,dataExample,controlsExample,languageExample,eventsExample,richTextExample,compatibilityExample,mdiExample} from './builtin-examples.js';
import {WIN32_SYSTEM_EXAMPLES} from './win32-system-examples.js';
export {orderEntryExample,calculatorExample,clockExample,graphicsExample,dataExample,controlsExample,languageExample,eventsExample,richTextExample,compatibilityExample,mdiExample};
export const EXAMPLES=[...BUILTIN_EXAMPLES,...WIN32_SYSTEM_EXAMPLES,WEB_BROWSER_EXAMPLE,MACOS26_EXAMPLE,{id:'pascal-forms',language:'pascal',name:'Turbo Pascal Forms',description:'Pascal source with shared form controls and mutable key events.',create:createPascalExample},{id:'pascal-number-lab',language:'pascal',name:'Turbo Pascal Number Lab',description:'Two Pascal units, number sequences, validated input and text-file output.',create:createPascalNumberLab}];
