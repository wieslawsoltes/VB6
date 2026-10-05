import test from 'node:test';
import assert from 'node:assert/strict';
import {importFiles,sourceFiles,selectWorkspaceProject,workspaceProjects,parseVBG} from '../src/project/formats.js';
import {encodeNativeText,bytesOf,decodeNativeText} from '../src/project/native-text.js';
import {newProject,createControl} from '../src/project/model.js';
const utf8=s=>new TextEncoder().encode(s),text=v=>new TextDecoder().decode(bytesOf(v));
const frm=`VERSION 5.00\r\n' native form comment\r\nBegin VB.Form Main\r\n   Caption = "Don''t normalize me" ' keep comment\r\n   ClientHeight = 2400\r\n   ClientWidth = 3600\r\n   BeginProperty Font\r\n      Name = "Arial"\r\n      Size = 8.25\r\n      Weight = 550 ' retain native weight\r\n      Charset = 238\r\n   EndProperty\r\n   Begin VB.CommandButton Button1\r\n      Caption = "OK"\r\n      Left = 120\r\n      Width = 900\r\n      Vendor.Indexed(0) = 17 ' vendor value\r\n   End\r\n   ' footer\r\nEnd\r\nAttribute VB_Name = "Main"\r\nAttribute VB_PredeclaredId = True\r\nOption Explicit\r\n\r\nPrivate Sub Button1_Click()\r\nAttribute Button1_Click.VB_Description = "event"\r\n    Debug.Print "original"\r\nEnd Sub\r\n`;
const bas='Attribute VB_Name = "Utils"\r\nOption Explicit\r\nPublic Sub Helper()\r\nAttribute Helper.VB_Description = "Keep me"\r\nEnd Sub';
const cls='VERSION 1.0 CLASS\r\nBEGIN\r\n  MultiUse = -1  \'True\r\n  Persistable = 0\r\nEND\r\nAttribute VB_Name = "Thing"\r\nAttribute VB_Exposed = False\r\nOption Explicit\r\nPublic Property Get Value() As Long\r\nAttribute Value.VB_UserMemId = 0\r\n  Value = 1\r\nEnd Property\r\nPublic Property Let Value(ByVal rhs As Long)\r\nEnd Property\r\n';
const vbp='Type=Exe\r\n\'Project comment\r\nForm=ui\\Main.frm\r\nModule=Utils; code\\Utils.bas\r\nClass=Thing; code\\Thing.cls\r\nStartup="Main"\r\nName="NativeApp"\r\nReference=*\\G{TEST}#1.0#0#C:\\old\\dep.dll#Dependency\r\nTitle="Custom Title"\r\nUnknownSetting=42  \'keep\r\n[Vendor]\r\nForm=not-a-member.frm\r\nSetting=exact';
function fixture(){return new Map([['app/App.vbp',utf8(vbp)],['app/ui/Main.frm',utf8(frm)],['app/code/Utils.bas',utf8(bas)],['app/code/Thing.cls',utf8(cls)],['app/App.vbw',Uint8Array.of(0xff,1,2)],['app/ui/Main.frx',Uint8Array.of(0,1,255,128)],['related/readme.txt',utf8('opaque related file')]]);}
async function load(entries=fixture(),options={}){return (await importFiles(entries,options)).project;}
function unchanged(entries,files){for(const [path,value]of entries)assert.deepEqual(bytesOf(files[path]),bytesOf(value),path);assert.deepEqual(Object.keys(files).sort(),[...entries.keys()].sort());}
test('native no-op export preserves all original bytes, order, comments, envelopes and unknown sections',async()=>unchanged(fixture(),sourceFiles(await load())));
test('web snapshot of native project retains lossless native metadata and bytes',async()=>{const p=await load(),q=await load(new Map([['snapshot.vb6web',JSON.stringify(p)]]));unchanged(fixture(),sourceFiles(q));assert.equal(q.storageFormat,'web');});
test('native export is pure and repeatable',async()=>{const p=await load(),before=JSON.stringify(p),a=sourceFiles(p);assert.equal(JSON.stringify(p),before);for(const [k,v]of Object.entries(sourceFiles(p)))assert.deepEqual(bytesOf(v),bytesOf(a[k]));});
test('designer property edits retain untouched native formatting and opaque records',async()=>{const p=await load();p.modules[0].form.controls[0].properties.Caption='New';const s=text(sourceFiles(p)['app/ui/Main.frm']);assert.ok(s.includes('Caption = "New"'));assert.ok(s.includes('Vendor.Indexed(0) = 17 \' vendor value'));assert.ok(s.includes('Weight = 550 \' retain native weight'));assert.ok(s.includes("' native form comment"));assert.ok(s.endsWith(frm.slice(frm.indexOf('Attribute VB_Name'))));});
test('changed font properties keep original comments',async()=>{const p=await load();p.modules[0].form.properties.FontBold=-1;const s=text(sourceFiles(p)['app/ui/Main.frm']);assert.ok(s.includes("Weight = 700 ' retain native weight"));});
test('code edit retains member attributes at only the original property accessor',async()=>{const p=await load(),m=p.modules[2];m.code=m.code.replace('Value = 1','Value = 2');const s=text(sourceFiles(p)[m.sourcePath]);assert.equal((s.match(/Attribute Value.VB_UserMemId/g)||[]).length,1);assert.ok(s.indexOf('Attribute Value.')<s.indexOf('Public Property Let'));assert.ok(s.startsWith(cls.slice(0,cls.indexOf('Attribute VB_Name'))));assert.ok(s.includes('Value = 2'));});
test('source rename updates VB_Name and native membership without regenerating other settings',async()=>{const p=await load(),m=p.modules[1];m.name='Helpers';m.sourcePath='app/shared/Helpers.bas';const files=sourceFiles(p);assert.ok(text(files['app/App.vbp']).includes('Module=Helpers; shared\\Helpers.bas'));assert.ok(text(files[m.sourcePath]).includes('Attribute VB_Name = "Helpers"'));assert.ok(text(files['app/App.vbp']).endsWith('[Vendor]\r\nForm=not-a-member.frm\r\nSetting=exact'));});
test('deleting a procedure with hidden attributes fails instead of silently dropping metadata',async()=>{const p=await load();p.modules[1].code='Option Explicit\n';assert.throws(()=>sourceFiles(p),/owns hidden attributes/);});
test('adding and removing project members patches membership only',async()=>{const p=await load();p.modules.splice(1,1);p.modules.push({id:'new',kind:'module',name:'Added',code:'Option Explicit\n',sourcePath:'app/code/Added.bas'});const f=sourceFiles(p);assert.ok(!text(f['app/App.vbp']).includes('Module=Utils;'));assert.ok(text(f['app/App.vbp']).includes('Module=Added; code\\Added.bas'));assert.ok(!Object.hasOwn(f,'app/code/Utils.bas'));});
test('duplicate source membership round trips and can be removed consistently',async()=>{const f=fixture();f.set('app/App.vbp',utf8(vbp.replace('Startup=', 'Module=Utils; code\\Utils.bas\r\nStartup=')));const p=await load(f);unchanged(f,sourceFiles(p));p.modules=p.modules.filter(m=>m.name!=='Utils');assert.equal((text(sourceFiles(p)['app/App.vbp']).match(/Module=Utils/g)||[]).length,0);});
test('new controls and removed controls survive native save/reopen',async()=>{const p=await load();const c=createControl('Label','NewLabel',12,14);p.modules[0].form.controls=[c];const q=await load(new Map(Object.entries(sourceFiles(p))));assert.deepEqual(q.modules[0].form.controls.map(c=>c.name),['NewLabel']);});
test('legal relative dot paths and quoted semicolon source paths remain byte identical',async()=>{const f=new Map([['app/Proj.vbp',utf8('Type=Exe\r\nModule=M; "..\\shared\\foo;bar.bas"\r\nName="P"\r\nStartup="Sub Main"')],['shared/foo;bar.bas',utf8('Attribute VB_Name = "M"\r\nSub Main()\r\nEnd Sub')]]);unchanged(f,sourceFiles(await load(f)));});
for(const encoding of ['windows-1252','windows-1250','windows-1251','shift_jis','utf-8','utf-16le','utf-16be'])test('byte-exact '+encoding+' preservation and encoded edits',async()=>{const phrase=({'windows-1252':'café €','windows-1250':'żółć','windows-1251':'Привет',shift_jis:'日本語'})[encoding]||'Zażółć 日本語';const source='Attribute VB_Name = "M"\r\nPublic Const S = "'+phrase+'"\r\n',doc={encoding,bom:encoding.startsWith('utf-')},data=bytesOf(encodeNativeText(source,doc)),files=new Map([['M.bas',data]]);const p=await load(files,{encoding});assert.deepEqual(bytesOf(sourceFiles(p)['M.bas']),data);p.modules[0].code+='\nPublic X As Long\n';assert.ok(decodeNativeText(bytesOf(sourceFiles(p)['M.bas']),{encoding}).text.includes(phrase));});
test('unrepresentable native edit rejects the complete save without replacement characters',async()=>{const p=await load(new Map([['M.bas',Uint8Array.from(Buffer.from('Attribute VB_Name = "M"\r\n\' café','latin1'))]]));p.modules[0].code+='\n\' 日本語';assert.throws(()=>sourceFiles(p),/represent|1252/i);});
for(const [kind,ext,root]of [['UserControl','ctl','VB.UserControl'],['PropertyPage','pag','VB.PropertyPage'],['UserDocument','dob','VB.UserDocument']])test(kind+' membership and designer data preserved',async()=>{const f=new Map([['P.vbp',utf8('Type=Control\r\n'+kind+'=Main.'+ext+'\r\nName="P"\r\nStartup="Main"\r\n')],['Main.'+ext,utf8(frm.replace('VB.Form',root))],['Main.ctx',Uint8Array.of(4,9,8)]]);unchanged(f,sourceFiles(await load(f)));});
test('custom DSR designer and DSX companion remain opaque and exact',async()=>{const f=new Map([['P.vbp',utf8('Type=Exe\r\nDesigner=Report.dsr\r\nName="P"\r\nStartup="Sub Main"\r\n')],['Report.dsr',utf8('VERSION 5.00\r\nBegin {GUID} Report\r\nVendor = 42\r\nEnd\r\nAttribute VB_Name = "Report"\r\nOption Explicit\r\n')],['Report.dsx',Uint8Array.of(255,1,2)]]);unchanged(f,sourceFiles(await load(f)));});
test('missing members remain in project with diagnostic and no fabricated source',async()=>{const f=new Map([['P.vbp',utf8('Type=Exe\r\nForm=Missing.frm\r\nName="P"\r\nStartup="Missing"')]]),r=await importFiles(f);assert.equal(r.project.modules.length,0);assert.ok(r.diagnostics.some(d=>d.severity==='error'));unchanged(f,sourceFiles(r.project));});
test('case-insensitive and normalized duplicate paths are rejected',async()=>{for(const entries of [[['X.bas',bas],['x.BAS',bas]],[['a/../X.bas',bas],['X.bas',bas]]])await assert.rejects(()=>load(entries),/Duplicate/);});
test('ambiguous project entry requires explicit selection',async()=>{const f=fixture();f.set('Other.vbp',utf8('Name="Other"'));await assert.rejects(()=>load(f),/entryPath/);assert.equal((await load(f,{entryPath:'app/App.vbp'})).name,'NativeApp');});
function group(){return new Map([['Group.vbg',utf8('VBGROUP 5.0\r\nProject=two\\B.vbp\r\nStartupProject=one\\A.vbp\r\n\'keep group comment\r\n[Extra]\r\nX=1')],['one/A.vbp',utf8('Type=Exe\r\nModule=Shared; ..\\shared\\Shared.bas\r\nName="A"\r\nStartup="Sub Main"\r\n')],['two/B.vbp',utf8('Type=OleDll\r\nModule=Shared; ..\\shared\\Shared.bas\r\nName="B"\r\nStartup="Sub Main"\r\n')],['shared/Shared.bas',utf8('Attribute VB_Name = "Shared"\r\nPublic Sub Main()\r\nEnd Sub\r\n')],['Group.vbw',Uint8Array.of(4,2,6)]]);}
test('VBG group round trip preserves startup, other projects and all companion files',async()=>{const f=group(),p=await load(f);assert.equal(p.name,'A');assert.equal(workspaceProjects(p).length,2);unchanged(f,sourceFiles(p));const q=selectWorkspaceProject(p,'TWO/b.VBP');assert.equal(q.name,'B');unchanged(f,sourceFiles(q));});
test('group switching keeps edits to each project and web snapshots preserve all projects',async()=>{let p=await load(group());p.name='ChangedA';p=selectWorkspaceProject(p,'two/B.vbp');p.name='ChangedB';p=await load(new Map([['all.vb6web',JSON.stringify(p)]]));const f=sourceFiles(p);assert.ok(text(f['one/A.vbp']).includes('Name="ChangedA"'));assert.ok(text(f['two/B.vbp']).includes('Name="ChangedB"'));});
test('shared file edits from one project win over untouched peers; divergent edits cancel save',async()=>{let p=await load(group());p.modules[0].code+='\nPublic X As Long\n';assert.ok(text(sourceFiles(p)['shared/Shared.bas']).includes('Public X'));p=selectWorkspaceProject(p,'two/B.vbp');p.modules[0].code+='\nPublic Y As Long\n';assert.throws(()=>sourceFiles(p),/Conflicting edits to shared/);});
test('changing VBG startup retains old startup as a group member',async()=>{const p=await load(group());p.nativeWorkspace.startupPath='two/B.vbp';const f=sourceFiles(p),meta=parseVBG(text(f['Group.vbg']));assert.equal(meta.projects.length,2);const q=await load(new Map(Object.entries(f)));assert.equal(q.name,'B');assert.equal(workspaceProjects(q).length,2);});
test('malformed cyclic/nested web group metadata is rejected',async()=>{const p=await load(group());p.nativeWorkspace.peers[0].nativeWorkspace={};await assert.rejects(()=>load(new Map([['p.vb6web',JSON.stringify(p)]])),/Nested/);});
import {readFRXRecord,writeFRXRecord,toBase64} from '../src/project/frx.js';
test('FRX text/list decoding and copy-on-write use the selected legacy code page',async()=>{const bytes=writeFRXRecord('żółć','text32',{encoding:'windows-1250'}),f=new Map([['P.vbp',utf8('Type=Exe\r\nForm=Main.frm\r\nName="P"\r\nStartup="Main"')],['Main.frm',utf8(frm.replace('Caption = "Don\'\'t normalize me"', 'Caption = $"Main.frx":0000'))],['Main.frx',bytes]]);const p=await load(f,{encoding:'windows-1250'});assert.equal(p.modules[0].form.properties.Caption,'żółć');unchanged(f,sourceFiles(p));p.modules[0].form.properties.Caption='zażółć';const out=sourceFiles(p);assert.deepEqual(bytesOf(out['Main.frx']).slice(0,bytes.length),bytes);const q=await load(new Map(Object.entries(out)),{encoding:'windows-1250'});assert.equal(q.modules[0].form.properties.Caption,'zażółć');const list=writeFRXRecord(['żółć','Łódź'],'list',{encoding:'windows-1250'});assert.deepEqual(readFRXRecord(list,0,'List',{encoding:'windows-1250'}).items,['żółć','Łódź']);});
test('new user-control resources use CTX rather than overwriting the CTL source',()=>{const p=newProject(),m=p.modules[0];m.nativeKind='UserControl';m.sourcePath='Form1.ctl';m.form.properties.Caption='Line 1\nLine 2';const f=sourceFiles(p);assert.ok(f['Form1.ctx']);assert.ok(text(f['Form1.ctl']).includes('"Form1.ctx"'));});
import {nativeOutputPath,planNativeDirectoryWrite,writeNativeDirectory,readNativeDirectory} from '../src/project/native-directory.js';

