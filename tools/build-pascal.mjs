/** Build a self-contained ESM and browser compiler package, without dependency
 * paths into the checkout. Uses the same deterministic bundler as native SDKs. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from './bundle.mjs';
const root=path.resolve(import.meta.dirname,'..');
const exports=['PASCAL_VERSION','PASCAL_DIALECT','PASCAL_KEYWORDS','PascalError','tokenizePascal','parsePascalModule','lowerPascalModule','compilePascalModule','compileModule','compileProject','createPascalProject','compilePascalSource'];
export function buildPascalPackage(sourceRoot=root) {
  const directory=path.join(sourceRoot,'packages/turbo-pascal'),entry=path.join(directory,'src/index.js');
  const browser=bundle(entry,'TurboPascal');
  const esm=browser.replace("(()=>{'use strict';","const __api=(()=>{'use strict';")
    .replace(/globalThis\["TurboPascal"\]=(__modules\[\d+\]);/,'return $1;')+'\n'+exports.map(name=>'export const '+name+'=__api.'+name+';').join('\n')+'\n';
  fs.mkdirSync(path.join(directory,'dist'),{recursive:true});
  fs.mkdirSync(path.join(sourceRoot,'dist'),{recursive:true});
  fs.writeFileSync(path.join(directory,'dist/index.js'),esm);
  fs.writeFileSync(path.join(directory,'dist/browser.js'),browser);
  fs.writeFileSync(path.join(sourceRoot,'dist/turbo-pascal.js'),browser);
  fs.writeFileSync(path.join(directory,'LICENSE'),fs.readFileSync(path.join(sourceRoot,'LICENSE'),'utf8').replace(/\r\n/g,'\n'));
  return {compilerBytes:Buffer.byteLength(esm),exports};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(buildPascalPackage()));
