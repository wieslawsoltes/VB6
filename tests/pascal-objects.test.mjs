import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';

function project(code, modules = []) {
  return {name: 'PascalObjects', language: 'pascal', startup: 'Sub Main', modules: [{name: 'MainUnit', kind: 'module', language: 'pascal', code}, ...modules]};
}
async function execute(code, modules = [], {handledError = false} = {}) {
  const compiled = compileProject(project(code, modules));
  assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics));
  const output = [], vm = new VirtualMachine(compiled, {print: text => output.push(text)});
  await vm.start(); if (!handledError) assert.equal(vm.lastError, null);
  assert.equal(vm.err.Number, 0);
  return {compiled, output, vm};
}
function invalid(code, pattern, modules = []) {
  const compiled = compileProject(project(code, modules));
  assert.equal(compiled.valid, false);
  assert.match(compiled.diagnostics.map(item => item.message).join('\n'), pattern);
}
async function runtimeError(code, number, modules = []) {
  const compiled = compileProject(project(code, modules));
  assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics));
  const vm = new VirtualMachine(compiled);
  await assert.rejects(vm.start(), error => error.number === number);
  assert.equal(vm.lastError?.number, number, JSON.stringify(vm.lastError));
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

test('virtual methods dispatch through ancestor var aliases and inherited methods, while qualified calls remain static', async () => {
  const {output, compiled} = await execute(`program VirtualCalls;
type TBase = object
  X: Integer;
  constructor Init(Initial: Integer);
  function Read(Offset: Integer): Integer; virtual;
  function Report: Integer;
end;
TChild = object(TBase)
  Y: Integer;
  constructor Init(Initial, Extra: Integer);
  function Read(Offset: Integer): Integer; virtual;
end;
constructor TBase.Init(Initial: Integer); begin X := Initial end;
function TBase.Read(Offset: Integer): Integer; begin Read := X + Offset end;
function TBase.Report: Integer; begin Report := Read(3) end;
constructor TChild.Init(Initial, Extra: Integer); begin inherited Init(Initial); Y := Extra end;
function TChild.Read(Offset: Integer): Integer; begin Read := inherited Read(Offset) + Y end;
function ThroughBase(var Item: TBase): Integer; begin Inc(Item.X); ThroughBase := Item.Read(2) end;
var Child: TChild;
begin Child.Init(4, 10); Writeln(Child.Read(1), ':', Child.Report); Writeln(ThroughBase(Child)); Writeln(Child.X, ':', Child.Y) end.`);
  assert.deepEqual(output, ['15:17', '17', '5:10']);
  const dispatchers = compiled.modules.get('mainunit').pascal.objectDispatchers;
  assert.equal(dispatchers.length, 1);
  assert.deepEqual(dispatchers[0].receiver, {parameter: '__PascalSelf', identity: 'mainunit.tbase', vmtField: '__PascalTypeId'});
  assert.deepEqual(dispatchers[0].branches.map(branch => [branch.runtimeType, branch.viewType]), [['mainunit.tbase', 'mainunit.tbase'], ['mainunit.tchild', 'mainunit.tchild']]);
});

test('cross-unit virtual calls preserve both ancestor and descendant private state', async () => {
  const virtualBase = {...baseUnit, code: baseUnit.code.replace('function Read: Integer;', 'function Read: Integer; virtual;')};
  const {output} = await execute(`program ImportedVirtual; uses BaseUnit;
type TChild = object(TBase)
  private Extra: Integer;
  public constructor Start(Initial, Bonus: Integer); function Read: Integer; virtual;
end;
constructor TChild.Start(Initial, Bonus: Integer); begin inherited Init(Initial); Extra := Bonus end;
function TChild.Read: Integer; begin Read := inherited Read + Extra end;
function Inspect(var Item: TBase): Integer; begin Item.Bump; Inspect := Item.Read end;
var Item: TChild;
begin Item.Start(8, 20); Writeln(Inspect(Item), ':', Calls) end.`, [virtualBase]);
  assert.deepEqual(output, ['29:1']);
});

