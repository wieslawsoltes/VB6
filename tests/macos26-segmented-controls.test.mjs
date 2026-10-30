import test from 'node:test';
import assert from 'node:assert/strict';
import {ToolbarButtons} from '../src/controls/collections.js';
import {validateMacOS26ToolbarButtons} from '../src/theme/macos26-compat.js';

const invalid = error => error.number === 380;
const values = buttons => buttons.items.map(button => button.Value);
const snapshot = buttons => buttons.items.map(button => ({Key:button.Key,Style:button.Style,Value:button.Value,Index:button.Index}));
const segmented = changed => new ToolbarButtons(changed, {validate:validateMacOS26ToolbarButtons});

test('grouped Toolbar selection is exclusive across hidden members and stops at ordinary buttons', () => {
  const buttons = new ToolbarButtons();
  const first = buttons.Add(undefined,'first','First',2), hidden = buttons.Add(undefined,'hidden','Hidden',2), third = buttons.Add(undefined,'third','Third',2);
  buttons.Add(undefined,'action','Action',0);
  const other = buttons.Add(undefined,'other','Other group',2);
  hidden.Visible = 0; hidden.Enabled = 0; hidden.Value = 1; other.Value = 1;
  assert.deepEqual(values(buttons),[0,1,0,0,1]);
  first.Value = 1; assert.deepEqual(values(buttons),[1,0,0,0,1]);
  third.Value = 1; assert.deepEqual(values(buttons),[0,0,1,0,1]);
  assert.equal(buttons.Item('third'),third);
  third.Value = 0; assert.deepEqual(values(buttons),[0,0,0,0,1]);
});

test('group updates notify observers only after the public selection becomes consistent', () => {
  const observations = []; let buttons;
  buttons = segmented(() => observations.push(values(buttons)));
  const first = buttons.Add(undefined,'first','First',2), second = buttons.Add(undefined,'second','Second',2);
  first.Value = 1; observations.length = 0;
  second.Value = 1;
  assert.deepEqual(observations,[[0,1]]);
  second.Value = 1; assert.equal(observations.length,1,'unchanged assignments do not repaint');
});

test('segmented independent toggles retain all selections through insertion and removal', () => {
  const buttons = segmented();
  const first = buttons.Add(undefined,'first','First',1), second = buttons.Add(undefined,'second','Second',1);
  first.Value = 1; second.Value = '1';
  const added = buttons.Add(1,'added','Added',1);
  assert.deepEqual(values(buttons),[0,1,1]);
  buttons.Remove('added'); assert.deepEqual(values(buttons),[1,1]);
  assert.equal(buttons.Item(1),first); assert.equal(buttons.Item(2),second); assert.equal(added.Index,0);
  first.Value = 0; assert.deepEqual(values(buttons),[0,1]);
});

test('invalid segmented insertion and style edits are atomic and do not consume keys', () => {
  const buttons = segmented(), first = buttons.Add(undefined,'first','First',2);
  first.Value = 1;
  const before = snapshot(buttons), revision = buttons.revision;
  for (const style of [0,1,3,4,5]) {
    assert.throws(() => buttons.Add(undefined,'next','Next',style),invalid);
    assert.deepEqual(snapshot(buttons),before); assert.equal(buttons.revision,revision);
  }
  const second = buttons.Add(undefined,'next','Next',2), valid = snapshot(buttons), nextRevision = buttons.revision;
  for (const style of [0,1,3,4,5]) {
    assert.throws(() => {second.Style = style;},invalid);
    assert.deepEqual(snapshot(buttons),valid); assert.equal(buttons.revision,nextRevision);
  }
  assert.equal(buttons.Item('next'),second);
});

test('momentary segments reject persistent Value before notifying or mutating', () => {
  let changes = 0;
  const buttons = segmented(() => changes++), button = buttons.Add(undefined,'back','Back',0);
  changes = 0;
  assert.throws(() => {button.Value = 1;},invalid);
  assert.equal(button.Value,0); assert.equal(changes,0);
  assert.throws(() => {button.Style = 5;},invalid);
  assert.equal(button.Style,0); assert.equal(changes,0);
});

test('Toolbar Value uses the VB 0/1 enum and rejects non-finite, mixed and fractional states', () => {
  const buttons = new ToolbarButtons(), button = buttons.Add(undefined,'toggle','Toggle',1);
  button.Value = 1; const revision = buttons.revision;
  for (const value of [-1,2,0.5,NaN,Infinity,'invalid']) assert.throws(() => {button.Value = value;},invalid);
  assert.equal(button.Value,1); assert.equal(buttons.revision,revision);
});

test('detached toolbar button values cannot change live group selection or notify its former owner', () => {
  let changes = 0;
  const buttons = segmented(() => changes++), first = buttons.Add(undefined,'first','First',2), removed = buttons.Add(undefined,'removed','Removed',2);
  buttons.Remove('removed'); first.Value = 1; changes = 0;
  removed.Value = 1; removed.Style = 1; removed.Value = 0;
  assert.equal(first.Value,1); assert.equal(removed.Index,0); assert.equal(changes,0);
  assert.deepEqual(values(buttons),[1]);
});

test('empty segmented collections can be rebuilt with a different tracking mode', () => {
  const buttons = segmented(), old = buttons.Add(undefined,'one','One',2); old.Value = 1;
  buttons.Clear();
  const momentary = buttons.Add(undefined,'one','One',0);
  assert.equal(momentary.Style,0); assert.equal(momentary.Value,0); assert.notEqual(momentary,old);
  assert.equal(old.Index,0);
});
