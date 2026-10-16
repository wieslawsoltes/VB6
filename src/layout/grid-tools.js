import {LayoutEngine} from '../../packages/auto-layout/src/index.js';
import {placeGridItems} from '../../packages/auto-layout/src/grid-placement.js';
import {resolveTrackTemplate,serializeTracks} from '../../packages/auto-layout/src/track-template.js';
import {normalizeTracks} from '../../packages/auto-layout/src/advanced.js';
import {formNodes,layoutOptions,parentIds} from './model.js';
import {layoutContainer} from './contract.js';
import {editLayoutProperties,selectedRoots,reparentControls} from './authoring.js';

export function formGridLayout(form,parentId=null){
  const engine=new LayoutEngine(formNodes(form),layoutOptions(form));engine.arrange();
  const grid=engine.getGridLayout(parentId);if(!grid)throw new Error('Select a grid container');return grid;
}
function container(form,id){const target=id===null?form:form.controls.find(c=>c.id===id);if(!target||!layoutContainer(target)||target.properties.LayoutMode!==5)throw new Error('Select a grid container');return target;}
function trackKey(axis){if(axis!=='columns'&&axis!=='rows')throw new RangeError('Invalid grid track axis');return axis==='columns'?'LayoutGridColumns':'LayoutGridRows';}

function trackContext(form,parentId,axis){
  trackKey(axis);const target=parentId===null?form:form.controls.find(c=>c.id===parentId),mode=target?.properties.LayoutMode;
  if(!target||!layoutContainer(target)||![5,6,7].includes(mode))throw new Error('Select a grid or masonry container');
  if(mode===6&&axis!=='columns'||mode===7&&axis!=='rows')throw new Error('Masonry has tracks only across its lanes, not on the stacking axis');
  const engine=new LayoutEngine(formNodes(form),layoutOptions(form));engine.arrange();
  const i=parentId===null?engine.count:engine.index.get(parentId),layout=mode===5?engine.getGridLayout(parentId):engine.getMasonryLayout(parentId);
  return {target,engine,i,layout,tracks:mode===5?layout[axis]:layout.lanes,gap:mode===5&&axis==='rows'&&!Number.isNaN(engine.data.crossGap[i])?engine.data.crossGap[i]:engine.data.gap[i]};
}


/** Changes one track, retaining every other authored track and all limits.
 * Implicit rows/columns are materialized only up to the requested track. Call
 * inside layoutEdit/IDE commit for one atomic geometry/history transaction. */
export function resizeGridTrack(form,parentId,axis,index,size){
  const context=trackContext(form,parentId,axis),target=context.target,key=trackKey(axis);
  if(!Number.isInteger(index)||index<0||index>=1024)throw new RangeError('Only the first 1024 tracks can be explicitly authored');
  if(!Number.isFinite(size)||size<0||size>300000)throw new RangeError('Grid track size must be between 0 and 300000');
  const tracks=normalizeTracks(target.properties[key],axis==='columns'?2:0),resolved=context.tracks[index];
  if(resolved?.autoRepeat||tracks.some(t=>t.repeat)&&!resolved)throw new Error('Expand responsive '+axis+' before resizing a repeated or implicit track');
  index=resolved&&resolved.sourceIndex>=0?resolved.sourceIndex:index;
  while(tracks.length<=index)tracks.push({mode:axis==='columns'?2:1,value:axis==='columns'?1:0,min:0,max:Infinity});
  const old=tracks[index];if(size<(resolved?.min??old.min)||size>(resolved?.max??old.max))throw new RangeError('Grid track size exceeds its minimum or maximum');
  tracks[index]={...old,mode:0,value:size};
  return editLayoutProperties(form,parentId===null?[]:[parentId],{[key]:serializeTracks(tracks)});
}

/** Keyboard cell movement preserves relative placements, spans and child order.
 * Auto-placed cells become explicit; unrelated controls remain untouched. */
