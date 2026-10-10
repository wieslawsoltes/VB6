import test from 'node:test';
import assert from 'node:assert/strict';
import {UIReferenceProviders} from '../packages/intelligent-ui/src/reference-providers.js';
const reference={kind:'citation',title:'Inspected',details:'Exact result',provenance:{source:'Configured provider'}};
test('reference providers require explicit approval and never execute on registration',async()=>{
  let calls=0,allow=false;const registry=new UIReferenceProviders({approve:async()=>allow});
  const unregister=registry.register('search',{description:'Trusted search',resolve:async()=>{calls++;return reference;}});
  assert.equal(calls,0);await assert.rejects(registry.resolve('search','topic',{owner:'a'}),/declined/);assert.equal(calls,0);
  allow=true;const value=await registry.resolve('search','topic',{owner:'a'});assert.equal(value.provenance.source,reference.provenance.source);assert.equal(calls,1);
  unregister();await assert.rejects(registry.resolve('search','topic',{owner:'a'}),/not configured/);registry.dispose();
});
test('unregistering, cancellation and owner revocation discard late provider results',async()=>{
  const registry=new UIReferenceProviders({approve:async()=>true});let resolve,started;
  const ready=new Promise(r=>started=r);const unregister=registry.register('slow',{resolve:async()=>{started();return new Promise(r=>resolve=r);}});
  const request=registry.resolve('slow','topic',{owner:'a'});await ready;
  await assert.rejects(registry.resolve('slow','other',{owner:'a'}),/already active/);
  unregister();resolve(reference);await assert.rejects(request);assert.equal(registry.active.size,0);registry.dispose();
});
test('reference timeouts and invalid results fail without persisting any data',async()=>{
  const registry=new UIReferenceProviders({approve:async()=>true,timeout:5});registry.register('timeout',{resolve:()=>new Promise(()=>{})});
  await assert.rejects(registry.resolve('timeout','topic',{owner:'a'}),/timeout/);assert.equal(registry.active.size,0);
  registry.register('bad',{resolve:async()=>({kind:'citation',title:'Invented'})});await assert.rejects(registry.resolve('bad','topic',{owner:'a'}),/explicit source/i);registry.dispose();
});
