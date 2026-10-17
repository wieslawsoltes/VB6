import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createVimSession,Vim,VimAdapter,VimPosition,VimStringStream} from '../src/editor/input-modes/vim-adapter.js';

class Node {
  constructor(name,text=''){this.nodeName=name;this.nodeType=name==='#text'?3:1;this._text=text;this.childNodes=[];this.style={};this.attributes={};this.value='';}
  appendChild(child){this.childNodes.push(child);return child;}
  append(...children){for(const child of children)this.appendChild(typeof child==='string'?new Node('#text',child):child);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name];}
  querySelector(selector){for(const child of this.childNodes){if(selector==='input'&&child.nodeName==='input'||selector[0]==='.'&&child.attributes?.class?.split(' ').includes(selector.slice(1)))return child;const inner=child.querySelector?.(selector);if(inner)return inner;}return null;}
  get textContent(){return this._text+this.childNodes.map(child=>child.textContent).join('');}
  set textContent(value){this._text=String(value);this.childNodes=[];}
  remove(){}
}
globalThis.document??={createElement:name=>new Node(name),createTextNode:text=>new Node('#text',String(text))};
globalThis.window??={setTimeout,clearTimeout};

function editor(text,offset=0,extra={}){
  const undo=[],redo=[],applications=[];let selections=[{anchor:offset,head:offset}],lastKind='',session,prompt=null;const notifications=[];
  const host={
    options:{tabSize:4,indentUnit:4,indentWithTabs:false,lineHeight:18,charWidth:8,viewportLines:8},readOnly:false,language:'vb6',
    getText:()=>text,getSelections:()=>selections.map(s=>({...s})),
    apply(value,next,options={}){if(value!==text){if(lastKind!=='typing'||options.kind!=='typing')undo.push({text,selections});redo.length=0;lastKind=options.kind||'command';}text=value;selections=next.map(s=>({...s}));applications.push({text,selections,options});},
    setSelections(value){selections=value.map(s=>({...s}));},
    undo(){const previous=undo.pop();if(previous){redo.push({text,selections});text=previous.text;selections=previous.selections;lastKind='';}},
    redo(){const next=redo.pop();if(next){undo.push({text,selections});text=next.text;selections=next.selections;lastKind='';}},
    focus(){},execute(command,args){host.commands.push({command,args});},commands:[],
    openDialog(template,callback,options){const input=template.querySelector?.('input');if(!input)return host.openNotification(template,options);input.value=options.value||'';const close=value=>{if(typeof value==='string')input.value=value;else prompt=null;};prompt={input,callback,options,close};return close;},
    openNotification(template){notifications.push(template.textContent);return ()=>{};},...extra,
  };
  session=createVimSession(host);
  const result={host,session,applications,notifications,get text(){return text;},get selections(){return selections;},get prompt(){return prompt;},
    keys(...values){for(const key of values.flatMap(value=>Array.isArray(value)?value:String(value).match(/<[^>]+>|[^]/g)||[])){const event={key:({'<CR>':'Enter','<BS>':'Backspace','<Del>':'Delete','<Tab>':'Tab','<Esc>':'Escape'})[key]||key,preventDefault(){},stopPropagation(){}};
        if(!session.handleKey(key,event)&&session.state.mode==='insert'){if(key==='<CR>')session.adapter.execCommand('newlineAndIndent');else if(key==='<BS>')session.adapter.execCommand('delCharBefore');else if(key==='<Del>')session.adapter.execCommand('delCharAfter');else if(key==='<Tab>')session.adapter.execCommand('insertTab');else if(key.length===1)result.native(key);}}
      return result;},
    native(value){const s=selections[0],a=Math.min(s.anchor,s.head),b=Math.max(s.anchor,s.head),next=text.slice(0,a)+value+text.slice(b);host.apply(next,[{anchor:a+value.length,head:a+value.length}],{kind:'typing'});session.sync();return result;},
    at(offset,end=offset){host.setSelections([{anchor:offset,head:end}]);session.sync();return result;},
    ex(command){session.executeEx(command);return result;},
    submit(value){assert.ok(prompt,'Expected Vim prompt');const current=prompt;current.input.value=value;current.callback?.(value);current.close();return result;},
    promptKey(key){assert.ok(prompt,'Expected Vim prompt');const current=prompt;const event={key,keyCode:key==='Enter'?13:0,preventDefault(){},stopPropagation(){}};current.options.onKeyDown?.(event,current.input.value,current.close);return result;},
    dispose(){session.dispose();},
  };return result;
}
function isolated(name,run){test(name,()=>{Vim.resetVimGlobalState_();Vim.mapclear();Vim.setOption('pcre',false);return run();});}