export function moveGridControls(form,ids,dx,dy){
  if(!Number.isInteger(dx)||!Number.isInteger(dy))throw new RangeError('Grid movement must use whole cells');
  const items=selectedRoots(form,ids);if(!items.length)return [];
  const parents=parentIds(form.controls),parentId=parents.get(items[0].id);container(form,parentId);
  if(items.some(c=>parents.get(c.id)!==parentId))throw new Error('Move cells from one grid at a time');
  const grid=formGridLayout(form,parentId),cells=new Map(grid.cells.map(c=>[c.id,c]));
  if(items.some(c=>!cells.has(c.id)))throw new Error('Only participating grid children can move between cells');
  const minColumn=Math.min(...items.map(c=>cells.get(c.id).column)),minRow=Math.min(...items.map(c=>cells.get(c.id).row));
  dx=Math.max(dx,-minColumn);dy=Math.max(dy,-minRow);
  const updates=items.map(c=>({c,column:cells.get(c.id).column+dx,row:cells.get(c.id).row+dy}));
  for(const {c,column,row}of updates)if(column+cells.get(c.id).columnSpan>1024||row+cells.get(c.id).rowSpan>262144)throw new RangeError('Grid cell budget exceeded');
  for(const {c,column,row}of updates)editLayoutProperties(form,[c.id],{LayoutColumn:column,LayoutRow:row,LayoutColumnSpan:cells.get(c.id).columnSpan,LayoutRowSpan:cells.get(c.id).rowSpan,LayoutArea:'',LayoutColumnStart:'',LayoutColumnEnd:'',LayoutRowStart:'',LayoutRowEnd:''});
  return items.map(c=>c.id);
}

/** Pointer placement uses real grid cells, not occupied control rectangles. */
export function placeGridControls(form,ids,parentId,column,row){
  const target=container(form,parentId),items=selectedRoots(form,ids),parents=parentIds(form.controls);
  if(!Number.isInteger(column)||!Number.isInteger(row)||column<0||row<0||column>1023||row>262143)throw new RangeError('Invalid grid drop cell');
  if(!items.length)return [];
  // A move within the grid must not silently change traversal/stacking order.
  if(items.every(c=>parents.get(c.id)===parentId)){
    const grid=formGridLayout(form,parentId),cells=new Map(grid.cells.map(c=>[c.id,c]));
    if(items.every(c=>cells.has(c.id))){const left=Math.min(...items.map(c=>cells.get(c.id).column)),top=Math.min(...items.map(c=>cells.get(c.id).row));return moveGridControls(form,ids,column-left,row-top);}
  }
  const engine=new LayoutEngine(formNodes(form),layoutOptions(form));engine.arrange();const sourceCells=new Map();
  for(const source of new Set(items.map(c=>parents.get(c.id))))for(const cell of engine.getGridLayout(source)?.cells||[])sourceCells.set(cell.id,cell);
  const spans=c=>({cs:sourceCells.get(c.id)?.columnSpan||c.properties.LayoutColumnSpan||1,rs:sourceCells.get(c.id)?.rowSpan||c.properties.LayoutRowSpan||1});
  const count=Math.max(column+spans(items[0]).cs,engine.getGridLayout(parentId).columns.length);
  const pack=items.map((c,i)=>({i:c.id,row:i?-1:0,col:i?-1:column,...spans(c)}));
  // Reserve only the leading part of the first row, never a potentially huge
  // prefix of the whole grid. The solver prevents multi-row spans overlapping.
  if(column)pack.unshift({i:null,row:0,col:0,cs:column,rs:1});
  const placed=placeGridItems(pack,count,0).placed.filter(p=>p.i!==null);
  for(const p of placed)if(row+p.row+p.rs>262144)throw new RangeError('Grid cell budget exceeded');
  const selected=reparentControls(form,ids,parentId);
  for(const p of placed)editLayoutProperties(form,[p.i],{LayoutColumn:p.col,LayoutRow:row+p.row,LayoutColumnSpan:p.cs,LayoutRowSpan:p.rs,LayoutArea:'',LayoutColumnStart:'',LayoutColumnEnd:'',LayoutRowStart:'',LayoutRowEnd:''});
  return selected;
}

/** Explicit user conversion: retain the current repeat count, line names and
 * constraints as ordinary authored tracks. Automatic repetition/collapse and
 * relative length bindings on this axis are deliberately removed. */
export function materializeGridTracks(form,parentId,axis){
  const {target,engine,i,layout:g,gap}=trackContext(form,parentId,axis),key=trackKey(axis);
  const tracks=resolveTrackTemplate(engine.tracks[i][axis],axis==='columns'?g.width:g.height,gap,engine.resolvedVariables[i]);
  return editLayoutProperties(form,parentId===null?[]:[parentId],{[key]:serializeTracks(tracks)});
}
