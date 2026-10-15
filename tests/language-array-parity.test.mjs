import test from 'node:test';
import assert from 'node:assert/strict';
import {VBArray,Cell,tagScalar,makeRecord} from '../src/runtime/values.js';
import {compileProject,validateCompiledModules} from '../src/language/compiler-core.js';
import {VirtualMachine} from '../src/runtime/vm.js';

function compile(code,extra=[]){return compileProject({name:'Arrays',startup:'Sub Main',modules:[{name:'M',kind:'module',code},...extra]});}
async function run(code,expected,extra=[],expectedError=null){
  const program=compile(code,extra);assert.deepEqual(program.diagnostics,[]);const output=[];
  const vm=new VirtualMachine(program,{print:s=>output.push(s)});await vm.start();
  assert.equal(vm.lastError?.number??null,expectedError);assert.deepEqual(output,expected);return {program,vm};
}
const main=body=>'Option Explicit\nSub Main()\n'+body+'\nEnd Sub';

test('ReDim can change a Variant-contained array type without Preserve',()=>run(main(`Dim a As Variant
ReDim a(1 To 2) As Long
a(1) = 7
Debug.Print TypeName(a), a(1)
ReDim a(-1 To 1) As String
Debug.Print TypeName(a), LBound(a), Len(a(-1))
a(-1) = "value"
ReDim Preserve a(-1 To 3)
Debug.Print a(-1), UBound(a), Len(a(3))`),['Long() 7','String() -1 0','value 3 0']));

test('ReDim Preserve type mismatch fails without changing the old array',()=>run(main(`Dim a As Variant
ReDim a(1) As Long
a(0) = 42
On Error Resume Next
ReDim Preserve a(2) As String
Debug.Print Err.Number, TypeName(a), UBound(a), a(0)`),['13 Long() 1 42'],[],13));

test('Implicit ReDim declares typed array storage under Option Explicit',()=>run(main(`Debug.Print IsArray(a)
ReDim a(1 To 2) As Long
a(1) = 9
ReDim Preserve a(1 To 4)
Debug.Print TypeName(a), a(1), a(4)`),['True','Long() 9 0']));

test('Implicit ReDim declarations are rebuilt on binder reuse and keep typed storage',()=>{
 const program=compile(main('ReDim a(2) As Long\nReDim a(3) As String'));
 assert.match(program.diagnostics.map(d=>d.message).join('\n'),/cannot change the element type/);
 const m=program.modules.get('m'),p=m.procedures.get('main');assert.equal(p.redimDeclarations.length,1);
 assert.deepEqual(validateCompiledModules(program.modules),program.diagnostics);
 assert.equal(p.redimDeclarations.length,1);
});

test('Later procedure declaration overrides declarative ReDim',()=>run(main(`ReDim a(2)
Dim a() As Long
Debug.Print TypeName(a), UBound(a)`),['Long() 2']));

test('A public module array is resolved before an implicit local ReDim',()=>run(main(`ReDim a(3)
a(3) = 11
Debug.Print TypeName(a), a(3)
Show`),['Long() 11','11'],[{name:'Shared',kind:'module',code:'Public a() As Long\nPublic Sub Show()\nDebug.Print a(3)\nEnd Sub'}]));

for(const statement of ['ReDim a','ReDim a()','ReDim a(1) = 2','ReDim a(1) As New Collection','ReDim WithEvents a(1) As Object'])test('ReDim rejects malformed declaration: '+statement,()=>{
 const result=compile(main(statement));assert.ok(result.diagnostics.length);assert.equal(result.diagnostics[0].number,1002);
});
for(const [decl,statement] of [
 ['Dim a() As Long','ReDim a(2) As String'],['Dim a(2) As Long','ReDim a(3)'],
 ['Dim a As Long','ReDim a(2)'],['Const a = 1','ReDim a(2)'],['Dim a As Variant','ReDim a(2) As String * 4']
])test('ReDim diagnoses incompatible declared storage: '+decl,()=>assert.ok(compile(main(decl+'\n'+statement)).diagnostics.length));

test('ParamArray cannot be redimensioned',()=>assert.ok(compile('Sub Main()\nEnd Sub\nSub F(ParamArray a())\nReDim a(2)\nEnd Sub').diagnostics.length));

test('ReDim on a non-array Variant reports VB type mismatch',()=>run(main(`Dim a As Variant
a = 12
On Error Resume Next
ReDim a(3)
Debug.Print Err.Number, a`),['13 12'],[],13));

