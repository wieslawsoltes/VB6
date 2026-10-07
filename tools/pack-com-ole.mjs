/** Produce self-contained, offline-installable packages without publishing to any registry. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const imports=/^\s*(?:import|export)\s+(?:[^'";]*?\sfrom\s*)?(['"])([^'"\r\n]+)\1/gm;
function localDependency(file,specifier){
  if(specifier.startsWith('node:'))return null;
  if(!specifier.startsWith('.'))throw Error(`Unexpected package dependency ${specifier} in ${file}`);
  const target=path.resolve(path.dirname(file),specifier),relative=path.relative(root,target);
  if(relative.startsWith('..')||path.isAbsolute(relative)||!['.js','.mjs'].includes(path.extname(target)))throw Error('Package import escapes the source tree: '+specifier);
  return target;
}
async function closure(entry,skip=()=>false){
  const files=new Map();
  async function visit(file){if(files.has(file)||skip(file))return;const text=await fs.readFile(file,'utf8');if(/\bimport\s*\(/.test(text))throw Error('Dynamic imports require an explicit packaging rule: '+file);files.set(file,text);
    const specs=[...text.matchAll(imports)].map(m=>m[2]);for(const spec of specs){const target=localDependency(file,spec);if(target)await visit(target);}
  }
  await visit(entry);return files;
}
function slash(value){return value.split(path.sep).join('/');}
function comImport(file){
  const name=path.basename(file);if(name==='contracts.js'||name==='com.js')return '@vb6/com-ole/com';if(name==='medium.js'||name==='ole.js')return '@vb6/com-ole/ole';if(name==='index.js')return '@vb6/com-ole';throw Error('Unexposed portable COM import: '+file);
}
async function stagePackage(directory,name,entry,files,rewrite){
  const source=path.join(root,'packages',name),manifest=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
  await fs.mkdir(directory,{recursive:true});
  for(const doc of ['README.md','LICENSE'])await fs.copyFile(path.join(source,doc),path.join(directory,doc));
  await fs.writeFile(path.join(directory,'package.json'),JSON.stringify(manifest,null,2)+'\n');
  for(const [file,text]of files){
    const relative=file===entry?'index.js':slash(path.relative(root,file)),destination=path.join(directory,relative);
    const output=text.replace(imports,(whole,quote,spec)=>{
      const target=localDependency(file,spec);if(!target)return whole;
      let next=rewrite(target);
      if(!next){const targetPath=path.join(directory,slash(path.relative(root,target)));next=slash(path.relative(path.dirname(destination),targetPath));if(!next.startsWith('.'))next='./'+next;}
      return whole.slice(0,whole.length-spec.length-1)+next+quote;
    });
    await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,output);
  }
  return manifest;
}
export async function runNpm(args,cwd){
  const candidates=[process.env.npm_execpath,path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),'/usr/share/nodejs/npm/bin/npm-cli.js'].filter(Boolean);
  let cli;for(const candidate of candidates)try{await fs.access(candidate);cli=candidate;break;}catch{}
  if(!cli)throw Error('npm CLI is required to produce or validate the tarballs');
  const result=spawnSync(process.execPath,[cli,...args],{cwd,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,env:{...process.env,npm_config_ignore_scripts:'true',npm_config_audit:'false',npm_config_fund:'false',npm_config_update_notifier:'false'}});
  if(result.error||result.status!==0)throw Error(result.error?.message||result.stderr||result.stdout);return result.stdout;
}
export async function packComOle(output=path.join(root,'artifacts/com-ole')){
  output=path.resolve(output);await fs.mkdir(output,{recursive:true});const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-com-pack-'));
  try{
    const comRoot=path.join(root,'packages/com-ole')+path.sep,autoEntry=path.join(root,'packages/automation/index.js'),nativeEntry=path.join(root,'packages/native-automation/index.js');
    const autoFiles=await closure(autoEntry,file=>file.startsWith(comRoot)),autoSet=new Set(autoFiles.keys());
    const nativeFiles=await closure(nativeEntry,file=>file.startsWith(comRoot)||autoSet.has(file));
    const autoDir=path.join(temporary,'automation'),nativeDir=path.join(temporary,'native-automation');
    await stagePackage(autoDir,'automation',autoEntry,autoFiles,file=>file.startsWith(comRoot)?comImport(file):null);
    await stagePackage(nativeDir,'native-automation',nativeEntry,nativeFiles,file=>file.startsWith(comRoot)?comImport(file):autoSet.has(file)?'@vb6/automation/internal/'+slash(path.relative(root,file)):null);
    const launcher=await fs.readFile(path.join(root,'tools/interop/automation-host.ps1'),'utf8'),nativeSources=[...launcher.matchAll(/'([A-Za-z][A-Za-z0-9]*\.cs)'/g)].map(m=>m[1]);
    if(!nativeSources.length||new Set(nativeSources).size!==nativeSources.length)throw Error('Invalid native companion source list');
    for(const name of ['automation-host.ps1',...nativeSources])await fs.copyFile(path.join(root,'tools/interop',name),path.join(nativeDir,'tools/interop',name));
    const packages=[];
    for(const directory of [path.join(root,'packages/com-ole'),autoDir,nativeDir]){
      const results=JSON.parse(await runNpm(['pack','--json','--ignore-scripts','--offline','--pack-destination',output],directory));
      if(results.length!==1||!results[0].filename)throw Error('Unexpected npm pack response');const result=results[0],file=path.join(output,result.filename),bytes=await fs.readFile(file);
      packages.push({name:result.name,version:result.version,file:result.filename,bytes:bytes.length,files:result.files.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
    }
    const manifest={packages,companionSources:nativeSources.length,registryPublished:false};await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
  }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await packComOle(process.argv[2]),null,2));
