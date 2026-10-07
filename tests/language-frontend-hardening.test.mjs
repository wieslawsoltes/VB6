import test from 'node:test';
import assert from 'node:assert/strict';
import {tokenize, splitTop, logicalLines, VBError} from '../src/language/lexer.js';
import {parseExpression, parseCall, MAX_EXPRESSION_NESTING} from '../src/language/expression.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';

async function run(body) {
  const program=compileProject({name:'Frontend',startup:'Sub Main',modules:[{name:'M',kind:'module',code:`Sub Main()\n${body}\nEnd Sub`}]});
  assert.deepEqual(program.diagnostics,[]);
  const output=[];await new VirtualMachine(program,{print:s=>output.push(s)}).start();return output;
}

for(const [source,expected] of [
  ['x = 1: Rem ignored: x = 2',['x = 1']],
  ['again: Rem ignored: x = 2',['again']],
  ['100 Rem ignored: x = 2',['100']],
  ['x = "Rem: \'text\'": y = 2',[`x = "Rem: 'text'"`,'y = 2']],
  ['x = 1: If True Then x = 2: x = 3',['x = 1','If True Then x = 2: x = 3']],
  ['x = [a:b]: y = 1',['x = [a:b]','y = 1']],
  ['If True Then Rem ignored: x = 2',['If True Then']],
]) test('logical source boundaries: '+source,()=>assert.deepEqual(logicalLines(source).map(s=>s.text),expected));

for(const [source,separator,expected] of [
  ['a, [x,y], f(1, 2)',',',['a','[x,y]','f(1, 2)']],
  ['[a:b]: x = "a:b"',':',['[a:b]','x = "a:b"']],
  ['#1/2/2000 1:23#: x = 2',':',['#1/2/2000 1:23#','x = 2']],
  ['#1, #2',',',['#1','#2']],
  ['x#, y#, 1#',',',['x#','y#','1#']],
  ['x:=f(1, 2): y = 3',':',['x:=f(1, 2)','y = 3']],
  ['"a"";b"; c',';',['"a"";b"','c']],
]) test('top-level boundaries: '+source,()=>assert.deepEqual(splitTop(source,separator),expected));

for(const name of ['True','False','Not','New','Nothing','Empty','Null','Rem','TypeOf','AddressOf'])
  test('escaped keyword is an identifier: '+name,()=>assert.deepEqual(parseExpression('['+name+']'),{kind:'id',name}));

for(const source of ['a.','a !','a!42','.','a.(1)','New','New A.','AddressOf','TypeOf a Is','f(,','f(1,','1 +','1e','2D+','[]','1 constructor 2','1 toString 2'])
  test('malformed expression has a VB diagnostic: '+source,()=>assert.throws(()=>parseExpression(source),e=>e instanceof VBError&&e.number===1002));
for(const source of ['a.','a..b','.','Call.'])
  test('malformed procedure target has a VB diagnostic: '+source,()=>assert.throws(()=>parseCall(source),e=>e instanceof VBError&&e.number===1002));

test('overflowing floating literal fails with error 6 and its source column',()=>assert.throws(()=>parseExpression('1 + 1e9999'),e=>e.number===6&&e.column===5));
test('nested expressions are bounded before the JavaScript stack overflows',()=>assert.throws(()=>parseExpression('('.repeat(MAX_EXPRESSION_NESTING+10)+'1'+')'.repeat(MAX_EXPRESSION_NESTING+10)),e=>e instanceof VBError&&/nesting limit/.test(e.message)));
test('ordinary nesting remains supported',()=>assert.equal(parseExpression('('.repeat(50)+'1'+')'.repeat(50)).kind,'group'));
test('token offsets and raw doubled quotes are preserved',()=>{const text='  Foo$ & "a""b" + .25D+2';for(const t of tokenize(text))if(t.type!=='eof')assert.equal(text.slice(t.start,t.end),t.raw);assert.equal(tokenize(text).at(-2).value,25);});
test('strings cannot absorb physical newlines',()=>assert.throws(()=>tokenize('"a\nb"'),e=>e.number===1002));
test('VB exponentiation is left associative and binds above unary negation',async()=>assert.deepEqual(await run('Debug.Print 2 ^ 3 ^ 2, 3 ^ 3 ^ 3, -2 ^ 2, (2 ^ (3 ^ 2))'),['64 19683 -4 512']));
test('Rem comments cannot execute trailing colon statements',async()=>assert.deepEqual(await run('Debug.Print "safe": Rem ignored: Debug.Print "wrong"'),['safe']));
test('inline If after another statement owns its remaining colons',async()=>assert.deepEqual(await run('Dim x As Long\nx = 1: If False Then x = 2: x = 3\nDebug.Print x'),['1']));
test('With bang access addresses the default member without exposing host properties',async()=>assert.deepEqual(await run('Dim d As Object\nSet d = CreateObject("Scripting.Dictionary")\nd.Add "key", 1\nWith d\n!key = 7\nDebug.Print !key\nEnd With'),['7']));
