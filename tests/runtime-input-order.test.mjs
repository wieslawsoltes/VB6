import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualMachine} from '../src/runtime/vm.js';
function vm(){const machine=new VirtualMachine({name:'Input',startup:'Sub Main',modules:[]});machine.setState('running');return machine;}

for(const barrier of ['MouseDown','MouseUp','KeyDown','KeyUp'])test('coalescing cannot cross '+barrier,async()=>{const v=vm(),owner={},key={},seen=[];v.processing=true;v.enqueueInput(owner,key,()=>seen.push('before'),{coalesce:true});v.enqueueInput(owner,null,()=>seen.push(barrier));v.enqueueInput(owner,key,()=>seen.push('after'),{coalesce:true});assert.equal(v.eventQueue.length,3);v.processing=false;await v.processEvents();assert.deepEqual(seen,['before',barrier,'after']);v.stop();});
test('coalescing cannot cross queued timer/application events',async()=>{const v=vm(),owner={},key={},seen=[];v.processing=true;v.enqueueInput(owner,key,()=>seen.push('before'),{coalesce:true});v.eventQueue.push({action:()=>seen.push('timer'),resolve:()=>{}});v.enqueueInput(owner,key,()=>seen.push('after'),{coalesce:true});assert.equal(v.eventQueue.length,3);v.processing=false;await v.processEvents();assert.deepEqual(seen,['before','timer','after']);v.stop();});
