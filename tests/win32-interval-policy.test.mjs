import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {referenceExpression,INTERVAL_REFERENCE_POLICY,DATE_INTERVAL_CONTRACTS} from '../tools/win32-date-interval-reference.mjs';

test('reference retains raw engine evidence and names the documented rounding/range distinction',()=>{
 const add={expression:'DateAdd("yyyy", 1.5, CDate(1))',kind:'date'};
 assert.equal(referenceExpression(add,false),add.expression);
 assert.equal(referenceExpression(add),'ContractAdd("yyyy", 1.5, CDate(1))');
 assert.match(INTERVAL_REFERENCE_POLICY,/Round\(CDbl\(number\), 0\)/);
 assert.match(INTERVAL_REFERENCE_POLICY,/If Abs\(number\) > limit Then Err.Raise 5/);
 const ordinary={expression:'DatePart("w", CDate(1), 2, 1)',kind:'long'};
 assert.equal(referenceExpression(ordinary),'CLng('+ordinary.expression+')');
 assert.equal(DATE_INTERVAL_CONTRACTS.length,2328);
});
test('DateAdd accepts a Double count beyond a signed Long without embedding a host engine',()=>{
 const p=newProject('WideDateCount');p.startup='Sub Main';
 p.modules=[{id:'main',name:'Main',kind:'module',code:'Sub Main()\nDim value As Date\nvalue = DateAdd("s", 2147483648#, #2024-01-01#)\nEnd Sub'}];
 const r=compileWin32(p);
 assert.ok(r.bytes.length);assert.ok(r.report.imports.some(x=>x.symbol==='VarR8Round'));
 assert.ok(r.report.imports.every(x=>!/(vbscript|msvbvm|mscoree)/i.test(x.dll)));
});
