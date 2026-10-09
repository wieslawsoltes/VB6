import test from 'node:test';
import assert from 'node:assert/strict';
import {ADVANCED_EDITOR_DEFAULTS,normalizeAdvancedEditorSettings,loadAdvancedEditorSettings,saveAdvancedEditorSettings,validateLanguageServerEndpoint} from '../src/editor/advanced/settings.js';

test('advanced editor stays disabled for new, malformed and legacy settings',()=>{
  assert.equal(ADVANCED_EDITOR_DEFAULTS.enabled,false);
  for(const input of [null,{},'yes',{enabled:'true'},{enabled:1},{enabled:false}]) assert.equal(normalizeAdvancedEditorSettings(input).enabled,false);
  assert.equal(loadAdvancedEditorSettings({getItem(){throw new Error('blocked');}}).enabled,false);
  assert.equal(loadAdvancedEditorSettings({getItem:()=>'{broken'}).enabled,false);
});
test('only known settings survive serialization; explicit opt-in roundtrips',()=>{
  let stored;
  const storage={setItem:(k,v)=>stored=v,getItem:()=>stored};
  saveAdvancedEditorSettings(storage,{enabled:true,minimap:false,secret:'not persisted',vb6Endpoint:' wss://example.test/lsp '});
  assert.deepEqual(loadAdvancedEditorSettings(storage),normalizeAdvancedEditorSettings({enabled:true,minimap:false,vb6Endpoint:'wss://example.test/lsp'}));
  assert.equal(stored.includes('secret'),false);
});
test('LSP endpoints reject credentials, non-WebSocket URLs and mixed content',()=>{
  for(const url of ['javascript:alert(1)','https://example.test','wss://user:pass@example.test','wss://example.test/#token','ws://example.test']) assert.throws(()=>validateLanguageServerEndpoint(url));
  assert.equal(validateLanguageServerEndpoint(''),'');
  assert.equal(validateLanguageServerEndpoint('ws://127.0.0.1:3001'),'ws://127.0.0.1:3001/');
  assert.equal(validateLanguageServerEndpoint('wss://example.test/lsp'),'wss://example.test/lsp');
});
