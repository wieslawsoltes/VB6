/** Layout math is independent of DOM and tested at viewport boundaries. */
export function listLayout(view,count,width,height,rowHeight=20,columnWidth=160,reportWidth=width) {
  width=Math.max(1,width);height=Math.max(1,height);rowHeight=Math.max(1,rowHeight);
  const vertical=view!==2,cellWidth=view===3?Math.max(1,reportWidth):view===0?96:Math.max(1,columnWidth);
  const cellHeight=view===0?Math.max(68,rowHeight+40):rowHeight;
  const columns=vertical?(view===3?1:Math.max(1,Math.floor(width/cellWidth))):Math.ceil(count/Math.max(1,Math.floor(height/cellHeight)));
  const rows=vertical?Math.ceil(count/columns):Math.max(1,Math.floor(height/cellHeight));
  const index=(row,col)=>vertical?row*columns+col:col*rows+row;
  const box=i=>({x:(vertical?i%columns:Math.floor(i/rows))*cellWidth,y:(vertical?Math.floor(i/columns):i%rows)*cellHeight,width:cellWidth,height:cellHeight});
  return {view,count,columns,rows,cellWidth,cellHeight,width:columns*cellWidth,height:vertical?rows*cellHeight:height,box,
    indexAt(x,y){if(x<0||y<0)return -1;const col=Math.floor(x/cellWidth),row=Math.floor(y/cellHeight),i=index(row,col);return col<columns&&row<rows&&i<count?i:-1;},
    visible(left,top,w,h,overscan=1){const found=[],firstCol=Math.max(0,Math.floor(left/cellWidth)-overscan),lastCol=Math.min(columns,Math.ceil((left+w)/cellWidth)+overscan),firstRow=Math.max(0,Math.floor(top/cellHeight)-overscan),lastRow=Math.min(rows,Math.ceil((top+h)/cellHeight)+overscan);
      for(let row=firstRow;row<lastRow;row++)for(let col=firstCol;col<lastCol;col++){const i=index(row,col);if(i<count)found.push(i);}return found;}
  };
}
export function revealRect(viewport,box) {
  if(box.y<viewport.scrollTop)viewport.scrollTop=box.y;
  else if(box.y+box.height>viewport.scrollTop+viewport.clientHeight)viewport.scrollTop=box.y+box.height-viewport.clientHeight;
  if(box.x<viewport.scrollLeft)viewport.scrollLeft=box.x;
  else if(box.x+box.width>viewport.scrollLeft+viewport.clientWidth)viewport.scrollLeft=box.x+box.width-viewport.clientWidth;
}
export function prefixAxis(count,size) {const offsets=new Float64Array(count+1);for(let i=0;i<count;i++)offsets[i+1]=offsets[i]+Math.max(0,Number(size(i))||0);return offsets;}
// First non-hidden entry containing position. End positions return Count.
export function axisIndex(offsets,position) {
  let lo=0,hi=offsets.length-1;while(lo<hi){const mid=(lo+hi)>>1;if(offsets[mid+1]<=position)lo=mid+1;else hi=mid;}return lo;
}
