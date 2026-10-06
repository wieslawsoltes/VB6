import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {compileCompute,ComputeScene,ComputePath,ComputeDevice} from '../src/compute/index.js';
import {validateArtifact,createInitialState,decodeState,encodeScalar,decodeScalar} from '../packages/vb6-compute/src/runtime.js';
import {integer,shaderLiteral} from '../packages/vb6-compute/src/protocol.js';
const source=body=>`Option Explicit\nPublic result As Long\nSub Main()\n${body}\nEnd Sub`;
const compile=body=>compileCompute(source(body));
for(const [name,code] of Object.entries({
  add:'result = 21& + 21&',subtract:'result = 100& - 58&',multiply:'result = 6& * 7&',divide:'result = 84& \\ 2&',remainder:'result = 85& Mod 43&',
  bitwise:'result = (5& And 3&) Or 42&',unary:'result = Not 0&',forLoop:'Dim i As Long\nFor i = 1& To 6&\nresult = result + 7&\nNext',
  whileLoop:'While result < 42&\nresult = result + 1&\nWend',doLoop:'Do\nresult = result + 1&\nLoop Until result = 42&',
  branching:'If result = 0& Then\nresult = 42&\nElse\nresult = 2&\nEnd If',selectCase:'Select Case result\nCase 0&\nresult = 42&\nCase Else\nresult = 7&\nEnd Select',
  errorHandler:'On Error Resume Next\nresult = 1& \\ 0&\nresult = Err.Number',graphics:'ComputeRect 1!, 2!, 3!, 4!, RGB(255,0,0)',
  graphicsSyntax:'Line (1!,2!)-(3!,4!), vbRed, BF',pixel:'PSet (1!,2!), 255&',circle:'Circle (4!,4!), 2!, 255&',
  shared:'result = ComputeAtomicAdd(0&, 1&)',bounds:'Dim a(1 To 4) As Long\na(2) = 42&\nresult = a(2)',
  asserts:'Debug.Assert 1& = 1&',minmax:'result = CLng(ComputeMin(42!, 50!))',bankers:'result = CInt(42.5!)'
}))test('WGSL lowering: '+name,()=>{const a=compile(code);validateArtifact(a);assert.match(a.wgsl,/@compute @workgroup_size\(64\)/);assert.match(a.wgsl,/fn main/);assert.ok(a.sources.some(s=>s.procedure==='Main'));});
for(const type of ['Boolean','Byte','Integer','Long','Single'])test('supported typed storage: '+type,()=>{const a=compileCompute(`Public value As ${type}\nSub Main()\nEnd Sub`);assert.equal(a.globals[0].type,type.toLowerCase());});
for(const type of ['Variant','String','Object','Double','Currency','Date'])test('unsupported storage is diagnosed: '+type,()=>assert.throws(()=>compileCompute(`Public value As ${type}\nSub Main()\nEnd Sub`),e=>e.code==='GPU_TYPE'));
for(const [name,code] of Object.entries({redim:'Dim a() As Long\nReDim a(5)',print:'Debug.Print 42&',host:'MsgBox "hello"',undeclared:'missing = 42&',recursion:'Main',dynamicDispatch:'CreateObject("ADODB.Connection")',file:'Open "file" For Output As #1'}))test('fail closed: '+name,()=>assert.throws(()=>compile(code),e=>/^GPU_/.test(e.code)));
test('strict Double promotion cannot silently become Single',()=>assert.throws(()=>compile('result = CLng(1& / 2&)'),e=>e.code==='GPU_TYPE'));
test('single approximation is explicit and leaves a warning',()=>{const a=compileCompute(source('result = CLng(1& / 2&)'),{precision:'single'});assert.equal(a.precision,'single');assert.ok(a.diagnostics.some(d=>d.code==='GPU_PRECISION'));});
test('invalid precision is rejected',()=>assert.throws(()=>compileCompute(source(''),{precision:'fast'})));
test('fixed arrays preserve nonzero and negative lower bounds',()=>{const a=compileCompute('Public a(-2 To 2, 3 To 4) As Integer\nSub Main()\na(0, 4) = 42\nEnd Sub');assert.deepEqual(a.globals[0].bounds,[[-2,2],[3,4]]);assert.equal(a.globals[0].length,10);assert.equal(a.initialState[4],1);assert.equal(a.initialState[7],5);});
test('Option Base 1 applies to implicit bounds',()=>{const a=compileCompute('Option Base 1\nPublic a(4) As Long\nSub Main()\nEnd Sub');assert.deepEqual(a.globals[0].bounds,[[1,4]]);});
test('ByRef parameters use addresses and preserve aliases',()=>{const a=compileCompute(source('Bump result')+'\nSub Bump(ByRef n As Long)\nn=n+1&\nEnd Sub');assert.match(a.wgsl,/fn proc_2\(arg0:u32\)/);});
test('ByVal function returns compile into WGSL functions',()=>{const a=compileCompute(source('result = Twice(21&)')+'\nFunction Twice(ByVal n As Long) As Long\nTwice=n*2&\nEnd Function');assert.match(a.wgsl,/fn proc_2\(arg0:i32\)->i32/);});
test('ByRef type mismatch is diagnosed',()=>assert.throws(()=>compileCompute(source('Bump result')+'\nSub Bump(ByRef n As Integer)\nEnd Sub'),e=>e.code==='GPU_ARGUMENT'));
test('ByRef explicit expression allocates a temporary',()=>assert.doesNotThrow(()=>compileCompute(source('Bump (result)')+'\nSub Bump(ByRef n As Integer)\nEnd Sub')));
test('form modules do not silently fall back to host runtime',()=>assert.throws(()=>compileCompute({modules:[{name:'Form1',kind:'form',code:'Sub Main()\nEnd Sub'}]}),e=>e.code==='GPU_HOST_MODULE'));
test('private cross-module field access is blocked',()=>assert.throws(()=>compileCompute({startup:'M.Main',modules:[{name:'M',code:'Sub Main()\nN.secret=1&\nEnd Sub'},{name:'N',code:'Private secret As Long'}]})));
test('source errors retain diagnostics',()=>assert.throws(()=>compile('If 1& Then'),e=>e.code==='GPU_SOURCE'&&e.diagnostics.length>0));
for(const size of [0,-1,1.5,257,Infinity])test('reject workgroup size '+size,()=>assert.throws(()=>compileCompute(source(''),{workgroupSize:size})));
test('state allocation limit is enforced before GPU allocation',()=>assert.throws(()=>compileCompute('Public a(1000000) As Long\nSub Main()\nEnd Sub'),e=>e.code==='GPU_LIMIT'));
test('state lane isolation is explicit in layout',()=>{const a=compile('result=42&'),s=createInitialState(a,2);s[6]=42;const d=decodeState(a,s.buffer,2);assert.equal(d[0].globals['Module1.result'],42);assert.equal(d[1].globals['Module1.result'],0);});
test('runtime error readback retains lane and VB source location',()=>{const a=compile('result=1& \\ 0&'),s=createInitialState(a);s.set([11,4,5,0,1,0]);const [d]=decodeState(a,s.buffer);assert.equal(d.error,11);assert.equal(d.line,4);assert.equal(d.source,'Module1');assert.equal(d.procedure,'Main');});
for(const [type,values] of Object.entries({byte:[0,255],integer:[-32768,32767],long:[-2147483648,2147483647],single:[-0,1.5,Math.fround(1/3)],boolean:[false,true]}))for(const value of values)test(`scalar roundtrip ${type} ${value}`,()=>assert.ok(Object.is(decodeScalar(encodeScalar(value,type),type),value)));
for(const [type,value] of [['byte',256],['integer',32768],['long',2147483648],['long',1.5],['single',Infinity],['single',NaN],['boolean','yes']])test(`scalar input rejection ${type} ${value}`,()=>assert.throws(()=>encodeScalar(value,type)));
test('minimum Long literal avoids illegal WGSL signed token',()=>assert.equal(shaderLiteral(-2147483648),'(-2147483647i - 1i)'));
for(const mutate of [a=>a.abi=99,a=>a.stateStride++,a=>a.initialState.push(1),a=>a.globals[0].offset=999,a=>a.globals[0].type='string'])test('artifact schema validation '+mutate,()=>{const a=compile('');mutate(a);assert.throws(()=>validateArtifact(a));});
test('scene encoding uses the same 160-byte GPU command ABI',()=>{const s=new ComputeScene(32,32).clear([0,0,0,1]).rect(1,2,3,4,[1,0,0,1]);const a=s.encode();assert.equal(a.count,2);assert.equal(a.commands.byteLength,320);assert.equal(new Uint32Array(a.commands)[40],2);assert.deepEqual([...new Float32Array(a.commands).slice(44,48)],[1,2,4,6]);});
test('quadratic and cubic curves are uploaded unflattened',()=>{const p=new ComputePath().moveTo(1,1).quadraticCurveTo(4,0,8,8).bezierCurveTo(9,4,10,2,16,1).closePath();const a=new ComputeScene(32,32).path(p,[1,0,0,1]).encode();assert.equal(a.curveCount,3);assert.equal(a.curves.byteLength,144);assert.equal(new Uint32Array(a.curves)[8],2);assert.equal(new Uint32Array(a.curves)[20],3);});
test('path fill implicitly closes final contour without mutating input',()=>{const p=new ComputePath().moveTo(0,0).lineTo(10,0).lineTo(5,10);const a=new ComputeScene(32,32).path(p,[1,1,1,1]).encode();assert.equal(a.curveCount,3);assert.equal(p.curves.length,2);});
test('gradients, transforms and clips share command metadata',()=>{const a=new ComputeScene(32,32).rect(0,0,10,10,{from:[1,0,0,1],to:[0,0,1,1],line:[0,0,10,0]},{transform:[2,0,0,2,1,2],clip:[1,2,20,22]}).encode(),f=new Float32Array(a.commands);assert.equal(f[30],1);assert.deepEqual([...f.slice(32,36)],[1,2,20,22]);});
for(const invalid of [()=>new ComputeScene(0,1),()=>new ComputeScene(1,1).circle(0,0,-1,[1,1,1,1]),()=>new ComputeScene(1,1).rect(0,0,1,1,[2,0,0,1]),()=>new ComputeScene(1,1).line(0,0,NaN,1,[0,0,0,1]),()=>new ComputePath().lineTo(1,1)])test('invalid scene input '+invalid,()=>assert.throws(invalid));
test('GPU async validation scopes are serialized and balanced',async()=>{
 const events=[],d={createComputePipelineAsync(){},lost:new Promise(()=>{}),pushErrorScope(x){events.push('push '+x);},async popErrorScope(){events.push('pop');return null;}};
 const g=new ComputeDevice(d);await Promise.all([g.operation(async()=>{events.push('a');await Promise.resolve();events.push('b');}),g.operation(()=>events.push('c'))]);
 assert.deepEqual(events,['push validation','push out-of-memory','a','b','pop','pop','push validation','push out-of-memory','c','pop','pop']);await g.dispose();
});
test('failed GPU operations do not poison subsequent submissions',async()=>{const d={createComputePipelineAsync(){},lost:new Promise(()=>{}),pushErrorScope(){},async popErrorScope(){return null;}};const g=new ComputeDevice(d);await assert.rejects(g.operation(()=>{throw new Error('failure');}));assert.equal(await g.operation(()=>42),42);await g.dispose();});
test('device loss rejects new work',async()=>{const d={createComputePipelineAsync(){},lost:Promise.resolve({reason:'destroyed',message:'lost'})};const g=new ComputeDevice(d);await g.lost;await assert.rejects(g.operation(()=>42),e=>e.code==='GPU_LOST');});
test('standalone ESM package compiles without access to repository imports',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'vb6-compute-'));
 try{execFileSync(process.execPath,['tools/build-compute.mjs',temp],{cwd:path.resolve(import.meta.dirname,'..')});const api=await import(pathToFileURL(path.join(temp,'index.js')).href);assert.equal(api.compileCompute(source('result=42&')).entry,'Module1.Main');assert.equal(globalThis.VB6Compute,undefined);assert.ok(fs.existsSync(path.join(temp,'playground.html')));}finally{fs.rmSync(temp,{recursive:true,force:true});}
});

// WGSL reserves these identifiers even when used as structure fields.
test('generated shaders avoid reserved future-language identifiers', async()=>{
  const {RENDER_WGSL}=await import('../packages/vb6-compute/src/render-wgsl.js');
  const shader=compileCompute('Sub Main()\nEnd Sub').wgsl;
  for(const code of [shader,RENDER_WGSL])assert.doesNotMatch(code.replace(/\/\/[^\n]*/g,''),/\b(?:meta|active)\b/);
});
