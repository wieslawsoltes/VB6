import test from 'node:test';
import assert from 'node:assert/strict';
import {DebugHoverProvider,debugExpression} from '../src/editor/advanced/debug-hover.js';
import {EditorIntelligence} from '../src/editor/intelligence.js';
import {LspTextDocument} from '../src/editor/advanced/text-document.js';

const source='Public Sub Run()\n  Dim value As Long\n  value = 42\nEnd Sub\nPrivate Sub Other()\n  Dim value As Long\nEnd Sub\n';
function fixture(){
  const module={id:'main',name:'Main',kind:'module',code:source},document=new LspTextDocument('vb6-editor://workspace/Main.bas','vb6',source,1);
  let version=1;const model={uri:{toString:()=>document.uri},getVersionId:()=>version,isDisposed:()=>false,getOffsetAt:p=>document.offsetAt({line:p.lineNumber-1,character:p.column-1}),getLineContent:line=>source.split('\n')[line-1]};
  const record={uri:document.uri,moduleId:module.id,language:'vb6',model,legacy:{intelligence:new EditorIntelligence()}},calls=[];
  const ide={runState:'paused',runtimeFrame:{},project:{modules:[module],settings:{}},stack:[{module:'Main',procedure:'Run'}],bridgeToken:'runtime',editRevision:1};
  ide.debuggerWindows={pauseId:5,frameIndex:0,refreshSerial:3,inspect:async expression=>{calls.push(expression);return {value:'42',type:'Long',context:{module:'Main',procedure:'Run',frameIndex:0,pauseId:5}};}};
  const runtime={ide,records:new Map([[record.uri,record]])},provider=new DebugHoverProvider(runtime),position={lineNumber:3,column:4};
  return {provider,ide,model,record,calls,position,edit:()=>version++};
}

test('automatic debugger expression extraction excludes strings, comments and call-result members',()=>{
  assert.equal(debugExpression('  obj.Value = 2',8).expression,'obj.Value');
  assert.equal(debugExpression('  GetObject().Value',16),null);
  assert.equal(debugExpression('  .Value',5),null);
  assert.equal(debugExpression('Debug.Print "value"',15),null);
  assert.equal(debugExpression("' value",4),null);
  assert.equal(debugExpression('Rem value',6),null);
});
test('hover reads the selected frame through storage inspection and uses untrusted plain text',async()=>{
  const f=fixture(),result=await f.provider.provideHover(f.model,f.position);
  assert.deepEqual(f.calls,['value']);assert.match(result.contents[0].value,/value = 42/);assert.equal(result.contents[0].isTrusted,false);assert.equal(result.contents[0].supportHtml,false);
  assert.equal(result.range.startColumn,3);
});
test('hover never inspects running, edited, retained or unrelated procedure source',async()=>{
  for(const change of [f=>f.ide.runState='running',f=>f.ide.pendingEdits=true,f=>f.ide.evaluating=true,f=>f.ide.stack[0].retained=true,f=>f.ide.stack[0].module='Other',f=>f.position.lineNumber=6]){
    const f=fixture();change(f);assert.equal(await f.provider.provideHover(f.model,f.position),null);assert.deepEqual(f.calls,[]);
  }
});
test('late debug tips are discarded on resume, pause/frame changes and source edits',async()=>{
  for(const change of [f=>f.ide.runState='running',f=>f.ide.debuggerWindows.pauseId++,f=>f.ide.debuggerWindows.refreshSerial++,f=>f.ide.bridgeToken='new runtime',f=>f.edit()]){
    const f=fixture();let finish;f.ide.debuggerWindows.inspect=()=>new Promise(resolve=>finish=resolve);
    const pending=f.provider.provideHover(f.model,f.position);await Promise.resolve();change(f);
    finish({value:'old',context:{module:'Main',procedure:'Run',pauseId:5,frameIndex:0}});assert.equal(await pending,null);
  }
});
test('runtime context must agree with the requested pause and frame',async()=>{
  const f=fixture();f.ide.debuggerWindows.inspect=async()=>({value:'wrong frame',context:{module:'Main',procedure:'Run',pauseId:6,frameIndex:0}});
  assert.equal(await f.provider.provideHover(f.model,f.position),null);
});
test('cancellation and disposal immediately suppress pending hover without running evaluation',async()=>{
  const f=fixture();let cancel,finish,disposed=false;
  f.ide.debuggerWindows.inspect=()=>new Promise(resolve=>finish=resolve);
  const token={onCancellationRequested:cb=>{cancel=cb;return {dispose:()=>disposed=true};}};
  const pending=f.provider.provideHover(f.model,f.position,token);await Promise.resolve();cancel();assert.equal(await pending,null);
  finish(null);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(disposed,true);
  const next=f.provider.provideHover(f.model,f.position);await Promise.resolve();f.provider.dispose();assert.equal(await next,null);finish(null);
});
test('inspection errors and excessive concurrent requests remain silent',async()=>{
  const f=fixture();let finish;f.ide.debuggerWindows.inspect=()=>new Promise(resolve=>finish=resolve);
  const a=f.provider.provideHover(f.model,f.position),b=f.provider.provideHover(f.model,f.position);
  assert.equal(await f.provider.provideHover(f.model,f.position),null);f.provider.dispose();assert.equal(await a,null);assert.equal(await b,null);
  if(finish)finish(null);
  const g=fixture();g.ide.debuggerWindows.inspect=async()=>{throw new Error('Automatic getter evaluation is disabled');};assert.equal(await g.provider.provideHover(g.model,g.position),null);
});
