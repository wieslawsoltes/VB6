import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {createVimLineLayout} from '../src/editor/advanced/vim-line-layout.js';

const base=new URL('../packages/advanced-editor/node_modules/monaco-editor/esm/vs/editor/common/',import.meta.url);
const available=existsSync(new URL('viewModel/monospaceLineBreaksComputer.js',base));
let MonospaceLineBreaksComputerFactory,CursorColumns;
if(available){
  ({MonospaceLineBreaksComputerFactory}=await import(new URL('viewModel/monospaceLineBreaksComputer.js',base)));
  ({CursorColumns}=await import(new URL('core/cursorColumns.js',base)));
}
const optional={skip:available?false:'Optional pinned Monaco dependencies are absent; run npm ci --prefix packages/advanced-editor.'};
function fixture(values={},Factory=MonospaceLineBreaksComputerFactory){
  const options={fontInfo:{typicalHalfwidthCharacterWidth:8,typicalFullwidthCharacterWidth:16,fontSize:14},wrappingInfo:{wrappingColumn:4},wrappingIndent:0,wordBreak:'normal',wrapOnEscapedLineFeeds:false,effectiveFullwidthCharacterWidth:'font',wordWrapBreakBeforeCharacters:'([{',wordWrapBreakAfterCharacters:' \t',...values};
  const monaco={editor:{EditorOption:Object.fromEntries(Object.keys(options).map(name=>[name,name]))}};
  const view={getOption:name=>options[name],getModel:()=>({getOptions:()=>({tabSize:values.tabSize||4})})};
  return {options,layout:createVimLineLayout(view,monaco,Factory,CursorColumns)};
}

test('staged Monaco layout matches wrapped offsets and keeps end-of-row normal cursors on their row',optional,()=>{
  const {layout}=fixture(),line=layout.line('abcdefghijkl');assert.equal(line.count,3);
  assert.deepEqual([0,3,4,7,8,12].map(ch=>line.rowAt(ch)),[0,0,1,1,2,2]);assert.equal(line.left(6),16);assert.equal(line.character(1,16),6);
  assert.equal(line.character(0,Infinity),3);assert.equal(line.character(1,Infinity),7);assert.equal(line.character(2,Infinity),12);assert.equal(line.character(1,-10),4);
  const empty=layout.line('');assert.equal(empty.count,1);assert.equal(empty.left(0),0);assert.equal(empty.character(0,100),0);
});
test('staged line breaks follow Monaco word boundaries and continuation indentation',optional,()=>{
  const words=fixture({wrappingInfo:{wrappingColumn:6}}).layout.line('one two three');assert.equal(words.count,3);assert.equal(words.character(1,0),4);assert.equal(words.character(2,0),8);
  const indent=fixture({wrappingInfo:{wrappingColumn:10},wrappingIndent:1}).layout.line('  abcdefghijklmnop');assert.equal(indent.count,2);assert.equal(indent.rowAt(10),1);assert.equal(indent.left(10),16);assert.equal(indent.character(1,16),10);assert.equal(indent.character(1,32),12);
});
test('staged projected cursor columns preserve tabs, surrogate pairs, wide characters and combining text',optional,()=>{
  const {layout}=fixture(),unicode=layout.line('A😀B漢字C');assert.equal(unicode.count,3);assert.equal(unicode.rowAt(4),1);assert.equal(unicode.character(0,8),1);assert.equal(unicode.left(3),24);assert.equal(unicode.character(0,Infinity),3);assert.equal(unicode.character(1,16),5);assert.equal(unicode.character(1,Infinity),5);
  const plain=fixture({wrappingInfo:{wrappingColumn:-1}}).layout;
  const tabs=plain.line('\tx\ty');assert.equal(tabs.left(1),32);assert.equal(tabs.left(3),64);assert.equal(tabs.character(0,64),3);
  const combining=plain.line('a\u0301b');assert.equal(combining.left(2),8);assert.equal(combining.character(0,8),2);
});
test('staged wrapping honors measured font width, fullwidth mode and escaped-line-feed settings',optional,()=>{
  const fontInfo={typicalHalfwidthCharacterWidth:10,typicalFullwidthCharacterWidth:30,fontSize:16};
  assert.equal(fixture({fontInfo}).layout.line('漢字').count,2);assert.equal(fixture({fontInfo,effectiveFullwidthCharacterWidth:'twoCells'}).layout.line('漢字').count,1);
  const text='"a\\nb\\nc"',off=fixture({wrappingInfo:{wrappingColumn:80}}).layout.line(text),on=fixture({wrappingInfo:{wrappingColumn:80},wrapOnEscapedLineFeeds:true}).layout.line(text);assert.equal(off.count,1);assert.equal(on.count,3);
});
test('staged line layout bounds its cache without retaining every visited source line',optional,()=>{
  let calculations=0;
  class CountingFactory extends MonospaceLineBreaksComputerFactory {createLineBreaksComputer(...args){calculations++;return super.createLineBreaksComputer(...args);}}
  const {layout}=fixture({},CountingFactory),first=layout.line('first');assert.strictEqual(layout.line('first'),first);assert.equal(calculations,1);
  for(let i=0;i<128;i++)layout.line('line '+i);assert.equal(calculations,129);assert.notStrictEqual(layout.line('first'),first);assert.equal(calculations,130);
});
