import fs from 'node:fs';
import path from 'node:path';
import {bundle} from './bundle.mjs';
const root=path.resolve(import.meta.dirname,'..');
const target=path.resolve(process.argv[2]||path.join(root,'artifacts/vb6-compute'));
fs.mkdirSync(target,{recursive:true});
const code=bundle(path.join(root,'src/compute/index.js'),'VB6Compute');
fs.writeFileSync(path.join(target,'vb6-compute.js'),code);
const names=['compileCompute','compileComputeIR','ComputeDevice','ComputeProgram','ComputeError','ComputeScene','ComputePath','ComputeRenderer','ComputeKernel','ComputeApplication','compileComputeApplication','exportComputeHTML'];
// ESM evaluates the same bundle in an isolated lexical scope, never clobbers globals.
const esm=code.replace('globalThis["VB6Compute"]=','return ');
fs.writeFileSync(path.join(target,'index.js'),`const api=${esm.replace(/^\/\*[^]*?\*\//,'').trim().replace(/;$/,'')};\nexport const {${names.join(',')}}=api;\n`);
fs.copyFileSync(path.join(root,'LICENSE'),path.join(target,'LICENSE'));
if(fs.existsSync(path.join(root,'packages/vb6-compute/README.md')))fs.copyFileSync(path.join(root,'packages/vb6-compute/README.md'),path.join(target,'README.md'));
fs.writeFileSync(path.join(target,'package.json'),JSON.stringify({name:'@vb6/compute',version:'0.2.0',description:'Experimental standalone VB6-to-WGSL compiler, WebGPU runtime and compute renderer',type:'module',license:'MIT',exports:'./index.js',bin:{'vb6-compute':'./cli.mjs'},files:['index.js','vb6-compute.js','cli.mjs','cli-core.mjs','playground.html','LICENSE','README.md'],engines:{node:'>=22'}},null,2)+'\n');
for(const file of ['cli.mjs','cli-core.mjs'])fs.copyFileSync(path.join(root,'packages/vb6-compute',file),path.join(target,file));
const source=`Option Explicit\nPublic ticks As Long\nSub Main()\n  ticks = ticks + 1&\n  ComputeClear RGB(24, 28, 40)\n  ComputeRect 20!, 20!, 150!, 70!, RGB(45, 120, 210)\n  ComputeCircle 260!, 80!, 40!, RGB(240, 150, 50)\n  ComputeLine 30!, 140!, 310!, 140!, 4!, RGB(230, 230, 240)\nEnd Sub`;
const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VB6 Compute Playground</title><style>body{background:#c0c0c0;color:#000;font:13px Tahoma,Arial;margin:16px}h1{font-size:16px;background:#000080;color:white;padding:8px}button,select{font:inherit;margin:4px;padding:5px}textarea{box-sizing:border-box;width:100%;height:240px;font:14px monospace}canvas{width:min(100%,640px);image-rendering:auto;border:2px inset #fff}pre{white-space:pre-wrap}details textarea{height:320px}</style><h1>VB6 — Experimental WebGPU Compute</h1><p>Standalone optional backend. Typed standard modules only; existing VB6 execution is unchanged. Rendering and VB execution use compute shaders. Unsupported constructs produce diagnostics.</p><textarea id="source" spellcheck="false"></textarea><p><button id="run">Compile and run</button><button id="again" disabled>Run again (retain state)</button><button id="dispose">Dispose</button><label>Precision <select id="precision"><option value="strict">Strict (reject Double)</option><option value="single">Explicit f32 approximation</option></select></label></p><canvas id="canvas" width="640" height="320"></canvas><pre id="status">WebGPU requires a supported browser and a secure context (HTTPS or localhost).</pre><details><summary>Generated WGSL</summary><textarea id="wgsl" readonly></textarea></details><script>${code.replace(/<\/script/gi,'<\\/script')}</script><script>
const [source,run,again,dispose,precision,canvas,statusBox,wgsl]=['source','run','again','dispose','precision','canvas','status','wgsl'].map(id=>document.getElementById(id));
source.value=${JSON.stringify(source)};
let gpu,program,renderer;let busy=false;
async function cleanup(){if(program)await program.dispose();if(renderer)await renderer.dispose();if(gpu)await gpu.dispose();gpu=program=renderer=null;again.disabled=true;}
async function execute(recompile){if(busy)return;busy=true;run.disabled=again.disabled=dispose.disabled=true;try{if(recompile){await cleanup();const artifact=VB6Compute.compileCompute(source.value,{precision:precision.value});wgsl.value=artifact.wgsl;gpu=await VB6Compute.ComputeDevice.request();program=await VB6Compute.ComputeProgram.create(gpu,artifact,{width:640,height:320});renderer=await VB6Compute.ComputeRenderer.create(gpu,{width:640,height:320,canvas});}const result=await program.run();await renderer.render(program);statusBox.textContent=JSON.stringify(result,null,2);}catch(e){statusBox.textContent=e.code+': '+e.message;}finally{busy=false;run.disabled=dispose.disabled=false;again.disabled=!program;}}
run.onclick=()=>execute(true);again.onclick=()=>execute(false);dispose.onclick=()=>{cleanup().then(()=>statusBox.textContent='Disposed.').catch(e=>statusBox.textContent=e.message);};
</script>`;
fs.writeFileSync(path.join(target,'playground.html'),html);
console.log('Built standalone compute package and playground: '+target);
