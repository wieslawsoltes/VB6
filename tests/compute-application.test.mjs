import test from 'node:test';
import assert from 'node:assert/strict';
import {compileComputeApplication} from '../src/compute/index.js';
import {ComputeApplication,validateApplication,INPUT_FIELDS} from '../packages/vb6-compute/src/application.js';
const source='Public n As Long\nSub Main()\nn=10&\nEnd Sub\nSub Click()\nn=n+CLng(ComputeInput.PointerX)\nEnd Sub';
const descriptor=()=>compileComputeApplication(source,{events:{load:'Main',pointerDown:'Click'}});
// Fake queue covers host orchestration only; real GPU readbacks are separate.
function fake(options={}) {
  const app=new ComputeApplication(descriptor(),options),writes=[];
  app.gpu={operation:async fn=>fn({queue:{writeBuffer(buffer,offset,data){writes.push([offset,data[0]]);}}})};
  app.program={check(){},count:1,artifact:app.descriptor.artifact,state:{},width:64,height:64,async run(){return [{error:0,drawCount:0}];},async reset(){writes.push('reset');},async dispose(){writes.push('dispose');}};
  return {app,writes};
}
test('all application inputs have typed globals and a single entry',()=>{const d=descriptor();assert.equal(d.artifact.entry,'ComputeInput.Dispatch');for(const name of Object.keys(INPUT_FIELDS))assert.ok(d.artifact.globals.some(g=>g.module==='ComputeInput'&&g.name===name));assert.deepEqual(d.events,{load:'Module1.Main',pointerDown:'Module1.Click'});});
test('event binding cannot inject VB code',()=>assert.throws(()=>compileComputeApplication(source,{events:{load:'Main(): End'}}),e=>e.code==='GPU_EVENT'));
for(const name of ['absent','mouseDown','__proto__'])test('unknown event '+name,()=>assert.throws(()=>compileComputeApplication(source,{events:{[name]:'Main'}}),e=>e.code==='GPU_EVENT'));
for(const decl of ['Private Sub Hidden()','Public Function Hidden() As Long','Public Sub Hidden(ByVal x As Long)'])test('unsupported event signature '+decl,()=>assert.throws(()=>compileComputeApplication(decl+'\nEnd '+(decl.includes('Function')?'Function':'Sub'),{events:{load:'Hidden'}}),e=>e.code==='GPU_EVENT'));
test('reserved host module is diagnosed',()=>assert.throws(()=>compileComputeApplication(source,{moduleName:'ComputeInput'}),e=>e.code==='GPU_NAME'));
test('no events is diagnosed',()=>assert.throws(()=>compileComputeApplication(source,{events:{}})));
test('duplicate event procedure names require qualification',()=>assert.throws(()=>compileComputeApplication({modules:[{name:'A',code:'Sub Main()\nEnd Sub'},{name:'B',code:'Sub Main()\nEnd Sub'}]}),e=>e.code==='GPU_EVENT'));
test('unhandled event is an explicit no-op',async()=>{const {app,writes}=fake();assert.deepEqual(await app.dispatch('wheel'),{handled:false});assert.equal(writes.length,0);await app.dispose();});
test('queued input snapshots preserve order',async()=>{const {app}=fake(),seen=[];app.program.run=async()=>{seen.push(app.inputs.PointerX);return []};const input={PointerX:12};const a=app.dispatch('pointerDown',input);input.PointerX=99;const b=app.dispatch('pointerDown',{PointerX:24});await Promise.all([a,b]);assert.deepEqual(seen,[12,24]);await app.dispose();});
test('bounded queue refuses excess without dropping queued work',async()=>{const {app}=fake({maxQueuedEvents:1});const first=app.dispatch('load');assert.throws(()=>app.dispatch('load'),e=>e.code==='GPU_QUEUE_FULL');await first;assert.equal(app.queued,0);await app.dispose();});
test('queue recovers after a failed dispatch',async()=>{const {app}=fake();app.program.run=async()=>{throw new Error('dispatch failed')};await assert.rejects(app.dispatch('load'));app.program.run=async()=>[];assert.equal((await app.dispatch('load')).handled,true);await app.dispose();});
test('reset is serialized with events and reruns load in its queue slot',async()=>{const {app,writes}=fake();const seen=[];app.program.run=async()=>{seen.push(app.inputs.EventId);return []};await Promise.all([app.dispatch('pointerDown'),app.reset(),app.dispatch('pointerDown')]);assert.deepEqual(seen,[3,1,3]);assert.ok(writes.includes('reset'));await app.dispose();});
test('empty draw list does not erase the previous image',async()=>{const {app}=fake();let renders=0;app.renderer={async render(){renders++},async dispose(){}};await app.dispatch('load');assert.equal(renders,0);app.program.run=async()=>[{drawCount:1}];await app.dispatch('load');assert.equal(renders,1);await app.dispose();});
for(const values of [{EventId:2},{unknown:1},{PointerX:NaN},{Frame:1.5}])test('reject invalid input '+JSON.stringify(values),async()=>{const {app}=fake();assert.throws(()=>app.dispatch('load',values));await app.dispose();});
test('dispose rejects queued work and is idempotent',async()=>{const {app,writes}=fake();const pending=app.dispatch('load');const disposal=app.dispose();await assert.rejects(pending,e=>e.code==='GPU_DISPOSED');assert.equal(disposal,app.dispose());await disposal;assert.equal(writes.filter(x=>x==='dispose').length,1);});
test('borrowed GPU device is not disposed',async()=>{const {app}=fake();let closed=false;app.gpu.dispose=async()=>{closed=true};await app.dispose();assert.equal(closed,false);});
test('descriptor validation rejects absent or mistyped input symbols',()=>{const d=descriptor();d.artifact.globals.find(g=>g.module==='ComputeInput').type='single';assert.throws(()=>validateApplication(d),e=>e.code==='GPU_ABI');});
