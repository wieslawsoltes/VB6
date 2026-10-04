/** Source-only fixture builder for offline browser icon checks. */
import path from 'node:path';
import {bundle} from './bundle.mjs';
import {COMMANDS,DEFAULT_BARS} from '../src/ide/command-bar-model.js';
console.log(JSON.stringify({script:bundle(path.resolve(import.meta.dirname,'../src/theme/icons.js'),'VB6Icons'),commands:COMMANDS,barCommands:DEFAULT_BARS.reduce((n,b)=>n+b.items.filter(id=>id!=='|').length,0)}));
