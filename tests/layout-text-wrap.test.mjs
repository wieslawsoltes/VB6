import test from 'node:test';import assert from 'node:assert/strict';
import {layoutGraphemes,measureWrappedText} from '../src/layout/text-wrap.js';
const width=t=>layoutGraphemes(t).length*10;
const wrap=(text,available,options)=>measureWrappedText(text,width,available,options);
test('CJK text wraps between graphemes without spaces',()=>{const m=wrap('你好世界你好',20);assert.deepEqual(m.lines,['你好','世界','你好']);assert.equal(m.width,20);});
test('opening and closing CJK punctuation stay with adjacent text',()=>{assert.deepEqual(wrap('「你好」世界',30).lines,['「你','好」世','界']);});
test('combining, joined emoji and flag graphemes remain intact',()=>{
 assert.deepEqual(layoutGraphemes('e\u0301👨‍👩‍👧‍👦🇵🇱👍🏽'),['e\u0301','👨‍👩‍👧‍👦','🇵🇱','👍🏽']);
 const m=wrap('👨‍👩‍👧‍👦👍🏽👍🏽',10);assert.deepEqual(m.lines,['👨‍👩‍👧‍👦','👍🏽','👍🏽']);
});
test('nonbreaking spaces bind words, ordinary spaces permit breaks',()=>{assert.deepEqual(wrap('one\u00a0two three',40).lines,['one\u00a0two ','three']);assert.deepEqual(wrap('one two',40).lines,['one ','two']);});
test('zero-width spaces break text without advancing width',()=>{assert.deepEqual(wrap('abc\u200bdef',30).lines,['abc\u200b','def']);assert.equal(wrap('abc\u200bdef',30).width,30);});
test('normal long words overflow; emergency wrapping is explicit and grapheme safe',()=>{assert.deepEqual(wrap('abcdef',20).lines,['abcdef']);assert.deepEqual(wrap('e\u0301e\u0301e\u0301',20,{breakLongWords:true}).lines,['e\u0301e\u0301','e\u0301']);});
test('CRLF, CR, empty and final lines retain their line counts',()=>{assert.deepEqual(wrap('a\r\nb\r\n',20).lines,['a','b','']);assert.equal(wrap('',20).lineCount,1);assert.equal(wrap('a\rb',20).lineCount,2);});
test('full-line shaping is used rather than summed glyph advances',()=>{const m=measureWrappedText('fi fi',t=>t==='fi fi'?20:t.length*10,20);assert.equal(m.lineCount,1);assert.equal(m.width,20);});
test('no-wrap measurement preserves large captions and rejects invalid metrics',()=>{assert.equal(measureWrappedText('a'.repeat(600000),t=>t.length,1,{wrap:false}).lineCount,1);assert.throws(()=>measureWrappedText('a',()=>NaN,20),/Invalid measured/);assert.throws(()=>wrap('a',Infinity),/finite/);});
test('input and measurement budgets fail explicitly instead of truncating text',()=>{assert.throws(()=>wrap('a'.repeat(1048577),20),/exceeds/);assert.throws(()=>wrap('a '.repeat(20000),200000),/budget/);});

test('an oversized unbroken ASCII word is scanned linearly without emergency wrapping',()=>{const m=measureWrappedText('x'.repeat(600000),t=>t.length,10);assert.equal(m.lineCount,1);assert.equal(m.width,600000);});
