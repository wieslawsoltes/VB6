/** Documents belonging to one live IDE session. No global DOM monkey-patching. */
const documents = new Set();
let current = null;
export function registerUIDocument(doc) {
  documents.add(doc);
  const activate = () => { current = doc; };
  doc.addEventListener('focusin', activate, true);
  doc.addEventListener('pointerdown', activate, true);
  return () => {
    documents.delete(doc);
    doc.removeEventListener('focusin', activate, true);
    doc.removeEventListener('pointerdown', activate, true);
    if (current === doc) current = null;
  };
}
export function uiDocuments() {
  return [...new Set([...(typeof document === 'undefined' ? [] : [document]), ...documents])];
}
export function uiDocument(node) {
  if (node?.ownerDocument) return node.ownerDocument;
  return current || uiDocuments().find(doc => doc.hasFocus()) || document;
}
export function hasUIDialog() {
  return uiDocuments().some(doc => doc.querySelector('.ide-modal-cover'));
}
