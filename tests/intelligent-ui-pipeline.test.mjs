import test from 'node:test';
import assert from 'node:assert/strict';
import {compile, UIRuntime, UIClient, startUIWorker, normalizeViewport, CATALOG} from '../packages/intelligent-ui/src/index.js';

const source='{@body const [n,setN] = DIL.useState(2)}<button onClick={()=>setN(n+1)}>{n}</button><text>Hello</text><metric label="Price" value={n*data.price}/><grid columns={DIL.useBreakpoint("md")?3:1}><text>{DIL.useViewport().width}</text></grid>';
const all=tree=>tree.flatMap(n=>[n,...all(n.children)]);
const plain=r=>all(r.tree).map(n=>n.text||'').join('');
test('precompiled programs and data-only patches retain edited state and original instructions',()=>{
  const document=compile(source),r=new UIRuntime();r.apply(document,{data:{price:10}});r.dispatch(r.tree[0].props.onClick);
  const constant=Object.keys(document.constants).find(k=>document.constants[k]==='Hello');
  const result=r.patch({constants:{[constant]:'Welcome'},data:{price:20}},r.version);
  assert.equal(result.kind,'constants');assert.equal(r.tree[0].children[0].text,'3');assert.match(plain(r),/Welcome/);
  assert.equal(all(r.tree).find(n=>n.type==='metric').props.value,60);
  assert.deepEqual(JSON.parse(JSON.stringify(r.document.program)),JSON.parse(JSON.stringify(document.program)));
  assert.equal(document.constants[constant],'Hello');assert.ok(result.operations.every(op=>op.op==='set'));
  assert.equal(r.patch({data:{price:21}}).kind,'data');assert.equal(r.patch({}).operations.length,0);
});
test('patch versions and fields fail closed without changing last good state',()=>{
  const r=new UIRuntime();r.update(source,{data:{price:10}});const previous=r.tree,version=r.version,state=r.snapshot();
  for(const patch of [{constants:{missing:'x'}},{constants:[]},{program:{}},{data:null},{partial:'false'},{constants:{n0:()=>42}}])assert.throws(()=>r.patch(patch));
  assert.throws(()=>r.patch({data:{price:0}},version-1),/changed/);
  assert.equal(r.tree,previous);assert.equal(r.version,version);assert.deepEqual(r.snapshot(),state);
  assert.throws(()=>new UIRuntime().patch({}),/Load/);r.dispose();assert.throws(()=>r.patch({}),/disposed/);
});
test('compiled document validation cannot commit malformed metadata or non-JSON capabilities',()=>{
  const r=new UIRuntime();r.update('<text>Good</text>');const previous=r.tree,version=r.version;
  for(const document of [null,{...compile('Bad'),diagnostics:'bad'},{...compile('Bad'),recoveryDiagnostics:[null]},{...compile('Bad'),constants:{n0:{}}},{...compile('Bad'),partial:0}])assert.throws(()=>r.apply(document));
  assert.equal(r.tree,previous);assert.equal(r.version,version);
});
test('host viewport hooks resize keyed controls and preserve state, without model authority',()=>{
  const r=new UIRuntime();r.update(source,{data:{price:10,viewport:{width:9999}},viewport:{width:500,height:600}});
  const button=r.tree[0].props.onClick;r.dispatch(button);assert.equal(all(r.tree).find(n=>n.type==='grid').props.columns,1);
  const result=r.resize({width:900,height:600});assert.equal(result.kind,'viewport');assert.equal(r.tree[0].props.onClick,button);
  assert.equal(all(r.tree).find(n=>n.type==='grid').props.columns,3);assert.equal(r.tree[0].children[0].text,'3');
  assert.match(plain(r),/900/);assert.equal(result.actions.length,0);assert.ok(result.operations.every(op=>op.op==='set'));
  assert.throws(()=>r.resize({width:-1,height:20}));assert.equal(r.viewport.width,900);
});
test('viewport dimensions and named breakpoints are bounded and diagnosed',()=>{
  assert.deepEqual(normalizeViewport({width:700.4}),{width:700,height:768});
  for(const value of [{width:Infinity},{width:16385},{width:'700'},{width:700,devicePixelRatio:9},null])assert.throws(()=>normalizeViewport(value));
  const r=new UIRuntime(),result=r.update('{DIL.useBreakpoint("unknown")}');assert.ok(result.diagnostics.some(d=>d.code==='breakpoint'));
});
test('failed viewport expansion rolls back viewport, state and handlers together',()=>{
  const r=new UIRuntime();r.update('{#if DIL.useBreakpoint("lg")}{#each data.rows as r}<text>{data.long}</text>{/each}{:else}<text>Narrow</text>{/if}',{data:{rows:Array(100).fill(0),long:'a'.repeat(10000)},viewport:{width:500,height:600}});
  const before=r.tree,version=r.version;assert.throws(()=>r.resize({width:1200,height:600}),/limit/);
  assert.equal(r.tree,before);assert.equal(r.version,version);assert.equal(r.viewport.width,500);
});
test('Worker protocol and local client both support compiled, patch and resize requests',async()=>{
  for(const remote of [false,true]){
    let receive;const replies=[];const scope={addEventListener(name,listener){receive=listener;},postMessage(message){replies.push(message);}};
    startUIWorker(scope);const client=new UIClient({window:{}});
    const request=async(method,payload)=>{if(!remote)return client.request(method,payload);receive({data:{id:replies.length+1,method,payload}});const response=replies.at(-1);if(response.error)throw new Error(response.error.message);return response.result;};
    let result=await request('apply',{document:compile(source),options:{data:{price:12}}});
    result=await request('patch',{patch:{data:{price:20}},version:result.version});assert.equal(result.kind,'data');
    result=await request('resize',{viewport:{width:400,height:600},version:result.version});assert.equal(result.kind,'viewport');
    assert.equal(all(result.tree).find(n=>n.type==='grid').props.columns,1);client.dispose();
  }
});
test('icon names and image ratios are catalog validated, and metric changes reach fallback',()=>{
  assert.ok(CATALOG.icon.name.includes('arrow-right'));
  assert.equal(compile('<button><icon name="arrow-right" inline/></button><AsyncImage ref="cover" aspectRatio="5:4" objectFit="cover"/>').diagnostics.length,0);
  for(const source of ['<icon name="<script>"/>','<image aspectRatio="1:0"/>','<image aspectRatio="url(https://example.com)"/>'])assert.ok(compile(source).diagnostics.length);
  const r=new UIRuntime();assert.match(r.update('<metric value={5} change="Up 2"/>').fallbackMarkdown,/Up 2/);
});
