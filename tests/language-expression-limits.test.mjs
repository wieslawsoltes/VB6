import test from 'node:test';
import assert from 'node:assert/strict';
import {parseExpression,parseCall,MAX_EXPRESSION_NESTING,MAX_EXPRESSION_NODES} from '../src/language/expression.js';
import {compileProject} from '../src/language/compiler.js';
import {ProjectDiagnosticCache,diagnosticSnapshot} from '../src/language/diagnostics.js';
import {VirtualMachine} from '../src/runtime/vm.js';
const depth=MAX_EXPRESSION_NESTING;
const bounded=f=>assert.throws(f,e=>e.number===1002&&/limit exceeded/.test(e.message)&&!(e instanceof RangeError));
const expressions=[['flat addition',Array(depth+1).fill('1').join('+')],['flat power',Array(depth+1).fill('1').join('^')],['flat comparison',Array(depth+1).fill('1').join('=')],['postfix member','root'+'.Value'.repeat(depth)],['postfix calls','f'+'()'.repeat(depth)],['mixed groups and operators','('.repeat(200)+Array(100).fill('1').join('+')+')'.repeat(200)]];
for(const [name,expression] of expressions){
  test('deep AST yields a VB diagnostic without JS stack overflow: '+name,()=>bounded(()=>parseExpression(expression)));
  test('Call argument bound includes the complete AST: '+name,()=>bounded(()=>parseCall('F('+expression+')',{explicit:true})));
}
test('a large, shallow argument list remains valid below the node limit',()=>{
  const node=parseExpression('F('+Array(4096).fill('1').join(',')+')');assert.equal(node.kind,'call');assert.equal(node.args.length,4096);
});
test('a wide expression has an explicit total-node budget',()=>bounded(()=>parseExpression('F('+Array(MAX_EXPRESSION_NODES).fill('1').join(',')+')')));
test('flat expressions exactly at the depth boundary remain available',()=>assert.equal(parseExpression(Array(depth).fill('1').join('+')).kind,'binary'));
test('implicit Call wrapper depth is validated, including the callee chain',()=>bounded(()=>parseCall('root'+'.method'.repeat(depth))));
for(const source of ['F (value)','obj.F (value)','[F] (value)','.F (value)'])test('one-token-stream call parsing retains implicit ByRef grouping: '+source,()=>assert.equal(parseCall(source).args[0].kind,'group'));
for(const source of ['F(value)','obj.F(value)','[F](value)','.F(value)'])test('explicit Call retains ByRef argument syntax: '+source,()=>assert.equal(parseCall(source,{explicit:true}).args[0].kind,'id'));
test('failed whole-expression parse restores the call-argument cursor',()=>{
  const call=parseCall('obj.F (value), another');assert.equal(call.args.length,2);assert.equal(call.args[0].kind,'group');assert.equal(call.args[1].name,'another');
});
test('named and call-site ByVal arguments survive token-stream reuse',()=>{
  const call=parseCall('F(named:=1, ByVal value)',{explicit:true});assert.deepEqual(call.args.map(a=>a.kind),['named','byval']);
});
test('actual calls preserve implicit parentheses versus explicit Call ByRef updates',async()=>{
  const code='Sub Change(ByRef n As Long)\nn = 42\nEnd Sub\nSub Main\nDim n As Long\nChange (n)\nDebug.Print n\nCall Change(n)\nDebug.Print n\nEnd Sub';
  const p=compileProject({name:'Calls',startup:'Sub Main',modules:[{id:'M',name:'M',kind:'module',code}]});assert.deepEqual(p.diagnostics,[]);
  const output=[],vm=new VirtualMachine(p,{print:s=>output.push(s)});await vm.start();assert.deepEqual(output,['0','42']);
});
test('deep expression compiler and warm-cache diagnostics retain authored source line',()=>{
  const p={name:'Limits',modules:[{id:'M',name:'M',kind:'module',code:'Sub Main\nDebug.Print '+Array(depth+1).fill('1').join('+')+'\nEnd Sub'}]},cache=new ProjectDiagnosticCache();
  const compiled=compileProject(p);assert.equal(compiled.valid,false);assert.equal(compiled.diagnostics[0].line,2);assert.match(compiled.diagnostics[0].message,/limit exceeded/);
  for(let i=0;i<2;i++){const result=cache.check(diagnosticSnapshot(p));assert.equal(result.valid,false);assert.equal(result.diagnostics[0].line,2);assert.equal(result.diagnostics[0].source,'M');}
});
