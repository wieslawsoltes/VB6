import test from 'node:test';
import assert from 'node:assert/strict';
import {compileLinuxAOT,linuxOptions,linuxTarget,linuxToolkit,linuxArtifactFilename,linkLinuxAOT,verifyLinuxAOTArchive,linuxControlReport} from '../packages/linux-native/src/index.js';
import {createLinuxAOTRuntimeManifest,inspectLinuxELF,verifyLinuxAOTRuntime} from '../packages/linux-native/src/elf.js';
import {linuxELFFixture} from './linux-aot-elf-fixture.mjs';

const project={schema:1,name:'GtkChoice',startup:'Sub Main',modules:[{name:'Main',kind:'module',code:`
#If GTK4 And (GTK3 = 0) Then
Sub Main()
Debug.Print "GTK4_SELECTED"
End Sub
#Else
Sub Main()
Debug.Print "GTK3_SELECTED"
End Sub
#End If`}]};
for(const architecture of ['x64','arm64'])for(const toolkit of ['gtk3','gtk4']){
  test(`${architecture} ${toolkit} selects the frontend constants and actual ELF toolkit`,async()=>{
    const before=structuredClone(project),compiled=compileLinuxAOT(project,{architecture,toolkit});
    assert.equal(compiled.report.toolkit,toolkit);assert.equal(compiled.options.toolkit,toolkit);
    assert.ok(compiled.metadata.literals.some(value=>value.value===toolkit.toUpperCase()+'_SELECTED'));
    assert.ok(!compiled.metadata.literals.some(value=>value.value===(toolkit==='gtk4'?'GTK3':'GTK4')+'_SELECTED'));
    assert.deepEqual(project,before);
    const bytes=linuxELFFixture(architecture,toolkit),manifest=await createLinuxAOTRuntimeManifest(bytes,{fixture:true});
    assert.equal(manifest.toolkit,toolkit);assert.equal(inspectLinuxELF(bytes,{architecture,toolkit}).image.toolkit,toolkit);
    const linked=await linkLinuxAOT(compiled,{bytes,manifest});
    const verified=await verifyLinuxAOTArchive(linked.bytes,linked.options);
    assert.equal(verified.toolkit,toolkit);assert.equal(verified.image.toolkit,toolkit);
    assert.equal(linked.report.minimumGTK,toolkit==='gtk4'?'4.14':'3.24');
    assert.match(new TextDecoder().decode(linked.files['GtkChoice/README.txt']),toolkit==='gtk4'?/GTK 4\.14/:/GTK 3\.24/);
    assert.equal(linked.filename,`GtkChoice-linux-${architecture}${toolkit==='gtk4'?'-gtk4':''}.zip`);
    const other=toolkit==='gtk4'?'gtk3':'gtk4';
    await assert.rejects(verifyLinuxAOTArchive(linked.bytes,{...linked.options,toolkit:other}),/toolkit/);
    await assert.rejects(verifyLinuxAOTRuntime(bytes,{...manifest,toolkit:other}),/toolkit/);
    await assert.rejects(linkLinuxAOT(compileLinuxAOT(project,{architecture,toolkit:other}),{bytes,manifest}),/toolkits do not match/);
  });
}
test('GTK4 option validation preserves GTK3 defaults and architecture aliases',()=>{
  assert.equal(linuxOptions().toolkit,'gtk3');assert.equal(linuxOptions({arch:'x86_64',toolkit:'gtk4'}).architecture,'x64');
  assert.equal(linuxTarget('arm64','gtk4').minimumGTK,'4.14');assert.equal(linuxTarget('x64').minimumGTK,'3.24');
  for(const toolkit of ['GTK4','gtk2',null,{},4])assert.throws(()=>linuxToolkit(toolkit),/toolkit/);
  assert.throws(()=>linuxOptions({architecture:'arm64',arch:'x64',toolkit:'gtk4'}),/Conflicting/);
  const filename=linuxArtifactFilename('日'.repeat(85),'arm64','.tar.gz','gtk4');
  assert.ok(new TextEncoder().encode(filename).length<=255);assert.match(filename,/-linux-arm64-gtk4\.tar\.gz$/);
});
test('GTK4 reports native menu, radio and toolbar implementations',()=>{
  const form={modules:[{name:'F',form:{name:'F',type:'Form',controls:[{name:'Choice',type:'OptionButton'},{name:'Tools',type:'Toolbar'}],menus:[{name:'File'}]}}]};
  const gtk4=Object.fromEntries(linuxControlReport(form,'gtk4').map(value=>[value.type,value.native]));
  assert.equal(gtk4.Menu,'GMenu/GtkPopoverMenuBar');assert.equal(gtk4.OptionButton,'GtkCheckButton');assert.equal(gtk4.Toolbar,'GtkBox/GtkButton');
  assert.equal(linuxControlReport(form).find(value=>value.type==='Menu').native,'GtkMenuItem');
});
