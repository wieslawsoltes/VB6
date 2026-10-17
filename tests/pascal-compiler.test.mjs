import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenizePascal, parsePascalModule, lowerPascalModule, compilePascalModule, lowerPascalExpression} from '../src/language/pascal/compiler.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';

function project(code, modules = []) {return {name: 'PascalConformance', language: 'pascal', startup: 'Sub Main', modules: [{name: 'MainUnit', kind: 'module', language: 'pascal', code}, ...modules]};}
async function execute(code, modules = [], options = {}) {const compiled = compileProject(project(code, modules)); assert.deepEqual(compiled.diagnostics, []); const output = [], vm = new VirtualMachine(compiled, {print: (text, newline) => output.push({text, newline})}, options); await vm.start(); assert.equal(vm.lastError, null); return {compiled, output: output.map(value => value.text), chunks: output, vm};}
function invalid(code, pattern, line) {const result = compileProject(project(code)); assert.equal(result.valid, false); assert.match(result.diagnostics.map(error => error.message).join('\n'), pattern); if (line) assert.equal(result.diagnostics[0].line, line); return result;}

test('Pascal lexer preserves original UTF-16 spans, string escapes and comments', () => {
  const source = "{comment}\r\nName := 'can''t'#13#10; (* ignored *)\nNext := $FF;";
  const tokens = tokenizePascal(source); assert.equal(tokens[0].value, 'Name'); assert.equal(tokens[0].line, 2); assert.equal(source.slice(tokens[0].start, tokens[0].end), 'Name');
  assert.equal(tokens.find(token => token.type === 'string').value, "can't"); assert.equal(tokens.find(token => token.raw === '$FF').value, 255); assert.equal(tokens.comments.length, 2);
  const tolerant = tokenizePascal("x := 'unfinished", {tolerant: true}); assert.equal(tolerant.diagnostics.length, 1); assert.equal(tolerant.at(-1).type, 'eof');
});

test('Pascal parser constructs structured syntax with positioned nested routines and types', () => {
  const ast = parsePascalModule('program Test; type Pair = record A,B: Integer end; procedure Outer; procedure Inner; begin end; begin Inner end; begin end.');
  assert.equal(ast.moduleKind, 'program'); assert.equal(ast.declarations[0].type.fields[0].names.length, 2); assert.equal(ast.declarations[1].declarations[0].name, 'Inner'); assert.equal(ast.body.kind, 'block');
});

test('integer division, modulo, arithmetic, loop bounds and source positions use Pascal semantics', async () => {
  const {output} = await execute(`program Arithmetic;
var I, Total: Integer;
begin
  Total := 0;
  for I := 1 to 5 do Total := Total + I;
  Writeln(Total, ':', -7 div 3, ':', -7 mod 3);
  I := 32767; I := I + 1; Writeln(I);
end.`);
  assert.deepEqual(output, ['15:-2:-1', '-32768']);
});

test('For handles maximal ordinal endpoints and descending Char loops without overflowing', async () => {
  const {output} = await execute("program Loops; var I: Integer; C: Char; begin for I := 32766 to 32767 do Writeln(I); for C := 'c' downto 'a' do Write(C); Writeln; end.");
  assert.deepEqual(output, ['32766', '32767', 'c', 'b', 'a', '']);
});

test('recursion, value parameters and var parameters share the existing call ABI', async () => {
  const {output} = await execute(`program Calls;
var Value: Longint;
function Factorial(N: Longint): Longint;
begin if N < 2 then Factorial := 1 else Factorial := N * Factorial(N - 1) end;
procedure Mutate(var Target: Longint; Copy: Longint);
begin Target := Target + Copy; Copy := 0 end;
begin Value := 10; Mutate(Value, Factorial(5)); Writeln(Value); end.`);
  assert.deepEqual(output, ['130']);
});

