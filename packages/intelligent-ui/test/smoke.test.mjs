import test from 'node:test';
import assert from 'node:assert/strict';
import {UIRuntime,compile,McpUIService} from '../src/index.js';
test('installed package works independently of the IDE',()=>{
 const runtime=new UIRuntime();const result=runtime.update('{@body const [n,setN] = DIL.useState(1)}<button onClick={() => setN(n+1)}>{n}</button>');
 assert.equal(result.tree[0].children[0].text,'1');const next=runtime.dispatch(result.tree[0].props.onClick);assert.equal(next.tree[0].children[0].text,'2');
 assert.equal(compile('<text>Standalone</text>').diagnostics.length,0);assert.equal(new McpUIService().run('list',{}, {principal:'local'}).documents.length,0);runtime.dispose();
});
