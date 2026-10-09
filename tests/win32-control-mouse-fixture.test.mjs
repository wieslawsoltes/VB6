import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
import {compileWin32} from '../src/native/compiler.js';

test('queued native TreeView click fixture inserts a complete real-input pair before entering COMCTL32',()=>{
  const {project,checks}=nativeControlFixtures().find(f=>f.project.name==='AotControlItemObjects');
  const code=project.modules[0].code,body=code.slice(code.indexOf('Private Function PulseTree'));
  assert.ok(body.indexOf('SendInput(2,clicks,28)')<body.indexOf('n=DispatchMessageW(message)'));
  assert.ok(body.includes('clicks.down.flags=2')&&body.includes('clicks.up.flags=4'));
  assert.ok(!body.includes('PostMessageW('));
  assert.ok(body.includes('GetForegroundWindow()<>Me.hWnd'));
  assert.equal(code.match(/Private Type INPUT32[\s\S]*?End Type/)[0].match(/ As Long/g).length,7);
  assert.ok(!body.includes('GetMessageW(message,Tree.hWnd,&H202'));
  assert.ok(body.includes('PeekMessageW(message,Tree.hWnd,&H202,&H202,1)'));
  assert.ok(body.includes('SendValue(Tree.hWnd,&H1114,0,item)'));
  assert.equal(checks.length,10);
  assert.ok(code.includes('n=1 And treeCalls=1 And treeText="Second" And treeKey="second"'));
  for(const optimization of [0,1,2])assert.ok(compileWin32(project,{optimization}).bytes.length);
});
