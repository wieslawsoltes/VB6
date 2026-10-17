import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';

const source = `program DebugPascal;
{$R+}
type TValues = array[-2..2] of Integer;
var Counter, Hits: Integer; Values: TValues; Name: string[8]; Small: 0..3;
function Touch: Integer;
begin Inc(Hits); Touch := Hits; end;
procedure Worker;
var Local: Integer;
begin
  Local := 9;
  Writeln('pause');
end;
begin
  Counter := 12; Values[-2] := 7; Name := 'O''Neil'; Small := 2;
  Worker;
  Writeln(Counter);
end.`;
const project = code => ({name: 'Pascal debugger', language: 'pascal', startup: 'Sub Main', modules: [{name: 'DebugPascal', kind: 'module', language: 'pascal', code}]});
async function paused(t, code = source, marker = "Writeln('pause')") {
  const output = [], vm = new VirtualMachine(compileProject(project(code)), {print: value => output.push(value)}, {debuggerEnabled: true});
  assert.equal(vm.program.valid, true, JSON.stringify(vm.program.diagnostics));
  const line = code.slice(0, code.indexOf(marker)).split('\n').length;
  vm.setBreakpoint('DebugPascal', line);
  const pause = new Promise(resolve => {const off = vm.on('pause', event => {off(); resolve(event);});});
  const running = vm.start();
  const timer = setTimeout(() => vm.stop(), 3000);
  t.after(async () => {clearTimeout(timer); vm.stop(); await running;});
  await Promise.race([pause, running.then(() => {throw vm.lastError || new Error('No Pascal breakpoint');})]);
  return {vm, output, running};
}

test('Pascal watches use typed arithmetic, set membership, strings and lazy Boolean operators', async t => {
  const {vm} = await paused(t);
  const cases = [['Counter div 5', 2], ['(-7) mod 3', -1], ['Local + Values[-2]', 16], ["Name[2]", "'"], ['Ord(True)', 1], ["UpCase('a')", 'A'], ['Sqr(6)', 36], ['Sqrt(9)', 3], ['MaxInt + 1', -32768], ['2 in [1..3]', -1], ['[1, 3] <= [1..4]', -1], ['False and (1 div 0 = 0)', 0], ['True or (1 div 0 = 0)', -1]];
  for (const [expression, value] of cases) assert.equal(await vm.evaluateWatch(expression), value, expression);
});

test('Pascal automatic inspection never invokes authored code or effectful intrinsics', async t => {
  const {vm} = await paused(t);
  for (const expression of ['Touch', 'Touch()', 'Random(10)']) await assert.rejects(vm.evaluateWatch(expression), /disabled|not permitted/i, expression);
  assert.equal(await vm.evaluateWatch('Hits'), 0);
  assert.equal(vm.currentFrame.locals.has('missing'), false);
  await assert.rejects(vm.evaluateWatch('Missing'), /identifier|defined/i);
  assert.equal(vm.currentFrame.locals.has('missing'), false);
});

test('Pascal locals and array children expose editable Pascal expressions and escaped literals', async t => {
  const {vm} = await paused(t), values = vm.inspectDebug('Values');
  assert.equal(values.children[0].expression, 'Values[-2]');
  assert.equal(values.children[0].value, '7');
  assert.equal(values.children[0].editable, true);
  assert.equal(vm.inspectDebug('Name').literal, "'O''Neil'");
  assert.ok(vm.debugLocals().some(value => value.name.toLowerCase() === 'local'));
  assert.ok(vm.debugLocals().every(value => !value.name.toLowerCase().startsWith('__pascal')));
  vm.assignDebug('Counter', 'Counter div 2');
  vm.assignDebug('Values[-2]', 'Local + 1');
  vm.assignDebug('Name[1]', "'J'");
  assert.equal(await vm.evaluateWatch('Counter'), 6);
  assert.equal(await vm.evaluateWatch('Values[-2]'), 10);
  assert.equal(await vm.evaluateWatch('Name'), "J'Neil");
  assert.throws(() => vm.assignDebug('Small', '4'), /range/i);
  assert.equal(await vm.evaluateWatch('Small'), 2);
  assert.throws(() => vm.assignDebug('Name[0]', '#9'), /length/i);
});

