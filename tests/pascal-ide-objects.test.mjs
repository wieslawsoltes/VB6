import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {EditorIntelligence} from '../src/editor/intelligence.js';
import {scanPascalDeclarations,pascalExpressionBefore,pascalWordAt,PASCAL_KEYWORDS} from '../src/editor/pascal-service.js';
import {LanguageClient} from '../src/editor/advanced/client.js';
import {messagePortTransport} from '../src/editor/advanced/rpc.js';
import {BuiltinLanguageServer} from '../src/editor/advanced/builtin-server.js';
import {compileProject} from '../src/language/compiler.js';

const code=`unit ObjectEditor;
interface
type PItem = ^TChild;
  TPoint = record X, Y: Integer; end;
  TBase = object
    private Value: Integer;
    public constructor Init(Initial: Integer);
    function Read(Offset: Integer): Integer; virtual;
  end;
  TChild = object(TBase)
    Position: TPoint;
    Items: array[0..1] of TPoint;
    function Read(Offset: Integer): Integer; virtual;
    procedure Move;
  end;
var Current: TChild; Pointer: PItem;
implementation
constructor TBase.Init(Initial: Integer); begin Value := Initial end;
function TBase.Read(Offset: Integer): Integer; begin Read := Value + Offset end;
function TChild.Read(Offset: Integer): Integer;
begin Read := inherited Read(Offset) + Position.X end;
procedure TChild.Move;
var Step: Integer;
begin
  Step := 1;
  with Position do begin X := Step; Y := X end;
  Items[0].X := Position.X;
  Self.Position.X := Items[0].X;
end;
procedure Check;
begin Current.Init(4); Current.Read(2); Pointer^.Read(3) end;
end.
`;
const module={id:'objects',name:'ObjectEditor',kind:'module',language:'pascal',code},project={id:'object-editor',name:'ObjectEditorProject',language:'pascal',modules:[module],settings:{}};
const position=(source,offset)=>({line:source.slice(0,offset).split('\n').length-1,character:offset-(source.lastIndexOf('\n',offset-1)+1)});

test('Pascal source declarations preserve structured types, method headers, exact name ranges and incomplete scopes',()=>{
  const index=scanPascalDeclarations(module);
  assert.deepEqual(index.records.map(record=>record.name),['PItem','TPoint','TBase','TChild']);
  assert.deepEqual(index.records[1].members.map(member=>[member.name,member.type]),[['X','Integer'],['Y','Integer']]);
  assert.equal(index.records[2].members.find(member=>member.name==='Value').scope,'private');
  assert.equal(index.records[3].ancestor,'TBase');
  assert.deepEqual(index.procedures.map(proc=>proc.name),['TBase.Init','TBase.Read','TChild.Read','TChild.Move','Check']);
  for(const proc of index.procedures)assert.equal(code.slice(proc.nameStart,proc.nameEnd),proc.bindingName||proc.name);
  const move=index.procedures.find(proc=>proc.name==='TChild.Move');
  assert.equal(index.symbols.find(symbol=>symbol.name==='Step').ownerId,move.id);
  assert.equal(index.withBlocks[0].expression,'Position');
  assert.ok(index.withBlocks[0].end>code.indexOf('Y := X'));
  const incomplete=scanPascalDeclarations({...module,code:code.slice(0,code.indexOf('  Self.Position.X')+8)});
  assert.equal(incomplete.records[3].members.at(-1).name,'Move');
  assert.ok(incomplete.procedures.some(proc=>proc.name==='TChild.Move'));
  assert.ok(PASCAL_KEYWORDS.includes('private')&&PASCAL_KEYWORDS.includes('public'));
});

test('Pascal completion and binding resolve record fields, inherited methods, Self, indexes, pointer aliases and with scopes',()=>{
  const service=new EditorIntelligence();
  const names=text=>service.completions(project,module,1,text,text.length).items.map(item=>item.name);
  assert.deepEqual(names('Current.Position.'),['X','Y']);
  assert.deepEqual(names('Current.Items[0].'),['X','Y']);
  assert.ok(names('Pointer^.').includes('Read'));
  assert.ok(names('Current.').includes('Init'));
  const at=code.indexOf('X := Step')+1,line=position(code,at).line+1;
  assert.equal(service.definition(project,module,line,code,at).parentType,'TPoint');
  const withItems=service.completions(project,module,line,code,at,{unfiltered:true}).items;
  assert.ok(withItems.some(item=>item.name==='Y'));
  const field=code.indexOf('Self.Position.X')+'Self.Position.'.length+1;
  assert.equal(service.definition(project,module,position(code,field).line+1,code,field).parentType,'TPoint');
  const inherited=code.indexOf('inherited Read')+'inherited '.length+1;
  assert.equal(service.definition(project,module,position(code,inherited).line+1,code,inherited).parentType,'TBase');
  const consumer={id:'consumer',name:'Consumer',kind:'module',language:'pascal',code:'program Consumer; uses ObjectEditor; begin end.'},external={...project,modules:[module,consumer]};
  const publicNames=service.completions(external,consumer,1,'Current.',8).items.map(item=>item.name);
  assert.ok(publicNames.includes('Read'));assert.ok(!publicNames.includes('Value'));
  assert.equal(pascalExpressionBefore('Current.Items[1 + Next()].',25).text,'Current.Items[1 + Next()]');
  const text='Pointer^.Items[0].X';assert.equal(pascalWordAt(text,text.length).text,text);
});