test('A copied fixed array can be resized in a dynamic array without changing its source',()=>run(main(`Dim source(1) As Long, target() As Long
source(0) = 5
target = source
ReDim Preserve target(3)
target(0) = 7
Debug.Print source(0), target(0), UBound(source), UBound(target)`),['5 7 1 3']));

test('Typed array function returns own resizable storage, including direct ReDim of result',()=>run(`Option Explicit
Function MakeValues() As Long()
ReDim MakeValues(-1 To 1)
MakeValues(-1) = 17
End Function
Sub Main()
Dim a() As Long
a = MakeValues()
ReDim Preserve a(-1 To 4)
Debug.Print TypeName(a), LBound(a), a(-1), a(4)
End Sub`,['Long() -1 17 0']));

test('Typed array functions copy fixed local arrays and support empty defaults',()=>run(`Function MakeValues() As String()
Dim a(1 To 2) As String
a(1) = "hello"
MakeValues = a
End Function
Function EmptyValues() As Long()
End Function
Sub Main()
Dim a() As String, b() As Long
a = MakeValues()
b = EmptyValues()
Debug.Print a(1), IsArray(b), TypeName(b)
ReDim b(0)
Debug.Print b(0)
End Sub`,['hello True Long()','0']));

test('Typed array returns reject mismatched whole-array assignment',()=>run(`Function Bad() As Long()
Dim a(1) As String
Bad = a
End Function
Sub Main()
On Error Resume Next
Dim v As Variant
v = Bad()
Debug.Print Err.Number
End Sub`,['13'],[],13));

test('Grouped array parameters create typed temporaries instead of aliasing caller storage',()=>run(`Sub Change(a() As Long)
a(0) = 99
ReDim Preserve a(3)
End Sub
Sub Main()
Dim a(1) As Long
a(0) = 7
Change (a)
Debug.Print a(0), UBound(a)
End Sub`,['7 1']));

test('A temporary passed to a typed array parameter must really be an array of that type',()=>run(`Sub Change(a() As Long)
Debug.Print "incorrect"
End Sub
Sub Main()
On Error Resume Next
Change (5)
Debug.Print Err.Number
End Sub`,['13'],[],13));

for(const declaration of ['Function F() As Long(2)','Function F() As Long(,)','Sub F() As Long()','Property Let F(value As Long) As Long()'])test('Array return grammar rejects '+declaration,()=>assert.ok(compile(declaration+'\nEnd '+(declaration.startsWith('Function')?'Function':declaration.startsWith('Sub')?'Sub':'Property')).diagnostics.length));

test('Array return shape participates in interface matching',()=>{
 const extra=[{name:'IValues',kind:'class',code:'Public Function Values() As Long()\nEnd Function'},
 {name:'Values',kind:'class',code:'Implements IValues\nPrivate Function IValues_Values() As Long\nEnd Function'}];
 assert.match(compile(main(''),extra).diagnostics.map(d=>d.message).join('\n'),/Interface procedure declaration does not match/);
});

test('Array Property Get shape must match Property Let final parameter shape',()=>{
 const code='Public Property Get Values() As Long()\nEnd Property\nPublic Property Let Values(value As Long)\nEnd Property';
 assert.match(compile(main(''),[{name:'Box',kind:'class',code}]).diagnostics.map(d=>d.message).join('\n'),/Property Let value type/);
});

test('ReDim Preserve maps multidimensional retained rows without coercion or cloned records',()=>{
 const a=new VBArray([[-1,1],[2,3],[5,7]],'Variant');a.dynamic=true;
 let n=0;for(const indices of a.indices())a.set(indices,tagScalar(++n,n%2?'integer':'long',true));
 const before=[...a.indices()].map(indices=>({indices,value:a.get(...indices),tag:a.getScalar(...indices)}));
 a.getScalar=()=>{throw new Error('Preserve must not coerce retained elements');};
 a.indices=()=>{throw new Error('Preserve must not allocate element coordinates');};
 a.redim([[-1,1],[2,3],[5,9]],true);
 for(const item of before){assert.equal(a.get(...item.indices),item.value);assert.equal(a.scalarData[a.offset(item.indices)],item.tag);}
 assert.equal(a.get(-1,2,9),undefined);
 a.redim([[-1,1],[2,3],[5,6]],true);
 for(const item of before.filter(item=>item.indices[2]<=6))assert.equal(a.get(...item.indices),item.value);
});

