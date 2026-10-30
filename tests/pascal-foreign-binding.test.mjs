import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {ProjectDiagnosticCache, diagnosticSnapshot} from '../src/language/diagnostics.js';
const vb = (name, code, kind = 'module') => ({name, code, kind, language: 'vb6'});
const project = (code, modules = []) => ({schema: 1, name: 'PascalForeign', language: 'pascal', startup: 'Sub Main', settings: {}, modules: [{name: 'Main', kind: 'module', language: 'pascal', code}, ...modules]});
async function execute(code, modules = []) {
  const source = project(code, modules), compiled = compileProject(source); assert.deepEqual(compiled.diagnostics, []);
  const output = [], vm = new VirtualMachine(compiled, {print: value => output.push(value)}); await vm.start();
  return {output, compiled, vm, source};
}
function invalid(code, modules, pattern) {
  const compiled = compileProject(project(code, modules)); assert.equal(compiled.valid, false); assert.match(compiled.diagnostics.map(value => value.message).join('\n'), pattern); return compiled;
}

test('Pascal binds VB public modules, constants, enums and nominal record fields using the shared declaration binder', async () => {
  const helper = vb('Helper', `Public Const Start As Long = 2
Public Const Finish As Long = Start + 1
Public Enum Shade
Red = 7
Blue
End Enum
Public Type Pair
X As Long
Values(Start To Finish) As Integer
End Type
Public Data As Pair
Public Items(Start To Finish) As Integer
Public Function Answer() As Integer
Answer = 42
End Function
Public Sub Fill(ByRef Value As Pair)
Value.X = 9
Value.Values(2) = 5
End Sub
Public Sub Bump(ByRef Values() As Integer)
Values(2) = Values(2) + 1
End Sub`);
  const result = await execute(`program Main;
const First = Helper.Start;
var Local: Helper.Pair;
begin Helper.Fill(Local); Helper.Items[First] := 10; Helper.Bump(Helper.Items);
WriteLn(Helper.Answer(), ':', Answer, ':', Local.X, ':', Local.Values[2], ':', Helper.Items(2), ':', Helper.Shade.Blue) end.`, [helper]);
  assert.deepEqual(result.output, ['42:42:9:5:11:8']);
});

test('VB Optional, ParamArray and ByRef arguments preserve source aliases and expression temporaries', async () => {
  const helper = vb('Helper', `Public Function Increment(ByRef Value As Integer, Optional ByVal Amount As Integer = 2) As Integer
Value = Value + Amount
Increment = Value
End Function
Public Function Total(ParamArray Values() As Variant) As Long
Dim I As Long
For I = LBound(Values) To UBound(Values)
Total = Total + Values(I)
Next I
End Function`);
  const {output} = await execute(`program Main; var N:Integer;
begin N:=5; WriteLn(Helper.Increment(N), ':', N); WriteLn(Helper.Increment((N), 3), ':', N); WriteLn(Helper.Increment(10)); WriteLn(Helper.Total(1, 2, 3)); WriteLn(Helper.Total) end.`, [helper]);
  assert.deepEqual(output, ['7:7', '10:7', '12', '6', '0']);
  invalid('program Main; var N:LongInt; begin Helper.Increment(N) end.', [helper], /ByRef parameter/);
  invalid('program Main; begin Helper.Increment end.', [helper], /expects/);
  invalid('program Main; begin Helper.Increment(1,2,3) end.', [helper], /expects/);
});

const counter = vb('Counter', `Public Value As Long
Private Hidden As Long
Private Storage(0 To 4) As Long
Private PeerValue As Counter
Public Sub Store(ByVal NextValue As Long)
Value = NextValue
End Sub
Public Property Get Entry(ByVal Index As Long) As Long
Entry = Storage(Index)
End Property
Public Property Let Entry(ByVal Index As Long, ByVal NextValue As Long)
Storage(Index) = NextValue
End Property
Public Property Get Peer() As Counter
Set Peer = PeerValue
End Property
Public Property Set Peer(ByVal NextValue As Counter)
Set PeerValue = NextValue
End Property
Public Property Get ReadOnly() As Long
ReadOnly = Value
End Property
Public Property Let WriteOnly(ByVal NextValue As Long)
Value = NextValue
End Property`, 'class');
const factory = vb('Factory', `Public Current As Counter
Public Original As Counter
Public Function Make() As Counter
Set Make = New Counter
End Function
Public Sub Setup()
Set Current = New Counter
Set Original = Current
End Sub
Public Function GetCurrent() As Counter
Set GetCurrent = Current
End Function`);

