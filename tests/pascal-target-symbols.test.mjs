import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {compileWin32} from '../src/native/compiler.js';
import {compileLinuxAOT} from '../packages/linux-native/src/compiler.js';
import {compileMacOS} from '../packages/macos-native/src/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {createPascalProject} from '../packages/turbo-pascal/src/index.js';

test('imported Pascal units inherit project defines, including user-defined zero values',async()=>{
  const project=createPascalProject(`program Main; uses Shared;
{$IFDEF ZERO} begin WriteLn(Answer) end. {$ELSE} Invalid main {$ENDIF}`,{
    name:'Main',settings:{conditionalConstants:{ZERO:0}},
    units:[{name:'Shared',code:`unit Shared; interface
{$IFDEF ZERO} function Answer:Integer; {$ENDIF}
implementation
{$IFDEF ZERO} function Answer:Integer; begin Answer:=42 end; {$ELSE} Invalid unit {$ENDIF}
end.`}],
  });
  const before=structuredClone(project),program=compileProject(project),output=[];
  assert.deepEqual(program.diagnostics,[]);
  await new VirtualMachine(program,{print:value=>output.push(value)}).start();
  assert.deepEqual(output,['42']);assert.deepEqual(project,before);
});

function conditionalProject(platform,architecture,toolkit='gtk3') {
  const absent=platform==='linux'?['Win16','Win32','Win64','Mac','MacOS','VBWEB','X86','I386','IA32',toolkit==='gtk4'?'GTK3':'GTK4',...(architecture==='arm64'?['X86_64','AMD64']:['ARM64','AARCH64'])]:platform==='win32'?['Win16','Win64','Mac','MacOS','Linux','Unix','GTK','GTK3','GTK4','ARM64','AARCH64','X86_64','AMD64','VBWEB']:['Win16','Win32','Win64','Linux','GTK','GTK3','GTK4','X86','I386','IA32','X86_64','AMD64','VBWEB'];
  const present=platform==='linux'?['LINUX','UNIX','GTK',toolkit.toUpperCase(),...(architecture==='arm64'?['ARM64','AARCH64']:['X86_64','AMD64'])]:platform==='win32'?['WIN32','X86','I386','IA32']:['MAC','MACOS','UNIX','ARM64','AARCH64'];
  const guards=[...absent.map(symbol=>`{$IFDEF ${symbol}} Unexpected target ${symbol} !!! {$ENDIF}`),...present.map(symbol=>`{$IFNDEF ${symbol}} Missing target ${symbol} !!! {$ENDIF}`)].join('\n');
  const project=createPascalProject(`program TargetMain; uses TargetUnit;
${guards}
begin WriteLn(Answer) end.`,{
    name:'TargetMain',settings:{conditionalConstants:{ZERO:0,win32:-1,ARM64:-1,X86_64:-1,Mac:-1,gtk3:-1,GTK4:-1,X86:-1,IA32:-1,Linux:-1}},
    units:[{name:'TargetUnit',code:`unit TargetUnit;
interface
${guards}
{$IFDEF ZERO} function Answer:Integer; {$ENDIF}
implementation
{$IFDEF ZERO} function Answer:Integer; begin Answer:=42 end; {$ENDIF}
end.`}],
  });
  // One mixed-project VB module must still observe ordinary numeric constants.
  project.modules.push({name:'Basic',language:'vb6',kind:'module',code:platform==='linux'?
    '#If Linux And (Win32 = 0) And '+toolkit.toUpperCase()+' And ('+(toolkit==='gtk4'?'GTK3':'GTK4')+' = 0) Then\nPublic Function PlatformName() As String\nPlatformName="VB_TARGET_OK"\nEnd Function\n#Else\nInvalid VB target\n#End If'
    :platform==='win32'?'#If Win32 And X86 And IA32 And (Win64 = 0) And (Linux = 0) And (VBWEB = 0) Then\nPublic Function PlatformName() As String\nPlatformName="VB_TARGET_OK"\nEnd Function\n#Else\nInvalid VB target\n#End If'
    :'#If MacOS And ARM64 And (Win32 = 0) Then\nPublic Function PlatformName() As String\nPlatformName="VB_TARGET_OK"\nEnd Function\n#Else\nInvalid VB target\n#End If'});
  return project;
}

for(const architecture of ['x64','arm64'])for(const toolkit of ['gtk3','gtk4'])test('Linux '+architecture+' '+toolkit+' target symbols select identical Pascal branches in current and imported units',()=>{
  const project=conditionalProject('linux',architecture,toolkit),before=structuredClone(project);
  const compiled=compileLinuxAOT(project,{architecture,toolkit});
  assert.ok(compiled.section.length>0);assert.equal(compiled.report.toolkit,toolkit);assert.equal(compiled.report.machine,architecture==='arm64'?183:62);
  assert.ok(compiled.metadata.modules.some(module=>module.name==='TargetUnit'));
  assert.ok(compiled.metadata.literals.some(literal=>literal.value==='VB_TARGET_OK'));
  assert.deepEqual(project,before);
});

test('macOS false platform constants stay undefined for Pascal without changing VB values',()=>{
  const project=conditionalProject('macos','arm64'),before=structuredClone(project),compiled=compileMacOSAOT(project);
  assert.ok(compiled.section.length>0);assert.equal(compiled.report.architecture,'arm64');
  assert.ok(compiled.metadata.literals.some(literal=>literal.value==='VB_TARGET_OK'));
  assert.deepEqual(project,before);
});

test('macOS source kit uses the same Pascal target symbol contract as AOT',()=>{
  const project=conditionalProject('macos','arm64'),before=structuredClone(project),compiled=compileMacOS(project);
  const literal='Text{'+[...'VB_TARGET_OK'].map(character=>'char16_t(0x'+character.charCodeAt(0).toString(16)+')').join(',')+'}';
  assert.ok(compiled.files['main.cpp'].includes(literal));
  assert.equal(compiled.report.architecture,'arm64');assert.deepEqual(project,before);
});

test('Win32 IA32 target symbols reach current and imported Pascal units without changing the input project',()=>{
  const project=conditionalProject('win32','x86'),before=structuredClone(project),compiled=compileWin32(project);
  assert.ok(compiled.bytes.length>0);assert.equal(compiled.report.architecture,'x86');
  assert.ok(compiled.report.sourceMap.some(entry=>entry.module==='TargetUnit'||entry.source==='TargetUnit'));
  assert.deepEqual(project,before);
});
