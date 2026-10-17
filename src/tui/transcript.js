import {layoutText} from './text-layout.js';

/** Read the canonical preformatted document and its native selection. This is
 * paint data only: copy, selection, scrolling and editing remain DOM operations.
 * Source-code editors use their richer virtualized token projection instead. */
export function captureTranscript(node, columns, rows, settings) {
  const style=node.ownerDocument.defaultView.getComputedStyle(node),text=node.textContent||'';
  let start=0,end=0;
  const selection=node.ownerDocument.getSelection();
  if(selection?.rangeCount&&!selection.isCollapsed){
    const selected=selection.getRangeAt(0);
    const contents=node.ownerDocument.createRange();contents.selectNodeContents(node);
    // A browser can normalize an endpoint to an ancestor, and a real drag can
    // enter/leave the transcript. Intersect ranges rather than requiring both
    // endpoint containers to be descendants. This also handles Select All.
    const first=contents.comparePoint(selected.startContainer,selected.startOffset);
    const last=contents.comparePoint(selected.endContainer,selected.endOffset);
    if(first<=0&&last>=0){
      const prefix=node.ownerDocument.createRange();prefix.selectNodeContents(node);
      if(first===0){prefix.setEnd(selected.startContainer,selected.startOffset);start=prefix.toString().length;}
      end=text.length;
      if(last===0){prefix.setEnd(selected.endContainer,selected.endOffset);end=prefix.toString().length;}
    }
  }
  const textColumns=Math.max(1,Math.min(columns,Math.floor((node.clientWidth||columns*settings.cellWidth)/settings.cellWidth)));
  const projection=layoutText(text,{columns:textColumns,rows,scrollColumn:Math.floor(node.scrollLeft/settings.cellWidth),
    scrollRow:Math.floor(node.scrollTop/settings.cellHeight),wrap:style.whiteSpace!=='pre',
    selectionStart:start,selectionEnd:end,focused:end>start});
  const items=[];let run=null;
  for(const cell of projection.cells){
    if(run&&run.y===cell.y&&run.x+run.width===cell.x&&run.selected===cell.selected){run.text+=cell.glyph;run.width++;}
    else{run={x:cell.x,y:cell.y,width:1,height:1,kind:'text',text:cell.glyph,selected:cell.selected,mnemonics:false};items.push(run);}
  }
  return {source:true,transcript:true,items};
}
