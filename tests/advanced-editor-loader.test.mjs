import test from 'node:test';
import assert from 'node:assert/strict';
import {loadAdvancedEditorAssets} from '../src/editor/advanced/loader.js';

function page({payload=null,fail=false}={}) {
  const nodes=[],workers=[],view={location:{origin:'https://studio.test'},URL,Blob,addEventListener(){},Worker:class {constructor(url){workers.push(url);}}};
  let reads=0;
  const document={defaultView:view,baseURI:'https://studio.test/dist/index.html',getElementById(){reads++;return payload===null?null:{textContent:JSON.stringify(payload)};},
    createElement(tag){return {tag,remove(){this.removed=true;}};},head:{append(node){nodes.push(node);queueMicrotask(()=>{
      if(fail){node.onerror();return;}
      if(node.tag==='script'&&(!view.VB6AdvancedMonaco))view.VB6AdvancedMonaco={monaco:{}};
      else if(node.tag==='script')view.VB6AdvancedEditorRuntime={createAdvancedEditorRuntime(){}};
      node.onload();
    });}}};
  return {document,view,nodes,workers,reads:()=>reads};
}
test('loader does nothing until called and caches one initialization per window',async()=>{
  const p=page();assert.equal(p.reads(),0);assert.equal(p.nodes.length,0);
  const one=loadAdvancedEditorAssets(p.document,'https://studio.test/dist/advanced-editor/'),two=loadAdvancedEditorAssets(p.document,'https://studio.test/dist/advanced-editor/');
  assert.equal(one,two);const assets=await one;assert.equal(p.reads(),1);assert.equal(p.nodes.length,4);assert.equal(p.workers.length,0);
  assets.worker();assert.deepEqual(p.workers,['https://studio.test/dist/advanced-editor/language.worker.js']);
});
test('loader rejects cross-origin asset roots before inserting executable content',async()=>{
  const p=page();await assert.rejects(loadAdvancedEditorAssets(p.document,'https://external.test/editor/'),/hosted beside/);assert.equal(p.nodes.length,0);assert.equal(p.workers.length,0);
});
test('failed initialization removes inserted nodes and restores the worker environment',async()=>{
  const p=page({fail:true}),environment={getWorker(){}};p.view.MonacoEnvironment=environment;
  await assert.rejects(loadAdvancedEditorAssets(p.document,'https://studio.test/dist/advanced-editor/'),/Could not load/);
  assert.equal(p.view.MonacoEnvironment,environment);assert.ok(p.nodes.every(n=>n.removed));
  await assert.rejects(loadAdvancedEditorAssets(p.document,'https://studio.test/dist/advanced-editor/'));assert.equal(p.reads(),2);
});
test('offline payload creates local blob assets without an HTTP dependency',async()=>{
  const payload=Object.fromEntries(['monaco.css','entry.css','monaco.js','entry.js','language.worker.js','editor.worker.js'].map(name=>[name,'/* '+name+' */']));
  const p=page({payload});p.view.location.origin='null';const assets=await loadAdvancedEditorAssets(p.document,'file:///advanced-editor/');
  assert.ok(p.nodes.every(n=>(n.src||n.href).startsWith('blob:')));assets.worker();assert.ok(p.workers[0].startsWith('blob:'));
});