test('Pascal preserves typed factory results and VB Property Get/Let/Set including indexed properties', async () => {
  const {output} = await execute(`program Main; var A,B:Counter;
begin A:=Factory.Make; B:=Factory.Make; A.Entry(2):=12; B.Value:=9; A.Peer:=B; A.WriteOnly:=4;
WriteLn(A.Entry(2), ':', A.Peer.Value, ':', A.ReadOnly); A.Peer:=nil end.`, [counter, factory]);
  assert.deepEqual(output, ['12:9:4']);
  invalid('program Main; var A:Counter; begin A:=Factory.Make; A.ReadOnly:=1 end.', [counter, factory], /read-only/);
  invalid('program Main; var A:Counter; begin A:=Factory.Make; WriteLn(A.WriteOnly) end.', [counter, factory], /write-only/);
  invalid('program Main; var A:Counter; begin A:=Factory.Make; A.Entry:=1 end.', [counter, factory], /expects/);
  invalid('program Main; var A:Counter; begin A:=Factory.Make; A.Peer:=1 end.', [counter, factory], /assign|Property Let/i);
});

test('foreign call and ByRef field receivers are fixed before later arguments replace the receiver', async () => {
  const helper = vb('Helper', `Public Sub Put(ByRef Value As Long, ByVal NextValue As Long)
Value = NextValue
End Sub`);
  const {output} = await execute(`program Main;
function Replace:LongInt;
begin Factory.Current:=Factory.Make; Replace:=7 end;
begin
Factory.Setup; Factory.Current.Store(Replace); WriteLn(Factory.Original.Value, ':', Factory.Current.Value);
Factory.Setup; Factory.GetCurrent.Store(Replace); WriteLn(Factory.Original.Value, ':', Factory.Current.Value);
Factory.Setup; Helper.Put(Factory.Current.Value, Replace); WriteLn(Factory.Original.Value, ':', Factory.Current.Value)
end.`, [counter, factory, helper]);
  assert.deepEqual(output, ['7:0', '7:0', '7:0']);
});

test('mixed VB WithEvents sinks invoke authored Pascal callbacks with synchronous ByRef values', async () => {
  const emitter = vb('Emitter', `Public Event Changing(ByRef Value As Long)
Public Function Fire() As Long
Dim N As Long
N = 4
RaiseEvent Changing(N)
Fire = N
End Function`, 'class');
  const sink = vb('Listener', `Public WithEvents Source As Emitter
Public Offset As Long
Private Sub Source_Changing(ByRef Value As Long)
Main.Adjust Value, Offset
End Sub`, 'class');
  const make = vb('Events', `Public Function NewEmitter() As Emitter
Set NewEmitter = New Emitter
End Function
Public Function NewListener() As Listener
Set NewListener = New Listener
End Function`);
  const {output} = await execute(`program Main; var E:Emitter; A,B:Listener; Calls:Integer;
procedure Adjust(var Value:LongInt; Offset:LongInt); begin Inc(Calls); Value:=Value+Offset end;
begin E:=Events.NewEmitter; A:=Events.NewListener; B:=Events.NewListener; A.Offset:=2; B.Offset:=3;
A.Source:=E; B.Source:=E; WriteLn(E.Fire); A.Source:=nil; WriteLn(E.Fire); WriteLn(Calls) end.`, [emitter, sink, make]);
  assert.deepEqual(output, ['9', '7', '3']);
});

test('Pascal rejects missing/private VB members and incompatible nominal arrays before execution', () => {
  const helper = vb('Helper', 'Private Secret As Integer\nPublic Sub NoResult()\nEnd Sub');
  invalid('program Main; begin WriteLn(Helper.Missing) end.', [helper], /not exported/);
  invalid('program Main; begin WriteLn(Helper.Secret) end.', [helper], /not exported/);
  invalid('program Main; begin WriteLn(Helper.NoResult()) end.', [helper], /does not return/);
  invalid('program Main; var A:Counter; begin A.Hidden:=1 end.', [counter], /not exported/);
  invalid('program Main; var A:Counter; begin A.Missing:=1 end.', [counter], /not exported/);
  const foo = vb('Foo', 'Public Type TItem\nX As Long\nEnd Type\nPublic Sub Accept(ByRef Value() As TItem)\nValue(0).X=1\nEnd Sub');
  const bar = vb('Bar', 'Public Type TItem\nX As Long\nEnd Type\nPublic Items(0 To 0) As TItem');
  invalid('program Main; begin Foo.Accept(Bar.Items) end.', [foo, bar], /ByRef parameter/);
});