test('nested routines capture live lexical variables and recursively share their activation', async () => {
  const {output} = await execute(`program Closures;
procedure Outer(Seed: Integer);
var Total: Integer;
  procedure Add(N: Integer);
  begin if N > 0 then begin Total := Total + Seed; Add(N - 1) end end;
begin Total := 0; Add(3); Writeln(Total) end;
begin Outer(7); Outer(2) end.`);
  assert.deepEqual(output, ['21', '6']);
});

test('array copies and by-value aggregate parameters keep independent storage', async () => {
  const {output} = await execute(`program Arrays;
type Values = array[-1..1] of Integer; Point = record X,Y: Integer end;
var A,B: Values; P,Q: Point;
procedure Change(Copy: Values; RecordCopy: Point); begin Copy[-1] := 99; RecordCopy.X := 99 end;
begin A[-1] := 4; A[0] := 5; A[1] := 6; B := A; A[-1] := 7; P.X := 8; P.Y := 9; Q := P; Change(A,P); Writeln(A[-1], ':', B[-1], ':', P.X, ':', Q.X); end.`);
  assert.deepEqual(output, ['7:4:8:8']);
});

test('multidimensional arrays, aliases and record fields preserve declared bounds', async () => {
  const {output} = await execute(`program Matrix;
type Index = 2..3; Matrix = array[Index, -1..0] of Longint; Alias = Matrix;
var M: Alias; I,J: Integer;
begin for I := 2 to 3 do for J := -1 to 0 do M[I,J] := I * 10 + J; Writeln(M[2,-1], ':', M[3,0]); end.`);
  assert.deepEqual(output, ['19:30']);
});

test('enumerations, subranges, sets and membership maintain ordinal type identity', async () => {
  const {output} = await execute(`program Sets;
type Color = (Red,Green,Blue); Colors = set of Color; Small = 1..5;
var A,B: Colors; I: Small;
begin A := [Red,Blue]; B := [Green..Blue]; Include(A,Green); Exclude(A,Red); Writeln(A = B, ':', Blue in A, ':', Red in A); I := 3; Writeln(Ord(Blue), ':', I); end.`);
  assert.deepEqual(output, ['TRUE:TRUE:FALSE', '2:3']);
});

test('short strings, character indexing and Pascal Write formatting reuse portable helpers', async () => {
  const {output, chunks} = await execute(`program Strings;
var S: String[5]; C: Char;
begin S := 'abcdefg'; S[2] := 'Z'; C := S[1]; Writeln(S, ':', C, ':', Ord(S[0])); Insert('!',S,1); Delete(S,2,1); Writeln(S); Write(7:3); Writeln(1.25:6:2, ':', True); end.`);
  assert.deepEqual(output, ['aZcde:a:5', '!Zcd', '  7', '  1.25:TRUE']); assert.equal(chunks[2].newline, false);
});

test('local typed constants initialize once and remain writable across calls', async () => {
  const {output} = await execute(`program Typed;
const Values: array[1..3] of Integer = (10,20,30);
procedure Tick;
const Counter: Integer = 5;
begin Inc(Counter); Writeln(Counter) end;
begin Writeln(Values[2]); Values[2] := 40; Writeln(Values[2]); Tick; Tick end.`);
  assert.deepEqual(output, ['20', '40', '6', '7']);
});

test('record and multidimensional array typed constants recursively initialize storage', async () => {
  const {output} = await execute(`program Initialized;
type Point = record X,Y: Longint end; Matrix = array[1..2,1..2] of Integer;
const P: Point = (X: 12; Y: 34); M: Matrix = ((1,2),(3,4));
begin Writeln(P.X, ':', P.Y, ':', M[2,1]); end.`);
  assert.deepEqual(output, ['12:34:3']);
});

test('repeat, while, nested case, goto, Break and Continue use correct jump targets', async () => {
  const {output} = await execute(`program Flow;
label Done;
var I,Sum: Integer;
begin I := 0; Sum := 0; repeat Inc(I); if I = 2 then Continue; Sum := Sum + I until I = 4;
while True do begin case Sum of 8: Writeln('eight'); 1..7: Writeln('small'); else Writeln('other') end; Break end;
goto Done; Writeln('bad'); Done: Writeln(Sum) end.`);
  assert.deepEqual(output, ['eight', '8']);
});

