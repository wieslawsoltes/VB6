import {RpcError,RPC_CONTENT_MODIFIED} from './rpc.js';

/** LSP offsets are UTF-16 code units; CRLF is one line ending, never two. */
export class LspTextDocument {
  constructor(uri, languageId, text = '', version = 1) { this.uri = uri; this.languageId = languageId; this.update(text, version); }
  update(text, version) {
    if (typeof text !== 'string' || !Number.isSafeInteger(version)) throw new TypeError('Invalid document snapshot.');
    this.text = text; this.version = version; this.lineStarts = [0]; this.lineEnds = [];
    this.scannedCharacters = (this.scannedCharacters || 0) + text.length;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\r' || text[i] === '\n') {
        this.lineEnds.push(i);
        if (text[i] === '\r' && text[i + 1] === '\n') i++;
        this.lineStarts.push(i + 1);
      }
    }
    this.lineEnds.push(text.length);
    return this;
  }
  positionAt(offset) {
    offset = Math.max(0, Math.min(this.text.length, Math.trunc(offset) || 0));
    let lo = 0, hi = this.lineStarts.length;
    while (lo + 1 < hi) { const mid = (lo + hi) >>> 1; if (this.lineStarts[mid] <= offset) lo = mid; else hi = mid; }
    return { line: lo, character: Math.min(offset, this.lineEnds[lo]) - this.lineStarts[lo] };
  }
  offsetAt(position, strict = false) {
    if (!position || !Number.isSafeInteger(position.line) || !Number.isSafeInteger(position.character) || position.line < 0 || position.character < 0) throw new RpcError(-32602, 'Invalid UTF-16 position.');
    const {line, character} = position;
    if (strict && (line >= this.lineStarts.length || character > this.lineEnds[line] - this.lineStarts[line])) throw new RpcError(-32602, 'Text edit position is outside the document.');
    if (line >= this.lineStarts.length) return this.text.length;
    return Math.min(this.lineEnds[line], this.lineStarts[line] + character);
  }
  range(start, end = start) { return { start: this.positionAt(start), end: this.positionAt(end) }; }
  fork() { return Object.assign(Object.create(LspTextDocument.prototype), this); }
  applyChanges(changes, version) {
    if (!Number.isSafeInteger(version) || version <= this.version) throw new RpcError(RPC_CONTENT_MODIFIED, 'Document version did not advance.');
    if (!Array.isArray(changes)) throw new RpcError(-32602, 'Expected an array of text changes.');
    const next = this.fork();
    for (const change of changes) {
      if (typeof change.text !== 'string') throw new RpcError(-32602, 'Text changes require a string.');
      if (!change.range) next.update(change.text, version);
      else {
        const start = next.offsetAt(change.range.start, true), end = next.offsetAt(change.range.end, true);
        if (end < start || (change.rangeLength !== undefined && change.rangeLength !== end - start)) throw new RpcError(-32602, 'Invalid text change range.');
        // Include adjacent physical lines because inserted CR/LF can merge with
        // an existing line ending. Scan only this region, not the full module.
        const first = Math.max(0, change.range.start.line - 1);
        const last = Math.min(next.lineStarts.length - 1, change.range.end.line + 1);
        const from = next.lineStarts[first], to = next.lineStarts[last + 1] ?? next.text.length;
        const fragment = next.text.slice(from, start) + change.text + next.text.slice(end, to);
        const local = new LspTextDocument(this.uri, this.languageId, fragment, version);
        const delta = change.text.length - (end - start), suffix = last + 1 < next.lineStarts.length;
        const starts = local.lineStarts.slice(0, suffix ? -1 : undefined).map(n => n + from);
        const ends = local.lineEnds.slice(0, suffix ? -1 : undefined).map(n => n + from);
        next.lineStarts = [...next.lineStarts.slice(0, first), ...starts, ...next.lineStarts.slice(last + 1).map(n => n + delta)];
        next.lineEnds = [...next.lineEnds.slice(0, first), ...ends, ...next.lineEnds.slice(last + 1).map(n => n + delta)];
        next.text = next.text.slice(0, start) + change.text + next.text.slice(end);
        next.scannedCharacters += fragment.length;
      }
    }
    next.version = version;
    Object.assign(this, next);
    return this;
  }
}

export function applyLspTextEdits(document, edits) {
  if (!Array.isArray(edits)) throw new RpcError(-32602, 'Expected an array of text edits.');
  const ranges = edits.map((edit, index) => {
    if (typeof edit.newText !== 'string' || !edit.range) throw new RpcError(-32602, 'Invalid text edit.');
    const start = document.offsetAt(edit.range.start, true), end = document.offsetAt(edit.range.end, true);
    if (end < start) throw new RpcError(-32602, 'Text edit range is reversed.');
    return { start, end, text: edit.newText, index };
  }).sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
  let cursor = 0; const pieces = [];
  for (const edit of ranges) {
    if (edit.start < cursor) throw new RpcError(-32602, 'Overlapping text edits are not supported.');
    pieces.push(document.text.slice(cursor, edit.start), edit.text); cursor = edit.end;
  }
  pieces.push(document.text.slice(cursor));
  return pieces.join('');
}

/** Validate the entire edit before touching any document. Resource operations
 * are deliberately not advertised: a language server cannot create/delete files. */
export function planWorkspaceEdit(edit, documents) {
  if (!edit || typeof edit !== 'object') throw new RpcError(-32602, 'Invalid workspace edit.');
  if (edit.changes && edit.documentChanges) throw new RpcError(-32602, 'Workspace edit must not contain both edit representations.');
  const entries = edit.documentChanges || Object.entries(edit.changes || {}).map(([uri, edits]) => ({ textDocument: { uri, version: null }, edits }));
  const plans = [], seen = new Set();
  for (const entry of entries) {
    if (entry.kind || !entry.textDocument) throw new RpcError(-32602, 'File create, rename and delete operations are not enabled.');
    const {uri, version} = entry.textDocument, document = documents.get(uri);
    if (!document) throw new RpcError(-32602, 'Workspace edit targets a document outside this project: ' + uri);
    if (seen.has(uri)) throw new RpcError(-32602, 'Repeated document edits must be combined into one TextDocumentEdit.');
    seen.add(uri);
    if (version !== null && version !== undefined && version !== document.version) throw new RpcError(RPC_CONTENT_MODIFIED, 'Workspace edit targets a stale document version.');
    const annotations = [];
    for (const item of entry.edits || []) if (item.annotationId !== undefined) {
      const annotation = edit.changeAnnotations?.[item.annotationId];
      if (!annotation) throw new RpcError(-32602, 'Unknown change annotation.');
      annotations.push(annotation);
    }
    plans.push({ uri, version: document.version, before: document.text, after: applyLspTextEdits(document, entry.edits), annotations });
  }
  return plans;
}