test('Pascal explicit evaluation calls functions once and shares the safe intrinsic expression bridge', async t => {
  const {vm} = await paused(t);
  assert.equal(await vm.evaluateExplicit('Touch() + 10'), 11);
  assert.equal(await vm.evaluateWatch('Hits'), 1);
  assert.equal(await vm.evaluateExplicit('False and (Touch() = 0)'), 0);
  assert.equal(await vm.evaluateWatch('Hits'), 1);
  assert.equal(await vm.immediate('? Counter div 5'), 2);
});

test('Pascal Immediate reuses typed statement lowering, var calls and selected-frame storage', async t => {
  const {vm, output} = await paused(t), frame = vm.currentFrame, procedures = [...frame.module.procedures.keys()];
  await vm.immediate("Counter := Counter + 5; Inc(Local); Name := 'Ada; Lovelace'; Writeln(Counter, ':', Local, ':', Name)");
  assert.equal(await vm.evaluateWatch('Counter'), 17);
  assert.equal(await vm.evaluateWatch('Local'), 10);
  assert.equal(await vm.evaluateWatch('Name'), 'Ada; Lov');
  assert.ok(output.includes('17:10:Ada; Lov'));
  assert.equal(vm.currentFrame, frame);
  assert.deepEqual([...frame.module.procedures.keys()], procedures);
  await vm.immediate('begin Values[-1] := 3; Values[0] := Values[-1] * 4 end');
  assert.equal(await vm.evaluateWatch('Values[0]'), 12);
});

test('Pascal Immediate failures and instruction cancellation restore suspended debugger state', async t => {
  const {vm} = await paused(t), frame = vm.currentFrame, procedures = [...frame.module.procedures.keys()];
  await assert.rejects(vm.immediate('Counter := 1 div 0'), /zero/i);
  assert.equal(await vm.evaluateWatch('Counter'), 12);
  await assert.rejects(vm.immediate('while True do Inc(Hits)', {instructionLimit: 100}), /budget|limit/i);
  assert.equal(vm.currentFrame, frame);
  assert.equal(vm.state, 'paused');
  assert.equal(vm.debugEvaluation, null);
  assert.deepEqual([...frame.module.procedures.keys()], procedures);
  assert.equal(await vm.immediate('? 6 * 7'), 42);
});

test('Pascal breakpoint conditions and change watches use the actual procedure language', async t => {
  const code = `program DebugPascal;
var Value: Integer;
begin
  Value := 2;
  Value := 5;
  Writeln(Value);
end.`, vm = new VirtualMachine(compileProject(project(code))), events = [];
  t.after(() => vm.stop());
  vm.setBreakpoint('DebugPascal', 6, 'Value div 2 = 2');
  vm.setWatchpoints([{module: 'DebugPascal', expression: 'Value mod 2', mode: 'change'}]);
  vm.on('pause', event => {events.push({line: event.instruction.line, reason: event.reason}); vm.resume();});
  await vm.start();
  assert.equal(vm.lastError, null);
  assert.ok(events.some(event => event.line === 6 && event.reason === 'breakpoint'));
});

test('Pascal design-mode Immediate prepares without running program startup', async t => {
  const vm = new VirtualMachine(compileProject(project(source)), {}, {debuggerEnabled: true});
  t.after(() => vm.stop());
  await vm.prepareImmediateContext();
  assert.equal(await vm.immediate('? Counter'), 0);
  await vm.immediate("Counter := 8; Name := 'Ready'", {module: 'DebugPascal'});
  assert.equal(await vm.immediate('? Counter div 2'), 4);
  assert.equal(await vm.immediate('? Name'), 'Ready');
});
