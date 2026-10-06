import {validateApplication} from './application.js';
import {ComputeError,integer} from './protocol.js';
const html=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=value=>JSON.stringify(value).replace(/[<>&\u2028\u2029]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
/** Pure exporter. runtimeSource must be the trusted standalone vb6-compute.js
 * bundle, not VB source. No CDN, network resource, eval or Function is used.
 */
export function exportComputeHTML(descriptor,{runtimeSource,title='VB6 Compute Application',width=640,height=480,count=1,capacity=256,fuel=100000,timerInterval=0,autoStart=!!descriptor?.events?.frame}={}) {
  validateApplication(descriptor);
  if(typeof runtimeSource!=='string'||!runtimeSource.trim())throw new ComputeError('The standalone runtime bundle is required','GPU_EXPORT');
  const options={width:integer(width,'width',1,16384),height:integer(height,'height',1,16384),count:integer(count,'count',1,1048576),capacity:integer(capacity,'capacity',1,16384),fuel:integer(fuel,'fuel',1,10000000)};
  if(count*fuel>50000000)throw new ComputeError('Exported dispatch fuel exceeds 50 million','GPU_LIMIT');
  if(typeof timerInterval!=='number'||!Number.isFinite(timerInterval)||timerInterval<0||timerInterval>86400)throw new ComputeError('Timer interval must be between 0 and 86400 seconds','GPU_VALUE');
  if(typeof autoStart!=='boolean')throw new ComputeError('autoStart must be Boolean','GPU_VALUE');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(title)}</title>
<style>body{margin:16px;background:#c0c0c0;color:#000;font:13px Tahoma,Arial,sans-serif}h1{font-size:16px;background:#000080;color:white;padding:8px}button{font:inherit;margin:4px;padding:5px}canvas{display:block;max-width:100%;height:auto;border:2px inset white;touch-action:none}pre{white-space:pre-wrap}</style></head><body>
<h1>${html(title)}</h1><canvas id="surface" width="${width}" height="${height}" aria-label="Compute application surface"></canvas>
<p><button id="resume" disabled>Resume</button><button id="pause" disabled>Pause</button><button id="reset" disabled>Reset</button><button id="dispose" disabled>Dispose</button></p>
<pre id="status" role="status">Starting WebGPU. HTTPS or localhost and a compute-capable browser are required.</pre>
<script>${runtimeSource.replace(/<\/script/gi,'<\\/script')}</script>
<script>
'use strict';
const descriptor=${json(descriptor)},canvas=document.getElementById('surface'),statusBox=document.getElementById('status');
const buttons=Object.fromEntries(['resume','pause','reset','dispose'].map(id=>[id,document.getElementById(id)]));
let app,busy=false;
function failure(error){statusBox.textContent=(error.code||error.name||'Error')+': '+error.message;}
function controls(){buttons.resume.disabled=!app||app.closed||busy||app.running;buttons.pause.disabled=!app||app.closed||busy||!app.running;buttons.reset.disabled=buttons.dispose.disabled=!app||app.closed||busy;}
async function action(fn){if(busy)return;busy=true;controls();try{await fn();}catch(error){failure(error);}finally{busy=false;controls();}}
buttons.resume.onclick=()=>action(()=>{app.start();statusBox.textContent='Running.';});
buttons.pause.onclick=()=>action(()=>{app.stop();statusBox.textContent='Paused.';});
buttons.reset.onclick=()=>action(async()=>{await app.reset();statusBox.textContent='Reset.';});
buttons.dispose.onclick=()=>action(async()=>{await app.dispose();statusBox.textContent='Disposed.';});
(async()=>{try{app=await VB6Compute.ComputeApplication.create(descriptor,{canvas,programOptions:${json(options)},timerInterval:${json(timerInterval)},autoStart:${json(autoStart)},onError:failure});globalThis.computeApplication=app;statusBox.textContent=app.running?'Running.':'Ready.';}catch(error){failure(error);}finally{controls();}})();
</script></body></html>`;
}