test('editing a foreign public signature invalidates Pascal diagnostics without caching stale bindings', () => {
  const source = project('program Main; var N:Integer; begin Helper.Increment(N) end.', [vb('Helper', 'Public Sub Increment(ByRef Value As Integer)\nValue=Value+1\nEnd Sub')]);
  const cache = new ProjectDiagnosticCache(); assert.equal(cache.check(diagnosticSnapshot(source)).valid, true);
  source.modules[1].code = 'Public Sub Increment(ByRef Value As Long)\nValue=Value+1\nEnd Sub';
  const changed = cache.check(diagnosticSnapshot(source)); assert.equal(changed.valid, false); assert.match(changed.diagnostics.map(value => value.message).join('\n'), /ByRef parameter/);
});

for (const language of ['vb6', 'pascal']) test('Pascal accesses the '+language+' form default instance, shared methods, nested menus and sparse control arrays', async () => {
  const {ControlArray} = await import('../src/controls/collections.js');
  const buttons = new ControlArray(); buttons.items.set(2, {Caption: ''}); buttons.items.set(7, {Caption: ''});
  const widget = {Caption: '', Button1: {Caption: ''}, Buttons: buttons, OpenMenu: {Caption: ''}, Show() {this.Shown = true;}};
  widget.controlMap = new Map([['Button1', widget.Button1], ['Buttons', buttons], ['OpenMenu', widget.OpenMenu]]);
  const form = {name: 'Form1', kind: 'form', language, code: language === 'pascal' ? 'unit Form1; interface implementation procedure Hidden; begin end; end.' : 'Private Sub Hidden()\nEnd Sub',
    form: {name: 'Form1', type: 'Form', properties: {Caption: 'Before'}, controls: [{name: 'Button1', type: 'CommandButton', properties: {}}, ...[2,7].map(index => ({name: 'Buttons', type: 'CommandButton', properties: {Index: index}}))], menus: [{name: 'FileMenu', type: 'Menu', properties: {}, items: [{name: 'OpenMenu', properties: {Caption: 'Open'}}]}]}};
  const main = `program Main; ${language === 'pascal' ? 'uses Form1;' : ''} begin
Form1.Caption:='hello'; Form1.Button1.Caption:='button'; Form1.Buttons[2].Caption:='two'; Form1.Buttons(7).Caption:='seven'; Form1.OpenMenu.Caption:='open';
WriteLn(Low(Form1.Buttons), ':', High(Form1.Buttons)); Form1.Show end.`;
  const compiled = compileProject(project(main, [form])); assert.deepEqual(compiled.diagnostics, []);
  const output = []; await new VirtualMachine(compiled, {print: value => output.push(value), createForm: () => widget}).start();
  assert.equal(widget.Caption, 'hello'); assert.equal(widget.Button1.Caption, 'button'); assert.equal(buttons.Item(2).Caption, 'two'); assert.equal(buttons.Item(7).Caption, 'seven'); assert.equal(widget.OpenMenu.Caption, 'open'); assert.equal(widget.Shown, true); assert.deepEqual(output, ['2:7']);
  invalid(`program Main; ${language === 'pascal' ? 'uses Form1;' : ''} begin Form1.Hidden end.`, [form], /not exported/);
});

test('foreign array results retain runtime bounds and nominal record arrays share only the declared type', async () => {
  const helper = vb('Helper', `Public Function Values() As Long()
Dim Result(-2 To -1) As Long
Result(-2) = 17
Result(-1) = 19
Values = Result
End Function
Public Type Item
Value As Long
End Type
Public Sub Fill(ByRef Items() As Item)
Items(0).Value = 23
End Sub`);
  const {output} = await execute(`program Main; type Items=array[0..0] of Helper.Item; var A:Items;
begin Helper.Fill(A); WriteLn(Helper.Values()[-2], ':', Low(Helper.Values()), ':', High(Helper.Values()), ':', A[0].Value) end.`, [helper]);
  assert.deepEqual(output, ['17:-2:-1:23']);
});

