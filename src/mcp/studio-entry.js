import {VB6Studio, StudioAPI} from '../ide/main.js';
import {installApplicationExport} from '../ide/application-export.js';
import {installMcp} from './studio.js';
import {installCodingAgents} from '../agents/studio.js';
if (globalThis.vb6Studio) installApplicationExport(globalThis.vb6Studio, StudioAPI);
if (globalThis.vb6Studio) installMcp(globalThis.vb6Studio, StudioAPI);
if (globalThis.vb6Studio) installCodingAgents(globalThis.vb6Studio, StudioAPI);
export {VB6Studio, StudioAPI, installMcp};
