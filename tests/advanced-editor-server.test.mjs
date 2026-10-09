import test from 'node:test';
import assert from 'node:assert/strict';
import {MessageChannel} from 'node:worker_threads';
import {LanguageClient} from '../src/editor/advanced/client.js';
import {messagePortTransport} from '../src/editor/advanced/rpc.js';
import {BuiltinLanguageServer} from '../src/editor/advanced/builtin-server.js';

async function workspace(t) {
  const {port1,port2}=new MessageChannel();
  const server=new BuiltinLanguageServer(messagePortTransport(port1),{diagnosticDelay:60000});
  const client=new LanguageClient(messagePortTransport(port2));
  t.after(()=>{client.dispose();server.dispose();});await client.initialize();return {client,server};
}
const code='Option Explicit\nPublic total As Long\nPublic Function Add(ByVal left As Long, ByVal right As Long) As Long\n    Add = left + right\nEnd Function\nPublic Sub Main()\n    total = Add(1, 2)\nEnd Sub\n';
const uri='file:///workspace/Module1.bas';
const at=(line,character)=>({textDocument:{uri},position:{line,character}});
test('built-in VB6 server supports completion, hover, definition, references and versioned rename',async t=>{
  const {client}=await workspace(t);client.open(uri,'vb6',code);
  const complete=await client.request('textDocument/completion',at(6,8));assert.ok(complete.items.some(i=>i.label==='total'));
  const hover=await client.request('textDocument/hover',at(6,6));assert.match(hover.contents.value,/total/i);
  const definition=await client.request('textDocument/definition',at(6,6));assert.equal(definition[0].range.start.line,1);
  const refs=await client.request('textDocument/references',{...at(6,6),context:{includeDeclaration:true}});assert.equal(refs.length,2);
  const renamed=await client.request('textDocument/rename',{...at(6,6),newName:'sum'});assert.equal(renamed.documentChanges[0].edits.length,2);
  assert.equal(renamed.documentChanges[0].textDocument.version,1);
  const signature=await client.request('textDocument/signatureHelp',at(6,19));assert.match(signature.signatures[0].label,/Add/);
});
test('built-in VB6 symbols, folds, semantic tokens and diagnostics have valid LSP shapes',async t=>{
  const {client}=await workspace(t);const doc=client.open(uri,'vb6',code);
  const symbols=await client.request('textDocument/documentSymbol',{textDocument:{uri}});assert.ok(symbols.some(s=>s.name==='Main'));
  for(const symbol of symbols){doc.offsetAt(symbol.range.start,true);doc.offsetAt(symbol.selectionRange.end,true);}
  const folds=await client.request('textDocument/foldingRange',{textDocument:{uri}});assert.ok(folds.some(f=>f.startLine===2&&f.endLine===4));
  const tokens=await client.request('textDocument/semanticTokens/full',{textDocument:{uri}});assert.ok(tokens.data.length>20);assert.equal(tokens.data.length%5,0);
  const diagnostics=await client.request('textDocument/diagnostic',{textDocument:{uri}});assert.equal(diagnostics.kind,'full');assert.ok(Array.isArray(diagnostics.items));
});
test('XAML supports completion, symbols, folding and semantic tokens through the same LSP connection',async t=>{
  const {client}=await workspace(t);const x='file:///workspace/Form1.xaml';
  client.open(x,'xaml','<vb:Form xmlns:vb="urn:vb6:forms" Name="Form1">\n  <vb:CommandButton Name="Button1" Caption="Hi" />\n</vb:Form>');
  const symbols=await client.request('textDocument/documentSymbol',{textDocument:{uri:x}});assert.equal(symbols[0].name,'Form1');
  const tokens=await client.request('textDocument/semanticTokens/full',{textDocument:{uri:x}});assert.ok(tokens.data.length>0);
  const folds=await client.request('textDocument/foldingRange',{textDocument:{uri:x}});assert.ok(folds.length>0);
  const rename=await client.request('textDocument/rename',{textDocument:{uri:x},position:{line:1,character:30},newName:'Go'});assert.equal(rename.documentChanges[0].edits[0].newText,'Go');
});
test('closed language clients clear documents and notify listeners on transport loss',async t=>{
  const {client}=await workspace(t);client.open(uri,'vb6',code);let closed=0;client.on('closed',()=>closed++);
  client.peer.close(new Error('lost'));assert.equal(client.state,'closed');assert.equal(closed,1);
  client.dispose();assert.equal(client.documents.size,0);assert.equal(client.listeners.size,0);
});
