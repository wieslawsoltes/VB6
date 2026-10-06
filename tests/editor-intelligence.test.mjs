import test from 'node:test';import assert from 'node:assert/strict';
import {EditorIntelligence,scanDeclarations,maskSource,splitArguments,callContext} from '../src/editor/intelligence.js';
const main={id:'m',name:'Main',kind:'module',code:`Option Explicit
Private book As Counter
Public Const Greeting = "Hello"
Public Sub Run(ByVal input As String, Optional count As Long = 2)
    Dim book As String, numbers() As Long
    Debug.Print input
End Sub
Public Sub Other()
End Sub`};
const counter={id:'c',name:'Counter',kind:'class',code:'Private secret As Long\nPublic value As Long\nPublic Function Add(ByVal amount As Long) As Long\nEnd Function\nPrivate Sub Hidden()\nEnd Sub'};
const project={name:'Test',modules:[main,counter]};
test('declaration index handles locals, parameters, arrays and public members',()=>{const i=scanDeclarations(main);assert.equal(i.procedures.length,2);assert.equal(i.procedures[0].end,7);assert.equal(i.symbols.find(s=>s.name==='numbers').array,true);assert.equal(i.symbols.find(s=>s.name==='count').optional,true);});
test('member completion honors local shadowing and private class members',()=>{const s=new EditorIntelligence();assert.equal(s.completions(project,main,5,'book.',5).items.length,0);assert.deepEqual(s.completions(project,main,9,'book.',5).items.map(x=>x.name),['Add','value']);});
test('intelligence reuses unchanged module declaration scans',()=>{const s=new EditorIntelligence();s.resolve(project,main,9,'book.Add');const before=s.scanCount;s.resolve(project,main,9,'book.value');assert.equal(s.scanCount,before);const edited={...counter,code:counter.code+'\nPublic newField As String'};s.resolve({...project,modules:[main,edited]},main,9,'book.newField');assert.equal(s.scanCount,before+1);});
test('constants list is deterministic, unique and prefix filtered',()=>{const s=new EditorIntelligence();const a=s.completions(project,main,9,'vbCr',4,{constants:true});assert.deepEqual(a.items.map(i=>i.name),['vbCr','vbCritical','vbCrLf']);assert.deepEqual(s.completions(project,main,9,'Gree',4,{constants:true}).items.map(i=>i.name),['Greeting']);});
test('strings and apostrophe comments do not produce completions',()=>{const s=new EditorIntelligence();for(const text of ['"book','\'book'])assert.equal(s.completions(project,main,9,text,text.length).items.length,0);});
test('nested call context ignores commas in literals and inner functions',()=>{const t='x = Replace("a,b", Mid("xyz", 2), ';assert.equal(callContext(t,t.length).name,'Replace');assert.equal(callContext(t,t.length).comma,2);const n='x = Replace("a,b", Mid("xyz", ';assert.equal(callContext(n,n.length).name,'Mid');assert.equal(callContext(n,n.length,{outer:true}).name,'Replace');});
test('parameter info supports named parameters and multiline continuation',()=>{const s=new EditorIntelligence(),t='x = DateDiff("d", _\n    date2:=Now';const info=s.parameterInfo(project,main,9,t,t.length);assert.equal(info.name,'DateDiff');assert.equal(info.active,2);});
test('unparenthesized Sub calls show argument context',()=>{assert.equal(callContext('Call Hello first, second',24).comma,1);assert.equal(callContext('Hello "x,y", ',13).comma,1);});
test('masking and split preserve quoted commas, nested calls and comments',()=>{assert.deepEqual(splitArguments('Optional s As String = "x,y", values(1, 2), ByRef n As Long'),['Optional s As String = "x,y"','values(1, 2)','ByRef n As Long']);assert.equal(maskSource('Rem x\n"a" & b'), '     \n    & b');});
test('type and enum declarations expose correct typed members',()=>{const module={id:'r',name:'Records',kind:'module',code:'Public Type Point\n X As Long\n Y As Double\nEnd Type\nPublic Enum Direction\n North = 1\n South = 2\nEnd Enum\nPrivate p As Point'};const s=new EditorIntelligence(),p={modules:[module]};assert.deepEqual(s.completions(p,module,9,'p.',2).items.map(x=>x.name),['X','Y']);assert.ok(s.completions(p,module,9,'Nor',3,{constants:true}).items.some(x=>x.name==='North'));});
test('typed browser controls expose implemented properties, not unrelated control fields',()=>{const module={id:'f',name:'Form1',kind:'form',code:'',form:{controls:[{name:'Text1',type:'TextBox',properties:{}}]}};const s=new EditorIntelligence(),items=s.completions({modules:[module]},module,1,'Text1.',6).items.map(x=>x.name);assert.ok(items.includes('SelStart'));assert.ok(items.includes('SetFocus'));assert.ok(!items.includes('Nodes'));});

test('completion reflects in-place control rename/type/index changes',()=>{
 const c={name:'OldName',type:'TextBox',properties:{}},m={id:'M',name:'M',kind:'form',code:'Sub Test()\nEnd Sub',form:{controls:[c]}},p={modules:[m]},i=new EditorIntelligence();
 assert.ok(i.resolve(p,m,2,'OldName'));c.name='NewName';assert.equal(i.resolve(p,m,2,'OldName'),null);assert.ok(i.resolve(p,m,2,'NewName'));
 c.type='ListBox';assert.equal(i.resolve(p,m,2,'NewName').type,'ListBox');c.properties.Index=0;assert.equal(i.resolve(p,m,2,'NewName').array,true);
});
test('List Constants excludes locals owned by another procedure',()=>{
 const m={id:'M',name:'M',kind:'module',code:'Sub A()\nConst A_ONLY = 1\nEnd Sub\nSub B()\nConst B_ONLY = 2\nEnd Sub'},p={modules:[m]},i=new EditorIntelligence();
 const names=i.completions(p,m,5,'',0,{constants:true}).items.map(s=>s.name);assert.ok(names.includes('B_ONLY'));assert.ok(!names.includes('A_ONLY'));
});
