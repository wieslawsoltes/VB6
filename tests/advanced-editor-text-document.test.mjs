import test from 'node:test';
import assert from 'node:assert/strict';
import {LspTextDocument,applyLspTextEdits,planWorkspaceEdit} from '../src/editor/advanced/text-document.js';
const range=(a,b,c,d)=>({start:{line:a,character:b},end:{line:c,character:d}});
test('UTF-16 document offsets roundtrip across CRLF, LF, CR and astral characters',()=>{
  const doc=new LspTextDocument('file:///x','vb6','A😀\r\nB\nC\rD');
  assert.deepEqual(doc.lineStarts,[0,5,7,9]);assert.deepEqual(doc.lineEnds,[3,6,8,10]);
  assert.deepEqual(doc.positionAt(2),{line:0,character:2});assert.deepEqual(doc.positionAt(4),{line:0,character:3});assert.equal(doc.offsetAt({line:1,character:1},true),6);
  for(let line=0;line<doc.lineStarts.length;line++)for(let character=0;character<=doc.lineEnds[line]-doc.lineStarts[line];character++)assert.deepEqual(doc.positionAt(doc.offsetAt({line,character})),{line,character});
});
test('changes use sequential ranges and advance versions',()=>{
  const doc=new LspTextDocument('file:///x','vb6','abc',1);
  doc.applyChanges([{range:range(0,1,0,2),text:'XYZ'},{range:range(0,4,0,5),text:'!'}],2);
  assert.equal(doc.text,'aXYZ!');assert.equal(doc.version,2);
  assert.throws(()=>doc.applyChanges([{text:'stale'}],2),{code:-32801});assert.equal(doc.text,'aXYZ!');
});
test('malformed multi-change notifications are atomic',()=>{
  const doc=new LspTextDocument('file:///x','vb6','abc',1);
  assert.throws(()=>doc.applyChanges([{range:range(0,0,0,1),text:'x'},{range:range(4,0,4,1),text:'y'}],2));assert.equal(doc.text,'abc');assert.equal(doc.version,1);
  assert.throws(()=>doc.applyChanges([{range:range(0,0,0,1),rangeLength:2,text:'x'}],2));
});
test('text edits sort by original coordinates and reject overlap or out-of-bounds positions',()=>{
  const doc=new LspTextDocument('file:///x','vb6','abcdef');
  assert.equal(applyLspTextEdits(doc,[{range:range(0,4,0,6),newText:'Y'},{range:range(0,0,0,2),newText:'X'}]),'XcdY');
  assert.throws(()=>applyLspTextEdits(doc,[{range:range(0,0,0,3),newText:''},{range:range(0,2,0,4),newText:''}]));
  assert.throws(()=>applyLspTextEdits(doc,[{range:range(0,0,0,100),newText:''}]));
  assert.equal(applyLspTextEdits(doc,[{range:range(0,2,0,2),newText:'X'},{range:range(0,2,0,2),newText:'Y'}]),'abXYcdef');
});
test('workspace edits validate every version and URI before producing a plan',()=>{
  const a=new LspTextDocument('file:///a','vb6','abc',2),b=new LspTextDocument('file:///b','xaml','def',3),docs=new Map([[a.uri,a],[b.uri,b]]),edit={range:range(0,0,0,1),newText:'X'};
  const plan=planWorkspaceEdit({documentChanges:[{textDocument:{uri:a.uri,version:2},edits:[edit]},{textDocument:{uri:b.uri,version:3},edits:[edit]}]},docs);
  assert.equal(plan[0].after,'Xbc');assert.equal(plan[1].after,'Xef');assert.equal(a.text,'abc');
  assert.throws(()=>planWorkspaceEdit({documentChanges:[{textDocument:{uri:a.uri,version:1},edits:[edit]}]},docs),{code:-32801});
  assert.throws(()=>planWorkspaceEdit({changes:{'file:///outside':[edit]}},docs));
  assert.throws(()=>planWorkspaceEdit({documentChanges:[{kind:'delete',uri:a.uri}]},docs));
});
test('workspace annotations are retained for confirmation and unknown IDs are rejected',()=>{
  const doc=new LspTextDocument('file:///a','vb6','abc'),docs=new Map([[doc.uri,doc]]),edit={range:range(0,0,0,1),newText:'X',annotationId:'rename'};
  assert.throws(()=>planWorkspaceEdit({changes:{[doc.uri]:[edit]}},docs));
  assert.equal(planWorkspaceEdit({changes:{[doc.uri]:[edit]},changeAnnotations:{rename:{label:'Rename symbol',needsConfirmation:true}}},docs)[0].annotations[0].needsConfirmation,true);
});
test('incremental line index agrees with a full scan after 1,200 mixed-EOL edits',()=>{
  let seed=81721;const random=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
  const doc=new LspTextDocument('file:///fuzz','vb6','alpha\r\nbeta\ngamma\rdelta 😀\n',1),parts=['','x','\r','\n','\r\n','😀','a\rb\nc\r\nd'];
  for(let i=0;i<1200;i++){
    const a=doc.positionAt(random(doc.text.length+1)),b=doc.positionAt(random(doc.text.length+1));
    const start=doc.offsetAt(a),end=doc.offsetAt(b),lo=Math.min(start,end),hi=Math.max(start,end),text=parts[random(parts.length)],before=doc.fork();
    doc.applyChanges([{range:doc.range(lo,hi),rangeLength:hi-lo,text}],i+2);
    const full=new LspTextDocument(doc.uri,doc.languageId,doc.text,doc.version);
    assert.deepEqual(doc.lineStarts,full.lineStarts,'starts at edit '+i);assert.deepEqual(doc.lineEnds,full.lineEnds,'ends at edit '+i);
    assert.equal(before.version,i+1);assert.equal(before.text.slice(0,lo)+text+before.text.slice(hi),doc.text);
  }
});
test('editing one line of a 100,000-line document does not rescan all characters',()=>{
  const doc=new LspTextDocument('file:///large','vb6','Dim value As Long\r\n'.repeat(100000)),scanned=doc.scannedCharacters;
  doc.applyChanges([{range:range(50000,4,50000,9),text:'other'}],2);
  assert.ok(doc.scannedCharacters-scanned<100);assert.equal(doc.lineStarts.length,100001);assert.equal(doc.text.slice(doc.lineStarts[50000],doc.lineEnds[50000]),'Dim other As Long');
});
