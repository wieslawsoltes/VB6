import {compileProject} from '../language/compiler.js';
import {compileComputeIR} from '../../packages/vb6-compute/src/compiler.js';
import {ComputeDevice} from '../../packages/vb6-compute/src/device.js';
import {ComputeProgram} from '../../packages/vb6-compute/src/runtime.js';
import {ComputeError} from '../../packages/vb6-compute/src/protocol.js';
export {compileComputeIR, ComputeDevice, ComputeProgram, ComputeError};
export function compileCompute(source,options={}) {
  const project=typeof source==='string'?{name:'Compute',startup:options.entry||'Main',modules:[{name:options.moduleName||'Module1',kind:'module',code:source}]}:source;
  return compileComputeIR(compileProject(project),options);
}
import {ComputeScene, ComputePath} from '../../packages/vb6-compute/src/scene.js';
import {ComputeRenderer} from '../../packages/vb6-compute/src/renderer.js';
export {ComputeScene, ComputePath, ComputeRenderer};
import {ComputeKernel} from '../../packages/vb6-compute/src/kernel.js';
export {ComputeKernel};

import {ComputeApplication} from '../../packages/vb6-compute/src/application.js';
import {compileComputeApplication} from './application-compiler.js';
export {ComputeApplication,compileComputeApplication};

import {exportComputeHTML} from '../../packages/vb6-compute/src/export-html.js';
export {exportComputeHTML};
