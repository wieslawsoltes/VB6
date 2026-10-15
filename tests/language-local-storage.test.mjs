import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {run,main,module,project,pause,finish} from './helpers/compiler-runtime.mjs';

for(const [type,expected] of [['Long','0 Long'],['Integer','0 Integer'],['Double','0 Double'],['String',' String'],['Boolean','False Boolean'],['Variant',' Empty']])test('skipped Dim creates procedure storage: '+type,async()=>{
 const r=await run(main('If False Then\nDim value As '+type+'\nEnd If\nDebug.Print value, TypeName(value)'));
 assert.deepEqual(r.output,[expected]);
});
test('a skipped local declaration cannot redirect writes into a module variable',async()=>{
 const r=await run('Public value As Long\nSub Main()\nvalue = 99\nWork\nDebug.Print value\nEnd Sub\nSub Work()\nIf False Then\nDim value As Long\nEnd If\nvalue = 7\nDebug.Print value\nEnd Sub');
 assert.deepEqual(r.output,['7','99']);
});
test('GoTo over a declaration leaves its initialized local available',async()=>{
 const r=await run(main('GoTo after\nDim value As Long\nafter:\nDebug.Print value\nvalue = 7\nDebug.Print value'));
 assert.deepEqual(r.output,['0','7']);
});
test('zero-iteration loops still declare their local variables',async()=>{
 const r=await run(main('Dim i As Long\nFor i = 1 To 0\nDim value As Integer\nNext\nDebug.Print value, TypeName(value)'));
 assert.deepEqual(r.output,['0 Integer']);
});
test('unselected Select cases still declare local variables',async()=>{
 const r=await run(main('Select Case 1\nCase 2\nDim value As Long\nCase Else\nEnd Select\nDebug.Print value'));
 assert.deepEqual(r.output,['0']);
});
test('skipped local fixed arrays use already-bound dimensions and tags',async()=>{
 const r=await run('Option Base 1\nSub Main()\nIf False Then\nDim a(Size) As Long\nEnd If\nConst Size = 3\nDebug.Print LBound(a), UBound(a), a(1), TypeName(a(1))\nEnd Sub');
 assert.deepEqual(r.output,['1 3 0 Long']);
});
test('dynamic Dim arrays exist even in procedures with no ReDim instruction',async()=>{
 const r=await run(main('If False Then\nDim a() As Long\nEnd If\nDebug.Print IsArray(a), TypeName(a)\nOn Error Resume Next\nDebug.Print UBound(a)\nDebug.Print Err.Number'));
 assert.deepEqual(r.output,['True Long()','9']);
});
test('skipped qualified record declarations retain field defaults and nominal identity',async()=>{
 const r=await run(main('If False Then\nDim value As Types.Item\nEnd If\nDebug.Print value.Value, value.Link Is Nothing\nBump value\nDebug.Print value.Value')+'\nSub Bump(ByRef value As Types.Item)\nvalue.Value = 7\nEnd Sub',[module('Types','Public Type Item\nValue As Long\nLink As Object\nEnd Type')]);
 assert.deepEqual(r.output,['0 True','7']);
});
test('skipped As New declarations stay lazy until their first reference',async()=>{
 const r=await run('Public created As Long\n'+main('If False Then\nDim value As New Bag\nEnd If\nDebug.Print created\nvalue.Value = 7\nDebug.Print created, value.Value'),[module('Bag','Public Value As Long\nPrivate Sub Class_Initialize()\nM.created = M.created + 1\nEnd Sub','class')]);
 assert.deepEqual(r.output,['0','1 7']);
});
test('unused skipped As New declarations never invoke their constructors',async()=>{
 const r=await run('Public created As Long\n'+main('If False Then\nDim value As New Bag\nEnd If\nDebug.Print created'),[module('Bag','Private Sub Class_Initialize()\nM.created = M.created + 1\nEnd Sub','class')]);
 assert.deepEqual(r.output,['0']);
});
test('local constants shadow module storage despite a skipped declaration',async()=>{
 const r=await run('Private Size As Long\nSub Main()\nSize = 99\nWork\nDebug.Print Size\nEnd Sub\nSub Work()\nIf False Then\nConst Size = 7\nEnd If\nDebug.Print Size\nOn Error Resume Next\nSize = 12\nDebug.Print Err.Number\nEnd Sub',[],{expectedCompileDiagnostics:[{"code": "VB_CONSTANT_ASSIGNMENT", "source": "M", "line": 13, "message": "Cannot assign to constant: Size"}]});
 assert.deepEqual(r.output,['7','500','99']);
});
test('ByRef calls use a skipped declaration rather than a new implicit Variant',async()=>{
 const r=await run(main('If False Then\nDim value As Long\nEnd If\nBump value\nDebug.Print value')+'\nSub Bump(ByRef value As Long)\nvalue = value + 1\nEnd Sub');
 assert.deepEqual(r.output,['1']);
});
test('skipped Static locals preserve their values between calls',async()=>{
 const r=await run('Sub Main()\nWork\nWork\nEnd Sub\nSub Work()\nIf False Then\nStatic value As Long\nEnd If\nvalue = value + 1\nDebug.Print value\nEnd Sub');
 assert.deepEqual(r.output,['1','2']);
});
test('Dim locals in Static procedures retain values even when declarations are skipped',async()=>{
 const r=await run('Sub Main()\nWork\nWork\nEnd Sub\nStatic Sub Work()\nIf False Then\nDim value As Long\nEnd If\nvalue = value + 1\nDebug.Print value\nEnd Sub');
 assert.deepEqual(r.output,['1','2']);
});
test('class Static locals remain independent per object instance',async()=>{
 const r=await run(main('Dim a As New Counter, b As New Counter\na.Work\na.Work\nb.Work'),[module('Counter','Public Sub Work()\nIf False Then\nStatic value As Long\nEnd If\nvalue = value + 1\nDebug.Print value\nEnd Sub','class')]);
 assert.deepEqual(r.output,['1','2','1']);
});
test('recursive invocations do not share procedure-local cells',async()=>{
 const r=await run('Sub Main()\nVisit 2\nEnd Sub\nSub Visit(ByVal depth As Long)\nIf False Then\nDim value As Long\nEnd If\nvalue = depth\nIf depth > 0 Then Visit depth - 1\nDebug.Print value\nEnd Sub');
 assert.deepEqual(r.output,['0','1','2']);
});
test('reencountering Dim in a loop does not reset the initialized local',async()=>{
 const r=await run(main('Dim i As Long\nFor i = 1 To 3\nDim value As Long\nvalue = value + 1\nNext\nDebug.Print value'));
 assert.deepEqual(r.output,['3']);
});
test('normal and error-handling paths share the same local storage',async()=>{
 const r=await run(main('On Error GoTo handler\nIf False Then\nDim value As Long\nEnd If\nErr.Raise 5\nfinished:\nDebug.Print value\nExit Sub\nhandler:\nvalue = 7\nResume finished'));
 assert.deepEqual(r.output,['7']);
});
test('local allocation failures propagate to the caller before procedure-body side effects',async()=>{
 const r=await run('Sub Main()\nOn Error Resume Next\nWork\nDebug.Print Err.Number\nEnd Sub\nSub Work()\nOn Error Resume Next\nDebug.Print "body must not run"\nIf False Then\nDim values(1000000) As Byte\nEnd If\nEnd Sub');
 assert.deepEqual(r.output,['7']);
});
test('parameter binding errors precede local allocation',async()=>{
 const r=await run(main('Dim bad As String\nOn Error Resume Next\nWork bad\nDebug.Print Err.Number')+'\nSub Work(ByRef value As Long)\nDim values(1000000) As Byte\nEnd Sub');
 assert.deepEqual(r.output,['13']);
});
test('fixed and implicit dynamic declarations allocate once per invocation',async()=>{
 const p=compileProject(project(main('Dim fixed(2) As Long\nReDim dynamic(2) As Long\nDim i As Long\nFor i = 1 To 2\nDim value As Long\nvalue = value + 1\nNext\nDebug.Print value, UBound(dynamic)')));
 assert.deepEqual(p.diagnostics,[]);const output=[],vm=new VirtualMachine(p,{print:s=>output.push(s)}),declare=vm.declare.bind(vm);const calls=new Map();
 vm.declare=(d,...args)=>{calls.set(d.name,(calls.get(d.name)||0)+1);return declare(d,...args);};
 await vm.start();assert.deepEqual(output,['2 2']);
 assert.equal(calls.get('fixed'),1);assert.equal(calls.get('dynamic'),1);assert.equal(calls.get('value'),1);
});
test('debugger sees skipped locals before the first executable statement',async()=>{
 const p=await pause(main('If False Then\nDim value As Long\nEnd If\nDebug.Print value'),3);
 try{assert.equal(await p.vm.evaluateWatch('value'),0);assert.ok(p.vm.locals().some(v=>v.name==='value'&&v.type==='Long'));}
 finally{await finish(p);}
 assert.deepEqual(p.output,['0']);
});
test('inactive procedure edits invalidate cached declaration plans',async()=>{
 const code='Sub Main()\nWork\nDebug.Print "pause"\nWork\nEnd Sub\nSub Work()\nIf False Then\nDim value As Long\nEnd If\nDebug.Print value\nEnd Sub';
 const p=await pause(code,3);
 try{const next=structuredClone(p.project);next.modules[0].code=code.replace('Dim value As Long','Dim value As String');p.vm.applyEdits(next);}
 finally{await finish(p);}
 assert.deepEqual(p.output,['0','pause','']);
});
test('nonclassic initialized-Dim extension retains its existing statement-time effects',async()=>{
 const r=await run('Dim calls As Long\nFunction Value() As Long\ncalls = calls + 1\nValue = 7\nEnd Function\n'+main('Debug.Print calls\nDim value As Long = Value()\nDebug.Print value, calls'));
 assert.deepEqual(r.output,['0','7 1']);
});

