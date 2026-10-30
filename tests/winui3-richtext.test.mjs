import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRTF,RichTextDocument,RICH_INHERITED_FIELDS} from '../src/controls/rtf.js';
import {RichTextController} from '../src/controls/richtext.js';

const defaults={fontName:'Arial',fontSize:10.5,bold:false,color:'#102030'};
const inherited=(document,offset)=>Object.keys(RICH_INHERITED_FIELDS).filter(key=>document.inheritanceAt(offset)&RICH_INHERITED_FIELDS[key]);
const all=['fontName','fontSize','bold','color'];
function controller(text='normal explicit'){
  const c=Object.create(RichTextController.prototype);
  Object.assign(c,{defaults,document:RichTextDocument.plain(text,defaults),start:0,end:0,undoStack:[],redoStack:[],maxLength:0,
    render(){},writeSelection(){},readSelection(){},onChange(){},onSelection(){}});
  return c;
}

test('plain run defaults remain distinct from explicitly selected equal values',()=>{
  const d=RichTextDocument.plain('abcd',defaults),original=d.styleAt(0);
  assert.deepEqual(inherited(d,0),all);
  d.format(1,3,{color:defaults.color,fontName:defaults.fontName,bold:defaults.bold});
  assert.equal(d.runs.length,3);
  assert.deepEqual(d.styleAt(1),original);
  assert.deepEqual(inherited(d,0),all);
  assert.deepEqual(inherited(d,1),['fontSize']);
  assert.deepEqual(inherited(d,3),all);
});

test('RTF groups distinguish explicit source fonts and same-value formatting from control defaults',()=>{
  const source=String.raw`{\rtf1\deff0{\fonttbl{\f0\fnil Arial;}}{\colortbl;\red16\green32\blue48;}A{\cf1\fs21\b0 B}C\cf0 D\b\plain E}`;
  const d=parseRTF(source,defaults);
  assert.equal(d.text,'ABCDE');
  assert.deepEqual(inherited(d,0),['fontSize','bold','color']);
  assert.deepEqual(inherited(d,1),[]);
  assert.equal(d.styleAt(1).color,defaults.color);assert.equal(d.styleAt(1).fontSize,defaults.fontSize);assert.equal(d.styleAt(1).bold,false);
  assert.deepEqual(inherited(d,2),['fontSize','bold','color']);
  assert.deepEqual(inherited(d,3),['fontSize','bold','color']);assert.equal(d.styleAt(3).color,null);
  assert.deepEqual(inherited(d,4),['fontSize','bold','color']);
  assert.equal(d.toRTF(),source);
});

test('slices, text insertion, rich insertion and snapshots preserve each field origin',()=>{
  const d=RichTextDocument.plain('abcd',defaults);d.format(1,3,{color:'#ff0000',fontSize:12});
  const piece=d.slice(1,3);assert.deepEqual(inherited(piece,0),['fontName','bold']);
  d.replace(2,2,'X');assert.deepEqual(inherited(d,2),['fontName','bold']);
  d.replace(0,0,'Y');assert.deepEqual(inherited(d,0),all);
  d.replace(d.length,d.length,piece);assert.deepEqual(inherited(d,d.length-1),['fontName','bold']);
  const snapshot=d.snapshot(),restored=RichTextDocument.restore(structuredClone(snapshot));
  assert.deepEqual(restored.snapshot(),snapshot);
  for(let at=0;at<d.length;at++){assert.deepEqual(restored.styleAt(at),d.styleAt(at));assert.deepEqual(inherited(restored,at),inherited(d,at));}
});

test('empty paragraph provenance survives paragraph formatting and undo snapshots',()=>{
  const source=String.raw`{\rtf1 A\par\cf0\fs24\b0 }`,d=parseRTF(source,defaults);
  assert.equal(d.text,'A\r\n');assert.deepEqual(inherited(d,d.length),['fontName','color']);
  d.formatParagraphs(d.length,d.length,{alignment:2,leftIndent:120});
  assert.deepEqual(inherited(d,d.length),['fontName','color']);
  const restored=RichTextDocument.restore(d.snapshot());
  assert.deepEqual(inherited(restored,restored.length),['fontName','color']);
  assert.equal(restored.styleAt(restored.length).alignment,2);
  d.replace(d.length,d.length,'tail');assert.deepEqual(inherited(d,d.length),['fontName','color']);
});

test('RTF serialization retains source values and explicit formatting without presentation mutations',()=>{
  const d=RichTextDocument.plain('default explicit',defaults);d.format(8,d.length,{fontName:'Tahoma',fontSize:12,bold:false,color:'#ff0000'});
  const snapshot=d.snapshot(),rtf=d.toRTF(),copy=parseRTF(rtf);
  assert.deepEqual(d.snapshot(),snapshot);assert.equal(d.toRTF(),rtf);
  assert.equal(copy.text,d.text);
  for(let at=0;at<d.length;at++)assert.deepEqual(copy.styleAt(at),d.styleAt(at));
  assert.deepEqual(inherited(copy,8),[]);
});

test('same-value selection and caret Sel edits preserve explicit origin through undo and redo',()=>{
  const c=controller('abcd');c.select(1,3);c.format('SelColor',0x302010);c.format('SelFontName','Arial');c.format('SelBold',0);
  assert.deepEqual(inherited(c.document,1),['fontSize']);
  const formatted=c.capture();assert.equal(c.undo(),true);assert.deepEqual(inherited(c.document,1),['fontSize','bold']);
  assert.equal(c.redo(),true);assert.deepEqual(c.capture(),formatted);
  c.select(4);c.format('SelFontSize',10.5);c.format('SelColor',0x302010);
  const caret=c.capture();assert.equal(caret.insertionInheritance,RICH_INHERITED_FIELDS.fontName|RICH_INHERITED_FIELDS.bold);
  c.replaceSelection('X');assert.deepEqual(inherited(c.document,4),['fontName','bold']);
  assert.equal(c.undo(),true);assert.deepEqual(c.capture(),caret);
  assert.equal(c.redo(),true);assert.equal(c.text,'abcdX');assert.deepEqual(inherited(c.document,4),['fontName','bold']);
});

test('Text reset restores control defaults while explicit RTF and original bytes remain authoritative',()=>{
  const c=controller();const source=String.raw`{\rtf1\deff0{\fonttbl{\f0\fnil Tahoma;}}{\colortbl;\red255\green0\blue0;}\f0\fs24\b0\cf1 fixed}`;
  c.setRTF(source);assert.deepEqual(inherited(c.document,0),[]);assert.equal(c.rtf,source);
  const before=c.capture();c.setText('reset');assert.deepEqual(inherited(c.document,0),all);
  assert.equal(c.undo(),true);assert.deepEqual(c.capture(),before);assert.equal(c.rtf,source);
});
