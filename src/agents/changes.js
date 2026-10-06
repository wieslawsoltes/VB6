// Local project review, inspired by the Codex review pane (reviewed 2026-10-06):
// https://developers.openai.com/codex/app/review/
// This is not Git staging. Snapshots never enter provider context automatically.
const LIMITS = Object.freeze({documents: 2000, characters: 4000000, perDocument: 500000});
const extension = kind => ({form: 'frm', class: 'cls', module: 'bas'})[kind] || 'txt';
const identity = (project, epoch) => ({projectId: project.id, projectName: project.name, epoch});

export function captureAgentReview(project, epoch, limits = LIMITS) {
  for (const key of Object.keys(LIMITS)) if (!Number.isSafeInteger(limits[key]) || limits[key] < 1 || limits[key] > LIMITS[key]) throw new Error('Invalid review limits.');
  const documents = [], keys = new Set(); let characters = 0, omittedDocuments = 0;
  function add(module, area, text) {
    if (documents.length >= limits.documents) { omittedDocuments++; return; }
    const key = area + ':' + module.id;
    if (keys.has(key)) throw new Error('Duplicate module identity in change review.');
    keys.add(key);
    const omitted = text.length > limits.perDocument || characters + text.length > limits.characters;
    if (!omitted) characters += text.length;
    documents.push(Object.freeze({key, moduleId: module.id, name: module.name, kind: module.kind, area,
      path: module.name + '.' + extension(module.kind) + (area === 'designer' ? '.designer.json' : ''),
      text: omitted ? null : text, omitted}));
  }
  for (const module of project.modules) {
    add(module, 'source', module.code);
    if (module.form) add(module, 'designer', JSON.stringify(module.form, null, 2));
  }
  return Object.freeze({...identity(project, epoch), created: new Date().toISOString(), characters, omittedDocuments, documents: Object.freeze(documents)});
}
export function compareAgentReview(before, after) {
  const old = new Map(before.documents.map(doc => [doc.key, doc])), now = new Map(after.documents.map(doc => [doc.key, doc]));
  const sameWorkspace = before.projectId === after.projectId && before.epoch === after.epoch;
  const changes = [];
  for (const key of new Set([...old.keys(), ...now.keys()])) {
    const a = old.get(key), b = now.get(key), doc = b || a;
    // A capped inventory cannot prove that an unlisted document was deleted/added.
    const unknown = !!a?.omitted || !!b?.omitted || (!a && before.omittedDocuments > 0) || (!b && after.omittedDocuments > 0);
    if (!unknown && a && b && a.text === b.text && a.name === b.name && a.kind === b.kind) continue;
    const status = unknown ? 'not-compared' : !a ? 'added' : !b ? 'removed' : a.name !== b.name || a.kind !== b.kind ? 'renamed' : 'modified';
    changes.push(Object.freeze({key, path: doc.path, moduleId: doc.moduleId, area: doc.area, before: a || null, after: b || null, status,
      canRestore: sameWorkspace && !unknown && !!a && !!b && doc.area === 'source' && a.name === b.name && a.kind === b.kind && a.text !== b.text}));
  }
  return Object.freeze({before, after, sameWorkspace, changes: Object.freeze(changes)});
}
export class AgentChangeReview {
  constructor() { this.first = null; this.last = null; this.thread = null; this.revision = 0; this.feedbackText = ''; this.feedbackKey = ''; this.feedbackTarget = null; this.view = {}; }
  begin(project, epoch, thread) {
    const snapshot = captureAgentReview(project, epoch);
    if (this.thread !== thread) { this.first = null; this.last = null; this.thread = thread; this.feedbackText = ''; this.feedbackKey = ''; this.feedbackTarget = null; this.view = {}; }
    if (!this.first) this.first = snapshot;
    this.last = snapshot; this.revision++;
  }
  compare(project, epoch, scope = 'task') {
    if (!['task', 'run'].includes(scope)) throw new Error('Choose task or last-run changes.');
    const before = scope === 'task' ? this.first : this.last;
    return before ? compareAgentReview(before, captureAgentReview(project, epoch)) : null;
  }
  clear() { this.first = this.last = this.thread = null; this.feedbackText = ''; this.feedbackKey = ''; this.feedbackTarget = null; this.view = {}; this.revision++; }
}

/** Pure source-only restoration. Caller must check busy state/revision after local consent. */
export function restoreReviewedSource(comparison, key, project, epoch) {
  if (!comparison?.sameWorkspace || project.id !== comparison.after.projectId || epoch !== comparison.after.epoch) throw new Error('Project was replaced or reloaded. Refresh the review; old checkpoints cannot restore this workspace.');
  const change = comparison.changes.find(change => change.key === key);
  if (!change?.canRestore) throw new Error('Only complete source changes in an existing, unrenamed module can be restored.');
  const module = project.modules.find(module => module.id === change.moduleId);
  if (!module || module.name !== change.after.name || module.kind !== change.after.kind || module.code !== change.after.text) throw new Error('Source changed after review. Refresh and review the current diff first.');
  const candidate = structuredClone(project);
  candidate.modules.find(module => module.id === change.moduleId).code = change.before.text;
  return candidate;
}

