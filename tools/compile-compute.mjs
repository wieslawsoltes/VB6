import path from 'node:path';
import * as api from '../src/compute/index.js';
import {bundle} from './bundle.mjs';
import {runComputeCLI} from '../packages/vb6-compute/cli-core.mjs';
process.exitCode=runComputeCLI(api,process.argv.slice(2),{runtimeSource:()=>bundle(path.resolve(import.meta.dirname,'../src/compute/index.js'),'VB6Compute')});