test('With aliases record storage and freezes indexed receivers once', async () => {
  const {output} = await execute(`program Aliases;
type Point = record X,Y: Integer end; Points = array[1..2] of Point;
var A: Points; I: Integer;
begin I := 1; with A[I] do begin I := 2; X := 7; Y := X + 1 end; Writeln(A[1].X, ':', A[1].Y, ':', A[2].X); end.`);
  assert.deepEqual(output, ['7:8:0']);
});

test('default short-circuit and explicit complete Boolean evaluation preserve side effects', async () => {
  const {output} = await execute(`program Booleans;
var Count: Integer; B: Boolean;
function Probe: Boolean; begin Inc(Count); Probe := True end;
begin Count := 0; B := False and Probe; B := True or Probe; Writeln(Count);
{$B+} B := False and Probe; B := True or Probe; Writeln(Count);
{$B-} B := True and (False or Probe); Writeln(Count) end.`);
  assert.deepEqual(output, ['0', '2', '3']);
});

test('imported units expose constants, types, values and routines with private-member checks', async () => {
  const unit = {name: 'Geometry', kind: 'module', code: `unit Geometry; interface type Point = record X,Y: Integer end; const Factor = 2; procedure Scale(var P: Point); implementation var Secret: Integer; procedure Scale(var P: Point); begin P.X := P.X * Factor; P.Y := P.Y * Factor end; end.`};
  const {output} = await execute('program Main; uses Geometry; var P: Point; begin P.X := 3; P.Y := 4; Scale(P); Writeln(P.X, \':\', P.Y, \':\', Geometry.Factor) end.', [unit]);
  assert.deepEqual(output, ['6:8:2']); const bad = compileProject(project('program Main; uses Geometry; begin Writeln(Geometry.Secret) end.', [unit])); assert.match(bad.diagnostics[0].message, /not exported/);
});

test('declaration and operator diagnostics point to original Pascal source', () => {
  invalid('program Bad;\nvar N: Integer;\nbegin\n N := 1.25\nend.', /Cannot assign/, 4);
  invalid('program Bad; begin Writeln(3.5 div 2) end.', /integer operands/);
  invalid('program Bad; var X: Integer; begin for X := 1 to 2 do Inc(X) end.', /control variable/);
  invalid('program Bad; var X: Integer; begin case X of 1..3: X := 2; 3: X := 4 end end.', /overlapping/);
  invalid('program Bad; type P = ^Integer; begin end.', /Typed pointers/);
  invalid('program Bad; begin asm mov ax, bx end end.', /Inline 8086 assembly/);
});

test('range and overflow checks are executable rather than ignored compiler directives', async () => {
  for (const source of ["program Checked; {$R+} type Small=1..3; var N:Small; X:Integer; begin X:=4; N:=X end.", "program Checked; {$Q+} var N:Integer; begin N:=32767; N:=N+1 end."]) {
    const compiled = compileProject(project(source)); assert.deepEqual(compiled.diagnostics, []); const vm = new VirtualMachine(compiled); await assert.rejects(vm.start(), /range|overflow/i);
  }
});

test('compiler source maps preserve authored text and expose debugger expression lowering', () => {
  const code = 'program Debug;\nvar A: array[1..3] of Integer;\nbegin\n A[1] := 7;\n Writeln(A[1])\nend.';
  const module = compilePascalModule({name: 'Debug', code, kind: 'module'}); assert.equal(module.source, code); assert.ok(module.generatedSource.includes('Debug.Print')); assert.equal(module.language, 'pascal');
  assert.ok(module.procedures.get('main').code.some(instruction => instruction.sequencePoint && instruction.line === 4));
  const expression = lowerPascalExpression('A[1] + 2', {module}); assert.equal(expression.kind, 'call'); assert.equal(expression.callee.name, '__PascalIntAdd');
  const lowered = lowerPascalModule({name: 'Debug', code}); assert.equal(lowered.sourceMap.length, lowered.generatedSource.split('\n').length);
});
