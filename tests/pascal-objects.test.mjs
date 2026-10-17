import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';

function project(code, modules = []) {
  return {name: 'PascalObjects', language: 'pascal', startup: 'Sub Main', modules: [{name: 'MainUnit', kind: 'module', language: 'pascal', code}, ...modules]};
}
async function execute(code, modules = []) {
  const compiled = compileProject(project(code, modules));
  assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics));
  const output = [], vm = new VirtualMachine(compiled, {print: text => output.push(text)});
  await vm.start(); assert.equal(vm.lastError, null);
  return {compiled, output, vm};
}
function invalid(code, pattern, modules = []) {
  const compiled = compileProject(project(code, modules));
  assert.equal(compiled.valid, false);
  assert.match(compiled.diagnostics.map(item => item.message).join('\n'), pattern);
}

test('object methods and ancestor var parameters alias the original descendant record', async () => {
  const {output, compiled} = await execute(`program Test;
type TBase = object X: Integer; procedure Add(N: Integer); end;
     TChild = object(TBase) Y: Integer; end;
procedure TBase.Add(N: Integer); begin X := X + N end;
var Child: TChild;
procedure Touch(var B: TBase); begin B.X := B.X + 2 end;
begin Child.X := 3; Child.Y := 11; Child.Add(4); Touch(Child); Writeln(Child.X, ':', Child.Y) end.`);
  assert.deepEqual(output, ['9:11']);
  const [base, child] = compiled.modules.get('mainunit').pascal.objectTypes;
  assert.deepEqual(child.parent, {module: 'MainUnit', name: 'TBase', identity: base.identity});
  assert.deepEqual(child.fields.slice(0, base.fields.length), base.fields);
});

test('constructors, destructors, explicit Self, function results and logical SizeOf share object storage', async () => {
  const {output} = await execute(`program Counters;
type TCounter = object
  Value: LongInt;
  constructor Init(Initial: LongInt);
  procedure Add(Amount: LongInt);
  function Read: LongInt;
  destructor Done;
end;
constructor TCounter.Init(Initial: LongInt); begin Value := Initial end;
procedure TCounter.Add(Amount: LongInt); begin Self.Value := Value + Amount end;
function TCounter.Read: LongInt; begin Read := Self.Value end;
destructor TCounter.Done; begin Value := 0 end;
var A, B: TCounter;
begin A.Init(4); B.Init(8); A.Add(3); Writeln(A.Read, ':', B.Read, ':', SizeOf(TCounter)); A.Done; Writeln(A.Read) end.`);
  assert.deepEqual(output, ['7:8:6', '0']);
});

test('inherited static methods retain their declaring type bindings', async () => {
  const {output} = await execute(`program StaticBindings;
type TBase = object function Scale: Integer; function Report: Integer; end;
     TChild = object(TBase) function Scale: Integer; end;
function TBase.Scale: Integer; begin Scale := 2 end;
function TBase.Report: Integer; begin Report := Scale end;
function TChild.Scale: Integer; begin Scale := 7 end;
var Child: TChild;
begin Writeln(Child.Report, ':', Child.Scale, ':', SizeOf(TBase)) end.`);
  assert.deepEqual(output, ['2:7:0']);
});

test('inherited and ancestor-qualified activations pass the current Self instance', async () => {
  const {output} = await execute(`program Ancestors;
type TBase = object X: Integer; constructor Init(Initial: Integer); function Read: Integer; end;
     TChild = object(TBase) Y: Integer; constructor Init(Initial, Extra: Integer); function Read: Integer; end;
constructor TBase.Init(Initial: Integer); begin X := Initial end;
function TBase.Read: Integer; begin Read := X end;
constructor TChild.Init(Initial, Extra: Integer); begin inherited Init(Initial); Y := Extra end;
function TChild.Read: Integer; begin Read := TBase.Read + Y end;
var Child: TChild;
begin Child.Init(5, 9); Writeln(Child.Read, ':', Child.X, ':', Child.Y) end.`);
  assert.deepEqual(output, ['14:5:9']);
});

