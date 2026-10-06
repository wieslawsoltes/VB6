#!/usr/bin/env node
import fs from 'node:fs';
import * as api from './index.js';
import {runComputeCLI} from './cli-core.mjs';
process.exitCode=runComputeCLI(api,process.argv.slice(2),{runtimeSource:()=>fs.readFileSync(new URL('./vb6-compute.js',import.meta.url),'utf8')});
