import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {verifyIdeArtifacts} from './ide-artifacts.mjs';
verifyIdeArtifacts();
const root=path.resolve(import.meta.dirname,'..'),pkg=path.join(root,'packages/auto-layout'),release=path.join(root,'release');
fs.mkdirSync(release,{recursive:true});
const npm=process.platform==='win32'?'npm.cmd':'npm';
const packed=JSON.parse(execFileSync(npm,['pack','--json','--ignore-scripts','--pack-destination',release],{cwd:pkg,encoding:'utf8'}))[0];
const archive=path.join(release,packed.filename),temp=fs.mkdtempSync(path.join(os.tmpdir(),'vb6-layout-pack-'));
try {
  execFileSync('tar',['-xzf',archive,'-C',temp]);
  const dir=path.join(temp,'package'),metadata=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));
  if(metadata.dependencies||metadata.devDependencies)throw new Error('Standalone package acquired external dependencies');
  for(const file of ['src/index.js','src/advanced.js','src/index.d.ts','dist/auto-layout.js','README.md','LICENSE'])
    if(!fs.existsSync(path.join(dir,file)))throw new Error('Missing package file '+file);
  execFileSync(process.execPath,['--input-type=module','-e',`
    import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import * as esm from './src/index.js';
    const context={};vm.runInNewContext(fs.readFileSync('./dist/auto-layout.js','utf8'),context);
    for(const api of [esm,context.VB6AutoLayout]){
      const e=new api.LayoutEngine([{id:1,bounds:{x:10,y:20,width:50,height:20},anchor:10}],{width:100,height:100});
      e.arrange(200,150);assert.deepEqual(JSON.parse(JSON.stringify(e.getBounds(1))),{x:110,y:70,width:50,height:20});
      assert.equal(api.parseAnchor('Right, Bottom'),10);
      const g=new api.LayoutEngine([{id:'a',widthMode:'fill',bounds:{width:10,height:30}},{id:'b',widthMode:'fill',bounds:{width:10,height:30}}],{width:300,height:100,layout:'Grid',columns:'1fr 2fr'});
      g.arrange();assert.equal(g.getBounds('a').width,100);assert.equal(g.getBounds('b').width,200);
      g.configure({columns:'[{"size":"1fr","max":60},"2fr"]'});g.arrange();assert.equal(g.getBounds('a').width,60);assert.equal(g.getBounds('b').width,240);
      const h=new api.LayoutEngine([{id:'label',widthMode:'hug',heightMode:'hug',measure:()=>({width:90,height:25,baseline:18})}],{width:300,height:100,layout:'Horizontal',padding:10});
      h.arrange();assert.equal(h.getBounds('label').width,90);assert.equal(h.getBounds('label').height,25);assert.equal(h.arrange().passes,0);
    }
  `],{cwd:dir,stdio:'inherit'});
  console.log('Packed and independently tested ES module and browser build: '+archive);
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
