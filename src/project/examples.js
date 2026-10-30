import {OLE_DOCUMENT_EXAMPLE} from './ole-example.js';
import {WEB_BROWSER_EXAMPLE} from './webbrowser-example.js';
import {MACOS26_EXAMPLE} from './macos26-example.js';
// Public catalog: keep stable built-in factories separate from new API samples.
import {EXAMPLES as BUILTIN_EXAMPLES,orderEntryExample,calculatorExample,clockExample,graphicsExample,dataExample,controlsExample,languageExample,eventsExample,richTextExample,compatibilityExample,mdiExample} from './builtin-examples.js';
import {WIN32_SYSTEM_EXAMPLES} from './win32-system-examples.js';
export {orderEntryExample,calculatorExample,clockExample,graphicsExample,dataExample,controlsExample,languageExample,eventsExample,richTextExample,compatibilityExample,mdiExample};
export const EXAMPLES=[...BUILTIN_EXAMPLES,...WIN32_SYSTEM_EXAMPLES,WEB_BROWSER_EXAMPLE,MACOS26_EXAMPLE,OLE_DOCUMENT_EXAMPLE];