// Bounded line diff. Exact source line endings are retained (including missing final LF).
// LCS is restricted to the changed middle; large middles use an exact replace hunk.
export function agentLineDiff(before, after, {maxCells = 250000, maxLines = 20000} = {}) {
  if (typeof before !== 'string' || typeof after !== 'string') throw new Error('A complete text comparison is required.');
  if (!Number.isSafeInteger(maxCells) || maxCells < 1 || maxCells > 1000000 || !Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > 100000) throw new Error('Invalid diff limits.');
  const split = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];
  // Stop before allocating per-line objects for extremely newline-dense files.
  const tooManyLines = text => { let count = 0; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10 && ++count >= maxLines) return true; return false; };
  if (tooManyLines(before) || tooManyLines(after)) return {rows: [], coarse: true, oversized: true, added: null, removed: null};
  const a = split(before), b = split(after); let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const n = a.length - prefix - suffix, m = b.length - prefix - suffix, coarse = (n + 1) * (m + 1) > maxCells || a.length + b.length > maxLines;
  const rows = []; let oldLine = 1, newLine = 1;
  const push = (kind, text) => rows.push({kind, text, oldLine: kind === '+' ? null : oldLine++, newLine: kind === '-' ? null : newLine++});
  for (let i = 0; i < prefix; i++) push(' ', a[i]);
  if (coarse) { for (let i = 0; i < n; i++) push('-', a[prefix + i]); for (let j = 0; j < m; j++) push('+', b[prefix + j]); }
  else {
    const table = new Uint32Array((n + 1) * (m + 1)), width = m + 1;
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      table[i * width + j] = a[prefix + i] === b[prefix + j] ? 1 + table[(i + 1) * width + j + 1] : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[prefix + i] === b[prefix + j]) { push(' ', a[prefix + i]); i++; j++; }
      else if (i < n && (j === m || table[(i + 1) * width + j] >= table[i * width + j + 1])) push('-', a[prefix + i++]);
      else push('+', b[prefix + j++]);
    }
  }
  for (let i = a.length - suffix; i < a.length; i++) push(' ', a[i]);
  return {rows, coarse, added: rows.filter(row => row.kind === '+').length, removed: rows.filter(row => row.kind === '-').length};
}
export function agentReviewPatch(comparison) {
  if (!comparison) throw new Error('Run a task before exporting changes.');
  const output = ['# VB6 local source/designer review; NOT a Git index or agent-only attribution.', '# Includes other/manual project edits since the selected checkpoint.'];
  for (const change of comparison.changes) {
    if (change.status === 'not-compared') { output.push('# OMITTED: ' + JSON.stringify(change.path)); continue; }
    const a = change.before, b = change.after, diff = agentLineDiff(a?.text || '', b?.text || '');
    if (a?.path !== b?.path) output.push('# Document identity: ' + JSON.stringify(a?.path || null) + ' -> ' + JSON.stringify(b?.path || null));
    output.push('--- ' + (a ? JSON.stringify('before/' + a.path) : '/dev/null'), '+++ ' + (b ? JSON.stringify('after/' + b.path) : '/dev/null'));
    if (diff.oversized) {
      // Exact full replacement export, without allocating hundreds of thousands of rows.
      const lines = text => { let n = text.endsWith('\n') || !text ? 0 : 1; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++; return n; };
      const ac = lines(a?.text || ''), bc = lines(b?.text || '');
      output.push('@@ -' + (ac ? 1 : 0) + ',' + ac + ' +' + (bc ? 1 : 0) + ',' + bc + ' @@');
      for (const [mark, text] of [['-', a?.text || ''], ['+', b?.text || '']]) if (text) {
        const body = text.endsWith('\n') ? text.slice(0, -1) : text;
        output.push(mark + body.replace(/\n/g, '\n' + mark));
        if (!text.endsWith('\n')) output.push('\\ No newline at end of file');
      }
      continue;
    }
    const oldCount = diff.rows.filter(row => row.kind !== '+').length, newCount = diff.rows.filter(row => row.kind !== '-').length;
    output.push('@@ -' + (oldCount ? 1 : 0) + ',' + oldCount + ' +' + (newCount ? 1 : 0) + ',' + newCount + ' @@');
    for (const row of diff.rows) {
      output.push(row.kind + (row.text.endsWith('\n') ? row.text.slice(0, -1) : row.text));
      if (!row.text.endsWith('\n')) output.push('\\ No newline at end of file');
    }
  }
  return output.join('\n') + '\n';
}
