import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import * as api from '../src/compute/index.js';
import {parseComputeCLI,runComputeCLI} from '../packages/vb6-compute/cli-core.mjs';
const simple='Public n As Long\nSub Main()\nn=42&\nEnd Sub';
function temp(fn){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'compute-cli-'));try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
const capture=()=>{let out='',err='';return {stdout:{write(s){out+=s}},stderr:{write(s){err+=s}},get out(){return out},get err(){return err}}};
for(const args of [[],['a.bas'],['a.bas','b.bas','--out','x.wgsl'],['a.bas','--out','x.exe'],['a.bas','--out','x.wgsl','--unknown','1'],['a.bas','--out','x.wgsl','--fuel','NaN'],['a.bas','--out','x.wgsl','--count','1.5'],['a.bas','--out','x.wgsl','--out','y.wgsl']])test('CLI invalid options '+args.join(' '),()=>assert.throws(()=>parseComputeCLI(args)));
test('CLI help does not require paths',()=>{const io=capture();assert.equal(runComputeCLI(api,['--help'],io),0);assert.match(io.out,/Usage:/);});
for(const format of ['wgsl','json','html'])test('CLI compiles standalone '+format,()=>temp(dir=>{
 const input=path.join(dir,'input.bas'),output=path.join(dir,'output.'+format),io=capture();fs.writeFileSync(input,simple);
 assert.equal(runComputeCLI(api,[input,'--out',output],{...io,runtimeSource:'globalThis.VB6Compute={};'}),0,io.err);
 const text=fs.readFileSync(output,'utf8');if(format==='wgsl')assert.match(text,/@compute/);if(format==='json')assert.equal(JSON.parse(text).target,'webgpu-compute');if(format==='html'){assert.match(text,/ComputeApplication.create/);assert.doesNotMatch(text,/<script src=/);}
}));
test('CLI event descriptor preserves bindings',()=>temp(dir=>{const input=path.join(dir,'input.bas'),output=path.join(dir,'output.json');fs.writeFileSync(input,simple);const io=capture();assert.equal(runComputeCLI(api,[input,'--out',output,'--event','load=Main'],io),0);assert.deepEqual(JSON.parse(fs.readFileSync(output)).events,{load:'Module1.Main'});}));
test('CLI existing output is protected without --force',()=>temp(dir=>{const input=path.join(dir,'input.bas'),output=path.join(dir,'output.wgsl');fs.writeFileSync(input,simple);fs.writeFileSync(output,'keep');const io=capture();assert.equal(runComputeCLI(api,[input,'--out',output],io),1);assert.equal(fs.readFileSync(output,'utf8'),'keep');assert.equal(runComputeCLI(api,[input,'--out',output,'--force'],io),0);}));
test('CLI cannot overwrite its source even with --force',()=>temp(dir=>{const input=path.join(dir,'input.bas');fs.writeFileSync(input,simple);assert.equal(runComputeCLI(api,[input,'--out',input,'--format','wgsl','--force'],capture()),1);assert.equal(fs.readFileSync(input,'utf8'),simple);}));
test('CLI rejects hard-linked source/output aliases',()=>temp(dir=>{const input=path.join(dir,'input.bas'),output=path.join(dir,'alias.wgsl');fs.writeFileSync(input,simple);fs.linkSync(input,output);assert.equal(runComputeCLI(api,[input,'--out',output,'--force'],capture()),1);assert.equal(fs.readFileSync(input,'utf8'),simple);}));
test('source error cannot truncate existing output',()=>temp(dir=>{const input=path.join(dir,'input.bas'),output=path.join(dir,'output.wgsl');fs.writeFileSync(input,'Sub Main()\nIf\nEnd Sub');fs.writeFileSync(output,'keep');assert.equal(runComputeCLI(api,[input,'--out',output,'--force'],capture()),1);assert.equal(fs.readFileSync(output,'utf8'),'keep');}));
test('export escapes HTML titles and descriptor script terminators',()=>{const d=api.compileComputeApplication(simple);d.artifact.diagnostics.push({message:'</script><script>unsafe()</script>\u2028'});const text=api.exportComputeHTML(d,{runtimeSource:'/* runtime */',title:'<img src=x onerror=alert(1)>'});assert.ok(text.includes('&lt;img'));assert.ok(text.includes('\\u003c/script'));assert.equal((text.match(/<script>/g)||[]).length,2);});
test('export requires runtime source and checks budgets',()=>{const d=api.compileComputeApplication(simple);assert.throws(()=>api.exportComputeHTML(d));assert.throws(()=>api.exportComputeHTML(d,{runtimeSource:'x',count:10000,fuel:100000}));});
test('actual extracted npm archive includes a functional independent CLI',()=>temp(dir=>{
 const build=path.join(dir,'build');execFileSync(process.execPath,['tools/build-compute.mjs',build]);
 const info=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--json','--pack-destination',dir],{cwd:build,encoding:'utf8'}));
 const archive=path.join(dir,info[0].filename),out=path.join(dir,'extracted');fs.mkdirSync(out);execFileSync('tar',['-xzf',archive,'-C',out]);
 const input=path.join(dir,'sample.bas'),output=path.join(dir,'sample.html');fs.writeFileSync(input,simple);
 execFileSync(process.execPath,[path.join(out,'package/cli.mjs'),input,'--out',output],{cwd:dir});assert.match(fs.readFileSync(output,'utf8'),/ComputeApplication.create/);
 const manifest=JSON.parse(fs.readFileSync(path.join(out,'package/package.json')));assert.equal(manifest.bin['vb6-compute'],'./cli.mjs');assert.equal(manifest.version,'0.3.0');
 const stringInput=path.join(out,'package/strings.bas'),json=path.join(dir,'strings.json');
 execFileSync(process.execPath,[path.join(out,'package/cli.mjs'),stringInput,'--out',json,'--max-string-length','64'],{cwd:dir});
 const strings=JSON.parse(fs.readFileSync(json));assert.equal(strings.stringABI,1);assert.equal(strings.maxStringLength,64);
}));

test('CLI forwards the explicit UTF-16 String capacity',()=>temp(dir=>{const input=path.join(dir,'input.bas'),output=path.join(dir,'output.json');fs.writeFileSync(input,'Public s As String\nSub Main()\ns="abc"\nEnd Sub');const io=capture();assert.equal(runComputeCLI(api,[input,'--out',output,'--max-string-length','8'],io),0);assert.equal(JSON.parse(fs.readFileSync(output)).maxStringLength,8);}));
for(const n of ['0','4097','-1','1.5'])test('CLI rejects String capacity '+n,()=>temp(dir=>{const input=path.join(dir,'input.bas'),output=path.join(dir,'output.json');fs.writeFileSync(input,simple);assert.equal(runComputeCLI(api,[input,'--out',output,'--max-string-length',n],capture()),1);assert.equal(fs.existsSync(output),false);}));
