import test from 'node:test';
import assert from 'node:assert/strict';
import {pointerMouseEvent} from '../src/controls/input.js';
for(const [type,button,buttons,expected]of [
  ['pointerdown',0,1,'MouseDown'],['pointerup',0,0,'MouseUp'],
  ['pointermove',-1,0,'MouseMove'],['pointermove',-1,7,'MouseMove'],
  ['pointermove',1,5,'MouseDown'],['pointermove',2,3,'MouseDown'],
  ['pointermove',0,4,'MouseUp'],['pointermove',2,1,'MouseUp']
])test(`${type}: button=${button}, buttons=${buttons} -> ${expected}`,()=>
  assert.equal(pointerMouseEvent({type,button,buttons}),expected));
