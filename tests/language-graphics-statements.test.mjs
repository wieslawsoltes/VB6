import test from 'node:test';import assert from 'node:assert/strict';
import {parseGraphicsStatement} from '../src/language/graphics-statements.js';
import {compileModule} from '../src/language/compiler.js';
for(const text of ['NativeTrace "line 23: Canvas.Line (5,7)-(20,7),&H123456"','s="Canvas.Circle (1,2),3"','WriteText "x.PSet (1,2)"','result=Canvas.Line(2)'])test('graphics-looking text is not a graphics statement: '+text,()=>{
 assert.equal(parseGraphicsStatement(text),null);
 if(!text.startsWith('result=')){const m=compileModule({name:'M',kind:'module',code:'Sub Main\n'+text+'\nEnd Sub'});assert.ok(!m.procedures.get('main').code.some(i=>i.op==='graphics'));}
});
test('nested coordinate calls and indexed receivers retain exact expression structure',()=>{
 const s=parseGraphicsStatement('Canvas(Choose()).Line (F(1,2),G(x:=1,y:=2))-(H(),4), RGB(1,2,3), BF');
 assert.equal(s.kind,'rect');assert.equal(s.fill,true);assert.equal(s.object.kind,'call');assert.equal(s.object.args[0].callee.name,'Choose');
 assert.equal(s.coords.length,4);assert.equal(s.coords[0].args.length,2);assert.equal(s.coords[1].args[0].kind,'named');assert.equal(s.coords[2].args.length,0);assert.equal(s.color.args.length,3);
});
test('implicit form and With receivers remain distinct and flags are case insensitive',()=>{
 assert.deepEqual(parseGraphicsStatement('Line (1,2)-(3,4),0,b').object,{kind:'id',name:'Me'});
 assert.deepEqual(parseGraphicsStatement('.PSet (1,2), 3').object,{kind:'with'});
 assert.equal(parseGraphicsStatement('Picture.Circle (1,2),F(3,4),RGB(5,6,7)').coords[2].args.length,2);
});
for(const text of ['Line (1)-(2,3)','Line (1,2)-(3,4),0,BB','PSet (1,2),3,4','Circle (1,2)','Circle (1,2),3,4,5,6,7,8','Line (1,2)'])test('invalid coordinate/flag syntax is diagnosed: '+text,()=>assert.throws(()=>parseGraphicsStatement(text)));

test('quoted parentheses inside coordinate arguments never change structural depth',()=>{
 const s=parseGraphicsStatement('Canvas.Line (F("("),1)-(2,F(")")),0');
 assert.equal(s.coords[0].args[0].value,'(');assert.equal(s.coords[3].args[0].value,')');
});

test('Step and implicit Line starts have explicit IR flags without rewriting receivers',()=>{
 const s=parseGraphicsStatement('Canvas(Choose()).Line Step (F(),G())-Step (H(),J()), , BF');
 assert.equal(s.object.kind,'call');assert.equal(s.stepStart,true);assert.equal(s.stepEnd,true);assert.equal(s.defaultColor,true);assert.equal(s.fill,true);
 const implicit=parseGraphicsStatement('.Line -Step (1,2)');assert.equal(implicit.implicitStart,true);assert.equal(implicit.stepEnd,true);assert.equal(implicit.coords.length,4);
 assert.equal(parseGraphicsStatement('PSet Step (1,2)').stepStart,true);
});
test('Circle omitted option slots and scale syntax remain structural',()=>{
 const s=parseGraphicsStatement('Circle Step (1,2),Radius(),,Start(),,Aspect()');
 assert.equal(s.defaultColor,true);assert.equal(s.arc.start.callee.name,'Start');assert.equal(s.arc.aspect.callee.name,'Aspect');assert.equal(s.arc.end,undefined);
 assert.equal(parseGraphicsStatement('Circle (1,2),3,4,5').arc.start.value,5);
 assert.equal(parseGraphicsStatement('Canvas.Scale (10,20)-(30,40)').kind,'scale');assert.deepEqual(parseGraphicsStatement('Scale').coords,[]);
});
for(const text of ['Scale (1,2)-(3,4),0','Circle Step -(1,2),3','Line Step -(1,2)','Circle (1,2),,0','Line (1,2)-Step 3,4'])test('reject malformed extended graphics: '+text,()=>assert.throws(()=>parseGraphicsStatement(text)));
