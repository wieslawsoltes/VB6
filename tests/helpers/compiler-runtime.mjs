import assert from 'node:assert/strict';
import {compileProject} from '../../src/language/compiler.js';
import {VirtualMachine} from '../../src/runtime/vm.js';
export const module=(name,code,kind='module')=>({id:name,name,kind,code});
export const project=(code,extras=[])=>({name:'CompilerRuntime',startup:'Sub Main',modules:[module('M',code),...extras]});
export const main=body=>`Option Explicit\nSub Main()\n${body}\nEnd Sub`;
export async function run(code,extras=[],options={}){const output=[],p=project(code,extras),compiled=compileProject(p);assert.deepEqual(compiled.diagnostics,[]);const vm=new VirtualMachine(compiled,{print:s=>output.push(s)},options);await vm.start();return {output,vm,project:p};}
export function invalid(code,pattern,extras=[]){const p=compileProject(project(code,extras));assert.equal(p.valid,false);assert.match(p.diagnostics.map(d=>d.message).join('\n'),pattern);return p;}
export const close=(actual,expected,epsilon=1e-9)=>assert.ok(Math.abs(actual-expected)<=epsilon*Math.max(1,Math.abs(expected)),`${actual} != ${expected}`);
export const error=(f,number)=>assert.throws(f,e=>e.number===number);
export async function pause(code,line,extras=[]){const output=[],p=project(code,extras),compiled=compileProject(p);assert.deepEqual(compiled.diagnostics,[]);const vm=new VirtualMachine(compiled,{print:s=>output.push(s)});vm.setBreakpoint('M',line);let accept;const ready=new Promise(resolve=>accept=resolve);const off=vm.on('pause',e=>{off();accept(e);});const running=vm.start();let timer;try{await Promise.race([ready,running.then(()=>{throw new Error('Program completed before breakpoint');}),new Promise((_,reject)=>timer=setTimeout(()=>reject(new Error('Breakpoint timeout')),3000))]);}catch(e){vm.stop();await running.catch(()=>{});throw e;}finally{clearTimeout(timer);}return {vm,project:p,output,running};}
export async function finish(p){p.vm.breakpoints.clear();p.vm.resume();await p.running;}
