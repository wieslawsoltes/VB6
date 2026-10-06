import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {compileCompute} from '../src/compute/index.js';
import {CODE_PAGES} from '../packages/vb6-compute/src/code-pages.js';
for(const codePage of [1250,1252])for(const expr of ['Chr$(128)','String$(3,379)','CStr(Asc("A"))'])test(`explicit Windows code page ${codePage} ${expr}`,()=>{
 const a=compileCompute(`Public s As String\nSub Main()\ns=${expr}\nEnd Sub`,{codePage});assert.equal(a.codePage,codePage);assert.match(a.wgsl,/const cp_high=/);
});
for(const codePage of [0,1251,65001,'1252',NaN])test('reject unsupported code page '+codePage,()=>assert.throws(()=>compileCompute('Sub Main()\nEnd Sub',{codePage}),e=>e.code==='GPU_CODEPAGE'));
for(const expr of ['Chr$(128)','Asc("A")','String$(3,128)'])test('never infer host ACP for '+expr,()=>assert.throws(()=>compileCompute(`Sub Main()\n${expr}\nEnd Sub`),e=>e.code==='GPU_CODEPAGE'));
test('code page option on numeric program has no unresolved String helpers',()=>assert.doesNotMatch(compileCompute('Public n As Long\nSub Main()\nn=42&\nEnd Sub',{codePage:1250}).wgsl,/fn str_cp_|str_first/));
test('Windows mappings retain Polish and Western European distinctions',()=>{assert.equal(CODE_PAGES[1250][0xA3-128],0x141);assert.equal(CODE_PAGES[1252][0xA3-128],0xA3);assert.equal(CODE_PAGES[1250][0x80-128],0x20AC);assert.equal(CODE_PAGES[1252][0x80-128],0x20AC);});
test('civil Date literals compile identically across host timezones',()=>{
 const script=`import {compileCompute} from './src/compute/index.js';console.log(compileCompute('Public d As Date\\nSub Main()\\nd=#2/29/2024 13:45:56#\\nEnd Sub').wgsl)`;
 const results=['UTC','Europe/Warsaw','America/New_York'].map(TZ=>execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',env:{...process.env,TZ}}));
 assert.equal(results[0],results[1]);assert.equal(results[0],results[2]);
});
