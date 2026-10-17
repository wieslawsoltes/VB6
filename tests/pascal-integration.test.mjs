import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject,compileModule} from '../src/language/compiler.js';
import {compileProject as compileBasicProject} from '../src/language/compiler-core.js';
import {ProjectDiagnosticCache,diagnosticSnapshot} from '../src/language/diagnostics.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {compileWin32} from '../src/native/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
import {compileLinuxAOT} from '../packages/linux-native/src/compiler.js';
import {prepareClassicProject} from '../src/exporter/classic-project.js';
import {pascalProgram,pascalFormProject} from './pascal-integration-fixtures.mjs';

async function execute(project,host={}) {
  const compiled=compileProject(project);assert.deepEqual(compiled.diagnostics,[]);
  const output=[],vm=new VirtualMachine(compiled,{print:text=>output.push(text),...host});
  await vm.start();return {compiled,output,vm};
}

test('Visual Basic compilation remains identical through the language facade',()=>{
  const project={name:'Basic',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code:'Sub Main()\nDebug.Print 42\nEnd Sub'}]};
  assert.deepEqual(compileProject(project),compileBasicProject(project));
});

test('Pascal project defaults and module overrides dispatch through the shared compiler',async()=>{
  const {output}=await execute(pascalProgram());assert.deepEqual(output,['30','PASCAL_NATIVE_OK']);
  const project=pascalProgram();delete project.modules[0].language;
  assert.equal(compileProject(project).valid,true);
  project.modules.push({name:'BasicUtility',language:'vb6',kind:'module',code:'Public Function Five() As Long\nFive = 5\nEnd Function'});
  const mixed=compileProject(project);assert.equal(mixed.valid,true);assert.ok(mixed.modules.get('basicutility').procedures.has('five'));
  assert.throws(()=>compileModule({name:'Unknown',language:'unknown',code:''}),/language/i);
});

test('background diagnostics include effective language and invalidate dependent units',()=>{
  const cache=new ProjectDiagnosticCache(),project=pascalProgram();
  const first=cache.check(diagnosticSnapshot(project));assert.equal(first.valid,true);assert.equal(first.stats.compiledModules,1);
  const second=cache.check(diagnosticSnapshot(project));assert.equal(second.stats.cacheHits,1);
  project.modules[0].language='vb6';
  const third=cache.check(diagnosticSnapshot(project));assert.equal(third.valid,false);assert.equal(third.stats.compiledModules,1);
  project.modules[0].language='pascal';assert.equal(cache.check(diagnosticSnapshot(project)).valid,true);
});

test('Pascal units initialize in dependency order exactly once before program statements',async()=>{
  const units=[
    {name:'FirstUnit',kind:'module',code:"unit FirstUnit; interface procedure Mark; implementation procedure Mark; begin Writeln('mark'); end; begin Writeln('first'); end."},
    {name:'SecondUnit',kind:'module',code:"unit SecondUnit; interface uses FirstUnit; implementation begin Writeln('second'); end."}
  ];
  const {output,compiled}=await execute(pascalProgram("program Main; uses SecondUnit, FirstUnit; begin FirstUnit.Mark; Writeln('body'); end.",units));
  assert.deepEqual(output,['first','second','mark','body']);assert.deepEqual(compiled.pascalInitialization,['FirstUnit','SecondUnit']);
});

test('Pascal interface cycles produce deterministic diagnostics',()=>{
  const project=pascalProgram('program Main; uses FirstUnit; begin end.',[
    {name:'FirstUnit',kind:'module',code:'unit FirstUnit; interface uses SecondUnit; implementation end.'},
    {name:'SecondUnit',kind:'module',code:'unit SecondUnit; interface uses FirstUnit; implementation end.'}
  ]);
  const result=compileProject(project);assert.equal(result.valid,false);assert.match(result.diagnostics.map(d=>d.message).join('\n'),/circular|cycle/i);
});

test('Pascal implementation cycles initialize once without rejecting legal interfaces',async()=>{
  const project=pascalProgram("program Main; uses FirstUnit; begin Writeln('body'); end.",[
    {name:'FirstUnit',kind:'module',code:"unit FirstUnit; interface implementation uses SecondUnit; begin Writeln('first'); end."},
    {name:'SecondUnit',kind:'module',code:"unit SecondUnit; interface implementation uses FirstUnit; begin Writeln('second'); end."}
  ]);
  const {output}=await execute(project);assert.deepEqual(output,['second','first','body']);
});

test('Pascal executable sequence points retain physical source coordinates',()=>{
  const project=pascalProgram(),result=compileProject(project);assert.deepEqual(result.diagnostics,[]);
  const module=result.modules.get('pascalnative'),lines=project.modules[0].code.split('\n');
  assert.equal(module.source,project.modules[0].code);assert.ok(module.generatedSource);
  const points=[...module.procedures.values()].flatMap(proc=>proc.code).filter(op=>op.sequencePoint);
  assert.ok(points.length>4);assert.ok(points.every(op=>op.line>0&&op.line<=lines.length));
  assert.ok(points.some(op=>lines[op.line-1].includes('for I')));
});

test('Pascal form lifecycle and event handlers reuse the existing controls and VM',async()=>{
  const text={Text:''},button={Caption:'Run Pascal'},form={Caption:'Pascal Forms',controlMap:new Map([['MessageText',text],['RunButton',button]]),Show(){this.shown=true;}};
  const {vm}=await execute(pascalFormProject(),{createForm:()=>form});
  assert.equal(text.Text,'Ready');assert.equal(form.shown,true);
  await vm.dispatch('MainForm','RunButton_Click');assert.equal(text.Text,'Pascal event');assert.equal(form.Caption,'Pascal event');
  assert.equal(vm.program.modules.get('mainform').procedures.get('messagetext_keypress').params[0].byRef,true);
});

for(const [name,compile] of [['Win32',compileWin32],['macOS ARM64',compileMacOSAOT],['Linux x64',compileLinuxAOT]]) {
  test('Pascal program compiles through the shared '+name+' machine code backend',()=>{
    const project=pascalProgram(),before=structuredClone(project),result=compile(project);
    assert.deepEqual(project,before);
    if(name==='Win32') {assert.equal(result.bytes[0],0x4d);assert.equal(result.bytes[1],0x5a);assert.equal(result.report.target,'win32-aot');}
    else {assert.ok(result.section.length>0);assert.ok(result.metadata.entries.length>=3);assert.ok(!JSON.stringify(result.metadata).includes('"op":'));}
  });
  test('Pascal forms share '+name+' native controls and event lowering',()=>{
    const result=compile(pascalFormProject());assert.ok(result.bytes?.length||result.section.length);
  });
}

test('Microsoft VB6 export reports a source-language diagnostic for Pascal',()=>{
  assert.throws(()=>prepareClassicProject(pascalFormProject()),error=>error.diagnostics?.[0]?.code==='CLASSIC_LANGUAGE');
});
