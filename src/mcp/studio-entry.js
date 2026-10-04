import {VB6Studio, StudioAPI} from '../ide/main.js';
import {installMcp} from './studio.js';
if (globalThis.vb6Studio) installMcp(globalThis.vb6Studio, StudioAPI);
export {VB6Studio, StudioAPI, installMcp};
