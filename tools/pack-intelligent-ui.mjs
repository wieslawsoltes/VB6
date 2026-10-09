import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildIntelligentUI} from './build-intelligent-ui.mjs';
const root=path.resolve(import.meta.dirname,'..'),directory=path.join(root,'packages/intelligent-ui'),out=path.join(root,'dist/packages');
function run(command,args,cwd){const result=spawnSync(command,args,{cwd,encoding:'utf8',env:{...process.env,npm_config_update_notifier:'false',npm_config_audit:'false'}});if(result.status!==0)throw new Error(command+' failed:\n'+result.stdout+result.stderr);return result.stdout;}
buildIntelligentUI(root);fs.mkdirSync(out,{recursive:true});
const [{filename}]=JSON.parse(run(process.platform==='win32'?'npm.cmd':'npm',['pack','--json','--ignore-scripts','--pack-destination',out],directory));
const file=path.join(out,filename),temporary=fs.mkdtempSync(path.join(os.tmpdir(),'intelligent-ui-package-'));
try{run('tar',['-xzf',file,'-C',temporary],root);run(process.execPath,['--test','test/smoke.test.mjs'],path.join(temporary,'package'));}finally{fs.rmSync(temporary,{recursive:true,force:true});}
const sha256=createHash('sha256').update(fs.readFileSync(file)).digest('hex');fs.writeFileSync(file+'.sha256',sha256+'  '+filename+'\n');console.log(JSON.stringify({filename,size:fs.statSync(file).size,sha256,isolatedPackageSmoke:'passed'},null,2));
