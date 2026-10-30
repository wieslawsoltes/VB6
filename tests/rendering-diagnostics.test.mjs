import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireWebGLContext} from '../src/rendering/context.js';
import {renderingAdvice, renderingEnvironment, softwareGraphicsAdapter} from '../src/rendering/diagnostics.js';
import {acquireDevice} from '../src/rendering/device.js';
import {UIRenderer} from '../src/rendering/renderer.js';

function canvas(create) {
  const listeners = new Map(), calls = [];
  return {listeners, calls, addEventListener:(type, fn)=>listeners.set(type, fn), removeEventListener:(type)=>listeners.delete(type),
    getContext(type, options) { calls.push({type, options}); return create(options, message => listeners.get('webglcontextcreationerror')?.({statusMessage:message})); }};
}
test('WebGL2 retries preference hints and releases creation listeners on success', () => {
  const gl = {}, c = canvas((options, report) => {
    if (options.powerPreference === 'high-performance') { report('discrete GPU unavailable'); return null; }
    return gl;
  });
  const result = acquireWebGLContext(c);
  assert.equal(result.gl, gl); assert.deepEqual(result.request, {powerPreference:'default'});
  assert.deepEqual(result.warnings, ['discrete GPU unavailable']); assert.equal(c.listeners.size, 0);
  assert.deepEqual(c.calls.map(c=>c.type), ['webgl2','webgl2']);
  assert.ok(c.calls.every(c=>!c.options.antialias && c.options.premultipliedAlpha && c.options.alpha));
});
test('WebGL2 preserves all creation errors and bounds failures to three attempts', () => {
  const c = canvas((options, report) => { if (options.powerPreference === 'default') throw Error('context budget'); report('GPU disabled'); return null; });
  assert.throws(()=>acquireWebGLContext(c), error => {
    assert.equal(error.code,'WEBGL2_CONTEXT_UNAVAILABLE'); assert.match(error.message,/GPU disabled.*context budget/);
    assert.deepEqual(error.attempts.map(a=>a.reason),['GPU disabled','context budget','GPU disabled']); return true;
  });
  assert.equal(c.calls.length,3); assert.equal(c.listeners.size,0);
});
test('WebGPU secure-context and native-host failures allocate nothing', async () => {
  let calls=0; const gpu={requestAdapter(){calls++;throw Error('must not probe');}};
  await assert.rejects(acquireDevice({isSecureContext:false,navigator:{gpu}}),{code:'WEBGPU_INSECURE_CONTEXT'});
  await assert.rejects(acquireDevice({vb6NativeGPUUnavailable:true,navigator:{gpu}}),{code:'WEBGPU_HOST_DISABLED'});
  assert.equal(calls,0);
});
test('diagnostic snapshots do not probe GPU APIs or leak URL/project contents', () => {
  const view={isSecureContext:true,navigator:{gpu:{requestAdapter(){throw Error('probe');}}},location:{href:'private'},vb6NativeGPUUnavailable:false};
  assert.deepEqual(renderingEnvironment(view),{secureContext:true,webgpuAPI:true,nativeHostDisabled:false});
  assert.deepEqual(renderingEnvironment({}),{secureContext:null,webgpuAPI:false,nativeHostDisabled:false});
});
test('dual GPU failures produce actionable advice without claiming a known driver cause', () => {
  const status={requested:'webgpu',active:'canvas2d',attempts:[{backend:'webgpu'},{backend:'webgl2'}]};
  const advice=renderingAdvice(status,{secureContext:true,webgpuAPI:true}).join(' ');
  assert.match(advice,/Both GPU APIs failed/); assert.match(advice,/exact browser\/driver cause is not exposed/);
  assert.match(advice,/chrome:\/\/gpu/); assert.match(advice,/saved backend order/);
  assert.doesNotMatch(advice,/--ignore-gpu-blocklist|--enable-unsafe/);
  assert.match(renderingAdvice(status,{secureContext:false}).join(' '),/HTTPS or localhost/);
  assert.match(renderingAdvice(status,{nativeHostDisabled:true}).join(' '),/native host disabled/);
});
test('intentional HTML and forced colors are not misdiagnosed as GPU failures', () => {
  assert.deepEqual(renderingAdvice({requested:'html'}),[]);
  assert.match(renderingAdvice({requested:'webgpu',forcedColors:true})[0],/intentionally uses HTML/);
  assert.match(renderingAdvice({adapter:{isFallbackAdapter:true}})[0],/does not certify hardware/);
});
test('explicit retry rechecks saved policy even when an unchanged Options apply would retain fallback', async () => {
  const r=Object.create(UIRenderer.prototype), saved={backend:'webgpu',fallbacks:['canvas2d','html']};
  const result={active:'webgpu'};r.policy=saved;
  r.setOptions=(policy,options)=>{assert.equal(policy,saved);assert.deepEqual(options,{force:true});return Promise.resolve(result);};
  assert.equal(await r.retry(),result);assert.equal(await r.ready,result);
});

test('software adapter evidence recommends native HTML without misclassifying unknown or hardware renderers', () => {
  for (const description of ['Google SwiftShader', 'ANGLE (Vulkan SwiftShader Device)', 'llvmpipe (LLVM 20)', 'softpipe', 'Microsoft Basic Render Driver']) {
    assert.equal(softwareGraphicsAdapter({description}), true);
    assert.match(renderingAdvice({active:'webgl2', adapter:{description}}).join(' '), /Use HTML \/ CSS/);
  }
  for (const description of ['', 'WebKit WebGL', 'ANGLE (Intel UHD Graphics)', 'NVIDIA GeForce RTX', 'AMD Radeon']) assert.equal(softwareGraphicsAdapter({description}), false);
  assert.equal(softwareGraphicsAdapter({isFallbackAdapter:true}), true);
  assert.equal(softwareGraphicsAdapter({isFallbackAdapter:false}), false);
  assert.equal(softwareGraphicsAdapter({description:{toString(){throw Error('coercion');}}}), false);
});