// A visual surface with four-character wrapped rows and optional hidden model
// lines. It answers from the supplied staged text, independently of the host's
// last committed document and selection, just like a layout-aware backend.
function visualEditor(source,offset=0,{width=4,hidden=[],pageRows=3}={}){
  const calls=[];let e;
  function layout(text){const lines=text.split('\n'),rows=[],visible=[];let start=0;for(let line=0;line<lines.length;line++){if(!hidden.includes(line)){visible.push({line,start,length:lines[line].length});for(let ch=0;ch<Math.max(1,lines[line].length);ch+=width)rows.push({line,from:start+ch,to:start+Math.min(lines[line].length,ch+width)});}start+=lines[line].length+1;}return {rows,visible};}
  function rowAt(rows,offset){let index=0;for(let i=0;i<rows.length;i++){if(rows[i].from>offset)break;index=i;}return index;}
  e=editor(source,offset,{
    charCoords(offset,mode,context){const {rows}=layout(context?.text??e?.text??source),row=rowAt(rows,offset);return {left:(offset-rows[row].from)*8,top:row*18,bottom:(row+1)*18};},
    findPosV(offset,amount,unit,goalColumn,context){
      calls.push({offset,amount,unit,goalColumn,...context,canonicalText:e.text,canonicalHead:e.selections[0].head});
      const {rows,visible}=layout(context.text),current=rowAt(rows,offset);
      if(context.logical){const line=rows[current].line,from=visible.findIndex(value=>value.line===line),target=Math.max(0,Math.min(visible.length-1,from+amount)),destination=visible[target];return {offset:destination.start+Math.min(destination.length,context.goalCharacter??context.position.ch),hitSide:target===from&&amount!==0};}
      const target=Math.max(0,Math.min(rows.length-1,current+amount*(unit==='page'?pageRows:1))),destination=rows[target],column=goalColumn===undefined?offset-rows[current].from:goalColumn/8;
      return {offset:destination.from+Math.min(destination.to-destination.from,column),hitSide:target===current&&amount!==0};
    },
  });e.visualCalls=calls;return e;
}

test('vendored Vim engine matches the pinned release and documented clipboard patch',()=>{
  const bytes=readFileSync(new URL('../src/editor/input-modes/vendor/vim.js',import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),'82ea6d8a0629d7d2ea2c30690f069158f7342be1f3adab496b0077a796dc2dc0');
});

