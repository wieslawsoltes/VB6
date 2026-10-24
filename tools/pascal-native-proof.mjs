/** Exact-runtime execution contract shared by native SDK refresh workflows. */
import {pascalNativeExpectedResult} from '../tests/pascal-integration-fixtures.mjs';

export const pascalNativeNegativeCases=Object.freeze([
  'uninitialized-virtual-receiver','incompatible-virtual-tag','vb-records-remain-nominal',
  'invalid-ancestor-prefix','invalid-ancestor-identity','invalid-dispatch-tag',
  'vb-module-cannot-authorize-pascal-views'
]);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

export function validatePascalNativeExecutionProof(pascal,manifest,{platform,architecture,toolkit}={}) {
  const checks=pascal?.checks;
  if(!['linux','darwin'].includes(platform)||!['x64','arm64'].includes(architecture)||
      platform==='darwin'&&(architecture!=='arm64'||toolkit!==undefined)||
      platform==='linux'&&!['gtk3','gtk4'].includes(toolkit)||
      !hash(manifest?.sha256)||pascal?.valid!==true||pascal.error||pascal.platform!==platform||
      pascal.architecture!==architecture||pascal.hostArchitecture!==architecture||
      pascal.toolkit!==toolkit||pascal.executionMode!=='native'||pascal.runtimeSHA256!==manifest.sha256||
      !Array.isArray(checks)||checks.length!==2+pascalNativeNegativeCases.length||
      !checks.every(check=>check?.executed===true&&hash(check.executableSHA256)))
    throw new Error('Runtime refresh requires complete native Pascal proof for the exact runtime and target.');
  for(const optimization of [0,2]) {
    const positive=checks.filter(check=>check.name===undefined&&check.optimization===optimization);
    if(positive.length!==1||positive[0].rejected||positive[0].result!==pascalNativeExpectedResult||
        !Number.isSafeInteger(positive[0].bytes)||positive[0].bytes<1)
      throw new Error('Runtime refresh lacks successful Pascal O'+optimization+' execution.');
  }
  for(const name of pascalNativeNegativeCases) {
    const negative=checks.filter(check=>check.name===name);
    if(negative.length!==1||negative[0].optimization!==2||negative[0].rejected!==true)
      throw new Error('Runtime refresh lacks the Pascal guard: '+name);
  }
  return {platform,architecture,...(toolkit?{toolkit}:{}),executionMode:'native',
    runtimeSHA256:manifest.sha256,pascalChecks:checks.length};
}
