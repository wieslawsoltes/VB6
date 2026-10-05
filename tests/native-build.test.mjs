import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseOptions, productName, externalizeScripts, stageWindows, readProject } from '../tools/build-windows.mjs';
const require = createRequire(import.meta.url);
const policy = require('../desktop/policy.cjs');
test('native targets reject unsupported architectures, graphics and false no-extraction claims', () => {
  assert.equal(parseOptions([]).graphics, 'webgpu');
  assert.equal(parseOptions(['--arch', 'arm64']).arch, 'arm64');
  for (const args of [['--arch','ia32'],['--graphics','d3d'],['--no-extract'],['--project'],['--unknown']]) assert.throws(() => parseOptions(args));
});
test('native product names reject Windows paths and devices', () => {
  assert.equal(productName('My App'), 'My App');
  for (const name of ['', 'NUL', 'CON.txt', '../app', 'A:B', 'x.', 'COM1', 'bad\nname']) assert.throws(() => productName(name));
});
test('entry externalization preserves JSON but removes inline executable scripts', () => {
  const entry = externalizeScripts('<html><head></head><body><script type="application/json" id="p">{"name":"x"}</script><script>globalThis.ok=1;</script></body></html>');
  assert.deepEqual(entry.scripts, ['entry-0.js']);
  assert.equal(entry.files.get('entry-0.js'), 'globalThis.ok=1;');
  assert.match(entry.html, /application\/json/);
  assert.doesNotMatch(entry.html, /globalThis/);
  assert.match(entry.html, /boot.mjs/);
  assert.throws(() => externalizeScripts('<head></head><script src="https://bad/script.js"></script>'));
  assert.throws(() => externalizeScripts('<head></head><script src="../secret.js"></script>'));
});
test('native origin and manifest routing cannot read arbitrary files', () => {
  const root = path.resolve('/tmp/assets'), files = {'index.html':'hash','entry.js':'hash'};
  assert.equal(policy.assetPath(root,'vb6://app/entry.js',files),path.join(root,'entry.js'));
  for (const url of ['https://app/entry.js','vb6://evil/entry.js','vb6://user@app/entry.js','vb6://app/%2e%2e%5csecret','vb6://app/secret','vb6://app/%00']) assert.throws(() => policy.assetPath(root,url,files));
  assert.equal(policy.trustedURL('vb6://app:99/index.html'), false);
});
test('native window options ignore renderer attempts to enable Node or change preload', () => {
  const options = policy.windowOptions({width: 700,height: 300,borderStyle:5,webPreferences:{nodeIntegration:true},preload:'evil'});
  assert.equal(options.resizable,true); assert.equal(options.skipTaskbar,true); assert.equal(options.maximizable,false);
  assert.equal(options.webPreferences,undefined); assert.equal(options.preload,undefined); assert.equal(options.show,false);
  assert.throws(() => policy.windowOptions({width:NaN}));
});
test('display bounds recover off-screen windows and preserve negative monitor coordinates', () => {
  const displays = [{workArea:{x:0,y:0,width:1000,height:800}},{workArea:{x:-1000,y:0,width:1000,height:800}}];
  assert.deepEqual(policy.clampBounds({x:-900,y:50,width:500,height:400},displays),{x:-900,y:50,width:500,height:400});
  const b = policy.clampBounds({x:90000,y:90000,width:2000,height:2000},displays);
  assert.deepEqual(b,{x:0,y:0,width:1000,height:800});
});
test('native menu payloads have bounded depth and length and no executable renderer callbacks', () => {
  let selected;
  const menu = policy.menuTemplate([{id:'Open',label:'&Open',checked:true},null],id=>selected=id);
  menu[0].click(); assert.equal(selected,'Open'); assert.equal(menu[0].type,'checkbox'); assert.equal(menu[1].type,'separator');
  assert.throws(()=>policy.menuTemplate(Array(257).fill(null),()=>{}));
  assert.throws(()=>policy.menuTemplate([{id:'bad',label:'bad\nlabel'}],()=>{}));
  assert.equal(policy.text('a\nb','',100,true),'a\nb');
});
test('staged native application contains all hashed assets and separate script entries', async () => {
  const result = await stageWindows(parseOptions(['--project','examples/calculator.vb6web','--name','Native Stage Test','--graphics','auto','--stage-only']));
  try {
    assert.equal(result.manifest.kind,'application'); assert.equal(result.manifest.graphics,'auto');
    assert.ok(result.manifest.files['boot.mjs']);
    for (const script of result.manifest.scripts) assert.ok(result.manifest.files[script]);
    assert.ok((await fs.stat(path.join(result.stage,'main.cjs'))).size > 1000);
    const entry = await fs.readFile(path.join(result.stage,'web','index.html'),'utf8');
    assert.doesNotMatch(entry, /<script>\s*\/\* VB6/); assert.match(entry,/boot.mjs/);
  } finally { await fs.rm(result.stage,{recursive:true,force:true}); }
});

test('declared native data origins allow fetch only, not remote code or navigation', () => {
  const origins=policy.dataOrigins(['https://api.example.test/','https://api.example.test','http://127.0.0.1:4286']);
  assert.deepEqual(origins,['http://127.0.0.1:4286','https://api.example.test']);
  const csp=policy.dataCSP(origins);
  assert.match(csp,/script-src 'self' 'wasm-unsafe-eval';/);assert.doesNotMatch(csp,/'unsafe-eval'/);
  assert.match(csp,/connect-src 'self' http:\/\/127.0.0.1:4286 https:\/\/api.example.test;/);
  assert(policy.dataRequestAllowed({url:'https://api.example.test/data?q=x',resourceType:'xhr'},origins));
  for(const resourceType of ['script','mainFrame','subFrame','webSocket','worker','image','other'])assert(!policy.dataRequestAllowed({url:'https://api.example.test/data',resourceType},origins));
  for(const url of ['https://api.example.test.evil/data','http://api.example.test/data','https://api.example.test:444/data','https://user:pw@api.example.test/data'])assert(!policy.dataRequestAllowed({url,resourceType:'xhr'},origins));
  for(const origin of ['https://*.example.test','https://example.test/path','https://example.test/?key=x','https://u:p@example.test','https://example.test;script-src','https://example.test\n','file:///tmp','wss://example.test'])assert.throws(()=>policy.dataOrigins([origin]));
  assert.throws(()=>policy.dataOrigins(Array(65).fill('https://example.test')));
  assert.deepEqual(parseOptions(['--data-origin','https://api.example.test','--data-origin','http://127.0.0.1:4286']).dataOrigins,origins);
});
test('packaged REST example declares only its API origins and includes SQLite license',async()=>{
  const result=await stageWindows(parseOptions(['--project','examples/rest-customers.vb6web','--name','Native REST Stage','--stage-only']));
  try{
    assert.deepEqual(result.manifest.dataOrigins,['http://127.0.0.1:4286']);
    assert.match(await fs.readFile(path.join(result.stage,'LICENSE.sql.js'),'utf8'),/Permission is hereby granted/);
    assert.match(await fs.readFile(path.join(result.stage,'THIRD-PARTY-NOTICES.md'),'utf8'),/sql.js/);
  }finally{await fs.rm(result.stage,{recursive:true,force:true});}
});
