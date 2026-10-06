import test from 'node:test';
import assert from 'node:assert/strict';
import {compileCompute} from '../src/compute/index.js';
import {validateArtifact} from '../packages/vb6-compute/src/runtime.js';
import {arrayHeader,readArrayLayout} from '../packages/vb6-compute/src/array-layout.js';
import {EXTRA_STRING_CASES} from './compute-string-extras-cases.js';
for(const c of EXTRA_STRING_CASES)test('String extras lowering: '+c.name,()=>validateArtifact(compileCompute(c.source,{maxStringLength:64})));
test('canonical empty dynamic array is allocated rank one',()=>{const words=arrayHeader([[0,-1]],8);assert.deepEqual(readArrayLayout(words,0,{name:'a',dynamic:true,capacity:8}),{allocated:true,bounds:[[0,-1]],length:0,capacity:8,dynamic:true});});
for(const bounds of [[[1,0]],[[0,-2]],[[0,-1],[0,0]]])test('other reversed array bounds fail '+JSON.stringify(bounds),()=>assert.throws(()=>arrayHeader(bounds,8)));
test('fixed empty array descriptor is rejected',()=>assert.throws(()=>arrayHeader([[0,-1]],8,false)));
for(const source of [
 'Public a(4) As String\nSub Main()\na=Split("a b")\nEnd Sub',
 'Public a() As Long\nSub Main()\na=Split("a b")\nEnd Sub',
 'Public a() As String\nSub Main()\na=Split("a b"," ",-1,1)\nEnd Sub',
 'Public a() As String\nSub Main()\na=Filter("abc","a")\nEnd Sub',
 'Public a() As String\nSub Main()\na=Split(42)\nEnd Sub',
 'Public a() As String\nSub Main()\na=Filter(a,"a",True,1)\nEnd Sub',
 'Option Compare Text\nPublic result As Boolean\nSub Main()\nresult="a" Like "A"\nEnd Sub'
])test('unsupported array/String contract fails closed '+source,()=>assert.throws(()=>compileCompute(source),e=>e.code.startsWith('GPU_')));
test('unused numeric kernels do not contain pattern scratch arrays',()=>assert.doesNotMatch(compileCompute('Sub Main()\nEnd Sub').wgsl,/fn str_like|fn str_split|fn str_filter/));
test('pattern kernel has polynomial scratch storage and charges row work',()=>{const s=compileCompute('Public b As Boolean\nSub Main()\nb="a" Like "*a"\nEnd Sub',{maxStringLength:64}).wgsl;assert.match(s,/var row:array<u32,65>/);assert.match(s,/array_charge\(n\+1u\)/);});
