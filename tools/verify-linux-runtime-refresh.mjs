/** Require native hardware and Pascal execution before publishing a refreshed SDK. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyLinuxAOTRuntime} from '../packages/linux-native/src/elf.js';
import {linuxTarget} from '../packages/linux-native/src/target.js';
import {linuxAOTExecutionVerification,readLinuxAOTSourceProvenance} from './linux-aot-provenance.mjs';
import {pascalNativeExpectedResult} from '../tests/pascal-integration-fixtures.mjs';

const negativeCases=['uninitialized-virtual-receiver','incompatible-virtual-tag','vb-records-remain-nominal',
  'invalid-ancestor-prefix','invalid-ancestor-identity','invalid-dispatch-tag','vb-module-cannot-authorize-pascal-views'];
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function validateLinuxRuntimeRefreshProof(proof,pascal,manifest) {
  const target=linuxTarget(manifest.architecture),provenance=manifest.provenance;
  if(proof?.executionMode!=='native'||proof?.hostArchitecture!==target.option||
      provenance?.buildPlatform!=='linux'||provenance?.buildArchitecture!==target.architecture||
      provenance?.targetArchitecture!==target.architecture||provenance?.crossCompiled!==false)
    throw new Error('Linux runtime refresh requires a native build and execution on the matching Linux architecture.');
  linuxAOTExecutionVerification(proof,manifest);
  const checks=pascal?.checks;
  if(pascal?.valid!==true||pascal.error||pascal.platform!=='linux'||pascal.architecture!==target.option||
      pascal.hostArchitecture!==target.option||pascal.executionMode!=='native'||pascal.runtimeSHA256!==manifest.sha256||
      !Array.isArray(checks)||checks.length!==2+negativeCases.length||
      !checks.every(check=>check?.executed===true&&hash(check.executableSHA256)))
    throw new Error('Linux runtime refresh requires complete native Pascal proof for the exact runtime.');
  for(const optimization of [0,2]) {
    const positive=checks.filter(check=>check.name===undefined&&check.optimization===optimization);
    if(positive.length!==1||positive[0].rejected||positive[0].result!==pascalNativeExpectedResult||
        !Number.isSafeInteger(positive[0].bytes)||positive[0].bytes<1)
      throw new Error('Linux runtime refresh lacks successful Pascal O'+optimization+' execution.');
  }
  for(const name of negativeCases) {
    const negative=checks.filter(check=>check.name===name);
    if(negative.length!==1||negative[0].optimization!==2||negative[0].rejected!==true)
      throw new Error('Linux runtime refresh lacks the Pascal guard: '+name);
  }
  return {architecture:target.architecture,executionMode:'native',runtimeSHA256:manifest.sha256,pascalChecks:checks.length};
}

export async function verifyLinuxRuntimeRefresh(directory,reportFile,pascalReportFile) {
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'runtime.json'),'utf8'));
  const target=linuxTarget(manifest.architecture);
  const bytes=new Uint8Array(await fs.readFile(path.join(directory,'runtime-'+target.architecture)));
  await verifyLinuxAOTRuntime(bytes,manifest);
  for(const [name,value]of Object.entries(readLinuxAOTSourceProvenance()))
    if(manifest.provenance?.[name]!==value)throw new Error('Linux runtime refresh source mismatch: '+name);
  const proof=JSON.parse(await fs.readFile(reportFile,'utf8')),pascal=JSON.parse(await fs.readFile(pascalReportFile,'utf8'));
  return validateLinuxRuntimeRefreshProof(proof,pascal,manifest);
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if(process.argv.length!==5)throw new Error('Usage: node tools/verify-linux-runtime-refresh.mjs RUNTIME_DIRECTORY LINUX_VALIDATION_JSON PASCAL_VALIDATION_JSON');
    console.log(JSON.stringify(await verifyLinuxRuntimeRefresh(...process.argv.slice(2).map(value=>path.resolve(value)))));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
