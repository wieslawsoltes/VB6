import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeKernelDependencies} from '../src/native/private-kernels.js';
const proc=(...names)=>({proc:{code:names.map(name=>({op:'expr',expr:{kind:'call',callee:{kind:'id',name},args:[]}}))}});
test('private kernel closure follows nested calls and terminates on recursion',()=>{
 const procedures=new Map([['root',proc('Left','External')],['left',proc('right')],['right',proc('LEFT')],['unused',proc()]]);
 assert.deepEqual([...nativeKernelDependencies(procedures,['ROOT'])],['root','left','right']);
 assert.deepEqual([...nativeKernelDependencies(procedures,[])],[]);
});
test('a missing compiler-owned root is an error, never an omitted implementation',()=>{
 assert.throws(()=>nativeKernelDependencies(new Map(),['missing']),/Unknown private native procedure/);
});
