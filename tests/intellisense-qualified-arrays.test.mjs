import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorIntelligence} from '../src/editor/intelligence.js';
import {SourceEditor} from '../src/editor/editor.js';
import {ExpressionAssistance} from '../src/editor/expression-assistance.js';
import {VirtualMachine} from '../src/runtime/vm.js';

const customer={id:'customer',name:'Customer',kind:'class',code:'Public Name As String\nPublic Parent As Customer'};
const model=(name='Models')=>({id:name,name,kind:'module',code:'Public Type Point\nX As Long\nEnd Type\nPrivate Type Secret\nHidden As Long\nEnd Type\nPublic Enum Choices\nFirstChoice=1\nEnd Enum'});
const fixture=(code='',others=[])=>{const module={id:'main',name:'Main',kind:'module',code},project={name:'Project1',modules:[module,...others],settings:{}},service=new EditorIntelligence();return {module,project,service};};
const items=(f,text,line=3)=>f.service.completions(f.project,f.module,line,text,text.length).items;
const names=(f,text,line)=>items(f,text,line).map(x=>x.name);
const resolve=(f,text,line=3)=>f.service.resolve(f.project,f.module,line,text);
const hint=(f,text,line=3)=>f.service.parameterInfo(f.project,f.module,line,text,text.length);

for(const qualifier of ['Models','Project1.Models','models','Project1 . Models'])test('qualified module types: '+qualifier,()=>{
  const f=fixture('',[model()]);assert.deepEqual(names(f,'Dim value As '+qualifier+'.'),['Choices','Point']);
});
test('project type path exposes modules, not invalid project-level record shortcuts',()=>{
  const f=fixture('',[model(),customer]);assert.deepEqual(names(f,'Dim value As Project1.'),['Customer','Models']);
  assert.ok(names(f,'Dim value As ').includes('Models'));
});
test('private records remain available only in their declaring module',()=>{
  const f=fixture(model().code);assert.ok(names(f,'Dim value As Main.').includes('Secret'));
  f.project.modules.push(model());assert.ok(!names(f,'Dim value As Models.').includes('Secret'));
});
test('type candidates do not lose record identity when names collide',()=>{
  const f=fixture('Public Type Point\nY As Long\nEnd Type',[model()]);
  const candidate=items(f,'Dim value As Models.').find(x=>x.name==='Point');assert.equal(candidate.type,'Models.Point');
  assert.deepEqual(f.service.members(f.project,f.module,candidate.type).map(x=>x.name),['X']);
});
for(const name of ['Dane','DaneŁ','Data Models'])test('qualified type paths retain Unicode and bracket syntax: '+name,()=>{
  const f=fixture('',[model(name)]),syntax=name.includes(' ')?'['+name+']':name;
  assert.deepEqual(names(f,'Dim value As '+syntax+'.'),['Choices','Point']);
  assert.equal(f.service.type(f.project,f.module,syntax+'.Point')?.members[0].name,'X');
  const candidate=items(f,'Dim value As ').find(x=>x.name===name);assert.equal(candidate.insertText,syntax);
});
test('continued type declarations keep module qualifiers',()=>{
  const f=fixture('',[model()]);assert.deepEqual(names(f,'Dim value As _\r\n Models . '),['Choices','Point']);
});
test('nested library paths offer only the next namespace segment',()=>{
  const f=fixture();f.service.registerTypeLibrary('Vendor.Api',[
    {name:'Client',members:[]},{name:'Nested.Record',kind:'type',members:[]},{name:'Nested.Hidden',hidden:true,members:[]}
  ]);
  assert.deepEqual(names(f,'Dim value As Vendor.'),['Api']);
  assert.deepEqual(names(f,'Dim value As Vendor.Api.'),['Client','Nested']);
  assert.deepEqual(names(f,'Dim value As Vendor.Api.Nested.'),['Record']);
  assert.ok(names(f,'Dim value As ').includes('Vendor'));
});
test('New and Implements filter terminal types without dropping valid namespace paths',()=>{
  const f=fixture('',[model(),customer]);f.service.registerTypeLibrary('Vendor.Api',[
    {name:'Client',members:[]},{name:'IThing',kind:'interface',members:[]},
    {name:'NoFactory',creatable:false,members:[]},{name:'Values.Point',kind:'type',members:[]}
  ]);
  assert.deepEqual(names(f,'Dim value As New Vendor.'),['Api']);
  assert.deepEqual(names(f,'Dim value As New Vendor.Api.'),['Client']);
  assert.deepEqual(names(f,'Implements Vendor.Api.'),['Client','IThing','NoFactory']);
  assert.deepEqual(names(f,'Dim value As New Models.'),[]);
});
test('alias completion inserts a resolvable alias, not an unrelated short type',()=>{
  const f=fixture();f.service.registerTypeLibrary('Library',[{name:'Client',aliases:['Other.API.ClientAlias'],members:[]}]);
  const match=items(f,'Dim value As Other.API.')[0];assert.equal(match?.name,'ClientAlias');
  assert.equal(f.service.type(f.project,f.module,'Other.API.'+match.insertText)?.name,'Library.Client');
});
test('type list observes reference priority and disabled descriptor namespaces',()=>{
  const f=fixture();f.project.typeLibraries=[{name:'Vendor.Api',enabled:false,types:[{name:'Client',members:[]}]}];
  assert.deepEqual(names(f,'Dim value As Vendor.'),[]);f.project.typeLibraries[0].enabled=true;
  assert.deepEqual(names(f,'Dim value As Vendor.'),['Api']);
});

