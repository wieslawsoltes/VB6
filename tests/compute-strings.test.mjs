import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCompute} from '../src/compute/index.js';
import {validateArtifact,createInitialState,decodeState,ComputeProgram} from '../packages/vb6-compute/src/runtime.js';
import {encodeStringBlock,decodeStringBlock} from '../packages/vb6-compute/src/string-layout.js';
import {STRING_CASES} from './compute-string-cases.js';
for(const c of STRING_CASES)test('String lowering: '+c.name,()=>{
  const a=compileCompute(c.source,c.options);validateArtifact(a);assert.equal(a.stringABI,1);assert.match(a.wgsl,/fn put_s/);
});
for(const text of ['', 'abc', '\0', '😀', '\ud800', '\udc00', 'zażółć\u0000'])test('UTF-16 storage roundtrip '+JSON.stringify(text),()=>{
  const storage={capacity:8,fixedLength:0};assert.equal(decodeStringBlock(encodeStringBlock(text,storage),0,storage),text);
});
test('fixed String storage pads and truncates',()=>{
 const storage={capacity:4,fixedLength:4};assert.equal(decodeStringBlock(encodeStringBlock('x',storage),0,storage),'x   ');assert.equal(decodeStringBlock(encodeStringBlock('abcdef',storage),0,storage),'abcd');
});
test('String metadata defaults decode correctly in separate lanes',()=>{
 const a=compileCompute('Public s As String\nPublic f As String * 3\nPublic v(2) As String\nSub Main()\nEnd Sub');const state=createInitialState(a,2);const lanes=decodeState(a,state.buffer,2);
 assert.deepEqual(lanes[0].globals,{'Module1.s':'','Module1.f':'   ','Module1.v':['','','']});assert.deepEqual(lanes[0].globals,lanes[1].globals);
});
for(const value of [0,{},null,['x'],'123456789'])test('invalid host String input '+JSON.stringify(value),()=>assert.throws(()=>encodeStringBlock(value,{capacity:8,fixedLength:0})));
for(const value of [0,4097,-1,NaN,1.5])test('invalid maxStringLength '+value,()=>assert.throws(()=>compileCompute('Sub Main()\nEnd Sub',{maxStringLength:value})));
test('String literal exceeding capacity is rejected at compile time',()=>assert.throws(()=>compileCompute('Sub Main()\nDim s As String\ns="12345"\nEnd Sub',{maxStringLength:4}),e=>e.code==='GPU_STRING_CAPACITY'));
test('String slabs enforce combined state budget',()=>assert.throws(()=>compileCompute('Public a(1000) As String\nSub Main()\nEnd Sub'),e=>e.code==='GPU_LIMIT'));
for(const body of ['s=CStr(1.5!)','n=CLng("123")','n=1&+"2"','n=Abs("2")','If "True" Then n=1&','s=String$(2,200)','s="a" Like "*"'])test('unsupported String coercion is diagnosed: '+body,()=>assert.throws(()=>compileCompute('Public s As String\nPublic n As Long\nSub Main()\n'+body+'\nEnd Sub'),e=>/^GPU_/.test(e.code)));
test('locale comparison is not approximated as ASCII',()=>assert.throws(()=>compileCompute('Option Compare Text\nPublic n As Long\nSub Main()\nIf "A"="a" Then n=1&\nEnd Sub'),e=>e.code==='GPU_COMPARE'));
for(const mutate of [a=>delete a.stringABI,a=>a.stringABI=2,a=>delete a.globals[0].stringStorage,a=>a.globals[0].stringStorage.offset=999999,a=>a.globals[0].stringStorage.stride++,a=>a.initialState[0]=0,a=>a.initialState[1]=9999,a=>a.globals.push({...a.globals[0],name:'alias'})])test('malformed String artifact '+mutate,()=>{const a=compileCompute('Public s As String\nSub Main()\nEnd Sub');mutate(a);assert.throws(()=>validateArtifact(a));});
test('readback rejects corrupt UTF-16 units',()=>{const b=encodeStringBlock('x',{capacity:8});b[3]=65536;assert.throws(()=>decodeStringBlock(b,0,{capacity:8}),e=>e.code==='GPU_ABI');});

for(const [declaration,argument,parameter] of [
  ['Public fixedText As String * 3','fixedText','ByRef text As String'],
  ['Public fixedText(1) As String * 3','fixedText(0)','ByRef text As String'],
  ['Public fixedText(1) As String * 3','fixedText','ByRef text() As String']
])test('fixed String ByRef copy-back is diagnosed: '+argument,()=>{
  assert.throws(()=>compileCompute(declaration+'\nSub Main()\nEdit '+argument+'\nEnd Sub\nSub Edit('+parameter+')\nEnd Sub'),e=>e.code==='GPU_FIXED_STRING_BYREF');
});
test('String readback refuses corrupt canonical references',()=>{
  const a=compileCompute('Public s As String\nSub Main()\nEnd Sub'),state=createInitialState(a);
  state[6]=0;
  assert.throws(()=>decodeState(a,state.buffer),e=>e.code==='GPU_ABI');
});
test('String array readback validates unallocated capacity references',()=>{
  const a=compileCompute('Public s() As String\nSub Main()\nEnd Sub'),state=createInitialState(a);
  const symbol=a.globals[0];state[6+symbol.offset+16+symbol.capacity-1]=0;
  assert.throws(()=>decodeState(a,state.buffer),e=>e.code==='GPU_ABI');
});