test('dynamic methods validate indexes and use the same checked receiver dispatch', async () => {
  const {output, compiled} = await execute(`program DynamicCalls;
const MessageIndex = 100;
type TBase = object constructor Init; procedure Message(var Code: Integer); virtual MessageIndex; end;
TChild = object(TBase) procedure Message(var Code: Integer); virtual MessageIndex; end;
constructor TBase.Init; begin end;
procedure TBase.Message(var Code: Integer); begin Inc(Code) end;
procedure TChild.Message(var Code: Integer); begin inherited Message(Code); Inc(Code, 10) end;
procedure Send(var Item: TBase; var Code: Integer); begin Item.Message(Code) end;
var Item: TChild; Code: Integer;
begin Item.Init; Code := 4; Send(Item, Code); Writeln(Code) end.`);
  assert.deepEqual(output, ['15']);
  assert.equal(compiled.modules.get('mainunit').pascal.objectTypes[0].methods.find(method => method.name === 'Message').dynamicIndex, 100);
  invalid('program BadIndex; type T=object constructor Init; procedure Run; virtual 0; end; constructor T.Init; begin end; procedure T.Run; begin end; begin end.', /index.*1\.\.65535/);
  invalid('program DuplicateIndex; type T=object constructor Init; procedure A; virtual 9; procedure B; virtual 9; end; constructor T.Init; begin end; procedure T.A; begin end; procedure T.B; begin end; begin end.', /already used/);
});

test('virtual overrides retain exact source signatures and require constructor initialization', () => {
  invalid('program MissingInit; type T=object procedure Run; virtual; end; procedure T.Run; begin end; begin end.', /must declare or inherit a constructor/);
  invalid('program VirtualConstructor; type T=object constructor Init; virtual; end; constructor T.Init; begin end; begin end.', /Constructors cannot be virtual/);
  invalid('program MissingDirective; type A=object constructor Init; procedure Run; virtual; end; B=object(A) procedure Run; end; constructor A.Init; begin end; procedure A.Run; begin end; procedure B.Run; begin end; begin end.', /must preserve.*virtual/);
  invalid('program MismatchedHeading; type A=object constructor Init; procedure Run(N:Integer); virtual; end; B=object(A) procedure Run(M:Integer); virtual; end; constructor A.Init; begin end; procedure A.Run(N:Integer); begin end; procedure B.Run(M:Integer); begin end; begin end.', /must match.*parameter names/);
  invalid('program MismatchedIndex; type A=object constructor Init; procedure Run; virtual 8; end; B=object(A) procedure Run; virtual 9; end; constructor A.Init; begin end; procedure A.Run; begin end; procedure B.Run; begin end; begin end.', /must preserve.*index/);
});

const virtualCopyTypes = `type TBase=object X:Integer; constructor Init(Initial:Integer); function Read:Integer; virtual; end;
TChild=object(TBase) Y:Integer; function Read:Integer; virtual; end;
constructor TBase.Init(Initial:Integer); begin X:=Initial end;
function TBase.Read:Integer; begin Read:=X end;
function TChild.Read:Integer; begin Read:=TBase.Read+Y end;`;

test('object assignment retains destination methods and value parameters project the formal type', async () => {
  const {output} = await execute(`program ObjectValueMethods; ${virtualCopyTypes}
procedure ByValue(Item:TBase); begin Inc(Item.X); Writeln(Item.Read) end;
procedure ByReference(var Item:TBase); begin Writeln(Item.Read) end;
procedure SameValue(Item:TChild); begin Inc(Item.Y); Writeln(Item.Read) end;
var Base:TBase; Child:TChild;
begin Base.Init(1); Child.Init(4); Child.Y:=8; Base:=Child;
Writeln(Base.Read,':',Child.Read); ByValue(Child); ByReference(Child); SameValue(Child); Writeln(Child.Read) end.`);
  assert.deepEqual(output, ['4:12', '5', '12', '13', '12']);
});

