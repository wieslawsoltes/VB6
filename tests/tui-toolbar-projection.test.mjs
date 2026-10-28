import test from 'node:test';
import assert from 'node:assert/strict';
import {captureControl} from '../src/tui/projection.js';
import {CellBuffer} from '../src/tui/cells.js';
import {paintControl} from '../src/tui/controls.js';
import {tuiAttribute} from '../src/tui/appearance.js';

// Geometry-bearing DOM fixture. Queries implement ordinary tag/class/attribute
// matching so projection exercises its real discovery, ownership and clipping.
class Element {
  constructor(document,tag,{classes='',attributes={},text='',left=0,top=0,width=8,height=16,hidden=false,disabled=false}={}) {
    this.ownerDocument=document;this.tagName=tag.toUpperCase();this.attributes=attributes;this.textContent=text;
    this.classes=new Set(classes.split(/\s+/).filter(Boolean));this.classList={contains:name=>this.classes.has(name)};
    this.hidden=hidden;this.disabled=disabled;this.children=[];this.parentElement=null;this.dataset={};
    this.clientLeft=this.clientTop=0;this.clientWidth=this.offsetWidth=width;this.clientHeight=this.offsetHeight=height;
    this.rect={left,top,width,height,right:left+width,bottom:top+height};
  }
  append(child){child.parentElement=this;this.children.push(child);return child;}
  getAttribute(name){if(name==='hidden'&&this.hidden||name==='disabled'&&this.disabled)return '';return this.attributes[name]??null;}
  getBoundingClientRect(){return this.rect;}
  getClientRects(){return this.hidden?[]:[this.rect];}
  matches(selectors){return selectors.split(',').some(value=>{
    const selector=value.trim();
    if(selector===':active')return false;
    if(selector.includes('>')){const [parent,child]=selector.split('>');return this.matches(child)&&!!this.parentElement?.matches(parent);}
    if(selector.includes(':'))return false;
    const tag=/^[\w-]+/.exec(selector)?.[0];
    if(tag&&this.tagName!==tag.toUpperCase())return false;
    for(const [,name]of selector.matchAll(/\.([\w-]+)/g))if(!this.classes.has(name))return false;
    for(const [,name,expected]of selector.matchAll(/\[([\w-]+)(?:=([^\]]+))?\]/g)){
      const actual=this.getAttribute(name);if(actual===null||expected!==undefined&&actual!==expected.replace(/^['"]|['"]$/g,''))return false;
    }
    return !!selector;
  });}
  closest(selector){for(let node=this;node;node=node.parentElement)if(node.matches(selector))return node;return null;}
  querySelectorAll(selector){const found=[];for(const child of this.children){if(child.matches(selector))found.push(child);found.push(...child.querySelectorAll(selector));}return found;}
  querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
  contains(child){for(let node=child;node;node=node.parentElement)if(node===this)return true;return false;}
}

function toolbar() {
  const document={activeElement:null,defaultView:{getComputedStyle:()=>({textAlign:'left',overflowX:'visible',overflowY:'visible'})}};
  const node=new Element(document,'div',{classes:'vb-control vb-toolbar',width:256});
  node.dataset={type:'Toolbar',control:'Actions'};
  return {node,document,add:(tag,options)=>node.append(new Element(document,tag,options)),capture:()=>captureControl(node,32,1,{cellWidth:8,cellHeight:16})};
}
const color=role=>{const value=tuiAttribute('turbo',role);return value.foreground|(value.background<<4);};

test('retained toolbar projection preserves separators, blank slots, labels and item state in DOM order',()=>{
  const fixture=toolbar();
  fixture.add('button',{classes:'vb-toolbar-button',text:'Save',left:0,width:40});
  fixture.add('span',{classes:'vb-toolbar-button vb-toolbar-separator',attributes:{role:'separator'},left:48,width:1});
  fixture.add('span',{classes:'vb-toolbar-button vb-toolbar-placeholder',attributes:{role:'presentation'},left:64,width:24});
  fixture.add('button',{classes:'vb-toolbar-button active',attributes:{'aria-pressed':'true'},text:'Export',left:96,width:72});
  fixture.add('button',{classes:'vb-toolbar-button active',attributes:{'aria-pressed':'true'},text:'Delete',left:176,width:72,disabled:true});
  fixture.add('span',{classes:'vb-toolbar-button vb-toolbar-separator',left:248,width:1,hidden:true});
  const nested=fixture.add('div',{classes:'vb-control',left:0,width:40});
  nested.append(new Element(fixture.document,'button',{text:'Nested',left:0,width:40}));
  const state=fixture.capture();
  assert.deepEqual(state.rows.map(({x,width,text,kind,separator,selected,pressed,disabled})=>({x,width,text,kind,separator,selected,pressed,disabled})),[
    {x:0,width:5,text:'Save',kind:'button',separator:false,selected:false,pressed:false,disabled:false},
    {x:6,width:1,text:'',kind:'item',separator:true,selected:false,pressed:false,disabled:false},
    {x:8,width:3,text:'',kind:'item',separator:false,selected:false,pressed:false,disabled:false},
    {x:12,width:9,text:'Export',kind:'button',separator:false,selected:true,pressed:true,disabled:false},
    {x:22,width:9,text:'Delete',kind:'button',separator:false,selected:true,pressed:true,disabled:true}
  ]);
  const buffer=paintControl(new CellBuffer(32,1),state);
  assert.equal(buffer.toText(),'Save  │     Export    Delete    ');
  assert.equal(buffer.colors[8],color('panel'),'placeholder is blank panel space, not a button');
  assert.equal(buffer.colors[12],color('selected'));assert.equal(buffer.colors[22],color('disabled'));
});

test('segmented radio selection remains selected without a pressed attribute and disabled state wins',()=>{
  const fixture=toolbar();fixture.node.attributes.role='radiogroup';
  fixture.add('button',{classes:'vb-toolbar-button',attributes:{role:'radio','aria-checked':'false'},text:'Icons',left:0,width:64});
  const selected=fixture.add('button',{classes:'vb-toolbar-button active',attributes:{role:'radio','aria-checked':'true'},text:'List',left:64,width:64});
  fixture.document.activeElement=selected;
  let state=fixture.capture();
  assert.deepEqual(state.rows.map(({text,kind,selected,pressed,focused,separator})=>({text,kind,selected,pressed,focused,separator})),[
    {text:'Icons',kind:'button',selected:false,pressed:false,focused:false,separator:false},
    {text:'List',kind:'button',selected:true,pressed:false,focused:true,separator:false}
  ]);
  assert.equal(paintControl(new CellBuffer(32,1),state).colors[8],color('selected'));
  fixture.node.attributes['aria-disabled']='true';state=fixture.capture();
  assert.equal(state.disabled,true);assert.ok(state.rows.every(row=>row.disabled));
  assert.equal(paintControl(new CellBuffer(32,1),state).colors[8],color('disabled'));
});

test('empty designer toolbar retains its real affordance label without inventing buttons',()=>{
  const fixture=toolbar();
  fixture.add('span',{attributes:{'data-toolbar-placeholder':'','aria-hidden':'true'},text:'New   Open   Save',width:136});
  const state=fixture.capture();
  assert.equal(state.rows.length,1);assert.equal(state.rows[0].kind,'item');
  assert.equal(state.rows[0].text,'New   Open   Save');assert.equal(state.rows[0].separator,false);
  assert.equal(paintControl(new CellBuffer(32,1),state).toText(),'New   Open   Save'.padEnd(32));
});
