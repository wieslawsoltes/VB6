import test from 'node:test';
import assert from 'node:assert/strict';
import {compileModule,compileProject} from '../src/language/compiler.js';
import {preprocess} from '../src/language/conditional.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {VBError} from '../src/language/errors.js';

const project=(body)=>({name:'ControlFlow',startup:'Sub Main',modules:[{name:'M',kind:'module',code:`Sub Main()\n${body}\nEnd Sub`}]});
async function run(body){const p=compileProject(project(body));assert.deepEqual(p.diagnostics,[]);const output=[],vm=new VirtualMachine(p,{print:s=>output.push(s)});await vm.start();return {output,vm};}
for(const [condition,expected] of [
  ['" Then " = " Then "','yes'],
  ['"x Then y" <> "x Then y"','no'],
  ['InStr("Then", "hen") = 2','yes'],
])test('If header ignores keywords in expressions: '+condition,async()=>assert.deepEqual((await run(`If ${condition} Then Debug.Print "yes" Else Debug.Print "no"`)).output,[expected]));
for(const [a,b,expected] of [[true,true,'inner yes'],[true,false,'inner no'],[false,true,'outer no'],[false,false,'outer no']])
  test(`nested inline If binds each Else: ${a}/${b}`,async()=>assert.deepEqual((await run(`If ${a} Then If ${b} Then Debug.Print "inner yes" Else Debug.Print "inner no" Else Debug.Print "outer no"`)).output,[expected]));
for(const [a,b,expected] of [[true,true,['prefix','inner yes','tail']],[true,false,['prefix','inner no','no tail']],[false,true,['outer no']]])
  test(`nested inline If retains colon sequences: ${a}/${b}`,async()=>assert.deepEqual((await run(`If ${a} Then Debug.Print "prefix": If ${b} Then Debug.Print "inner yes": Debug.Print "tail" Else Debug.Print "inner no": Debug.Print "no tail" Else Debug.Print "outer no"`)).output,expected));
test('Else inside a quoted string is not a branch',async()=>assert.deepEqual((await run('If True Then Debug.Print "Then Else: Else" Else Debug.Print "bad"')).output,['Then Else: Else']));
test('escaped Then variable remains an expression',async()=>assert.deepEqual((await run('Dim [Then] As Boolean\n[Then] = True\nIf [Then] Then Debug.Print "ok"')).output,['ok']));
test('ElseIf condition can contain Then text',async()=>assert.deepEqual((await run('If False Then\nDebug.Print "bad"\nElseIf "x Then y" = "x Then y" Then\nDebug.Print "ok"\nEnd If')).output,['ok']));
test('Select Case value can contain To text',async()=>assert.deepEqual((await run('Select Case "a To z"\nCase "a To z"\nDebug.Print "ok"\nCase Else\nDebug.Print "bad"\nEnd Select')).output,['ok']));
test('Select Case range can contain To in either bound',async()=>assert.deepEqual((await run('Select Case "b To x"\nCase "a To x" To "c To x"\nDebug.Print "ok"\nEnd Select')).output,['ok']));
for(const [body,pattern] of [
  ['If True Then\nElse\nElse\nEnd If',/Duplicate Else/],
  ['If True Then\nElse\nElseIf True Then\nEnd If',/ElseIf cannot follow Else/],
  ['Do While True\nLoop Until True',/Do and Loop cannot both/],
  ['Select Case 1\nCase Else\nCase 1\nEnd Select',/Case cannot follow/],
  ['Exit Function',/does not match/],
  ['Exit Property',/does not match/],
  ['If True Then If False Then',/block statement/i],
  ['FileCopy "one"',/requires source and destination/],
  ['Name "name As old"',/Expected As/],
])test('invalid block syntax is a VB error: '+body.replaceAll('\n',' / '),()=>{
  assert.throws(()=>compileModule(project(body).modules[0]),e=>e instanceof VBError&&e.number===1002&&pattern.test(e.message)&&e.source==='M'&&e.line>0);
});
test('FileCopy and Name preserve delimiters inside strings and calls',async()=>{
  const {vm}=await run('Open "a,b As c.txt" For Output As #1\nPrint #1, "payload"\nClose #1\nFileCopy "a,b As c.txt", Left$("d,e As f.txt!!!", 12)\nName "d,e As f.txt" As "renamed As x.txt"');
  assert.equal(vm.fs.read('/renamed As x.txt'),'payload\r\n');
});
test('multiple file handles cannot be mistaken for a date',async()=>{
  const {vm}=await run('Open "a.txt" For Output As #1\nOpen "b.txt" For Output As #2\nClose #1, #2');
  assert.equal(vm.fs.handles.size,0);
});
test('inline sequence points stay on the correct physical source line',()=>{
  const m=compileModule({name:'M',code:'Sub Main()\nIf "Then" = "Then" Then Debug.Print "yes" Else Debug.Print "no"\nEnd Sub'});
  const points=m.procedures.get('main').code.filter(i=>i.sequencePoint);assert.equal(points.length,3);
  assert.deepEqual(points.map(p=>p.line),[2,2,2]);assert.ok(points.every(p=>p.column>0&&p.endColumn>p.column));assert.ok(points[1].column<points[2].column);
});
for(const [condition,enabled] of [
  ['"ALPHA" = "alpha"',true],['"a Then b" = "A THEN B"',true],
  ['"don\'t" = "DON\'T"',true],['2 ^ 3 ^ 2 = 64',true],
  ['1.0001@ > 1.0000@',true],['#1/2/2000# > #1/1/2000#',true],
  ['-32768% < 0',true],['UNKNOWN_FEATURE',false],['Empty = 0',true],
])test('conditional expression semantics: '+condition,()=>{
  const result=preprocess(`#If ${condition} Then ' comment\nyes\n#Else\nno\n#End If`);
  assert.equal(result.split('\n')[1],enabled?'yes':'');assert.equal(result.split('\n')[3],enabled?'':'no');assert.equal(result.split('\n').length,5);
});
test('conditional constants preserve quotes, dates and Currency without rounding',()=>{
  const source=`#Const Label = "don't Then"
#Const Price = 922337203685477.5807@
#Const Day = #1/2/2000#
#If Label = "DON'T THEN" And Price > 922337203685477.5806@ And Day > #1/1/2000# Then
chosen
#End If`;
  assert.equal(preprocess(source).split('\n')[4],'chosen');
});
for(const source of ['#If False Then\n#If InvalidCall() Then\n#End If\n#End If','#If True Then\n#ElseIf InvalidCall() Then\n#End If'])
  test('excluded conditional expressions still diagnose calls',()=>assert.throws(()=>preprocess(source,{},'Flags'),e=>e.number===1002&&e.source==='Flags'&&e.line===2));
test('conditional directives reject trailing inline source and preserve error positions',()=>assert.throws(()=>preprocess('\n#If True Then Debug.Print 1',{},'Flags'),e=>e.number===1002&&e.source==='Flags'&&e.line===2));

test('Name assignment is not mistaken for a file rename',async()=>assert.deepEqual((await run('Dim name As String\nname = "customer As text"\nDebug.Print name')).output,['customer As text']));
