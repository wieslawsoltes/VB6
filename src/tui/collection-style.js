import {leaseCollectionMetrics} from '../rendering/collection-metrics.js';

/** Scope physical row/header metrics to the same nodes whose virtualized
 * geometry has accepted a presentation lease. The original DOM retains input,
 * selection, sort/expand behavior and in-place grid editors.
 */
export const TUI_COLLECTION_CSS = `
[data-tui-collection] :is(.vb-tree-row,.vb-lv-header,.vb-lv-row){height:var(--tui-collection-row)!important;min-height:0!important}
[data-tui-collection].vb-listview>.vb-virtual-viewport{height:calc(100% - var(--tui-collection-row))!important}
[data-tui-collection] :is(.vb-tree-label,.vb-lv-header>div,.vb-lv-row>div){padding-block:0!important;line-height:var(--tui-collection-row)!important}
[data-tui-collection].vb-grid :is(th,td):not(.vb-grid-spacer){height:var(--tui-collection-row)!important;min-height:0!important;padding-block:0!important;font-size:calc(var(--tui-collection-row)*.75)!important;line-height:calc(var(--tui-collection-row) - 1px)!important}
[data-tui-collection].vb-grid td input{height:calc(var(--tui-collection-row) - 1px)!important;min-height:0!important;line-height:calc(var(--tui-collection-row) - 1px)!important}
`;

const sheets = new WeakMap();
function retainStyle(document) {
  let entry = sheets.get(document);
  if (!entry) {
    const style = document.createElement('style');
    style.setAttribute('data-tui-collection-style', ''); style.textContent = TUI_COLLECTION_CSS;
    document.head.append(style); sheets.set(document, entry = {style, references: 0});
  }
  entry.references++;
  return () => {
    if (--entry.references === 0) { entry.style.remove(); sheets.delete(document); }
  };
}

export function presentCollection(node, metrics) {
  const previous = node.getAttribute('data-tui-collection');
  const style = [node.style.getPropertyValue('--tui-collection-row'), node.style.getPropertyPriority('--tui-collection-row')];
  let releaseStyle, lease, disposed = false, rowHeight;
  const restore = () => {
    previous === null ? node.removeAttribute('data-tui-collection') : node.setAttribute('data-tui-collection', previous);
    style[0] ? node.style.setProperty('--tui-collection-row', ...style) : node.style.removeProperty('--tui-collection-row');
  };
  try {
    releaseStyle = retainStyle(node.ownerDocument);
    node.setAttribute('data-tui-collection', '');
    node.style.setProperty('--tui-collection-row', metrics.cellHeight + 'px');
    lease = leaseCollectionMetrics(node, metrics.cellHeight);
    if (!lease) { restore(); releaseStyle(); return null; }
    rowHeight = metrics.cellHeight;
  } catch (error) { restore(); releaseStyle?.(); throw error; }
  return {
    update(metrics) {
      if (disposed || rowHeight === metrics.cellHeight) return;
      const previousHeight = rowHeight;
      node.style.setProperty('--tui-collection-row', metrics.cellHeight + 'px');
      try { lease.update(metrics.cellHeight); rowHeight = metrics.cellHeight; }
      catch (error) { node.style.setProperty('--tui-collection-row', previousHeight + 'px'); throw error; }
    },
    dispose() {
      if (disposed) return;
      disposed = true; restore();
      try { lease.dispose(); } finally { releaseStyle(); }
    }
  };
}