test('foreign ByRef element borrows survive later argument effects and release after the call, exactly like VB', async () => {
  const helper = vb('Helper', `Public Values() As Long
Public Sub Setup()
ReDim Values(1)
Values(0)=7
End Sub
Public Function Later() As Long
On Error Resume Next
Err.Clear
ReDim Values(4)
Later=Err.Number
End Function
Public Sub Accept(ByRef Value As Long, ByVal Status As Long)
Debug.Print Status, UBound(Values), Value
End Sub`);
  const basic = project('', [helper]); basic.modules[0] = vb('Main', 'Public Sub Main()\nHelper.Setup\nHelper.Accept Helper.Values(0), Helper.Later()\nDebug.Print Helper.Later()\nEnd Sub');
  const baseline = compileProject(basic); assert.deepEqual(baseline.diagnostics, []); const expected = [];
  await new VirtualMachine(baseline, {print: value => expected.push(value)}).start(); assert.deepEqual(expected, ['10 1 7', '0']);
  const result = await execute('program Main; begin Helper.Setup; Helper.Accept(Helper.Values[0], Helper.Later()); WriteLn(Helper.Later()) end.', [helper]);
  assert.deepEqual(result.output, expected);
});

test('deferred foreign arguments retain nested Pascal captures and evaluate each value in source order', async () => {
  const helper = vb('Helper', 'Public Sub PrintValues(ByVal First As Long, ByVal Second As Long)\nDebug.Print First, Second\nEnd Sub');
  const {output} = await execute(`program Main;
procedure Run;
var N:LongInt;
function Next:LongInt; begin Inc(N); Next:=N end;
begin N:=1; Helper.PrintValues(Sqr(Next), Next); WriteLn(N) end;
begin Run end.`, [helper]);
  assert.deepEqual(output, ['4 3', '3']);
});

for (const name of ['VBCounter', 'CounterEnum']) test('declared VB class '+name+' retains object identity regardless of enum-like spelling', async () => {
  const object = vb(name, 'Public Value As Long', 'class');
  const factory = vb('Factory', `Public Function Make() As ${name}\nSet Make=New ${name}\nMake.Value=42\nEnd Function`);
  const {output} = await execute(`program Main; var C:${name}; begin C:=Factory.Make(); WriteLn(C.Value) end.`, [object, factory]);
  assert.deepEqual(output, ['42']);
});

test('foreign loop controls retain Pascal mutation guards for assignments and ByRef calls', () => {
  const helper = vb('Helper', 'Public N As Integer\nPublic Sub Change(ByRef Value As Integer)\nValue=5\nEnd Sub');
  invalid('program Main; begin for N:=1 to 3 do N:=5 end.', [helper], /For control variable/);
  invalid('program Main; begin for N:=1 to 3 do Helper.Change(N) end.', [helper], /For control variable/);
  invalid('program Main; begin for N:=1 to 3 do Helper.N:=5 end.', [helper], /For control variable/);
  invalid('program Main; begin for N:=1 to 3 do Helper.Change(Helper.N) end.', [helper], /For control variable/);
});

test('foreign ByRef strings cannot bypass Pascal bounded string storage and explicit VB storage remains usable', async () => {
  const helper = vb('Helper', `Public Text As String
Public Sub Fill(ByRef Value As String)
Value=String$(300,"x")
End Sub
Public Sub FillVariant(ByRef Value As Variant)
Value=String$(300,"x")
End Sub
Public Sub FillArray(ByRef Value() As String)
Value(0)=String$(300,"x")
End Sub`);
  for (const type of ['String', 'String[5]', 'Char']) invalid(`program Main; var S:${type}; begin Helper.Fill(S) end.`, [helper], /bounded Pascal string storage/);
  invalid('program Main; var S:String; begin Helper.FillVariant(S) end.', [helper], /bounded Pascal string storage/);
  invalid('program Main; var S:array[0..1] of String; begin Helper.FillArray(S) end.', [helper], /bounded Pascal string storage/);
  const {output} = await execute('program Main; var S:String; begin Helper.Fill(Helper.Text); S:=Helper.Text; WriteLn(Length(Helper.Text),\':\',Length(S)) end.', [helper]);
  assert.deepEqual(output, ['300:255']);
});
