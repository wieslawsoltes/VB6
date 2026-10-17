import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenizePascal, parsePascalModule, lowerPascalModule, compilePascalModule, lowerPascalExpression} from '../src/language/pascal/compiler.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';

function project(code, modules = []) {return {name: 'PascalConformance', language: 'pascal', startup: 'Sub Main', modules: [{name: 'MainUnit', kind: 'module', language: 'pascal', code}, ...modules]};}
async function execute(code, modules = [], options = {}) {const compiled = compileProject(project(code, modules)); assert.deepEqual(compiled.diagnostics, []); const output = [], vm = new VirtualMachine(compiled, {print: (text, newline) => output.push({text, newline}), ...options.host}, options); await vm.start(); assert.equal(vm.err.Number, 0); return {compiled, output: output.map(value => value.text), chunks: output, vm};}
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

test('conditional compilation filters lexical branches while preserving physical locations', async () => {
  const {output, compiled} = await execute(`program Conditional;
{$DEFINE FEATURE}
{$IFDEF FEATURE}
const Value = 42;
{$ELSE}
this is not valid Pascal !!!
{$ENDIF}
begin
{$IFOPT R-} Writeln(Value); {$ELSE} Writeln(0); {$ENDIF}
{$UNDEF FEATURE}
{$IFNDEF FEATURE} Writeln('done'); {$ENDIF}
end.`);
  assert.deepEqual(output, ['42', 'done']); assert.ok(compiled.modules.get('mainunit').procedures.get('main').code.some(instruction => instruction.sequencePoint && instruction.line === 9));
  invalid('program Broken; {$IFDEF X} begin end.', /Unterminated conditional/);
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

test('open array parameters rebase actual bounds and copy value parameters', async () => {
  const {output} = await execute(`program OpenArrays;
type Values = array[-2..0] of Integer;
var A: Values;
procedure Change(var Items: array of Integer); begin Items[0] := 7; Writeln(Low(Items), ':', High(Items), ':', SizeOf(Items)) end;
procedure Copy(Items: array of Integer); begin Items[1] := 99; Writeln(Items[0], ':', Items[1]) end;
begin A[-2] := 1; A[-1] := 2; A[0] := 3; Change(A); Copy(A); Writeln(A[-2], ':', A[-1], ':', A[0]) end.`);
  assert.deepEqual(output, ['0:2:6', '7:99', '7:2:3']);
});

test('typed pointers support forward records, heap growth, linked lists and var aliases', async () => {
  const {output} = await execute(`program Heap;
type PNode = ^Node; Node = record Value: Integer; Next: PNode end;
var Head,Item,NextItem: PNode; I,Total: Integer;
procedure AddOne(var Value: Integer); begin Inc(Value) end;
begin Head := nil; for I := 1 to 40 do begin New(Item); Item^.Value := I; Item^.Next := Head; Head := Item end;
Total:=0; while Head <> nil do begin AddOne(Head^.Value); Total:=Total+Head^.Value; NextItem:=Head^.Next; Dispose(Head); Head:=NextItem end; Writeln(Total); end.`);
  assert.deepEqual(output, ['860']);
});

test('pointer aliases across units share storage and pointers to arrays preserve bounds', async () => {
  const unit = {name: 'HeapTypes', kind: 'module', code: 'unit HeapTypes; interface type Values=array[2..3] of Integer; PValues=^Values; procedure Create(var P:PValues); implementation procedure Create(var P:PValues); begin New(P); P^[2]:=7; P^[3]:=9 end; end.'};
  const {output} = await execute('program Heap; uses HeapTypes; var P:PValues; begin Create(P); Writeln(P^[2],\':\',P^[3]); Dispose(P) end.', [unit]); assert.deepEqual(output, ['7:9']);
});

test('nil and disposed pointer accesses produce deterministic Pascal runtime errors', async () => {
  for (const source of ['program NilPointer; type PInt=^Integer; var P:PInt; begin P:=nil; Writeln(P^) end.', 'program StalePointer; type PInt=^Integer; var P:PInt; begin New(P); Dispose(P); Writeln(P^) end.']) {
    const compiled = compileProject(project(source)); assert.deepEqual(compiled.diagnostics, []); await assert.rejects(new VirtualMachine(compiled).start(), error => error.number === 204);
  }
});

test('Text files preserve CRLF, token delimiters, short string capacities and stream position', async () => {
  const {output, vm} = await execute(`program TextIO;
var F: Text; N: Integer; S: String[3]; Tail: String[20];
begin Assign(F,'text.txt'); Rewrite(F); Writeln(F,42,' abcdef'); Writeln(F,'last'); Close(F);
Reset(F); Read(F,N); Read(F,S); Readln(F,Tail); Writeln(N,':',S,':',Tail,':',Eof(F));
Readln(F,Tail); Writeln(Tail,':',Eof(F)); Close(F);
Append(F); Write(F,'tail'); Close(F); Rename(F,'renamed.txt') end.`);
  assert.deepEqual(output, ['42: ab:cdef:FALSE', 'last:TRUE']);
  assert.deepEqual([...vm.fs.readBytes('/renamed.txt')], [...new TextEncoder().encode('42 abcdef\r\nlast\r\ntail')]);
  assert.equal(vm.fs.exists('/text.txt'), false);
});

test('typed file records use Pascal byte layout and zero-based record seeking', async () => {
  const {output, vm} = await execute(`program Records;
type Item = record Code: Word; Delta: Integer; Mark: Char; Name: String[3]; Flags: set of 0..7; Values: array[1..2] of Byte end;
var F: file of Item; A,B: Item;
begin A.Code:=65535; A.Delta:=-2; A.Mark:='Z'; A.Name:='ab'; A.Flags:=[0,7]; A.Values[1]:=10; A.Values[2]:=20;
Assign(F,'records.dat'); Rewrite(F); Write(F,A); A.Code:=7; Write(F,A); Writeln(FilePos(F),':',FileSize(F));
Seek(F,0); Read(F,B); Writeln(B.Code,':',B.Delta,':',B.Mark,':',B.Name,':',7 in B.Flags,':',B.Values[2]);
Seek(F,1); Read(F,B); Writeln(B.Code,':',Eof(F)); Close(F) end.`);
  assert.deepEqual(output, ['2:2', '65535:-2:Z:ab:TRUE:20', '7:TRUE']);
  assert.deepEqual([...vm.fs.readBytes('/records.dat').slice(0,12)], [255,255,254,255,90,2,97,98,0,129,10,20]);
});

test('unchecked file failures share IOResult across unit boundaries and preserve numeric targets', async () => {
  const unit = {name:'FileWork', kind:'module', code:`unit FileWork; interface procedure OpenMissing(var F:Text); implementation procedure OpenMissing(var F:Text); begin Assign(F,'missing.txt'); {$I-} Reset(F) {$I+} end; end.`};
  const {output} = await execute(`program Errors; uses FileWork;
var F:Text; N,Code:Integer;
begin OpenMissing(F); Code:=IOResult; Writeln(Code,':',IOResult);
Rewrite(F); Writeln(F,'invalid'); Close(F); Reset(F); N:=37; {$I-} Read(F,N); {$I+} Code:=IOResult; Writeln(N,':',Code); Close(F) end.`, [unit]);
  assert.deepEqual(output, ['2:0', '37:106']);
  invalid('program CopyFile; var A,B: Text; begin A:=B end.', /File variables cannot be copied/);
  invalid('program FileValue; procedure P(F:Text); begin end; begin end.', /File parameters must be declared var/);
});

test('typed Real files preserve Borland Real48 byte representations', async () => {
  const {output, vm} = await execute("program Reals; var F:file of Real; R:Real; begin Assign(F,'real.dat'); Rewrite(F); R:=-1.0; Write(F,R); R:=0; Seek(F,0); Read(F,R); Writeln(R:4:1); Close(F) end.");
  assert.deepEqual(output,['-1.0']); assert.deepEqual([...vm.fs.readBytes('/real.dat')],[129,0,0,0,0,128]);
});

test('buffered console Read/ReadLn share line input across units and preserve empty lines', async () => {
  const unit={name:'ConsoleWork',kind:'module',code:'unit ConsoleWork; interface procedure ReadNumber(var N:Integer); implementation procedure ReadNumber(var N:Integer); begin Read(N) end; end.'};
  const lines=['12 abcdef','','7','x']; let requests=0;
  const {output,compiled}=await execute(`program ConsoleInput; uses ConsoleWork;
var N:Integer; S:String[3]; Tail:String[20]; C:Char;
begin ReadNumber(N); Read(S); Readln(Tail); Writeln(N,':',S,':',Tail);
Readln(Tail); Writeln(Length(Tail)); Read(N); Writeln(N,':',Eoln); Readln; Read(C); Writeln(Ord(C)) end.`,[unit],{host:{inputBox:async()=>{requests++; assert.ok(lines.length,'unexpected input request'); return lines.shift();}}});
  assert.deepEqual(output,['12: ab:cdef','0','7:TRUE','120']); assert.equal(requests,4);
  assert.deepEqual(compiled.modules.get('consolework').pascal.hostRequirements,['consoleLineInput']);
  invalid('program EndOfInput; begin Writeln(Eof) end.',/end-of-input sentinel/);
});

test('bounded untyped block I/O preserves partial-record bytes and untouched buffer storage', async () => {
  const {output,vm}=await execute(`program Blocks;
type Bytes=array[1..8] of Byte;
var F:file; A,B:Bytes; I,N:Integer;
begin for I:=1 to 8 do begin A[I]:=I; B[I]:=9 end;
Assign(F,'block.dat'); Rewrite(F,1); BlockWrite(F,A,5,N); Writeln(N); Close(F);
Reset(F,2); BlockRead(F,B,4,N); Writeln(N,':',B[1],':',B[5],':',B[6],':',B[8],':',Eof(F)); Close(F) end.`);
  assert.deepEqual(output,['5','2:1:5:9:9:TRUE']); assert.deepEqual([...vm.fs.readBytes('/block.dat')],[1,2,3,4,5]);
  const compiled=compileProject(project('program Bounds; type Bytes=array[1..4] of Byte; var F:file; A:Bytes; begin Assign(F,\'bounds.dat\'); Rewrite(F,2); BlockWrite(F,A,3) end.'));
  assert.deepEqual(compiled.diagnostics,[]); await assert.rejects(new VirtualMachine(compiled).start(),error=>error.number===201&&/buffer capacity/.test(error.message));
});

test('typed IEEE file codecs and Flush lower through the shared portable file runtime', async () => {
  const {output,vm}=await execute(`program FloatFiles; var F:file of Double; T:Text; D:Double;
begin Assign(F,'double.dat'); Rewrite(F); D:=-1.5; Write(F,D); Seek(F,0); D:=0; Read(F,D); Writeln(D:4:1); Close(F);
Assign(T,'flush.txt'); Rewrite(T); Writeln(T,'ready'); Flush(T); Close(T) end.`);
  assert.deepEqual(output,['-1.5']); assert.deepEqual([...vm.fs.readBytes('/double.dat')],[0,0,0,0,0,0,248,191]);
  assert.equal(vm.fs.read('/flush.txt'),'ready\r\n');
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

test('Val preserves the target on errors and reports numeric conversion positions', async () => {
  const {output} = await execute(`program Conversion;
var N,Code: Integer; R: Real;
begin N:=9; Val('123',N,Code); Writeln(N,':',Code); Val('1x3',N,Code); Writeln(N,':',Code); Val('32768',N,Code); Writeln(N,':',Code); Val('1.25',R,Code); Writeln(R:4:2,':',Code) end.`);
  assert.deepEqual(output, ['123:0', '123:2', '123:5', '1.25:0']);
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
  invalid('program Bad; var N:Integer; begin Writeln(N^) end.', /typed pointer/);
  invalid('program Bad; begin asm mov ax, bx end end.', /Inline 8086 assembly/);
  invalid('program Bad; var __PascalOrdinal: Integer; begin end.', /reserved/);
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
