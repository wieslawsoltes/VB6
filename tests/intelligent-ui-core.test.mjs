import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExpression,evaluate,baseScope} from '../packages/intelligent-ui/src/expression.js';
import {compile,StreamingCompiler,classifyUpdate} from '../packages/intelligent-ui/src/compiler.js';
import {UIRuntime,diffTrees} from '../packages/intelligent-ui/src/runtime.js';
import {boundedData,safeUrl} from '../packages/intelligent-ui/src/safety.js';

const example=`## Team plan estimate
Drag the slider to change the price.
{@body const [seats,setSeats] = DIL.useState(8)}
{@body const price = seats*29}
<box border padding={3} gap={2}>
<slider label="Seats" min={1} max={50} value={seats} onChange={setSeats}/>
<title size="xl">$\{price}/mo</title>
<button onClick={()=>GenUI.issueNewTurn("Plan for "+seats+" seats")}>Continue</button>
</box>`;
const all=tree=>tree.flatMap(n=>[n,...all(n.children||[])]);
const text=runtime=>all(runtime.tree).map(n=>n.text||'').join('');
const run=s=>evaluate(parseExpression(s),baseScope());
test('intelligent UI: numeric, string, collection and callback expressions',()=>{
 assert.equal(run('2+3*4'),14);assert.equal(run('2**3**2'),512);assert.equal(run('true ? 8 : 9'),8);assert.equal(run('null ?? "fallback"'),'fallback');
 assert.deepEqual(run('[1,2,3].map((v,i)=>v+i)'),[1,3,5]);assert.equal(run('[1,2,3].reduce((sum,v)=>sum+v,0)'),6);
 assert.equal(run('" hello ".trim().toUpperCase()'),'HELLO');assert.equal(run('Math.max(1,2,3).toFixed(2)'),'3.00');assert.equal(run('({a:2}).a'),2);
});
for(const source of ['window.location','globalThis','Function("return 1")()','eval("1")','fetch("https://example.org")','new Date()','({}).constructor','({})["constructor"]()','(()=>1).call(null)','[1].sort()','while(true){}'])test('intelligent UI denies host escape: '+source,()=>assert.throws(()=>run(source)));
test('intelligent UI: JSON data rejects prototypes, accessors, cycles and oversized input',()=>{
 assert.throws(()=>boundedData(JSON.parse('{"__proto__":{"polluted":true}}')));assert.throws(()=>boundedData({get secret(){throw Error('getter ran');}}),/accessors/);
 const cycle={};cycle.self=cycle;assert.throws(()=>boundedData(cycle));assert.throws(()=>boundedData(new Date()));assert.throws(()=>boundedData({f(){}}));assert.throws(()=>boundedData('x'.repeat(100001)));
 assert.equal({}.polluted,undefined);
});
test('intelligent UI: URL validation blocks credential and script schemes',()=>{for(const s of ['javascript:alert(1)','data:text/html,x','//example.org','https://user:password@example.org'])assert.throws(()=>safeUrl(s));assert.equal(safeUrl('https://example.org/path'),'https://example.org/path');});
test('intelligent UI: article-shaped state, derived text and callback without model round trips',()=>{
 const runtime=new UIRuntime(),result=runtime.update(example);assert.equal(result.diagnostics.length,0);assert.match(text(runtime),/232/);
 const slider=all(runtime.tree).find(n=>n.type==='slider'),button=all(runtime.tree).find(n=>n.type==='button');
 const changed=runtime.dispatch(slider.props.onChange,[9]);assert.match(text(runtime),/261/);assert.equal(changed.actions.length,0);assert.ok(changed.operations.every(op=>op.op==='set'));
 assert.deepEqual(JSON.parse(JSON.stringify(runtime.dispatch(button.props.onClick,[]).actions)),[{type:'message',args:['Plan for 9 seats']}]);
});
test('intelligent UI: state survives appends, compiler replacements and data patches',()=>{
 const r=new UIRuntime();r.update(example,{partial:true});r.dispatch(all(r.tree).find(n=>n.type==='slider').props.onChange,[17]);r.update(example+'\n<caption>Done</caption>',{partial:true,data:{fresh:42}});assert.match(text(r),/493/);
 r.update(example.replace('DIL.useState(8)','DIL.useState(3)'));assert.match(text(r),/493/);
});
test('intelligent UI: every streaming cut recovers deterministically and final stream is valid',()=>{
 const c=new StreamingCompiler();for(const char of example){const update=c.append(char);assert.equal(update.document.version,1);assert.ok(update.document.recoveryDiagnostics.length<100);}
 const final=c.finish();assert.equal(final.document.diagnostics.length,0);assert.deepEqual(JSON.parse(JSON.stringify(final.document)),JSON.parse(JSON.stringify(compile(example))));
 assert.ok(compile('<box><slider value={',{partial:true}).recoveryDiagnostics.length);assert.ok(compile('<box>').diagnostics.some(d=>d.code.startsWith('incomplete_')));
});
test('intelligent UI: text-only append changes constants, not program',()=>{assert.equal(classifyUpdate(compile('Hello'),compile('Hello world')),'constants');assert.equal(classifyUpdate(compile('Hello'),compile('Hello')),'none');assert.equal(classifyUpdate(compile('Hello'),compile('Hello<box/>')),'program');});
test('intelligent UI: component catalog removes unrecognized properties and diagnoses literals',()=>{const c=compile('<box innerHTML="unsafe" gap="1" border><script>boom</script><unknown/></box>');assert.ok(c.diagnostics.some(d=>d.code==='unknown_prop'));assert.ok(c.diagnostics.some(d=>d.code==='invalid_literal'));assert.ok(c.diagnostics.some(d=>d.code==='unknown_component'));const r=new UIRuntime();r.apply(c);assert.equal(all(r.tree).filter(n=>n.type==='script').length,0);assert.equal(r.tree[0].props.innerHTML,undefined);});
test('intelligent UI: conditions, keyed loops and exact data bindings',()=>{
 const r=new UIRuntime();const source='{#if data.show}<box>{#each data.rows as row, i (row.id)}<text>{i}: {row.name}</text>{/each}</box>{:else}<text>Empty</text>{/if}';
 r.update(source,{data:{show:true,rows:[{id:'a',name:'Alpha'},{id:'b',name:'Beta'}]}});assert.equal(text(r),'0: Alpha1: Beta');
 const id=all(r.tree).find(n=>n.text==='Alpha').id;r.update(source,{data:{show:true,rows:[{id:'b',name:'Beta'},{id:'a',name:'Alpha'}]}});assert.equal(all(r.tree).find(n=>n.text==='Alpha').id,id);
 r.update(source,{data:{show:false,rows:[]}});assert.equal(text(r),'Empty');
});
test('intelligent UI: render-time calls cannot issue actions or mutate state',()=>{
 const r=new UIRuntime();const result=r.update('{@body const [x,setX] = DIL.useState(1)}{GenUI.copy("secret")}{setX(7)}<text>{x}</text>');assert.equal(text(r),'1');assert.equal(result.actions.length,0);assert.ok(result.diagnostics.some(d=>d.code==='action_during_render'));assert.ok(result.diagnostics.some(d=>d.code==='state_during_render'));
});
test('intelligent UI: events reject stale revisions and removed callbacks',()=>{const r=new UIRuntime();const a=r.update(example),id=all(r.tree).find(n=>n.type==='slider').props.onChange;r.update('<text>Replaced</text>');assert.throws(()=>r.dispatch(id,[7],a.version),/changed/);assert.throws(()=>r.dispatch(id,[7]),/no longer/);});
test('intelligent UI: functional updates have a fresh bounded budget on every interaction',()=>{const r=new UIRuntime();r.update('{@body const [n,setN] = DIL.useState(0)}<button onClick={()=>setN(v=>v+1)}>{n}</button>');const id=all(r.tree).find(n=>n.type==='button').props.onClick;for(let i=0;i<1000;i++)r.dispatch(id);assert.equal(text(r),'1000');});
test('intelligent UI: failed render is transactional and retains last good tree, handlers and state',()=>{const r=new UIRuntime();r.update(example);const before=r.tree,handlers=r.handlers;assert.throws(()=>r.update('{#each data.rows as row}<box>{#each data.rows as item}<text>{item}</text>{/each}</box>{/each}',{data:{rows:Array.from({length:100},(_,i)=>i)}}),/nodes|budget/);assert.equal(r.tree,before);assert.equal(r.handlers,handlers);r.dispatch(all(r.tree).find(n=>n.type==='slider').props.onChange,[2]);assert.match(text(r),/58/);});
test('intelligent UI: AppBlock stays inert and incomplete apps never enter the renderer',()=>{const r=new UIRuntime();r.update('<AppBlock title="Demo"><script>window.pwned=true</script><p>App</p></AppBlock>');assert.equal(r.tree[0].props.html,'<script>window.pwned=true</script><p>App</p>');assert.equal(globalThis.pwned,undefined);r.update('<AppBlock><script>while(true){}',{partial:true});assert.equal(r.tree.length,0);});
test('intelligent UI: code fences are literal and never call host actions',()=>{const r=new UIRuntime();r.update('```js\n{GenUI.copy("secret")}<button/>\n```');assert.equal(r.tree[0].type,'codeBlock');assert.match(text(r),/GenUI/);assert.equal(r.handlers.size,0);});
test('intelligent UI: operation ordering, update and removal are renderer neutral',()=>{const a=[{id:'a',type:'box',props:{},children:[{id:'b',type:'#text',props:{},text:'one',children:[]}]}],b=structuredClone(a);b[0].children[0].text='two';assert.deepEqual(diffTrees(a,b),[{op:'set',id:'b',props:{},text:'two'}]);assert.equal(diffTrees(a,[]).length,2);assert.equal(diffTrees([],a)[0].op,'create');});
test('intelligent UI: state snapshot round-trip and disposal',()=>{const r=new UIRuntime();r.update(example);r.dispatch(all(r.tree).find(n=>n.type==='slider').props.onChange,[4]);const snapshot=r.snapshot(),other=new UIRuntime();other.restore(snapshot);other.update(example);assert.match(text(other),/116/);other.dispose();assert.throws(()=>other.update(example),/disposed/);});

test('intelligent UI: text fallback includes current values and excludes hidden content',()=>{const r=new UIRuntime();r.update('{@body const [n,setN] = DIL.useState(2)}<slider value={n} onChange={v=>setN(v)}/><metric label="Total" value={n*10}/><text hidden>Secret</text>');const result=r.dispatch(all(r.tree).find(n=>n.type==='slider').props.onChange,[7]);assert.match(result.fallbackMarkdown,/70/);assert.doesNotMatch(result.fallbackMarkdown,/Secret/);});