test('conditional source indexing masks inactive declarations without changing physical spans',()=>{
  const source='unit ConditionalEditor; interface {$IFDEF ACTIVE} var Enabled: Integer; {$ELSE} var Disabled: Integer; {$ENDIF} implementation end.';
  const index=scanPascalDeclarations({id:'conditional',name:'ConditionalEditor',code:source,conditionalConstants:{ACTIVE:true}});
  assert.ok(index.symbols.some(symbol=>symbol.name==='Enabled'));
  assert.ok(!index.symbols.some(symbol=>symbol.name==='Disabled'));
  assert.equal(index.masked.length,source.length);
  assert.equal(index.masked.slice(source.indexOf('Disabled'),source.indexOf('Disabled')+8),'        ');
});

test('Pascal LSP binds method implementations and safely renames an entire virtual override family',async t=>{
  const uri='file:///workspace/ObjectEditor.pas',{port1,port2}=new MessageChannel(),server=new BuiltinLanguageServer(messagePortTransport(port1),{diagnosticDelay:60000}),client=new LanguageClient(messagePortTransport(port2));
  t.after(()=>{client.dispose();server.dispose();});await client.initialize();client.open(uri,'pascal',code);
  const at=offset=>({textDocument:{uri},position:position(code,offset)}),call=code.indexOf('Current.Read')+'Current.'.length+1;
  const definition=await client.request('textDocument/definition',at(call));assert.equal(definition[0].range.start.line,12);
  const signatures=await client.request('textDocument/signatureHelp',at(code.indexOf('Pointer^.Read(3')+'Pointer^.Read('.length));
  assert.match(signatures.signatures[0].label,/Read\(Offset: Integer\): Integer/);
  const symbols=await client.request('textDocument/documentSymbol',{textDocument:{uri}}),child=symbols.find(symbol=>symbol.name==='TChild');
  assert.deepEqual(child.children.map(symbol=>symbol.name),['Position','Items','Read','Move']);
  const hierarchy=await client.request('textDocument/prepareTypeHierarchy',at(code.indexOf('TChild =')+1));assert.equal(hierarchy[0].name,'TChild');
  const bases=await client.request('typeHierarchy/supertypes',{item:hierarchy[0]});assert.equal(bases[0].name,'TBase');
  const descendants=await client.request('typeHierarchy/subtypes',{item:bases[0]});assert.equal(descendants[0].name,'TChild');
  const implementations=await client.request('textDocument/implementation',at(code.indexOf('function Read')+'function '.length+1));assert.deepEqual(implementations.map(item=>item.range.start.line),[18,19]);
  const callHierarchy=await client.request('textDocument/prepareCallHierarchy',at(code.indexOf('procedure Check')+'procedure '.length+1));
  const outgoing=await client.request('callHierarchy/outgoingCalls',{item:callHierarchy[0]});assert.ok(outgoing.some(edge=>edge.to.name==='TChild.Read'));
  const renamed=await client.request('textDocument/rename',{...at(call),newName:'Measure'}),edits=renamed.documentChanges[0].edits;
  assert.equal(edits.length,9);
  let updated=code;const offsetAt=p=>code.split('\n').slice(0,p.line).reduce((sum,line)=>sum+line.length+1,0)+p.character;
  for(const edit of edits.sort((a,b)=>offsetAt(b.range.start)-offsetAt(a.range.start)))updated=updated.slice(0,offsetAt(edit.range.start))+edit.newText+updated.slice(offsetAt(edit.range.end));
  assert.doesNotMatch(updated,/\bRead\b/);
  const compiled=compileProject({...project,modules:[{...module,code:updated}]});assert.equal(compiled.valid,true,JSON.stringify(compiled.diagnostics));
  await assert.rejects(client.request('textDocument/rename',{...at(call),newName:'Position'}),/shadow.*component/);
});
