/** Require native hardware and Pascal execution before publishing a refreshed SDK. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyLinuxAOTRuntime} from '../packages/linux-native/src/elf.js';
import {linuxTarget} from '../packages/linux-native/src/target.js';
import {linuxAOTExecutionVerification,readLinuxAOTSourceProvenance} from './linux-aot-provenance.mjs';
import {validatePascalNativeExecutionProof} from './pascal-native-proof.mjs';

export function validateLinuxRuntimeRefreshProof(proof,pascal,manifest,expected={}) {
  const toolkit=manifest.toolkit??'gtk3',target=linuxTarget(manifest.architecture,toolkit),provenance=manifest.provenance;
  if(expected.architecture!==undefined&&linuxTarget(expected.architecture,toolkit).architecture!==target.architecture||
      expected.toolkit!==undefined&&expected.toolkit!==toolkit)
    throw new Error('Linux runtime refresh variant does not match the requested architecture and toolkit.');
  if(proof?.executionMode!=='native'||proof?.hostArchitecture!==target.option||proof.toolkit!==toolkit||
      provenance?.buildPlatform!=='linux'||provenance?.buildArchitecture!==target.architecture||
      provenance?.targetArchitecture!==target.architecture||provenance?.crossCompiled!==false||provenance?.toolkit!==toolkit)
    throw new Error('Linux runtime refresh requires a native build and execution on the matching Linux architecture and toolkit.');
  linuxAOTExecutionVerification(proof,manifest);
  const verified=validatePascalNativeExecutionProof(pascal,manifest,{platform:'linux',architecture:target.option,toolkit});
  return {architecture:target.architecture,toolkit,executionMode:'native',runtimeSHA256:manifest.sha256,pascalChecks:verified.pascalChecks};
}

export async function verifyLinuxRuntimeRefresh(directory,reportFile,pascalReportFile,expected={}) {
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'runtime.json'),'utf8'));
  const target=linuxTarget(manifest.architecture);
  const bytes=new Uint8Array(await fs.readFile(path.join(directory,'runtime-'+target.architecture)));
  await verifyLinuxAOTRuntime(bytes,manifest);
  for(const [name,value]of Object.entries(readLinuxAOTSourceProvenance()))
    if(manifest.provenance?.[name]!==value)throw new Error('Linux runtime refresh source mismatch: '+name);
  const proof=JSON.parse(await fs.readFile(reportFile,'utf8')),pascal=JSON.parse(await fs.readFile(pascalReportFile,'utf8'));
  return validateLinuxRuntimeRefreshProof(proof,pascal,manifest,expected);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2),expected={},usage='Usage: node tools/verify-linux-runtime-refresh.mjs RUNTIME_DIRECTORY LINUX_VALIDATION_JSON PASCAL_VALIDATION_JSON [--architecture x64|arm64] [--toolkit gtk3|gtk4]';
    if(args.length<3||args.length%2!==1||args.slice(0,3).some(value=>value.startsWith('--')))throw new Error(usage);
    for(let index=3;index<args.length;index+=2){
      const name=args[index].slice(2),value=args[index+1];
      if(!['--architecture','--toolkit'].includes(args[index])||expected[name]!==undefined||!value||value.startsWith('--'))throw new Error(usage);
      expected[name]=value;
    }
    console.log(JSON.stringify(await verifyLinuxRuntimeRefresh(...args.slice(0,3).map(value=>path.resolve(value)),expected)));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
