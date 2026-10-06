import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {bundle} from '../tools/bundle.mjs';
function fixture(files,run){const root=fs.mkdtempSync(path.join(os.tmpdir(),'vb6-bundle-'));try{for(const [name,source]of Object.entries(files))fs.writeFileSync(path.join(root,name),source);return run(path.join(root,'main.js'));}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('bundler rejects missing named exports before emitting undefined imports',()=>fixture({'dep.js':'export const valid = 1;','main.js':"import {missing} from './dep.js';\nexport const value = missing;"},entry=>assert.throws(()=>bundle(entry),/Missing export missing/)));
test('bundler validates aliased names against the original export',()=>fixture({'dep.js':'export const valid = 7;','main.js':"import {valid as renamed} from './dep.js';\nexport const value = renamed + 1;"},entry=>{const context={};vm.runInNewContext(bundle(entry,'Test'),context);assert.equal(context.Test.value,8);}));
test('bundler rejects malformed bindings',()=>fixture({'dep.js':'export const valid = 1;','main.js':"import {valid = 7} from './dep.js';\nexport const value = valid;"},entry=>assert.throws(()=>bundle(entry),/Unsupported import binding/)));
test('bundler still rejects circular relative dependencies',()=>fixture({'dep.js':"import {value} from './main.js';\nexport const other=1;",'main.js':"import {other} from './dep.js';\nexport const value=1;"},entry=>assert.throws(()=>bundle(entry),/Circular module/)));
test('bundler rejects external imports and export-star declarations',()=>{fixture({'main.js':"import {value} from 'external';\nexport const x=1;"},entry=>assert.throws(()=>bundle(entry),/Non-relative/));fixture({'dep.js':'export const x=1;','main.js':"export * from './dep.js';"},entry=>assert.throws(()=>bundle(entry),/Unsupported export/));});
test('bundler validates local export lists, async functions and shared dependencies',()=>fixture({'dep.js':'const a=4;\nexport {a};\nexport async function answer(){return 42;}','other.js':"import {a} from './dep.js';\nexport const b=a+2;",'main.js':"import {a, answer} from './dep.js';\nimport {b} from './other.js';\nexport const total=a+b;\nexport {answer};"},async entry=>{const context={};vm.runInNewContext(bundle(entry,'Build'),context);assert.equal(context.Build.total,10);assert.equal(await context.Build.answer(),42);}));
