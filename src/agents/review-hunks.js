import {agentLineDiff, restoreReviewedSource} from './changes.js';

/** Consecutive inserted/deleted lines form one independently restorable block.
 * Exact UTF-16 offsets retain mixed line endings and missing-final-newline state.
 * A coarse diff is one explicitly labelled replacement; oversized diffs offer no
 * selective operation. No fuzzy matching, patch evaluation or provider request.
 */
export function agentReviewHunks(before, after) {
  const diff = agentLineDiff(before, after), hunks = [];
  let oldOffset = 0, newOffset = 0, active = null;
  for (let i = 0; i < diff.rows.length; i++) {
    const row = diff.rows[i];
    if (row.kind === ' ') active = null;
    else {
      if (!active) {
        active = {id: 'change-' + (hunks.length + 1), firstRow: i, lastRow: i,
          oldStart: oldOffset, newStart: newOffset, oldEnd: oldOffset, newEnd: newOffset,
          oldText: '', newText: '', added: 0, removed: 0};
        hunks.push(active);
      }
      active.lastRow = i;
      if (row.kind === '-') { active.oldText += row.text; active.removed++; }
      else { active.newText += row.text; active.added++; }
      active.oldEnd = oldOffset + (row.kind === '-' ? row.text.length : 0);
      active.newEnd = newOffset + (row.kind === '+' ? row.text.length : 0);
    }
    if (row.kind !== '+') oldOffset += row.text.length;
    if (row.kind !== '-') newOffset += row.text.length;
  }
  return {...diff, hunks: Object.freeze(hunks.map(hunk => Object.freeze(hunk)))};
}

/** Caller retains the same consent, idle/design and revision checks as full restore.
 * Recompute the canonical block from the captured text; accept an identifier, not
 * caller-provided offsets/content. The entire current source must still match.
 */
export function restoreReviewedHunk(comparison, key, hunkId, project, epoch) {
  // Reuse the complete-source guard; the returned clone preserves unrelated fields.
  const candidate = restoreReviewedSource(comparison, key, project, epoch);
  const change = comparison.changes.find(item => item.key === key);
  const {hunks} = agentReviewHunks(change.before.text, change.after.text);
  const hunk = hunks.find(item => item.id === hunkId);
  if (!hunk) throw new Error('Select a complete change block from the current review.');
  candidate.modules.find(module => module.id === change.moduleId).code =
    change.after.text.slice(0, hunk.newStart) + hunk.oldText + change.after.text.slice(hunk.newEnd);
  return candidate;
}