test('ReDim Preserve retains record-field reference identity',()=>{
 const a=new VBArray([[0,1]],'Entry',()=>makeRecord('Entry',new Map([['Value',new Cell('Long',0)]])));a.dynamic=true;
 const record=a.get(0),cell=record.__fields.get('Value');cell.set(27);
 a.redim([[0,3]],true);assert.equal(a.get(0),record);cell.set(29);assert.equal(a.get(0).Value,29);
 assert.notEqual(a.get(2),a.get(3));assert.equal(a.get(3).Value,0);
});

test('Failed Preserve is atomic for bounds, data and tags',()=>{
 const a=VBArray.from([tagScalar(9,'long',true)]),data=a.data,bounds=a.bounds,tags=a.scalarData;
 for(const [next,number] of [[[[1,3]],9],[[[0,1000000]],7],[[[0,2147483648]],6]]){
  assert.throws(()=>a.redim(next,true),e=>e.number===number);assert.equal(a.data,data);assert.equal(a.bounds,bounds);assert.equal(a.scalarData,tags);
 }
});

test('Empty array Preserve, growth, shrinkage and Erase retain dynamic descriptor behavior',()=>{
 const a=VBArray.from([]);a.redim([[0,3]],true);assert.equal(a.data.length,4);a.erase();assert.deepEqual(a.bounds,[]);a.redim([[-2,1]],true);assert.equal(a.data.length,4);
});

test('Typed array return storage can be read in its own function and indexed by the caller',()=>run(`Function F() As Long()
ReDim F(1)
F(0) = 8
F(1) = F(0) + 2
End Function
Sub Main()
Debug.Print F(1)
End Sub`,['10']));

test('Typed UDT array results retain element factories through ReDim Preserve',()=>run(`Type Entry
Value As Long
Text As String * 3
End Type
Function Entries() As Entry()
ReDim Entries(0)
Entries(0).Value = 17
End Function
Sub Main()
Dim a() As Entry
a = Entries()
ReDim Preserve a(2)
Debug.Print a(0).Value, a(2).Value, Len(a(2).Text)
End Sub`,['17 0 3']));

test('Class arrays and class-array results initialize elements to Nothing',()=>run(`Function Boxes() As Box()
ReDim Boxes(1)
End Function
Sub Main()
Dim a() As Box, b(0) As Box
a = Boxes()
Debug.Print a(0) Is Nothing, b(0) Is Nothing
ReDim Preserve a(2)
Debug.Print a(2) Is Nothing
End Sub`,['True True','True'],[{name:'Box',kind:'class',code:'Public Value As Long'}]));

test('Typed array returns compile for compute while unsupported backend boundaries stay explicit',async()=>{
 const source='Function F() As Long()\nEnd Function\nSub Main()\nEnd Sub';
 const {compileCompute}=await import('../src/compute/index.js');
 const {compileWin32}=await import('../src/native/compiler.js');
 const {newProject}=await import('../src/project/model.js');
 const {convertVbNetProject,exportVbNetProject}=await import('../src/migration/index.js');
 for(const codeStyle of ['native','compatibility']){
  const project={...newProject('ArrayReturns'),startup:'Sub Main',modules:[{name:'M',kind:'module',code:source}]};
  const result=convertVbNetProject(project,{codeStyle});assert.equal(result.success,false);
  assert.ok(result.diagnostics.some(d=>d.code==='MIG_ARRAY_RETURN'&&d.source==='M'&&d.line===1));
  assert.match(result.files['Directory.Build.targets'],/RequireResolvedMigration/);
  assert.throws(()=>exportVbNetProject(project,{codeStyle}),/unresolved diagnostics/);
 }
 const artifact=compileCompute(source.replace('Sub Main()\nEnd Sub','Public values() As Long\nSub Main()\nvalues=F()\nEnd Sub'));
 assert.equal(artifact.target,'webgpu-compute');
 assert.ok(artifact.sources.some(p=>p.procedure==='F'));
 assert.match(artifact.wgsl,/array_copy_value/);
 assert.throws(()=>compileWin32({...newProject('ArrayReturns'),startup:'Sub Main',modules:[{name:'M',kind:'module',code:source}]}),/native array-return ABI is not implemented/);
});


test('ReDim early storage retains explicit Static array lifetime across calls',()=>run(`Sub Tick()
Static a() As Long
ReDim Preserve a(0)
a(0) = a(0) + 1
Debug.Print a(0)
End Sub
Sub Main()
Tick
Tick
End Sub`,['1','2']));
