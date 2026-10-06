import test from 'node:test';
import assert from 'node:assert/strict';
import {agentReviewHunks, restoreReviewedHunk} from '../src/agents/review-hunks.js';
import {captureAgentReview, compareAgentReview, AgentChangeReview} from '../src/agents/changes.js';
import {newProject} from '../src/project/model.js';
const comparison = (before, after) => {
  const project = newProject(); project.modules[0].code = before;
  const checkpoint = captureAgentReview(project, 7);
  project.modules[0].code = after;
  return {project, review: compareAgentReview(checkpoint, captureAgentReview(project, 7)), key: 'source:' + project.modules[0].id};
};
for (const [name, before, after] of [
  ['insertion', 'one\ntwo\n', 'zero\none\ntwo\n'],
  ['deletion', 'one\ntwo\n', 'two\n'],
  ['replacement', 'old\n', 'new\n'],
  ['empty insertion', '', 'new'], ['empty deletion', 'old', ''],
  ['CRLF', 'one\r\ntwo\r\n', 'ONE\r\ntwo\r\n'],
  ['mixed endings', 'one\r\ntwo\nlast', 'one\r\nTWO\nlast'],
  ['missing final newline', 'line\n', 'line'],
  ['Unicode offsets', '🙂\nvalue\n', '🙂\n新値\n']
]) test('selective review: ' + name + ' reconstructs exact checkpoint text', () => {
  const {project, review, key} = comparison(before, after), {hunks} = agentReviewHunks(before, after);
  assert.equal(hunks.length, 1);
  assert.equal(restoreReviewedHunk(review, key, hunks[0].id, project, 7).modules[0].code, before);
  assert.equal(project.modules[0].code, after);
  assert.ok(Object.isFrozen(hunks) && Object.isFrozen(hunks[0]));
});
test('selective review: each block retains all other changes, fields, and designer edits', () => {
  const before = 'alpha\nkeep\nbravo\nlast\n', after = 'ALPHA\nkeep\nBRAVO\nlast\n';
  const {project, review, key} = comparison(before, after), {hunks} = agentReviewHunks(before, after);
  project.modules[0].form.properties.Caption = 'manual'; project.assets.user = 'keep';
  assert.equal(hunks.length, 2);
  const first = restoreReviewedHunk(review, key, hunks[0].id, project, 7);
  assert.equal(first.modules[0].code, 'alpha\nkeep\nBRAVO\nlast\n');
  assert.equal(first.modules[0].form.properties.Caption, 'manual'); assert.equal(first.assets.user, 'keep');
  assert.equal(restoreReviewedHunk(review, key, hunks[1].id, project, 7).modules[0].code, 'ALPHA\nkeep\nbravo\nlast\n');
});
test('selective review: deletion-only block retains surrounding added blocks', () => {
  const before = 'remove\nkeep\nlast\n', after = 'keep\nadded\nlast\n';
  const {project, review, key} = comparison(before, after), {hunks} = agentReviewHunks(before, after);
  assert.equal(hunks.length, 2); assert.equal(hunks[0].newStart, hunks[0].newEnd);
  assert.equal(restoreReviewedHunk(review, key, hunks[0].id, project, 7).modules[0].code, 'remove\nkeep\nadded\nlast\n');
});
test('selective review: reject edited source anywhere, even outside the chosen block', () => {
  const {project, review, key} = comparison('old\nkeep\n', 'new\nkeep\n');
  project.modules[0].code += 'concurrent\n';
  assert.throws(() => restoreReviewedHunk(review, key, 'change-1', project, 7), /changed after review/);
});
test('selective review: reject same-ID reload, different project, rename, removal, and fabricated identifiers', () => {
  for (const change of [p => p.id = 'other', p => p.modules[0].name = 'renamed', p => p.modules = []]) {
    const {project, review, key} = comparison('old', 'new'); change(project);
    assert.throws(() => restoreReviewedHunk(review, key, 'change-1', project, 7));
  }
  const {project, review, key} = comparison('old', 'new');
  assert.throws(() => restoreReviewedHunk(review, key, 'change-1', project, 8), /replaced|reloaded/);
  for (const id of ['change-0', 'change-2', null, {id: 'change-1', oldText: 'injected'}]) assert.throws(() => restoreReviewedHunk(review, key, id, project, 7), /complete change block/);
});
test('selective review: bounded coarse replacement is explicit and remains exact', () => {
  const before = Array.from({length: 600}, (_, i) => 'old' + i + '\n').join('');
  const after = Array.from({length: 600}, (_, i) => 'new' + i + '\n').join('');
  const diff = agentReviewHunks(before, after); assert.equal(diff.coarse, true); assert.equal(diff.hunks.length, 1);
  const {project, review, key} = comparison(before, after);
  assert.equal(restoreReviewedHunk(review, key, 'change-1', project, 7).modules[0].code, before);
});
test('selective review: oversized dense sources never offer a partial operation', () => {
  const before = '\n'.repeat(25000), after = 'new\n' + before;
  const diff = agentReviewHunks(before, after); assert.equal(diff.oversized, true); assert.deepEqual(diff.hunks, []);
  const {project, review, key} = comparison(before, after);
  assert.throws(() => restoreReviewedHunk(review, key, 'change-1', project, 7), /complete change block/);
});
test('selective review: empty comparison has no change blocks', () => {
  for (const text of ['', 'same\n', 'same']) assert.deepEqual(agentReviewHunks(text, text).hunks, []);
});
test('selective review: randomized offsets describe exact old/new source spans', () => {
  let seed = 42;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  for (let k = 0; k < 250; k++) {
    const make = () => Array.from({length: random() % 30}, () => ['🙂\n', 'a\r\n', 'b\n', '\n', 'c\n'][random() % 5]).join('') + (random() % 2 ? 'end' : '');
    const before = make(), after = make(), {hunks} = agentReviewHunks(before, after);
    let reconstructed = after;
    for (const hunk of [...hunks].reverse()) {
      assert.equal(before.slice(hunk.oldStart, hunk.oldEnd), hunk.oldText);
      assert.equal(after.slice(hunk.newStart, hunk.newEnd), hunk.newText);
      reconstructed = reconstructed.slice(0, hunk.newStart) + hunk.oldText + reconstructed.slice(hunk.newEnd);
    }
    assert.equal(reconstructed, before);
  }
});
test('review presentation: cleared tasks release feedback targets and view preferences', () => {
  const review = new AgentChangeReview(); review.feedbackText = 'draft'; review.feedbackTarget = {row: {text: 'source'}};
  review.view.scope = 'run'; review.view.key = 'source:one'; review.clear();
  assert.equal(review.feedbackText, ''); assert.equal(review.feedbackTarget, null); assert.deepEqual(review.view, {});
});

test('review presentation: new thread discards old target, unchanged thread preserves it', () => {
  const review = new AgentChangeReview(), project = newProject(), thread = {};
  review.begin(project, 7, thread); review.feedbackText = 'draft'; review.feedbackTarget = {row: {text: 'old'}}; review.view.scope = 'run';
  review.begin(project, 7, thread); assert.equal(review.feedbackText, 'draft'); assert.equal(review.view.scope, 'run');
  review.begin(project, 7, {}); assert.equal(review.feedbackText, ''); assert.equal(review.feedbackTarget, null); assert.deepEqual(review.view, {});
});
