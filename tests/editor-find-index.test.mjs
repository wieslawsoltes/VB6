import test from 'node:test';
import assert from 'node:assert/strict';
import {FindIndex,replaceMatches,moveSourceSelection} from '../src/editor/find-index.js';

for(const query of ['.', '[', '\\', '$&', '(a)', '?', '^', '|', '*', '{x}'])test('find treats regex characters literally: '+query,()=>{
 const f=new FindIndex(),text='prefix '+query+' suffix '+query;assert.equal(f.search(text,query).length,2);assert.equal(replaceMatches(text,f.matches,'$&'),'prefix $& suffix $&');
});
test('find caches the source/query/options tuple and navigates by binary boundaries',()=>{
 const f=new FindIndex();assert.equal(f.search('abc ABC abcX','abc').length,3);const m=f.matches;assert.equal(f.search('abc ABC abcX','abc'),m);assert.equal(f.scans,1);
 assert.equal(f.next(0).index,0);assert.equal(f.next(3).index,1);assert.equal(f.next(30).index,0);assert.equal(f.next(0,-1).index,2);assert.equal(f.next(7,-1).index,1);assert.equal(f.next(6,-1).index,0);
 assert.equal(f.search('abc ABC abcX','abc',{wholeWord:true}).length,2);assert.equal(f.search('abc ABC abcX','abc',{wholeWord:true,matchCase:true}).length,1);
 assert.equal(f.search('new','').length,0);assert.equal(f.next(0),null);
});
test('single-pass Replace All handles 50,000 literal substitutions without recursive calls',()=>{
 const text=Array(50000).fill('old old').join('\n'),f=new FindIndex(),m=f.search(text,'old');assert.equal(m.length,100000);
 const result=replaceMatches(text,m,'$1\\new');assert.equal(result,Array(50000).fill('$1\\new $1\\new').join('\n'));
});
test('replacement range validation fails before returning partial output',()=>{
 assert.throws(()=>replaceMatches('abc',[{start:2,end:3},{start:1,end:2}],'x'),/range/);
 assert.throws(()=>replaceMatches('abc',[{start:0,end:4}],'x'),/range/);assert.equal(replaceMatches('abc',[],'x'),'abc');
});
test('source selection moves in either direction, copying and no-op insertion',()=>{
 assert.deepEqual(moveSourceSelection('ABcdEF',2,4,0),{text:'cdABEF',start:0,end:2,changed:true});
 assert.deepEqual(moveSourceSelection('ABcdEF',2,4,6),{text:'ABEFcd',start:4,end:6,changed:true});
 for(const at of [2,3,4])assert.equal(moveSourceSelection('ABcdEF',2,4,at).changed,false);
 assert.equal(moveSourceSelection('ABcdEF',2,4,3,true).text,'ABccddEF');
 assert.throws(()=>moveSourceSelection('abc',0,4,1),/range/);
});
test('source moves preserve Unicode text and empty selections',()=>{
 const text='A😀B\nC';assert.equal(moveSourceSelection(text,1,3,text.length).text,'AB\nC😀');assert.equal(moveSourceSelection(text,1,1,0).text,text);
});
