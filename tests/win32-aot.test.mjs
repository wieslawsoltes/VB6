import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {PE32Image,BinarySection,PE32_BASE} from '../src/native/pe32.js';
import {X86} from '../src/native/x86.js';
import {compileWin32,extractNativeDeclarations} from '../src/native/compiler.js';
import {newProject,createControl} from '../src/project/model.js';
import {inspectPE} from '../tools/pe.mjs';
import {parseWin32Options,buildWin32} from '../tools/build-win32.mjs';
import {win32Fixtures} from '../tools/win32-fixtures.mjs';
const buildCode=code=>{const p=newProject('CodeTest');p.modules[0].code=code;return compileWin32(p);};
function minimal() {const image=new PE32Image(),code=image.section('.text',0x60000020),data=image.section('.data',0xc0000040);data.label('number').u32(42);const x=new X86(code,image);x.label('entry').value({memory:'number'}).push().invoke('kernel32.dll','ExitProcess');return {image,code,data};}
function view(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function offset(result,rva){const section=result.sections.find(s=>rva>=s.rva&&rva<s.rva+s.size);assert.ok(section,'mapped RVA');return section.offset+rva-section.rva;}
test('PE linker creates deterministic, ASLR-capable x86 images without a binary template',()=>{
  const result=minimal().image.finish('entry');const b=Buffer.from(result.bytes),pe=inspectPE(b),v=view(b),h=v.getUint32(0x3c,true)+24;
  assert.equal(pe.arch,'x86');assert.equal(pe.format,'PE32');assert.equal(pe.dll,false);assert.deepEqual(pe.imports,['kernel32.dll']);
  assert.equal(v.getUint32(h+28,true),PE32_BASE);assert.equal(v.getUint16(h+70,true)&0x140,0x140);assert.ok(v.getUint32(h+96+5*8,true));
  assert.deepEqual(result.bytes,minimal().image.finish('entry').bytes);
  for(const section of result.sections)assert.notEqual(section.flags&0xa0000000,0xa0000000,'no writable executable section');
});
test('PE import deduplication handles names, case and ordinals',()=>{
  const {image}=minimal();const a=image.import('USER32.dll','GetMessageW');assert.equal(a,image.import('user32.dll','GetMessageW'));
  image.import('user32.dll',12);const result=image.finish('entry');assert.equal(result.imports.filter(i=>i.dll==='user32.dll').length,2);
  assert.deepEqual(inspectPE(result.bytes).imports,['kernel32.dll','user32.dll']);
});
test('PE relocations describe every absolute pointer and never relative branches',()=>{
  const {image,code}=minimal();code.label('again').emit(0xe9).reference('entry','rel').u32(0);
  const result=image.finish('entry'),v=view(result.bytes),header=v.getUint32(0x3c,true)+24;
  let rva=v.getUint32(header+136,true),end=rva+v.getUint32(header+140,true),pointers=[];
  while(rva<end){const at=offset(result,rva),page=v.getUint32(at,true),size=v.getUint32(at+4,true);assert.ok(size>=8&&size%4===0);for(let i=8;i<size;i+=2){const entry=v.getUint16(at+i,true);if(entry>>>12===3)pointers.push(page+(entry&4095));}rva+=size;}
  assert.equal(pointers.length,2);for(const at of pointers){const value=v.getUint32(offset(result,at),true);assert.ok(value>=PE32_BASE);assert.ok(value<PE32_BASE+0x10000);}
  const jmp=offset(result,result.symbols.again);assert.equal(v.getInt32(jmp+1,true),result.symbols.entry-result.symbols.again-5);
});
test('PE linker validates import paths, symbols, sizes and missing labels',()=>{
  for(const dll of ['../evil.dll','C:\\x.dll','\\\\host\\x.dll','x.dll\0','x.exe'])assert.throws(()=>minimal().image.import(dll,'Entry'));
  for(const value of [0,65536,-1,'','evil/entry','entry\0'])assert.throws(()=>minimal().image.import('x.dll',value));
  const {image,code}=minimal();code.reference('not-there');assert.throws(()=>image.finish('entry'),/symbol|label/i);
  assert.throws(()=>new BinarySection('x',0).zero(-1));assert.throws(()=>new BinarySection('x',0).zero(17*1024*1024));
});
test('assembler emits stdcall cleanup and guarded large stack frames',()=>{
  const image=new PE32Image(),code=image.section('.text',0x60000020),x=new X86(code,image);x.label('entry').enter(8200).leave(8);
  assert.equal(Buffer.from(code.bytes).subarray(-3).toString('hex'),'c20800');assert.equal(code.bytes.filter((b,i)=>b===0x81&&code.bytes[i+1]===0xec).length,3);
  assert.throws(()=>x.branch('never','entry'));assert.throws(()=>x.value(Number.NaN));
});
for(const project of win32Fixtures())test('AOT links fixture '+project.name+' with native imports and source maps',()=>{
  const result=compileWin32(project),pe=inspectPE(result.bytes);assert.equal(result.report.extraction,false);assert.equal(pe.classicRuntimeImport,false);
  assert.ok(pe.imports.includes('user32.dll'));assert.ok(result.report.sourceMap.length);assert.ok(result.bytes.length<100*1024);
  assert.deepEqual(compileWin32(project).bytes,result.bytes);
});
test('native MDI uses MDICLIENT/CreateMDIWindow/DefMDIChildProc, not DOM windows',()=>{
  const {report}=compileWin32(win32Fixtures()[2]);const names=report.imports.map(i=>i.symbol);for(const name of ['CreateMDIWindowW','DefMDIChildProcW','DefFrameProcW','TranslateMDISysAccel'])assert.ok(names.includes(name));
});
test('native modal loop and cancellation are linked to actual window APIs',()=>{
  const names=compileWin32(win32Fixtures()[1]).report.imports.map(i=>i.symbol);for(const name of ['EnableWindow','IsWindowEnabled','GetMessageW','IsDialogMessageW','DestroyWindow','SetWindowLongW'])assert.ok(names.includes(name));
});
test('Declare parsing preserves source lines, scope, aliases and exact numeric ABI',()=>{
  const result=extractNativeDeclarations({name:'M',code:'Option Explicit\nPrivate Declare Function Tick Lib "kernel32" Alias "GetTickCount" () As Long\nPublic Sub Main()\nEnd Sub'});
  assert.equal(result.code.split('\n').length,4);assert.equal(result.declarations.get('tick').symbol,'GetTickCount');assert.equal(result.declarations.get('tick').scope,'private');
  assert.equal(extractNativeDeclarations({name:'M',code:'Declare Function F Lib "x.dll" Alias "#42" (ByVal x As Long) As Integer'}).declarations.get('f').symbol,42);
});
for(const code of [
  'Private Declare Function F Lib "x" (ByVal s As String) As Long',
  'Private Declare Function F Lib "x" (x() As Long) As Long',
  'Private Declare Function F Lib "../x" () As Long'
])test('unsupported native Declare fails without producing a plausible executable: '+code,()=>assert.throws(()=>extractNativeDeclarations({name:'M',code})));
for(const [name,code] of [
  ['floating storage','Dim n As Double'],['dynamic arrays','Dim n() As Long'],
  ['unsupported arithmetic','Private Sub Form_Load()\n Dim n As Long\n n = 1 / 2\nEnd Sub'],

  ['unsupported event','Private Sub Form_KeyDown(KeyCode As Integer, Shift As Integer)\nEnd Sub'],
  ['ambiguous default variant','Private Sub F(n)\nEnd Sub']
])test('AOT fails closed for '+name,()=>assert.throws(()=>buildCode(code)));
test('AOT rejects unimplemented controls and WebGPU rather than silently changing targets',()=>{
  const p=newProject();p.modules[0].form.controls.push(createControl('OLE'));assert.throws(()=>compileWin32(p),/control/);
  assert.throws(()=>compileWin32(newProject(),{arch:'x64'}),/x86/);assert.throws(()=>compileWin32(newProject(),{graphics:'webgpu'}),/WebGPU/);
});
test('AOT does not mutate the project or strip declarations from the saved source',()=>{
  const p=win32Fixtures()[0],before=JSON.stringify(p);compileWin32(p);assert.equal(JSON.stringify(p),before);
});
test('Win32 CLI requires values and refuses unknown switches',()=>{
  assert.deepEqual(parseWin32Options(['--project','a.vbp','--graphics','gdi']),{project:'a.vbp',graphics:'gdi'});
  for(const args of [['--project'],['--wrong']])assert.throws(()=>parseWin32Options(args));
});
test('Win32 file build emits actual MZ bytes and refuses to replace an existing executable',async()=>{
  const out=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-aot-'));try{const input=path.join(out,'input.vb6web');await fs.writeFile(input,JSON.stringify(win32Fixtures()[0]));
  const result=await buildWin32({project:input,out});assert.equal(inspectPE(await fs.readFile(result.filename)).arch,'x86');assert.equal(result.extraction,false);
  await assert.rejects(buildWin32({project:input,out}),/exist/i);
  }finally{await fs.rm(out,{recursive:true,force:true});}
});
test('qualified calls respect private procedure and Declare scope',()=>{
  for(const target of ['Private Sub Hidden()\nEnd Sub','Private Declare Sub Hidden Lib "kernel32" Alias "Beep" ()']){
    const p=newProject();p.modules[0].code='Private Sub Form_Load()\n Module1.Hidden\nEnd Sub';
    p.modules.push({id:'m',name:'Module1',kind:'module',code:target});
    assert.throws(()=>compileWin32(p),/Private native procedure/);
  }
});
test('native declarations cannot shadow procedure or storage names',()=>{
  for(const declaration of ['Private Sub CallMe()\nEnd Sub','Private CallMe As Long']){
    assert.throws(()=>buildCode('Private Declare Sub CallMe Lib "x" ()\n'+declaration),/conflicts/);
  }
});
test('form initializers and default-instance method calls have distinct guarded initialization',()=>{
  const p=win32Fixtures()[1], result=compileWin32(p);
  const map=result.report.sourceMap.filter(e=>e.procedure==='Form_Initialize');assert.ok(map.length);
  const text=Buffer.from(result.bytes);assert.ok(text.includes(Buffer.from('Initialized native window','utf16le')));
});
test('invalid hWnd, form images and unsupported scale modes fail compilation',()=>{
  const p=newProject();p.modules[0].form.controls.push(createControl('Timer','Timer1'));
  p.modules[0].code='Private Sub Form_Load()\n Dim n As Long\n n = Timer1.hWnd\nEnd Sub';assert.throws(()=>compileWin32(p),/Timer has no hWnd/);
  for(const props of [{ScaleMode:2},{Picture:'x.bmp'},{Icon:'x.ico'}]){const form=newProject();Object.assign(form.modules[0].form.properties,props);assert.throws(()=>compileWin32(form),/ScaleMode|picture\/icon/);}
});
test('pixel and twip ScaleWidth lower to distinct explicit coordinate policies',()=>{
  const p=newProject();p.modules[0].code='Private Sub Form_Resize()\n Dim n As Long\n n = ScaleWidth\nEnd Sub';
  const twips=compileWin32(p);p.modules[0].form.properties.ScaleMode=3;const pixels=compileWin32(p);
  const section=r=>r.report.sections.find(s=>s.name==='.text');assert.equal(section(twips).size-section(pixels).size,3);
});

test('Frame controls retain native parent handles and forward their notifications',()=>{
  const p=win32Fixtures()[1],result=compileWin32(p),symbols=result.report.imports.map(i=>i.symbol);
  assert.ok(symbols.includes('SetWindowLongW'));assert.ok(symbols.includes('CallWindowProcW'));
  // The importer accepts declaration order that places children before their parents.
  const reversed=structuredClone(p);reversed.modules[0].form.controls.reverse();assert.ok(compileWin32(reversed).bytes.length);
});