isolated('normal mode counts, operator motion composition, and dot repeat are atomic',()=>{
  const e=editor('one two three four five six');e.keys('2dw');assert.equal(e.text,'three four five six');assert.equal(e.applications.length,1);e.keys('.');assert.equal(e.text,'five six');e.keys('u');assert.equal(e.text,'three four five six');e.keys('<C-r>');assert.equal(e.text,'five six');e.dispose();
});
isolated('wrapped-row motions delegate counts and preserve visual goals through short lines',()=>{
  const e=visualEditor('abcdefgh\nx\nijklmnop',2);e.keys('2gj');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(1,0));e.keys('gj');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(2,2));e.keys('2gk');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,6));
  assert.ok(e.visualCalls.every(call=>call.unit==='line'&&!call.logical&&call.goalColumn===16));e.dispose();
});
isolated('logical motions skip folded lines under wrapped headers and keep the desired model column',()=>{
  const e=visualEditor('abcdefghij\nhidden\nhidden\nx\nabcdefghijkl',7,{hidden:[1,2]});e.keys('j');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(3,0));e.keys('j');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(4,7));e.keys('2k');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,7));
  assert.ok(e.visualCalls.every(call=>call.logical&&call.goalCharacter===7));assert.equal(e.visualCalls.at(-1).amount,-2);e.keys('dj');assert.equal(e.text,'abcdefghijkl');assert.equal(e.applications.length,1);e.keys('u');assert.equal(e.text,'abcdefghij\nhidden\nhidden\nx\nabcdefghijkl');e.dispose();
});
isolated('display-line operators and Ex normal use staged positions and publish one canonical edit',()=>{
  const e=visualEditor('abcdefghijkl\nnext',2);e.keys('dgj');assert.equal(e.text,'abghijkl\nnext');assert.equal(e.applications.length,1);e.keys('u');e.at(0).ex('normal! lgj');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,5));assert.equal(e.visualCalls.at(-1).offset,1);assert.equal(e.visualCalls.at(-1).canonicalHead,0);
  e.at(0).ex('normal! xgj');assert.equal(e.text,'bcdefghijkl\nnext');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,4));const staged=e.visualCalls.at(-1);assert.equal(staged.text,'bcdefghijkl\nnext');assert.equal(staged.canonicalText,'abcdefghijkl\nnext');assert.equal(staged.lineCount,2);assert.equal(staged.getLine(0),'bcdefghijkl');assert.equal(staged.offsetAt(1,2),14);assert.deepEqual(staged.positionAt(14),new VimPosition(1,2));assert.strictEqual(staged.changes,staged.operation.changes);assert.equal(staged.changes.length,1);assert.equal(e.applications.length,2);
  e.keys('u');assert.equal(e.text,'abcdefghijkl\nnext');assert.equal(staged.getLine(0),'bcdefghijkl','Captured layout index remains stable after another canonical edit');e.dispose();
});
isolated('mapped and macro display-line edits use current staged layout and remain one undo',()=>{
  const e=visualEditor('abcdefghijklmnopqrstuvwxyz');e.ex('nmap Q gj');e.keys('Q');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,4));e.at(0).keys('qa','x','gj','x','q');assert.equal(e.text,'bcdeghijklmnopqrstuvwxyz');e.keys('@a');assert.equal(e.text,'bcdehijkmnopqrstuvwxyz');assert.equal(e.applications.length,3);const replay=e.visualCalls.at(-1);assert.equal(replay.text,'bcdehijklmnopqrstuvwxyz');assert.equal(replay.canonicalText,'bcdeghijklmnopqrstuvwxyz');e.keys('u');assert.equal(e.text,'bcdeghijklmnopqrstuvwxyz');e.dispose();
});
isolated('page motions delegate page units and repeat counts to native visual geometry',()=>{
  const e=visualEditor('abcdefghijklmnop\nqrstuvwxyz\n0123456789',1);e.keys('<C-f>');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,13));e.keys('2<C-b>');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,1));assert.deepEqual(e.visualCalls.map(call=>[call.amount,call.unit,call.logical]),[[1,'page',false],[-2,'page',false]]);e.dispose();
});
isolated('native insert transactions feed dot replay and counted insert correctly',()=>{
  const e=editor('one two');e.keys('ciw','NEW','<Esc>','w','.');assert.equal(e.text,'NEW NEW');e.keys('u');assert.equal(e.text,'NEW two');e.dispose();
  const counted=editor('word');counted.keys('3i','ab','<Esc>');assert.equal(counted.text,'abababword');counted.dispose();
});
isolated('counted open-line inserts and dot repeat exclude the originating newline from insertion recording',()=>{
  const e=editor('');e.keys('3o','text','<Esc>');assert.equal(e.text,'\ntext\ntext\ntext');e.dispose();
  const dot=editor('');dot.keys('o','z','<Esc>','2.');assert.equal(dot.text,'\nz\nz\nz');dot.dispose();
});
isolated('dot records the final caret inside native auto-pair insertions',()=>{
  const e=editor('5 6');e.keys('a');e.session.adapter.operation(()=>{e.session.adapter.replaceSelection('()');e.session.adapter.setCursor(0,2);});e.keys('xy','<Esc>','.');assert.equal(e.text,'5(xy(xy)) 6');e.dispose();
});
isolated('Vim undo places the caret at the first restored change for subsequent motions',()=>{
  const e=editor('prefix suffix',11);e.keys('ciw','X','<Esc>','u');assert.equal(e.text,'prefix suffix');assert.equal(e.selections[0].head,7);e.dispose();
});
isolated('all visual modes retain directional and block selections',()=>{
  const e=editor('abcd\nefgh\nijkl');e.keys('<C-v>','j','l');assert.deepEqual(e.selections,[{anchor:0,head:2},{anchor:5,head:7}]);e.keys('d');assert.equal(e.text,'cd\ngh\nijkl');e.keys('u','gg','V','j','y','G','p');assert.equal(e.text,'abcd\nefgh\nijkl\nabcd\nefgh');e.dispose();
});
isolated('visual block insertion and append edit all rows without replacing the active surface',()=>{
  const e=editor('abc\ndef\nghi');e.keys('<C-v>','j','I','!','<Esc>');assert.equal(e.text,'!abc\n!def\nghi');e.keys('gg','<C-v>','j','l','A','?','<Esc>');assert.equal(e.text,'!a?bc\n!d?ef\nghi');e.dispose();
});
isolated('language keyboard maps preserve literal text in block Insert and Replace',()=>{
  const e=editor('abc\ndef');try{Vim.langmap('xh');e.keys('<C-v>','j','I');const event={key:'x',code:'KeyX'};assert.equal(e.session.keyFromEvent(event),'h');e.session.handleKey('h',event);e.keys('<Esc>');assert.equal(e.text,'xabc\nxdef');e.keys('gg','R');e.session.handleKey('h',event);e.keys('<Esc>');assert.equal(e.text,'xabc\nxdef');}finally{e.dispose();Vim.langmap('');}
});
isolated('reselecting a previous block includes insertions at the original mark boundary',()=>{
  const e=editor('1234\n5678\nabcdefg\nxyz',2);e.keys('<C-v>','2j','l','I','+-','<Esc>');e.at(e.text.indexOf('xyz')+2).keys('gv');assert.equal(e.session.adapter.getSelection(),'+-34\n+-78\n+-cd');e.dispose();
});
isolated('visual block change and register paste preserve the rectangle',()=>{
  const e=editor('abcd\nefgh\nijkl');e.keys('<C-v>','j','l','c','X','<Esc>');assert.equal(e.text,'Xcd\nXgh\nijkl');e.keys('u');assert.equal(e.text,'abcd\nefgh\nijkl');e.dispose();
  const p=editor('abcd\nefgh\nijkl');p.keys('<C-v>','j','l','y','G','p');assert.equal(p.text,'abcd\nefgh\niabjkl\n ef');p.dispose();
});
isolated('named registers are shared across documents and uppercase names append',()=>{
  const a=editor('one two');a.keys('"ayiw','w','"Ayiw');const b=editor('value');b.keys('"ap');assert.equal(b.text,'vonetwoalue');a.dispose();b.dispose();
});
isolated('macro recording replays complete changes including native inserted text',()=>{
  const e=editor('one\ntwo\nthree');e.keys('qa','I','!','<Esc>','j','q','@a','@@');assert.equal(e.text,'!one\n!two\n!three');e.dispose();
});
isolated('marks and jump positions track host changes',()=>{
  const e=editor('one\ntwo\nthree');e.keys('j','ma','G');e.at(0).native('zero\n');e.keys('`a');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(2,0));e.dispose();
});
isolated('word, paragraph, sentence, pair and quote text objects compose with operators',()=>{
  const pairs=[['outer(inner(value))',13,'di(','outer(inner())'],['a [b [c] d] e',6,'da[','a [b  d] e'],['Say "one two" now',7,'di"','Say "" now'],['one two three',5,'daw','one three'],['a <b<c>d> e',6,'di<','a <b<>d> e'],['a\t<\n\tbar\n>b',7,'da>','a\tb']];
  for(const [source,offset,keys,expected]of pairs){const e=editor(source,offset);e.keys(keys);assert.equal(e.text,expected,keys+' in '+source);e.dispose();}
  const e=editor('first paragraph\nsecond line\n\nnext paragraph');e.keys('dap');assert.equal(e.text,'next paragraph');e.dispose();
});
isolated('XAML tag text objects and bracket matching understand nested ranges',()=>{
  const e=editor('<StackPanel><TextBlock>Hello</TextBlock></StackPanel>',25,{language:'xaml'});e.keys('dit');assert.equal(e.text,'<StackPanel><TextBlock></TextBlock></StackPanel>');e.keys('dat');assert.equal(e.text,'<StackPanel></StackPanel>');e.dispose();
  const b=editor('call(a, (b + c))');b.keys('f(','%');assert.equal(b.selections[0].head,15);b.dispose();
});
isolated('bracket matching skips VB strings, apostrophe and Rem comments, and XML comments',()=>{
  const sources=[['(\")\")','vb6'],["( ' )\n)",'vb6'],['(\nRem )\n)','vb6'],['(<!-- )\n -->)','xaml'],['(/* )\n */)','javascript']];
  for(const [source,language]of sources){const e=editor(source,0,{language});e.keys('%');assert.equal(e.selections[0].head,source.length-1,source);e.dispose();}
});
isolated('comment operators use VB and XML comment syntax and toggle cleanly',()=>{
  for(const [source,language,commented]of [['  value','vb6',"  'value"],['  <TextBlock />','xaml','  <!-- <TextBlock /> -->']]){const e=editor(source,0,{language});e.keys('gcc');assert.equal(e.text,commented);e.keys('gcc');assert.equal(e.text,source);e.dispose();}
});
isolated('replace mode, character replacement, case operators and numeric changes work',()=>{
  const e=editor('abc def');e.keys('R','XY','<BS>','Z','<Esc>');assert.equal(e.text,'XZc def');e.keys('gg','gUw');assert.equal(e.text,'XZC def');e.keys('w','rQ');assert.equal(e.text,'XZC Qef');e.dispose();
  const n=editor('counter = 9',10);n.keys('<C-a>');assert.equal(n.text,'counter = 10');n.keys('2<C-x>');assert.equal(n.text,'counter = 8');n.dispose();
});
isolated('replace backspace restores successive overwritten characters without retaining whole documents',()=>{
  const e=editor('A😀BCD');e.keys('R','xyz','<BS>','<BS>');assert.equal(e.text,'x😀BCD');assert.ok(e.session.adapter._replaceStack.every(change=>!('beforeText'in change)&&!('afterText'in change)));e.keys('<BS>','<Esc>');assert.equal(e.text,'A😀BCD');e.dispose();
});
isolated('Replace dot and macro replay restore overwritten text when the recorded insertion contains Backspace',()=>{
  for(const [source,expected]of [['abcd wxyz','XZcd XZyz'],['A😀B 😀😀C','XZB XZC'],['ab w','XZ XZ'],['ab\nw','XZ\nXZ']]){const e=editor(source);e.keys('R','XY','<BS>','Z','<Esc>','w');const before=e.text;e.keys('.');assert.equal(e.text,expected);e.keys('u');assert.equal(e.text,before);e.dispose();}
  const macro=editor('abcd wxyz');macro.keys('qa','R','XY','<BS>','<BS>','Z','<Esc>','w','q','@a');assert.equal(macro.text,'Zbcd Zxyz');macro.dispose();
});
isolated('Replace records typing equal to the original character for repeat and Backspace without a redundant host edit',()=>{
  const e=editor('abc wxyz');e.keys('R','a');assert.equal(e.applications.length,0);e.keys('<Esc>','w','.');assert.equal(e.text,'abc axyz');e.dispose();
  const correction=editor('abcd wxyz');correction.keys('R','ab','<BS>','Z','<Esc>','w','.');assert.equal(correction.text,'aZcd aZyz');correction.dispose();
});
isolated('Ex ranges, substitution flags, global commands, sort and undo share canonical edits',()=>{
  const e=editor('cat dog\ncat cat\nzebra\napple');e.ex('%s/cat/fox/g');assert.equal(e.text,'fox dog\nfox fox\nzebra\napple');e.ex('g/fox/d');assert.equal(e.text,'zebra\napple');e.ex('sort');assert.equal(e.text,'apple\nzebra');e.keys('u');assert.equal(e.text,'zebra\napple');e.dispose();
});
isolated('Ex normal and mapped Insert commands honor DOM arrow-key aliases',()=>{
  const e=editor('abc\ndef');e.ex('normal i<Right>X<Esc>');assert.equal(e.text,'aXbc\ndef');e.ex('%normal A<Left>!<Esc>');assert.equal(e.text,'aXb!c\nde!f');e.dispose();
});
isolated('format operators reflow paragraphs at textwidth and leave the caret on the final affected line',()=>{
  const e=editor('alpha beta gamma delta\nepsilon zeta\n\nend');e.ex('set tw=15');e.keys('gqj');assert.equal(e.text,'alpha beta\ngamma delta\nepsilon zeta\n\nend');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(2,0));e.dispose();
  const long=editor('x'.repeat(100));long.ex('set tw=15');long.keys('gqq');assert.equal(long.text,'x'.repeat(100));long.dispose();
});
isolated('global commands invalidate joined line handles instead of processing the joined line twice',()=>{
  const e=editor('one\ntwo\nthree\nfour\nfive\n');e.ex('g/o/s/\\n/;');assert.equal(e.text,'one;two\nthree\nfour;five\n');e.dispose();
});
isolated('substitution deletes adjacent matches and zero-width global substitution terminates',()=>{
  const e=editor('W12345678OR12345D');e.ex('s/\\d//g');assert.equal(e.text,'WORD');e.ex('%s/^/prefix /g');assert.equal(e.text,'prefix WORD');e.dispose();
});
isolated('substitute confirmation callbacks commit outside a keyboard operation',()=>{
  const e=editor('cat cat\ncat');e.ex('%s/cat/fox/gc');e.promptKey('y');assert.equal(e.text,'fox cat\ncat');e.promptKey('n');e.promptKey('a');assert.equal(e.text,'fox cat\nfox');e.dispose();
});
isolated('search prompts, next/previous results and search history update the canonical selection',()=>{
  const e=editor('one two one\none');e.keys('/').submit('one');assert.equal(e.selections[0].head,8);e.keys('n');assert.equal(e.selections[0].head,12);e.keys('N');assert.equal(e.selections[0].head,8);e.keys('?').submit('two');assert.equal(e.selections[0].head,4);e.dispose();
});
isolated('backward search wraps to the final line including non-overlapping matches',()=>{
  const e=editor('aaa aa \n a aa');e.keys('?').submit('aa');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(1,3));e.keys('n');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,4));e.keys('n');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,0));e.keys('n');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(1,3));e.dispose();
});
isolated('backward zero-width search avoids the preceding match boundary and line endings',()=>{
  const e=editor('aaa  aa\n aa');e.keys('?').submit('a*');const expected=[[1,1],[1,0],[0,5],[0,4],[0,0]];for(const [line,ch]of expected){assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(line,ch));e.keys('n');}e.dispose();
});
isolated('programmatic document replacement resets the caret and adopts canonical text',()=>{
  const e=editor('old source',7);e.session.adapter.setValue('new source');assert.equal(e.text,'new source');assert.deepEqual(e.selections,[{anchor:0,head:0}]);e.keys('cG','changed','<Esc>');assert.equal(e.text,'changed');e.dispose();
});
isolated('multiline and zero-length search cursors terminate and track replacements',()=>{
  const e=editor('a\na\nb');let cursor=e.session.adapter.getSearchCursor(/^/gm,new VimPosition(0,0)),positions=[];while(cursor.findNext()){positions.push(cursor.from());assert.ok(positions.length<10);}assert.deepEqual(positions,[new VimPosition(0,0),new VimPosition(1,0),new VimPosition(2,0)]);cursor=e.session.adapter.getSearchCursor(/a\na/,new VimPosition(0,0));assert.ok(cursor.findNext());cursor.replace('x');assert.equal(e.text,'x\nb');e.dispose();
});
isolated('Unicode insertions, deletion, native composition sync and surrogate offsets remain valid',()=>{
  const e=editor('A😀B');e.keys('l','x');assert.equal(e.text,'AB');e.keys('i');e.native('zażółć 漢字');e.keys('<Esc>');assert.equal(e.text,'Azażółć 漢字B');assert.ok(!/[\uD800-\uDFFF]/.test(e.text));e.dispose();
});
isolated('Insert and Replace leave Normal carets on complete Unicode characters before deletion and repeat',()=>{
  const insert=editor('abc');insert.keys('i').native('😀').keys('<Esc>');assert.deepEqual(insert.selections,[{anchor:0,head:0}]);insert.keys('x');assert.equal(insert.text,'abc');insert.keys('u');assert.equal(insert.text,'😀abc');insert.dispose();
  const replace=editor('abc');replace.keys('R');replace.session.handleKey('😀',{key:'😀'});replace.keys('<Esc>');assert.equal(replace.text,'😀bc');assert.deepEqual(replace.selections,[{anchor:0,head:0}]);replace.keys('l','.');assert.equal(replace.text,'😀😀c');assert.deepEqual(replace.selections,[{anchor:2,head:2}]);replace.keys('x');assert.equal(replace.text,'😀c');replace.dispose();
});
isolated('Unicode selection boundaries expand directed ranges and clip collapsed external carets safely',()=>{
  const e=editor('A😀B');e.at(2);assert.deepEqual(e.selections,[{anchor:1,head:1}]);e.keys('x');assert.equal(e.text,'AB');e.keys('u');
  e.at(1,2);assert.deepEqual(e.selections,[{anchor:1,head:3}]);e.keys('y');assert.equal(Vim.getVimGlobalState_().registerController.getRegister('"').toString(),'😀');
  e.keys('gv');assert.equal(e.session.adapter.getSelection(),'😀');e.keys('<Esc>');
  e.at(2,1);assert.deepEqual(e.selections,[{anchor:3,head:1}]);e.keys('d');assert.equal(e.text,'AB');e.dispose();
  for(const [anchor,head]of [[1,3],[3,1]]){const selected=editor('A😀B');selected.at(anchor,head).keys('y');assert.equal(Vim.getVimGlobalState_().registerController.getRegister('"').toString(),'😀');selected.dispose();}
});
isolated('native IME commitment fills every block row and remains one canonical undo',()=>{
  const e=editor('abc\ndef');e.keys('<C-v>','j','I');e.host.composing=true;e.session.beginComposition();e.native('漢😀');assert.equal(e.text,'漢😀abc\ndef');e.host.composing=false;assert.equal(e.session.endComposition(),true);assert.equal(e.text,'漢😀abc\n漢😀def');e.keys('<Esc>','u');assert.equal(e.text,'abc\ndef');e.dispose();
});
isolated('IME already committed to native multiple selections is reconciled without duplication',()=>{
  const e=editor('abc\ndef');e.keys('<C-v>','j','I');e.host.composing=true;e.session.beginComposition();e.host.apply('漢abc\n漢def',[{anchor:1,head:1},{anchor:6,head:6}],{kind:'typing'});e.session.sync();e.host.composing=false;assert.equal(e.session.endComposition(),true);assert.equal(e.text,'漢abc\n漢def');assert.equal(e.applications.length,1);assert.deepEqual(Vim.getVimGlobalState_().macroModeState.lastInsertModeChanges.changes,['漢']);e.keys('<Esc>');e.dispose();
});
isolated('IME can enter Insert from Normal after the host composition guard is active',()=>{
  const e=editor('abc');e.keys('d');e.host.composing=true;assert.equal(e.session.beginComposition(),true);assert.equal(e.session.state.mode,'insert');e.native('漢');e.host.composing=false;e.session.endComposition();e.keys('<Esc>','.');assert.equal(e.text,'漢漢abc');e.dispose();
});
isolated('Replace IME overwrites complete code points and Backspace restores the original text',()=>{
  const e=editor('A😀BC');e.keys('R');e.host.composing=true;e.session.beginComposition();e.native('漢字');e.host.composing=false;e.session.endComposition();assert.equal(e.text,'漢字BC');e.keys('<BS>','<Esc>');assert.equal(e.text,'A😀BC');e.dispose();
});
isolated('Replace dot replay and regular-expression substitution operate on Unicode code points',()=>{
  const e=editor('AB 😀😀');e.keys('R');e.host.composing=true;e.session.beginComposition();e.native('漢字');e.host.composing=false;e.session.endComposition();e.keys('<Esc>','w','.');assert.equal(e.text,'漢字 漢字');e.dispose();
  const s=editor('😀😀');s.ex('%s/./X/g');assert.equal(s.text,'XX');s.dispose();
});
isolated('IME reconciliation cancels extra modal edits after an unexpected source or surface change',()=>{
  const e=editor('abc\ndef');e.keys('<C-v>','j','I');e.host.composing=true;e.session.beginComposition();e.host.apply('external change',[{anchor:0,head:0}],{kind:'command'});e.host.composing=false;assert.equal(e.session.endComposition(),false);assert.equal(e.text,'external change');assert.deepEqual(e.selections,[{anchor:0,head:0}]);e.dispose();
});
isolated('read-only editing blocks operators, substitutes, insertions and undo while preserving motions',()=>{
  const e=editor('one two\nthree',0,{readOnly:true});e.keys('w');assert.equal(e.selections[0].head,4);e.keys('dd');e.ex('%s/o/x/g');e.keys('i','x','u');assert.equal(e.text,'one two\nthree');assert.equal(e.applications.length,0);e.dispose();
});
isolated('user mappings, Ex options and editor commands retain extensibility',()=>{
  const e=editor('one two');e.ex('nmap Q diw');e.keys('Q');assert.equal(e.text,' two');e.ex('set shiftwidth=2');e.keys('>>');assert.equal(e.text,'   two');e.ex('write');assert.deepEqual(e.host.commands,[{command:'save',args:undefined}]);e.dispose();
});
isolated('host navigation and Ex pane closure retain the destination selection after the Vim operation flushes',()=>{
  const e=editor('0123456789\nabcdefghij\nklmnopqrst',2);
  e.host.execute=()=>{e.host.setSelections([{anchor:12,head:12}]);};
  e.session.adapter.operation(()=>{e.session.adapter.curOp.isVimOp=true;e.session.adapter.execCommand('goToDefinition');});
  assert.deepEqual(e.selections,[{anchor:12,head:12}]);assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(1,1));
  e.keys('j');assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(2,1));
  Vim.defineEx('testhostclose','testhostclose',cm=>cm.executeHostCommand('close'));
  e.at(2).ex('testhostclose');assert.deepEqual(e.selections,[{anchor:12,head:12}]);assert.equal(e.applications.length,0);e.dispose();
});
isolated('host commands publish pending edits once and subsequent replay edits use the resulting host caret',()=>{
  const e=editor('abcdef'),observed=[],changes=[];const cm=e.session.adapter;
  cm.on('changes',(_,value)=>changes.push(value.map(change=>change.text.join('\n'))));
  e.host.execute=command=>{observed.push({command,text:e.text,selections:e.selections});e.host.setSelections([{anchor:2,head:2}]);return true;};
  cm.operation(()=>{cm.curOp.isVimOp=true;Vim.handleKey(cm,'x');cm.execCommand('save');Vim.handleKey(cm,'x');});
  assert.deepEqual(observed,[{command:'save',text:'bcdef',selections:[{anchor:0,head:0}]}]);
  assert.equal(e.text,'bcef');assert.equal(e.applications.length,2);assert.deepEqual(changes,[[''],['']]);
  e.keys('u');assert.equal(e.text,'bcdef');e.keys('u');assert.equal(e.text,'abcdef');e.dispose();
});
isolated('host source changes are adopted without replaying them into canonical history',()=>{
  const e=editor('old text');e.host.execute=()=>{e.host.apply('replacement',[{anchor:3,head:3}],{kind:'command'});};
  e.session.adapter.execCommand('goToDefinition');assert.equal(e.text,'replacement');assert.equal(e.session.adapter.getValue(),'replacement');assert.equal(e.applications.length,1);
  e.keys('x');assert.equal(e.text,'repacement');e.keys('u');assert.equal(e.text,'replacement');e.dispose();
});
isolated('asynchronous host commands adopt settled selection changes without overwriting intervening edits',async()=>{
  const e=editor('abcdefghi');let finish;
  e.host.execute=()=>new Promise(resolve=>{finish=()=>{e.host.setSelections([{anchor:6,head:6}]);resolve('saved');};});
  const pending=e.session.adapter.execCommand('save');e.keys('x');finish();assert.equal(await pending,'saved');
  assert.equal(e.text,'bcdefghi');assert.deepEqual(e.selections,[{anchor:6,head:6}]);assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,6));assert.equal(e.applications.length,1);
  e.host.execute=async()=>{e.host.setSelections([{anchor:2,head:2}]);throw new Error('save failed');};
  await assert.rejects(e.session.adapter.execCommand('save'),/save failed/);assert.deepEqual(e.selections,[{anchor:2,head:2}]);assert.deepEqual(e.session.adapter.getCursor(),new VimPosition(0,2));e.dispose();
});
isolated('late host command settlement does not inspect or mutate a disposed source session',async()=>{
  const e=editor('abc');let finish;e.host.execute=()=>new Promise(resolve=>{finish=resolve;});
  const pending=e.session.adapter.execCommand('save');e.dispose();e.host.getText=()=>{throw new Error('disposed host');};finish(true);assert.equal(await pending,true);assert.equal(e.text,'abc');
});
isolated('host indentation options update dynamically until a local Vim option overrides them',()=>{
  const e=editor('value');e.host.options.indentUnit=2;e.keys('>>');assert.equal(e.text,'  value');e.ex('set sw=3');e.host.options.indentUnit=8;e.keys('>>');assert.equal(e.text,'     value');e.dispose();
});
isolated('disposal restores options and stops notifications and late mutation',()=>{
  const e=editor('one');e.keys('i','x');e.dispose();assert.equal(e.session.handleKey('x'),false);assert.equal(e.session.insertText('late'),false);assert.equal(e.text,'xone');assert.equal(e.session.adapter.disposed,true);
});
isolated('clipboard registers guard permission failures and cross-document asynchronous completion',async()=>{
  let resolveRead,written='';const e=editor('one two',0,{writeClipboard:text=>{written=text;return Promise.resolve();},readClipboard:()=>new Promise(resolve=>resolveRead=resolve)});
  e.keys('"+yiw');assert.equal(written,'one');e.keys('w','"*p');resolveRead('X');await e.session.adapter.pendingClipboard;assert.equal(e.text,'one tXwo');
  e.keys('"+p');e.at(0);resolveRead('wrong');await e.session.adapter.pendingClipboard;assert.equal(e.text,'one tXwo');assert.ok(e.notifications.some(n=>n.includes('cancelled')));
  e.host.readClipboard=()=>Promise.reject(new Error('denied'));e.keys('"+p');await e.session.adapter.pendingClipboard;assert.equal(e.text,'oonene tXwo');
  e.dispose();
});
isolated('clipboard read completion cannot mutate a disposed or read-only session',async()=>{
  let complete;const e=editor('abc',0,{readClipboard:()=>new Promise(resolve=>complete=resolve)});e.keys('"+p');e.dispose();complete('late');await e.session.adapter.pendingClipboard;assert.equal(e.text,'abc');
});
test('Ex token streams consume anchored regexes, spaces and case-insensitive literals',()=>{
  const stream=new VimStringStream('  Set foo=42');assert.equal(stream.eatSpace(),true);assert.equal(stream.match('set',true,true),true);stream.eatSpace();assert.equal(stream.match(/foo=(\d+)/)[1],'42');assert.equal(stream.eol(),true);
});
