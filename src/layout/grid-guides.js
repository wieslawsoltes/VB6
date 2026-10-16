import {el} from '../core/core.js';
const px=n=>n/15+'px';
const bounds=(node,r)=>Object.assign(node.style,{left:px(r.x),top:px(r.y),width:px(Math.max(0,r.width)),height:px(Math.max(0,r.height))});
export function gridCellAt(grid,point){
  const nearest=(tracks,value)=>{let best=-1,distance=Infinity;for(const t of tracks){if(t.collapsed)continue;const delta=value<t.start?t.start-value:value>t.start+t.size?value-t.start-t.size:0;if(delta<distance){best=t.index;distance=delta;}}return best;};
  const rows=grid.rows.length?grid.rows:[{index:0,start:grid.y,size:grid.height}];
  const column=nearest(grid.columns,point.x),row=nearest(rows,point.y);
  if(column<0||row<0)return null;
  const x=grid.columns[column],y=rows[row];return {column,row,x:x.start,y:y.start,width:x.size,height:y.size};
}
/** Track bands include unoccupied tracks; only visible ruler handles are
 * realized. Cell outlines retain the original per-child accessibility count. */
export function paintGridGuides(d,layer,rect,grid,parentId,editable){
  const root=d.root.getBoundingClientRect(),origin=d.formView.node.getBoundingClientRect(),zoom=d.zoom||1;
  const viewport={x:(root.left-origin.left)*15/zoom,y:(root.top-origin.top)*15/zoom,width:root.width*15/zoom,height:root.height*15/zoom};
  let cellsDrawn=0;
  for(const c of grid.cells){const area={...c,x:rect.x+c.x,y:rect.y+c.y};if(area.x+area.width<viewport.x||area.y+area.height<viewport.y||area.x>viewport.x+viewport.width||area.y>viewport.y+viewport.height)continue;if(++cellsDrawn>4096)break;const node=el('div',{class:'auto-grid-cell','aria-hidden':true});bounds(node,area);layer.append(node);}
  for(const axis of ['columns','rows']){
    const horizontal=axis==='columns',tracks=grid[axis];let drawn=0;
    for(const track of tracks){
      if(track.collapsed)continue;const rtl=horizontal&&grid.direction==='rtl';
      const edge=(horizontal?rect.x:rect.y)+track.start+(rtl?0:track.size),low=horizontal?viewport.x:viewport.y,high=low+(horizontal?viewport.width:viewport.height);
      if(edge<low-90||edge>high+90)continue;if(++drawn>1024)break;
      const area=horizontal?{x:edge-45,y:rect.y+grid.y,width:90,height:grid.height}:{x:rect.x+grid.x,y:edge-45,width:grid.width,height:90};
      const label=(horizontal?'Column ':'Row ')+(track.index+1)+' size',canEdit=editable&&track.index<1024&&!track.autoRepeat;
      const handle=el('div',{class:'auto-grid-track-handle',role:'slider',tabindex:canEdit?0:-1,'aria-label':label,'aria-valuenow':track.size,'aria-valuemin':track.min,'aria-valuemax':Math.min(300000,track.max),'aria-disabled':!canEdit,'data-layout-track':axis,'data-track-index':track.index,'data-layout-target':parentId??'','data-axis':horizontal?'x':'y','data-sign':rtl?-1:1,title:(track.autoRepeat?'Expand responsive '+axis+' to edit individually. ':'')+label+': '+Math.round(track.size)+' twips. Drag or use arrows. The edited track becomes fixed.'});
      bounds(handle,area);handle.append(el('span',{},(horizontal?'C':'R')+(track.index+1)));layer.append(handle);
    }
  }
}

/** Masonry shares lane rulers but never pretends to have row/column cell slots. */
export function paintMasonryGuides(d,layer,rect,masonry,parentId,editable){
  const vertical=masonry.orientation==='vertical';
  paintGridGuides(d,layer,rect,{...masonry,columns:vertical?masonry.lanes:[],rows:vertical?[]:masonry.lanes},parentId,editable);
}