test('implicit ReDim array supplies typed indexed members and rank',()=>{
  const f=fixture('Sub Work()\nReDim customers(0 To 2, 1 To 3) As Customer\ncustomers(0,1).\nEnd Sub',[customer]);
  assert.deepEqual(names(f,'customers(0,1).'),['Name','Parent']);assert.equal(hint(f,'customers(0, ').active,1);
  assert.equal(hint(f,'customers(').params.length,2);assert.equal(resolve(f,'customers').implicitRedim,true);
});
test('ReDim Preserve, bounds calls and multiple declarations retain separate element types',()=>{
  const f=fixture('Sub Work()\nReDim Preserve customers(0 To Len("a,b")) As Customer, points(1 To 2, 0 To 3) As Models.Point\nEnd Sub',[customer,model()]);
  assert.deepEqual(names(f,'customers(0).'),['Name','Parent']);assert.deepEqual(names(f,'points(0,0).'),['X']);
});
test('implicit ReDim declarations are procedure-local, including one-line procedures',()=>{
  const code='Sub One(): ReDim items(1) As Customer: items(0).: End Sub: Sub Two(): items(0).: End Sub',f=fixture(code,[customer]);
  const one=code.indexOf('items(0).')+9,two=code.lastIndexOf('items(0).')+9;
  assert.ok(f.service.completions(f.project,f.module,1,code,one).items.some(x=>x.name==='Name'));
  assert.deepEqual(f.service.completions(f.project,f.module,1,code,two).items,[]);
});
for(const declaration of ['Dim items() As Long','Dim items As Variant'])test('explicit declarations win over ReDim type hints: '+declaration,()=>{
  const f=fixture('Sub Work()\nReDim items(2) As Customer\n'+declaration+'\nEnd Sub',[customer]);
  assert.equal(resolve(f,'items').type,declaration.includes('Long')?'Long':'Variant');
  assert.deepEqual(names(f,'items(0).'),[]);
});
test('ReDim never shadows later module or imported public variables',()=>{
  const f=fixture('Sub Work()\nReDim items(2) As Customer\nEnd Sub\nPrivate items() As Long',[customer]);
  assert.equal(resolve(f,'items').type,'Long');
  f.module.code='Sub Work()\nReDim items(2) As Customer\nEnd Sub';
  const shared={id:'shared',name:'Shared',kind:'module',code:'Public items() As Long'};f.project.modules.push(shared);
  assert.equal(resolve(f,'items').type,'Long');shared.code='Private items() As Long';assert.equal(resolve(f,'items').type,'Customer');
});
test('ReDim does not retype an explicitly declared parameter',()=>{
  const f=fixture('Sub Work(items() As Long)\nReDim items(2) As Customer\nEnd Sub',[customer]);assert.equal(resolve(f,'items').type,'Long');
});
test('conditional ReDim declarations follow the active compile branch',()=>{
  const f=fixture('Sub Work()\n#If Feature Then\nReDim items(2) As Customer\n#Else\nReDim items(2) As Long\n#End If\nEnd Sub',[customer]);
  f.project.settings.conditionalConstants={Feature:0};assert.equal(resolve(f,'items',7).type,'Long');
  f.project.settings.conditionalConstants={Feature:-1};assert.equal(resolve(f,'items',7).type,'Customer');
});
test('ReDim uses DefType when no As clause is present and never invents late-bound members',()=>{
  const f=fixture('DefLng I-N\nSub Work()\nReDim items(2), values(2)\nEnd Sub');
  assert.equal(resolve(f,'items').type,'Long');assert.equal(resolve(f,'values').type,'Variant');assert.deepEqual(names(f,'values(0).'),[]);
});
test('ReDim declarations agree with the shipped compiler/runtime for object arrays',async()=>{
  const f=fixture('Public Sub Main()\nReDim people(0 To 1) As Customer\nSet people(0) = New Customer\npeople(0).Name = "Ada"\nDebug.Print people(0).Name\nEnd Sub',[customer]);
  f.project.startup='Sub Main';const output=[];await new VirtualMachine(f.project,{print:x=>output.push(x),output:x=>output.push(x)}).start();
  assert.ok(output.join(' ').includes('Ada'));assert.deepEqual(names(f,'people(0).',4),['Name','Parent']);
});

