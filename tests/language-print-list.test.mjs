import test from 'node:test';
import assert from 'node:assert/strict';
import {splitPrintList} from '../src/language/print-list.js';
import {parseNativePrintList} from '../src/native/print.js';
import {parseFileStatement} from '../src/language/statement-headers.js';
import {compileModule} from '../src/language/compiler.js';
for(const text of [''," ' empty",'Rem empty'])test('empty Print image has a newline: '+text,()=>{
  assert.deepEqual(splitPrintList(text),{parts:[],newline:true});
});
for(const [source,newline,count]of [['"a";"b"',true,2],['"a";"b";',false,2],['"a","b",',false,2],[';,,',false,3],['Spc(2) "value" Tab(7);',false,3],['"a" "b"',true,2]])test('Print separators and whitespace expressions: '+source,()=>{
  const parts=splitPrintList(source);assert.equal(parts.newline,newline);assert.equal(parts.parts.length,count);
});
test('Print lexer preserves strings, escapes, Unicode names, dates and nested/named arguments',()=>{
  const text='"a;b,";[a;b]; Żółć; Format$(expression:=#2/29/2024#,format:="yyyy;mm"); F(1,2),';
  const split=splitPrintList(text);
  assert.deepEqual(split.parts.map(p=>p.text),['"a;b,"','[a;b]','Żółć','Format$(expression:=#2/29/2024#,format:="yyyy;mm")','F(1,2)']);
  assert.equal(split.newline,false);
});
test('source file and Debug.Print IR preserve outputlist while retaining parsed expressions',()=>{
  const raw='"x,y;"; Spc(2) "z", Tab(6);';
  const f=parseFileStatement('Print #H(1,2), '+raw);
  assert.equal(f.handle.args.length,2);assert.equal(f.exprs.length,4);assert.equal(f.outputList,raw);assert.equal(f.newline,false);
  const m=compileModule({name:'M',kind:'module',code:'Sub Main\nDebug.Print '+raw+'\nEnd Sub'});
  const ins=m.procedures.get('main').code.find(i=>i.op==='print');assert.equal(ins.outputList,raw);assert.equal(ins.exprs.length,4);assert.equal(ins.newline,false);
});
test('positioning operators preserve their own argument AST and print-zone commas',()=>{
  const p=parseNativePrintList('"A";Spc(F(1,2)) "B",Tab(7); Tab;');
  assert.deepEqual(p.items.map(i=>i.kind),['value','spc','value','tab','tab','tab']);assert.equal(p.items[1].expr.args.length,2);assert.equal(p.newline,false);
});
for(const text of ['Spc','Spc()','Spc(1,2)','Tab(1,2)','Tab(n:=1)','"a""b" x(', 'F(1,2'])test('invalid Print expressions do not silently produce an image: '+text,()=>{
  assert.throws(()=>parseNativePrintList(text));
});