test('single-line conditional declarations do not create block scope',async()=>{
 assert.deepEqual((await run(main('If False Then Dim value As Long\nDebug.Print value'))).output,['0']);
});
test('declaration plans contain metadata, reuse unchanged code and follow binding replacement',async()=>{
 const {procedureLocalDeclarations}=await import('../src/runtime/local-storage.js');
 const d={name:'a',bounds:[],initial:null},implicit={name:'b',bounds:[],initial:null};
 const p={code:[{op:'dim',decls:[d],static:true}],redimDeclarations:[d,implicit]};
 const first=procedureLocalDeclarations(p);assert.equal(first.length,2);assert.equal(first[0].decl,d);assert.equal(first[0].static,true);
 assert.ok(Object.isFrozen(first)&&Object.isFrozen(first[0]));assert.equal(procedureLocalDeclarations(p),first);
 d.boundValues=[[0,3]];assert.equal(procedureLocalDeclarations(p)[0].decl.boundValues,d.boundValues);
 p.redimDeclarations=[];assert.notEqual(procedureLocalDeclarations(p),first);assert.equal(procedureLocalDeclarations(p).length,1);
 p.code=[];assert.equal(procedureLocalDeclarations(p).length,0);
});
test('procedure-local arrays preserve independent ownership across recursive calls',async()=>{
 const r=await run('Sub Main()\nVisit 2\nEnd Sub\nSub Visit(ByVal depth As Long)\nIf False Then\nDim a(1) As Long\nEnd If\na(0) = depth\nIf depth > 0 Then Visit depth - 1\nDebug.Print a(0)\nEnd Sub');
 assert.deepEqual(r.output,['0','1','2']);
});
test('property invocations create their own skipped local storage',async()=>{
 const r=await run(main('Dim counter As New Counter\nDebug.Print counter.NextValue, counter.NextValue'),[module('Counter','Public Property Get NextValue() As Long\nIf False Then\nDim value As Long\nStatic count As Long\nEnd If\ncount = count + 1\nvalue = count\nNextValue = value\nEnd Property','class')]);
 assert.deepEqual(r.output,['1 2']);
});
test('fixed-string skipped locals support Mid assignment with their declared length',async()=>{
 assert.deepEqual((await run(main('If False Then\nDim text As String * 4\nEnd If\nMid$(text, 2, 2) = "Hi"\nDebug.Print text, Len(text)'))).output,[' Hi  4']);
});
test('normal completion and an escaping error both discard nonstatic local values',async()=>{
 const r=await run('Sub Main()\nOn Error Resume Next\nWork\nWork\nEnd Sub\nSub Work()\nIf False Then\nDim count As Long\nEnd If\ncount = count + 1\nDebug.Print count\nErr.Raise 5\nEnd Sub');
 assert.deepEqual(r.output,['1','1']);
});
