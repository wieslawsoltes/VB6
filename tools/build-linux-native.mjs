/** Reproducible, independently usable browser/Node Linux AOT package. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from './bundle.mjs';
import {readLinuxAOTSources,checkLinuxAOTRuntimeProvenance} from './linux-aot-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');
export function buildLinuxPackage(sourceRoot=root,{allowStaleAOTRuntime=false}={}) {
  if(!allowStaleAOTRuntime)checkLinuxAOTRuntimeProvenance(sourceRoot);
  const directory=path.join(sourceRoot,'packages/linux-native'),entry=path.join(directory,'src/index.js');
  const source=fs.readFileSync(entry,'utf8');
  const names=[...source.matchAll(/\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)].map(match=>match[1]);
  for(const match of source.matchAll(/^export\s*\{([\w$\s,]+)\};?\s*$/gm))names.push(...match[1].split(',').map(name=>name.trim()).filter(Boolean));
  if(!names.length||new Set(names).size!==names.length)throw new Error('Invalid Linux package export inventory.');
  const iife=bundle(entry,'VB6Linux'),esm=iife.replace("(()=>{'use strict';","const __api=(()=>{'use strict';").replace(/globalThis\["VB6Linux"\]=(__modules\[\d+\]);/,'return $1;')+'\n'+names.map(name=>'export const '+name+'=__api.'+name+';').join('\n')+'\n';
  fs.mkdirSync(path.join(directory,'dist'),{recursive:true});fs.mkdirSync(path.join(sourceRoot,'dist'),{recursive:true});
  fs.writeFileSync(path.join(directory,'dist/index.js'),esm);fs.writeFileSync(path.join(directory,'dist/browser.js'),iife);fs.writeFileSync(path.join(sourceRoot,'dist/vb6-linux.js'),iife);
  const sdk=readLinuxAOTSources(sourceRoot);
  fs.rmSync(path.join(directory,'dist/sdk'),{recursive:true,force:true});
  for(const [name,content]of Object.entries(sdk.files)){const destination=path.join(directory,'dist/sdk',name);fs.mkdirSync(path.dirname(destination),{recursive:true});fs.writeFileSync(destination,content);}
  const license=fs.readFileSync(path.join(sourceRoot,'LICENSE'),'utf8').replace(/\r\n/g,'\n');
  fs.writeFileSync(path.join(directory,'LICENSE'),license);
  fs.writeFileSync(path.join(directory,'dist/sdk/provenance.json'),JSON.stringify(sdk.provenance,null,2)+'\n');
  return {compilerBytes:Buffer.byteLength(esm),sourceFiles:Object.keys(sdk.files).length,exports:names,provenance:sdk.provenance};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildLinuxPackage()));
