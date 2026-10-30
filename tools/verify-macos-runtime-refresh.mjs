/** Require full SDK acceptance and Pascal execution before publishing macOS. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {encodeAOTRuntimePayload} from './embed-macos-aot-runtime.mjs';
import {validatePascalNativeExecutionProof} from './pascal-native-proof.mjs';

export async function verifyMacOSRuntimeRefresh(directory,reportFile,pascalReportFile) {
  const bytes=new Uint8Array(await fs.readFile(path.join(directory,'runtime-arm64')));
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'runtime.json'),'utf8'));
  const proof=JSON.parse(await fs.readFile(reportFile,'utf8'));
  const pascal=JSON.parse(await fs.readFile(pascalReportFile,'utf8'));
  // The existing packager validates Mach-O bytes, native signatures, source
  // provenance and the complete SDK acceptance contract before encoding.
  await encodeAOTRuntimePayload({bytes,manifest},{proof});
  return validatePascalNativeExecutionProof(pascal,manifest,{platform:'darwin',architecture:'arm64'});
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if(process.argv.length!==5)throw new Error('Usage: node tools/verify-macos-runtime-refresh.mjs RUNTIME_DIRECTORY NATIVE_VALIDATION_JSON PASCAL_VALIDATION_JSON');
    console.log(JSON.stringify(await verifyMacOSRuntimeRefresh(...process.argv.slice(2).map(value=>path.resolve(value)))));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
