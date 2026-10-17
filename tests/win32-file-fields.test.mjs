import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFileMachine} from './support/native-file-machine.mjs';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
import {compileWin32} from '../src/native/compiler.js';
const code='Sub Main\nDim value As Variant\nOpen "x" For Input As #1\nInput #1,value\nClose #1\nEnd Sub';
for(const optimization of [0,1,2])test(`Input field lexer preserves VB delimiters and counted values O${optimization}`,t=>{
 const f=nativeFileMachine(t,{optimization,code}),raw='  "a,b""c" , +1.25E2 ,\r\n#NULL#,\r\n"a\0b"',expected=[['a,b',1],['c',1],['+1.25E2',0],['',0],['#NULL#',0],['',0],['a\0b',1]];
 f.add('x',new TextEncoder().encode(raw));const e=f.open('x',1,3,2),q=f.m.alloc(4);
 for(const [text,quoted]of expected){const result=f.vm.invoke('proc:NativeFileText:ReadFieldText',[e,q]);assert.equal(f.m.bstr(result),text);assert.equal(f.m.read(q),quoted);f.m.free(result-4);}
 assert.equal(f.invoke('eof',e),0xffffffff);
});
for(const optimization of [0,1,2])test(`Input numeric grammar rejects locale/grouping and incomplete exponents O${optimization}`,t=>{
 const f=nativeFileMachine(t,{optimization,code});
 for(const text of ['0','+0','-.5','1.','1.5E+2','-1e-2','1234567890123456789012345678'])assert.equal(f.vm.invoke('proc:NativeFileText:IsFieldNumber',[f.m.string(text)]),0xffffffff,text);
 for(const text of ['','+','-','.','1e','1e+','1,2','1 2','NaN','Infinity','0x10','1.2.3'])assert.equal(f.vm.invoke('proc:NativeFileText:IsFieldNumber',[f.m.string(text)]),0,text);
});
for(const optimization of [0,1,2])test(`Input field Windows fixture is deterministic O${optimization}`,()=>{
 const {project,checks}=nativeControlFixtures().find(f=>f.project.name==='AotControlInputFields'),a=compileWin32(project,{optimization});
 assert.deepEqual(a.bytes,compileWin32(project,{optimization}).bytes);assert.equal(checks.length,33);assert.ok(a.bytes.length<100*1024);
});