test('uninitialized virtual calls and assignments cannot forge a constructed instance', async () => {
  await runtimeError(`program Uninitialized; ${virtualCopyTypes} var Item:TChild; begin Writeln(Item.Read) end.`, 210);
  await runtimeError(`program AssignmentDoesNotConstruct; ${virtualCopyTypes} var Original, Copy:TChild; begin Original.Init(7); Copy:=Original; Writeln(Copy.Read) end.`, 210);
  await runtimeError(`program EvaluateArgumentsFirst; ${virtualCopyTypes} var Item:TChild; begin Item.Init(Item.Read) end.`, 210);
});

test('constructors return success and Fail unwinds direct and nested constructor bodies', async () => {
  const {output} = await execute(`program ConstructorRecovery;
type TBase=object Value:Integer; constructor Init(Accept:Boolean); end;
TChild=object(TBase) constructor Init(Accept:Boolean); end;
constructor TBase.Init(Accept:Boolean);
  procedure Check; begin if not Accept then Fail end;
begin Value:=1; Check; Value:=2 end;
constructor TChild.Init(Accept:Boolean);
begin if not inherited Init(Accept) then Fail; Value:=3 end;
var Base:TBase; Child:TChild;
begin Writeln(Base.Init(True),':',Base.Value); Writeln(Base.Init(False),':',Base.Value);
Writeln(Child.Init(True),':',Child.Value); Writeln(Child.Init(False),':',Child.Value) end.`, [], {handledError: true});
  assert.deepEqual(output, ['TRUE:2', 'FALSE:1', 'TRUE:3', 'FALSE:1']);
  invalid('program InvalidFail; begin Fail end.', /only within a constructor/);
});

test('virtual destructors and array receiver indexes preserve the original object alias', async () => {
  const {output} = await execute(`program VirtualReceivers;
type TBase=object X:Integer; constructor Init; destructor Done; virtual; end;
TChild=object(TBase) Y:Integer; destructor Done; virtual; end;
constructor TBase.Init; begin X:=1 end;
destructor TBase.Done; begin X:=0 end;
destructor TChild.Done; begin inherited Done; Y:=0 end;
procedure Destroy(var Item:TBase); begin Item.Done end;
var Items:array[0..1] of TChild; Cursor:Integer;
function NextIndex:Integer; begin NextIndex:=Cursor; Inc(Cursor) end;
begin Cursor:=0; Items[NextIndex].Init; Items[NextIndex].Init; Items[0].Y:=6; Items[1].Y:=8;
Cursor:=0; Destroy(Items[NextIndex]); with Items[NextIndex] do Done;
Writeln(Cursor,':',Items[0].X,':',Items[0].Y,':',Items[1].X,':',Items[1].Y) end.`);
  assert.deepEqual(output, ['2:0:0:0:0']);
});

test('extended New constructs typed heap objects and failing constructors release their allocation', async () => {
  const {output} = await execute(`program HeapObjects;
type PItem=^TItem;
TItem=object
  Value:Integer;
  constructor Init(Initial:Integer);
  function Read:Integer; virtual;
  destructor Done; virtual;
end;
var Released:Integer;
constructor TItem.Init(Initial:Integer); begin if Initial<0 then Fail; Value:=Initial end;
function TItem.Read:Integer; begin Read:=Value end;
destructor TItem.Done; begin Inc(Released); Value:=0 end;
var Good, Failed:PItem;
begin New(Good, Init(17)); Writeln(Good^.Read); New(Failed, Init(-1)); Writeln(Failed=nil);
Dispose(Good, Done); Writeln(Released); New(Failed, Init(23)); Writeln(Failed^.Read); Dispose(Failed, Done); Writeln(Released) end.`, [], {handledError: true});
  assert.deepEqual(output, ['17', 'TRUE', '1', '23', '2']);
});
