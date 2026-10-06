import {VB6Studio, StudioAPI} from '../ide/main.js';
import {installMcp} from './studio.js';
import {installAutoLayout} from '../ide/auto-layout.js';
import {installCodingAgents} from '../agents/studio.js';
if (globalThis.vb6Studio) installMcp(globalThis.vb6Studio, StudioAPI);
if (globalThis.vb6Studio) installCodingAgents(globalThis.vb6Studio, StudioAPI);
if (globalThis.vb6Studio) installAutoLayout(globalThis.vb6Studio);
export {installAutoLayout, VB6Studio, StudioAPI, installMcp};