test('with scopes expose object methods and evaluate array receivers exactly once', async () => {
  const {output} = await execute(`program Receivers;
type TCounter = object Value: Integer; constructor Init(Initial: Integer); procedure Add(Amount: Integer); end;
constructor TCounter.Init(Initial: Integer); begin Value := Initial end;
procedure TCounter.Add(Amount: Integer); begin Value := Value + Amount end;
var Items: array[0..1] of TCounter; Cursor: Integer;
function NextIndex: Integer; begin NextIndex := Cursor; Cursor := Cursor + 1 end;
begin Cursor := 0; Items[NextIndex].Init(4); with Items[NextIndex] do begin Init(7); Add(2); Writeln(Value) end; Writeln(Cursor, ':', Items[0].Value, ':', Items[1].Value) end.`);
  assert.deepEqual(output, ['9', '2:4:9']);
});

test('nested routines in methods capture the live implicit Self parameter', async () => {
  const {output} = await execute(`program CapturedSelf;
type TCounter = object Value: Integer; procedure AddThree; end;
procedure TCounter.AddThree;
  procedure Bump; begin Value := Value + 1 end;
begin Bump; Bump; Bump end;
var Counter: TCounter;
begin Counter.Value := 8; Counter.AddThree; Writeln(Counter.Value) end.`);
  assert.deepEqual(output, ['11']);
});

test('ancestor assignment and by-value parameters project independent object data', async () => {
  const {output} = await execute(`program ObjectCopies;
type TBase = object X: Integer; Items: array[1..2] of Integer; end;
     TChild = object(TBase) Y: Integer; end;
var Base: TBase; Child: TChild;
procedure Change(Copy: TBase); begin Copy.X := 99; Copy.Items[1] := 88 end;
begin Child.X := 3; Child.Y := 7; Child.Items[1] := 4; Child.Items[2] := 5;
  Base := Child; Change(Child); Child.Items[1] := 6;
  Writeln(Base.X, ':', Base.Items[1], ':', Child.X, ':', Child.Y, ':', Child.Items[1]) end.`);
  assert.deepEqual(output, ['3:4:3:7:6']);
});

const baseUnit = {name: 'BaseUnit', kind: 'module', language: 'pascal', code: `unit BaseUnit;
interface
type TBase = object
  private Value: Integer;
  public constructor Init(Initial: Integer); procedure Bump; function Read: Integer;
end;
function Calls: Integer;
implementation
var HitCount: Integer;
constructor TBase.Init(Initial: Integer); begin Value := Initial end;
procedure TBase.Bump; begin Inc(Value); Inc(HitCount) end;
function TBase.Read: Integer; begin Read := Value end;
function Calls: Integer; begin Calls := HitCount end;
end.`};

test('cross-unit inheritance preserves the ancestor private state and method scope', async () => {
  const {output} = await execute(`program ImportedObjects; uses BaseUnit;
type TChild = object(TBase) Extra: Integer; function Total: Integer; end;
function TChild.Total: Integer; begin Total := Read + Extra end;
var Child: TChild;
begin Child.Init(5); Child.Extra := 10; Child.Bump; Writeln(Child.Total, ':', Calls) end.`, [baseUnit]);
  assert.deepEqual(output, ['16:1']);
});

test('private members, wrong receivers and incompatible object var arguments produce source diagnostics', () => {
  invalid('program PrivateAccess; uses BaseUnit; var Item: TBase; begin Item.Value := 3 end.', /private to unit/, [baseUnit]);
  invalid('program NoSelf; type T = object procedure Work; end; procedure T.Work; begin end; begin T.Work end.', /requires Self/);
  invalid('program Siblings; type A = object X:Integer end; B=object X:Integer end; var Item:B; procedure Read(var Value:A); begin end; begin Read(Item) end.', /Var parameter/);
  invalid('program Missing; type T=object procedure Work; end; begin end.', /has no implementation/);
  invalid('program DuplicateLocal; type T=object X:Integer; procedure Work(X:Integer); end; procedure T.Work(X:Integer); begin end; begin end.', /conflicts with an object component/);
});

test('object typed constants omit the internal header and component sections preserve field ordering', async () => {
  const {output} = await execute(`program Constants;
type T = object X: Integer; procedure Read;
  private Y: Integer;
  public procedure SetValue(Initial: Integer);
end;
procedure T.Read; begin Writeln(X, ':', Y) end;
procedure T.SetValue(Initial: Integer); begin Y := Initial end;
const Item: T = (X: 8; Y: 2);
begin Item.Read; Item.SetValue(6); Item.Read end.`);
  assert.deepEqual(output, ['8:2', '8:6']);
  invalid('program BadOrder; type T=object procedure Work; X:Integer; end; procedure T.Work; begin end; begin end.', /before methods/);
});
