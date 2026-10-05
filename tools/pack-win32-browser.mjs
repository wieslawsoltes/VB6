import {mkdirSync,readdirSync,readFileSync,mkdtempSync,rmSync,cpSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),pkg=join(root,'packages/win32-browser');
if(!existsSync(join(pkg,'dist/win32-browser.js')))throw new Error('Run npm run build before packaging');
mkdirSync(join(root,'release'),{recursive:true});
const npm=process.platform==='win32'?'npm.cmd':'npm';
const result=JSON.parse(execFileSync(npm,['pack','--json','--ignore-scripts','--pack-destination',join(root,'release')],{cwd:pkg,encoding:'utf8'}))[0];
const archive=join(root,'release',result.filename),temp=mkdtempSync(join(tmpdir(),'win32-browser-pack-'));
try{
  execFileSync('tar',['-xzf',archive,'-C',temp]);
  cpSync(join(pkg,'test'),join(temp,'package/test'),{recursive:true});
  execFileSync(process.execPath,['--test',...readdirSync(join(temp,'package/test')).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>'test/'+name)],{cwd:join(temp,'package'),stdio:'inherit'});
  const metadata=JSON.parse(readFileSync(join(temp,'package/package.json'),'utf8'));
  if(metadata.dependencies||metadata.devDependencies)throw new Error('Standalone package acquired external dependencies');
  console.log('Packed and independently tested '+archive);
}finally{rmSync(temp,{recursive:true,force:true});}
