import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCompute} from '../src/compute/index.js';
import {arrayHeader,readArrayLayout} from '../packages/vb6-compute/src/array-layout.js';
import {createInitialState,decodeState,validateArtifact} from '../packages/vb6-compute/src/runtime.js';
const source=body=>`Option Explicit\nPublic a() As Long\nPublic result As Long\nSub Main()\n${body}\nEnd Sub`;
for(const [name,body] of Object.entries({
  redim:'ReDim a(1 To 4)',preserve:'ReDim a(-2 To 2,3 To 5)\nReDim Preserve a(-2 To 2,3 To 6)',
  erase:'ReDim a(5)\nErase a',runtimeBounds:'result=5&\nReDim a(-result To result)',
  gosub:'GoSub label\nExit Sub\nlabel:\nresult=42&\nReturn',
  computedGoto:'On result GoTo first,second\nExit Sub\nfirst:\nresult=1&\nExit Sub\nsecond:\nresult=2&',
  computedGosub:'On result GoSub first,second\nExit Sub\nfirst:\nresult=1&\nReturn\nsecond:\nresult=2&\nReturn'
}))test('lower new control flow '+name,()=>validateArtifact(compileCompute(source(body))));
test('dynamic arrays reserve a bounded unallocated descriptor',()=>{
  const a=compileCompute(source(''),{dynamicArrayCapacity:37}),s=a.globals[0];
  assert.equal(a.abi,2);assert.equal(s.capacity,37);assert.equal(s.dynamic,true);assert.equal(s.words,53);
  assert.deepEqual(readArrayLayout(a.initialState,s.offset,s),{allocated:false,bounds:[],length:0,capacity:37,dynamic:true});
});
test('array descriptor encodes first dimension as fastest varying',()=>{
  const h=arrayHeader([[-4,-2],[2,5]],16);assert.equal(h[1],12);assert.equal(h[4],1);assert.equal(h[7],3);
});
test('dynamic readback uses current GPU bounds, not initial length',()=>{
  const a=compileCompute(source('')),s=a.globals[0],state=createInitialState(a);
  state.set(arrayHeader([[-2,0]],s.capacity),6+s.offset);state.set([1,2,42],6+s.offset+16);
  const [lane]=decodeState(a,state.buffer);assert.deepEqual(lane.globals['Module1.a'],[1,2,42]);assert.deepEqual(lane.arrays['Module1.a'].bounds,[[-2,0]]);
});
for(const mutate of [w=>w[0]=5,w=>w[1]=999,w=>w[4]=4,w=>w[14]=3,w=>w[15]=3,w=>w[8]=1])test('reject corrupt descriptor '+mutate,()=>{
  const s={name:'a',capacity:8,dynamic:true},w=arrayHeader([[1,3]],8);mutate(w);assert.throws(()=>readArrayLayout(w,0,s),e=>e.code==='GPU_ABI');
});
for(const bounds of [[[4,2]],[[0,99999]],[[NaN,2]],[[0,Infinity]],[[0,1],[0,1],[0,1],[0,1],[0,1]]])test('reject invalid array header '+JSON.stringify(bounds),()=>assert.throws(()=>arrayHeader(bounds,20)));
test('fixed arrays cannot be resized',()=>assert.throws(()=>compileCompute('Public a(5) As Long\nSub Main()\nReDim a(6)\nEnd Sub'),e=>e.code==='GPU_FIXED_ARRAY'));
test('typed ReDim cannot change type',()=>assert.throws(()=>compileCompute(source('ReDim a(5) As Single')),e=>e.code==='GPU_TYPE'));
test('ByRef element call emits a balanced temporary lock',()=>{
  const a=compileCompute(source('ReDim a(2)\nMutate a(0)')+'\nSub Mutate(ByRef x As Long)\nx=42&\nEnd Sub');
  assert.match(a.wgsl,/frame_1.lock\d+=array_lock\(/);assert.match(a.wgsl,/if\(frame_1.lock\d+\) \{array_unlock\(/);
});
test('resource limits are configured at compilation',()=>{
  assert.throws(()=>compileCompute(source(''),{dynamicArrayCapacity:100000}));
  assert.throws(()=>compileCompute(source(''),{gosubStackDepth:0}));
  const a=compileCompute(source('GoSub again\nExit Sub\nagain:\nReturn'),{gosubStackDepth:7});assert.match(a.wgsl,/gosub_stack:array<u32,7>/);
});
test('large array reset is a bounded loop rather than unrolled shader source',()=>{
  const a=compileCompute('Sub Main()\nDim data(4095) As Long\nEnd Sub');assert.ok(a.wgsl.length<20000);assert.match(a.wgsl,/array_erase\(0u\)/);
});
test('runtime fault origin is separate from user Error numbers',()=>{
  const a=compileCompute(source('On Error Resume Next\nError 50000\nresult=Err.Number'));assert.match(a.wgsl,/handler_active \|\| vb_fatal/);assert.doesNotMatch(a.wgsl,/vb_error>=10000u/);
});
test('recursion forms a finite call graph with a stack-limit fault',()=>{
  const a=compileCompute('Sub Main()\nMain\nEnd Sub',{maxCallDepth:4});
  assert.equal(a.sources.length,5);assert.equal(a.maxCallDepth,4);assert.match(a.wgsl,/fail\(28u\)/);
});
test('shared recursion targets are specialized once per depth',()=>{
  const a=compileCompute('Sub Main()\nMain\nMain\nEnd Sub',{maxCallDepth:4});assert.equal(a.sources.length,5);
});
test('recursive Static storage is shared across frames',()=>{
  const a=compileCompute('Sub Main()\nStatic n As Long\nn=n+1&\nIf n<3& Then Main\nEnd Sub',{maxCallDepth:4});assert.equal(a.stateWords,1);
});
test('recursive automatic storage gets separate frames',()=>{
  const a=compileCompute('Sub Main()\nDim n As Long\nMain\nEnd Sub',{maxCallDepth:4});assert.equal(a.stateWords,4);
});
test('excessive call depth is rejected',()=>assert.throws(()=>compileCompute('Sub Main()\nEnd Sub',{maxCallDepth:65})));

test('branching recursion uses one dispatch arm per frame, never nested WGSL procedure calls',()=>{
  const a=compileCompute('Sub Main()\nMain\nMain\nEnd Sub',{maxCallDepth:10});
  assert.doesNotMatch(a.wgsl,/proc_\d+\(/);
  assert.equal([...a.wgsl.matchAll(/step_\d+\(\);/g)].length,11);
  assert.ok(a.wgsl.length<100000);
});
