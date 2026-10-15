import test from 'node:test';
import assert from 'node:assert/strict';
import {verticalRangeMode,applyRangeOrientation,handleRangeEndpointKey} from '../src/controls/range-orientation.js';

function documentFixture(vertical = true, legacy = true) {
  const nodes = new Set(), probes = [];
  const document = {
    documentElement: {appendChild: node => nodes.add(node)},
    defaultView: {getComputedStyle: node => ({writingMode: vertical ? 'vertical-lr' : 'horizontal-tb', appearance: legacy && node.style.appearance === 'slider-vertical' ? 'slider-vertical' : 'none'})},
    createElement: () => {
      const node = {style: {}, attributes: {}, setAttribute(key, value) {this.attributes[key] = value;}, remove() {nodes.delete(this);}};
      probes.push(node);return node;
    }
  };
  return {document,nodes,probes};
}

test('vertical range detection checks actual rendered input style, not CSS syntax or user agent', () => {
  for (const vertical of [false,true]) {
    const {document,nodes,probes} = documentFixture(vertical);
    assert.equal(verticalRangeMode(document), vertical ? 'writing-mode' : 'legacy-appearance');
    assert.equal(nodes.size,0);
    assert.equal(probes.length,1);
    assert.equal(probes[0].type,'range');
    assert.equal(probes[0].tabIndex,-1);
    assert.equal(probes[0].attributes['aria-hidden'],'true');
    assert.match(probes[0].style.cssText,/visibility:hidden/);
    assert.equal(probes[0].style.appearance,vertical ? undefined : 'slider-vertical');
  }
});

test('range capability is cached once per document, not once per realm or control', () => {
  const modern=documentFixture(),legacy=documentFixture(false);
  for(let i=0;i<8;i++) {
    assert.equal(verticalRangeMode(modern.document),'writing-mode');
    assert.equal(verticalRangeMode(legacy.document),'legacy-appearance');
  }
  assert.equal(modern.probes.length,1);assert.equal(legacy.probes.length,1);
});

test('orientation switching removes the fallback and retains the original input', () => {
  const {document,probes}=documentFixture(false), classes=new Set();
  const input={ownerDocument:document,classList:{toggle(name,enabled){enabled?classes.add(name):classes.delete(name);}},getAttribute(name){return this[name];},setAttribute(name,value){this[name]=value;}};
  applyRangeOrientation(input,false);assert.equal(probes.length,0);
  applyRangeOrientation(input,true);assert.deepEqual([...classes],['vb-vrange','vb-range-legacy-vertical']);assert.equal(input['aria-orientation'],'vertical');
  applyRangeOrientation(input,false);assert.equal(classes.size,0);assert.equal(input['aria-orientation'],'horizontal');
  applyRangeOrientation(input,true);assert.equal(probes.length,1);
});

test('unavailable layout does not poison subsequent detection or assume unsupported legacy appearance', () => {
  const {document,probes}=documentFixture(false,false),root=document.documentElement;
  document.documentElement=null;assert.equal(verticalRangeMode(document),'writing-mode');assert.equal(probes.length,0);
  document.documentElement=root;assert.equal(verticalRangeMode(document),'writing-mode');assert.equal(probes.length,1);
  assert.equal(verticalRangeMode(null),'writing-mode');
});

test('exceptional style queries remove the temporary probe and leave detection retryable', () => {
  const {document,nodes,probes}=documentFixture();const original=document.defaultView.getComputedStyle;
  document.defaultView.getComputedStyle=()=>{throw new Error('style query');};
  assert.throws(()=>verticalRangeMode(document),/style query/);assert.equal(nodes.size,0);
  document.defaultView.getComputedStyle=original;assert.equal(verticalRangeMode(document),'writing-mode');assert.equal(probes.length,2);
});

function endpointFixture(value = '50') {
  const events = [], input = {min: '10', max: '90', value, disabled: false,
    ownerDocument: {defaultView: {Event}}, dispatchEvent: e => events.push(e)};
  const key = name => ({key: name, preventDefault() {this.defaultPrevented = true;}});
  return {input, events, key};
}

test('range endpoints share input/change dispatch, do not duplicate unchanged values, and preserve propagation', () => {
  const {input,events,key} = endpointFixture();
  for (const [name,value] of [['Home','10'],['End','90']]) {
    const e = key(name);handleRangeEndpointKey(input,e);
    assert.equal(input.value,value);assert.equal(e.defaultPrevented,true);
    const count = events.length;handleRangeEndpointKey(input,key(name));assert.equal(events.length,count);
  }
  assert.deepEqual(events.map(e=>[e.type,e.bubbles]),[['input',true],['change',true],['input',true],['change',true]]);
});

test('range endpoint keys do not intercept native arrows, shortcuts, IME or disabled/cancelled input', () => {
  const {input,events,key} = endpointFixture();
  for (const modifier of ['altKey','ctrlKey','metaKey','shiftKey','isComposing','defaultPrevented']) {
    const event = {...key('Home'),[modifier]:true};handleRangeEndpointKey(input,event);assert.equal(input.value,'50');
  }
  handleRangeEndpointKey(input,{...key('End'),keyCode:229});
  for (const name of ['ArrowUp','ArrowDown','PageUp','PageDown']) {
    const event = key(name);handleRangeEndpointKey(input,event);assert.equal(event.defaultPrevented,undefined);
  }
  input.disabled=true;const event=key('Home');handleRangeEndpointKey(input,event);
  assert.equal(event.defaultPrevented,undefined);assert.equal(input.value,'50');assert.equal(events.length,0);
});

test('endpoint defaults match the HTML range contract for empty and invalid bounds', () => {
  const {input,key} = endpointFixture();
  for (const bound of ['', 'not-a-number', 'Infinity']) {
    input.min=bound;input.max=bound;handleRangeEndpointKey(input,key('Home'));assert.equal(input.value,'0');
    handleRangeEndpointKey(input,key('End'));assert.equal(input.value,'100');
  }
});