test('editing unrelated VBP settings preserves duplicate setting records',async()=>{
  const f=fixture();f.set('app/App.vbp',utf8(vbp.replace('Title=', 'Vendor=first\r\nVendor=second\r\nTitle=')));
  const p=await load(f);p.nativeProject.entries.find(r=>r.key==='UnknownSetting').value='43';
  const s=text(sourceFiles(p)['app/App.vbp']);assert.ok(s.includes('Vendor=first\r\nVendor=second'));assert.ok(s.includes("UnknownSetting=43  'keep"));
});
test('editing one duplicate setting does not coalesce the other occurrences',async()=>{
  const f=fixture();f.set('app/App.vbp',utf8(vbp.replace('Title=', 'Vendor=first\r\nVendor=second\r\nTitle=')));
  const p=await load(f);p.nativeProject.entries.filter(r=>r.key==='Vendor')[1].value='changed';
  assert.ok(text(sourceFiles(p)['app/App.vbp']).includes('Vendor=first\r\nVendor=changed'));
});
for(const path of ["app/code/O'Brien.bas",'app/code/space name.bas','app/code/a;b.bas'])test('renamed membership quotes '+path,async()=>{
  const p=await load();p.modules[1].sourcePath=path;const q=await load(Object.entries(sourceFiles(p)));assert.equal(q.modules[1].sourcePath,path);
});
for(const ref of ['C:\\old\\Utils.bas','..\\..\\outside\\Utils.bas'])test('relocate only a supplied source: '+ref,async()=>{
  const f=fixture();f.set('app/App.vbp',utf8(vbp.replace('code\\Utils.bas',ref)));const r=await importFiles(f);assert.equal(r.project.modules.length,3);
  assert.ok(r.diagnostics.some(d=>/Relocated/.test(d.message)));const out=sourceFiles(r.project);assert.ok(text(out['app/App.vbp']).includes('Module=Utils; code\\Utils.bas'));assert.equal((await load(Object.entries(out))).modules.length,3);
});
test('ambiguous supplied basename stays opaque with all original files retained',async()=>{
  const f=fixture();f.set('other/Utils.bas',utf8(bas));f.set('app/App.vbp',utf8(vbp.replace('code\\Utils.bas','C:\\old\\Utils.bas')));const r=await importFiles(f);
  assert.ok(r.diagnostics.some(d=>/Ambiguous/.test(d.message)));assert.equal(r.project.modules.length,2);unchanged(f,sourceFiles(r.project));
});
test('VBG relocation rewrites supplied external VBP references',async()=>{
  const f=group();f.set('Group.vbg',utf8('VBGROUP 5.0\r\nProject=C:\\old\\B.vbp\r\nStartupProject=C:\\old\\A.vbp'));
  const p=await load(f),out=sourceFiles(p),q=await load(Object.entries(out));assert.equal(q.name,'A');assert.equal(workspaceProjects(q).length,2);assert.ok(text(out['Group.vbg']).includes('StartupProject=one\\A.vbp'));
});
test('ASCII native source defaults to ANSI when an accented edit is made',async()=>{
  const p=await load(new Map([['M.bas',utf8('Attribute VB_Name = "M"\r\nOption Explicit\r\n')]]));assert.equal(p.modules[0].sourceEncoding,'windows-1252');p.modules[0].code+="' café\n";assert.ok(bytesOf(sourceFiles(p)['M.bas']).includes(0xe9));
});
test('non-project JSON is not offered or selected as a project',async()=>{
  const f=fixture();f.set('config.json',utf8('{"mode":"production"}'));const {listProjectEntries}=await import('../src/project/formats.js');assert.deepEqual(listProjectEntries(f).map(e=>e.path),['app/App.vbp']);unchanged(f,sourceFiles(await load(f)));
});
test('multiple valid generic JSON projects require explicit selection',async()=>{
  const p=JSON.stringify(newProject());await assert.rejects(()=>load(new Map([['a.json',p],['b.json',p]])),/entryPath/);
});
test('explicit native selection coexists with vb6proj and web snapshot formats',async()=>{
  const f=fixture();f.set('current.vb6proj',JSON.stringify(newProject('Web')));assert.equal((await load(f)).name,'Web');assert.equal((await load(f,{entryPath:'app/App.vbp'})).name,'NativeApp');
});
test('project description is imported and patched without changing native Title',async()=>{
  const f=fixture();f.set('app/App.vbp',utf8(vbp.replace('Title=', 'Description="Description"\r\nTitle=')));const p=await load(f);assert.equal(p.description,'Description');p.description='Edited';const out=text(sourceFiles(p)['app/App.vbp']);assert.ok(out.includes('Description="Edited"'));assert.ok(out.includes('Title="Custom Title"'));
});
test('native .res no-op export keeps dotted reference and opaque original bytes',async()=>{
  const {writeRES,setResourceString}=await import('../src/project/res.js');const f=fixture();f.set('app/App.vbp',utf8(vbp.replace('Title=', 'ResFile32=".\\resources.res"\r\nTitle=')));f.set('app/resources.res',writeRES(setResourceString({fileName:'app/resources.res',entries:[]},101,'test')));unchanged(f,sourceFiles(await load(f)));
});
test('explicit resource removal removes native membership, not a dangling reference',async()=>{
  const {writeRES,setResourceString}=await import('../src/project/res.js');const f=fixture();f.set('app/App.vbp',utf8(vbp.replace('Title=', 'ResFile32="resources.res"\r\nTitle=')));f.set('app/resources.res',writeRES(setResourceString({fileName:'app/resources.res',entries:[]},101,'test')));const p=await load(f);delete p.resources;assert.ok(!text(sourceFiles(p)['app/App.vbp']).includes('ResFile32'));
});
test('moving a VBP rebases read-only related documents too',async()=>{
  const f=fixture();f.set('app/App.vbp',utf8(vbp.replace('Title=','RelatedDoc=..\\related\\readme.txt\r\nTitle=')));const p=await load(f);p.nativeProject.path='moved/nested/App.vbp';assert.ok(text(sourceFiles(p)[p.nativeProject.path]).includes('RelatedDoc=..\\..\\related\\readme.txt'));
});
test('edited procedure attributes stay attached to exactly one accessor',async()=>{
  const p=await load(),m=p.modules[2];m.attributes=m.attributes.map(a=>a.replace('VB_UserMemId = 0','VB_UserMemId = 7'));m.attributes.push('Attribute Value.VB_Description = "Updated"');const out=text(sourceFiles(p)[m.sourcePath]);assert.equal((out.match(/VB_UserMemId/g)||[]).length,1);assert.ok(out.indexOf('VB_Description')<out.indexOf('Public Property Let'));assert.ok(out.includes('VB_UserMemId = 7'));
});
test('new procedure attributes can be written through the existing metadata API',async()=>{
  const p=await load(),m=p.modules[1];m.attributes.push('Attribute Helper.VB_HelpID = 42');const out=text(sourceFiles(p)[m.sourcePath]);assert.ok(out.includes('Attribute Helper.VB_HelpID = 42'));assert.ok(out.indexOf('Public Sub Helper')<out.indexOf('VB_HelpID'));
});
test('module variable attributes survive unrelated source edits',async()=>{
  const source='Attribute VB_Name = "M"\r\nPublic WithEvents Source As Thing\r\nAttribute Source.VB_VarHelpID = -1\r\nPublic X As Long\r\n';const p=await load(new Map([['M.bas',utf8(source)]]));p.modules[0].code+='Public Y As Long\n';assert.ok(text(sourceFiles(p)['M.bas']).includes('Public WithEvents Source As Thing\r\nAttribute Source.VB_VarHelpID = -1'));
});
test('edited class envelope settings are not silently ignored',async()=>{
  const p=await load(),m=p.modules[2];m.nativeClassHeader=m.nativeClassHeader.replace('Persistable = 0','Persistable = 1');assert.ok(text(sourceFiles(p)[m.sourcePath]).includes('Persistable = 1'));
});
test('unsupported structured data cancels native export instead of silently dropping it',async()=>{
  const p=await load();p.modules[0].form.controls[0].properties.GridData=[['important']];assert.throws(()=>sourceFiles(p),/structured property/);assert.ok(JSON.stringify(p).includes('important'));
});
test('group startup must remain an actual open member',async()=>{
  const p=await load(group());p.nativeWorkspace.startupPath='not-present.vbp';assert.throws(()=>sourceFiles(p),/Startup project/);
});
test('group manifest cannot overwrite a project or source file',async()=>{
  const p=await load(group());p.nativeWorkspace.path='one/A.vbp';assert.throws(()=>sourceFiles(p),/collides/);
});
test('invalid opaque designer edits cancel saving rather than damaging its bytes',async()=>{
  const f=new Map([['P.vbp',utf8('Type=Exe\r\nDesigner=Report.dsr\r\nName="P"\r\nStartup="Sub Main"')],['Report.dsr',utf8('VERSION 5.00\r\nBegin {GUID} Report\r\nEnd\r\nAttribute VB_Name = "Report"\r\nOption Explicit\r\n')]]);const p=await load(f);p.modules[0].code+='Public X As Long\n';assert.throws(()=>sourceFiles(p),/cannot be edited safely/);
});
for(const [encoding,phrase]of [['windows-1253','Ελλάδα'],['windows-1254','İstanbul'],['windows-1255','שלום'],['windows-1256','العربية'],['windows-1257','Lietuvių'],['windows-1258','Việt'],['windows-874','ไทย'],['gbk','中文'],['big5','繁體'],['euc-kr','한국어']])test('legacy encoder '+encoding,()=>{
  // Choose representable characters; unrepresentable inputs always fail closed.
  if(encoding==='windows-1258')assert.throws(()=>encodeNativeText(phrase,{encoding}),/representable/);
  else assert.equal(decodeNativeText(bytesOf(encodeNativeText(phrase,{encoding})),{encoding}).text,phrase);
});
for(const eol of ['\n','\r','\r\n'])test('no-op preserves '+JSON.stringify(eol)+' and no trailing newline',async()=>{
  const data=utf8(bas.replace(/\r\n/g,eol));const p=await load(new Map([['Utils.bas',data]]));assert.deepEqual(bytesOf(sourceFiles(p)['Utils.bas']),data);
});