for(const location of ['library','types','member','array-index','reference','reference-missing','project-list'])test('project reference getters and toJSON cannot run during assistance: '+location,()=>{
  const f=fixture('Dim client As Safe.Client');let calls=0;
  const getter=()=>{calls++;throw Error('Metadata executed');};
  const safe={name:'Safe',types:[{name:'Client',members:[{name:'Ready',type:'Boolean'}]}]};
  const bad={name:'Bad',types:[]};f.project.typeLibraries=[bad,safe];
  if(location==='library')bad.toJSON=getter;
  if(location==='types')Object.defineProperty(bad,'types',{get:getter,enumerable:true});
  if(location==='member'){bad.types=[{name:'Client',members:[{name:'Exploit',toJSON:getter}]}];}
  if(location==='array-index')Object.defineProperty(f.project.typeLibraries,'0',{get:getter,enumerable:true});
  if(location.startsWith('reference')){
    const reference={};Object.defineProperty(reference,location==='reference'?'typeLibrary':'missing',{get:getter,enumerable:true});
    if(location==='reference-missing')reference.typeLibrary=bad;f.project.references=[reference];f.project.typeLibraries=[safe];
  }
  if(location==='project-list'){Object.defineProperty(f.project,'references',{get:getter,enumerable:true});f.project.typeLibraries=[safe];}
  assert.deepEqual(names(f,'client.'),['Ready']);
  SourceEditor.prototype.completionSnapshot.call({project:f.project,module:f.module,intelligence:f.service});
  ExpressionAssistance.prototype.revision.call({ide:{runState:'design'},service:f.service},{project:f.project,module:f.module,line:1});
  assert.equal(calls,0);
});
test('cyclic project descriptors are rejected without disabling unrelated valid libraries',()=>{
  const f=fixture('Dim client As Safe.Client'),bad={name:'Cycle',types:[]};bad.self=bad;
  f.project.typeLibraries=[bad,{name:'Safe',types:[{name:'Client',members:[{name:'Ready',type:'Boolean'}]}]}];
  assert.deepEqual(names(f,'client.'),['Ready']);
});
test('safe reference snapshots observe in-place edits and invalidate existing lists',()=>{
  const f=fixture('Dim client As Safe.Client');f.project.typeLibraries=[{name:'Safe',types:[{name:'Client',members:[{name:'Ready',type:'Boolean'}]}]}];
  const owner={project:f.project,module:f.module,intelligence:f.service},before=SourceEditor.prototype.completionSnapshot.call(owner);
  assert.deepEqual(names(f,'client.'),['Ready']);f.project.typeLibraries[0].types[0].members[0].name='Updated';
  assert.deepEqual(names(f,'client.'),['Updated']);assert.notEqual(before.references,SourceEditor.prototype.completionSnapshot.call(owner).references);
});

test('repeated ReDim declarations do not duplicate locals',()=>{
  const f=fixture('Sub Work()\nReDim items(2) As Customer\nReDim items(4) As Customer\nEnd Sub',[customer]);
  assert.equal(items(f,'items').filter(x=>x.name==='items').length,1);
});
test('ReDim cannot shadow a form control array',()=>{
  const f=fixture('Sub Work()\nReDim items(2) As Customer\nEnd Sub',[customer]);f.module.kind='form';
  f.module.form={controls:[{name:'items',type:'TextBox',properties:{Index:0}}]};
  assert.equal(resolve(f,'items').type,'TextBox');assert.ok(names(f,'items(0).').includes('SelStart'));
});
test('large ReDim declaration sets are cached without duplicate scans',()=>{
  const f=fixture('Sub Work()\n'+Array.from({length:5000},(_,i)=>'ReDim item'+i+'(1) As Customer').join('\n')+'\nEnd Sub',[customer]);
  assert.equal(items(f,'item',5002).filter(s=>s.implicitRedim).length,5000);const scans=f.service.scanCount;
  assert.equal(resolve(f,'item4999',5002).type,'Customer');assert.equal(f.service.scanCount,scans);
});

test('native attached metadata is gated by missing state without touching identity fields',()=>{
  const f=fixture('Dim client As Safe.Client'),reference={kind:'Reference',value:'native-library-identity',missing:false,typeLibrary:{name:'Safe',types:[{name:'Client',members:[{name:'Ready',type:'Boolean'}]}]}};
  f.project.references=[reference];assert.deepEqual(names(f,'client.'),['Ready']);reference.missing=true;
  assert.deepEqual(names(f,'client.'),[]);assert.equal(reference.value,'native-library-identity');
});
test('excessive project descriptor arrays fail closed without inspecting their entries',()=>{
  const f=fixture('Dim client As Safe.Client');let calls=0;f.project.typeLibraries=new Array(4097);
  Object.defineProperty(f.project.typeLibraries,'0',{get(){calls++;return null;},enumerable:true});
  assert.deepEqual(names(f,'client.'),[]);assert.equal(calls,0);
});
