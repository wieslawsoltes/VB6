/** Bounded row/column realization, including fixed axes and zero-sized entries. */
import {el} from '../core/core.js';
import {cssColor,fontFamily} from '../theme/theme.js';
import {acceptsInput} from './input.js';
import {controlInteger} from './collections.js';
import {prefixAxis,axisIndex} from './view-layout.js';
import {attr,style,text,reconcile} from './collection-view.js';
import {gridRange,cellStyle} from './grid-state.js';

export function visibleAxis(offsets,position,extent,fixedCount=0,overscan=42){
  const count=offsets.length-1,fixed=Math.min(count,Math.max(0,fixedCount)),result=[];
  for(let i=0;i<fixed&&offsets[i]<extent;i++)if(offsets[i+1]>offsets[i])result.push(i);
  let first=Math.max(fixed,axisIndex(offsets,Math.max(offsets[fixed],position+Math.min(offsets[fixed],extent)-overscan)));
  const stop=position+extent+overscan;
  for(let i=first;i<count&&offsets[i]<stop;i++)if(offsets[i+1]>offsets[i])result.push(i);
  return result;
}
function segments(indices,offsets){const result=[];let x=0;for(const index of indices){if(offsets[index]>x)result.push({key:'gap:'+x,width:offsets[index]-x});result.push({key:'col:'+index,index,width:offsets[index+1]-offsets[index]});x=offsets[index+1];}if(offsets.at(-1)>x)result.push({key:'gap:'+x,width:offsets.at(-1)-x});return result;}
const horizontal=alignment=>['left','center','right'][Math.floor(alignment/3)]||'left';
const vertical=alignment=>['top','middle','bottom'][alignment%3]||'middle';
export class GridViewController{
  constructor(control){
    this.control=control;this.cacheKey='';this.gesture=null;this.rows=new Map();this.pads=new Map();this.cols=new Map();this.lastMouse={row:-1,col:-1};
    control.node.classList.add('vb-grid');control.viewport=el('div',{class:'vb-grid-scroll',tabindex:0,role:'region','aria-label':control.model.name});control.table=el('table',{role:'grid'});this.group=el('colgroup');this.body=el('tbody');control.table.append(this.group,this.body);control.viewport.append(control.table);control.node.append(control.viewport);
    control.viewport.addEventListener('scroll',()=>{this.paint();control.event('Scroll',[],true);});
    control.viewport.addEventListener('keydown',event=>this.keydown(event));
    for(const event of ['focusin','focusout'])control.viewport.addEventListener(event,()=>{if(Number(control.props.HighLight)===2)control.invalidate();});
    control.viewport.addEventListener('pointermove',event=>{const cell=event.target.closest('[data-row][data-col]');this.lastMouse=cell?{row:Number(cell.dataset.row),col:Number(cell.dataset.col)}:{row:-1,col:-1};});
    this.resize=new ResizeObserver(()=>this.paint());this.resize.observe(control.viewport);
  }
  geometry(){
    const c=this.control,p=c.props,rows=Math.max(0,Math.min(c._boundRS?100001:10000,Number(p.Rows)||0)),cols=Math.max(0,Math.min(10000,Number(p.Cols)||0)),key=[rows,cols,c._gridGeometryRevision||0].join('/');
    if(this.cacheKey!==key){this.rowOffsets=prefixAxis(rows,row=>(c._rowHeights?.[row]??315)/15);this.colOffsets=prefixAxis(cols,col=>(c._colWidths?.[col]??1200)/15);this.cacheKey=key;}
    return {rows,cols,row:this.rowOffsets,col:this.colOffsets,fixedRows:Math.min(rows,Number(p.FixedRows)||0),fixedCols:Math.min(cols,Number(p.FixedCols)||0)};
  }
  refresh(){
    const c=this.control,p=c.props;
    if(!c._boundRS&&p.FormatString&&this.lastFormat!==p.FormatString){this.lastFormat=p.FormatString;const columns=String(p.FormatString).split('|');c.gridData[0]=columns.map(value=>value.replace(/^[<>^]/,''));for(let i=0;i<columns.length;i++)if(/^[<>^]/.test(columns[i]))c._colAlignment[i]={'<':1,'>':7,'^':4}[columns[i][0]];p.Cols=Math.max(Number(p.Cols)||0,columns.length);c._gridGeometryRevision++;}
    attr(c.node,'tabindex',-1);attr(c.viewport,'tabindex',c.design||!p.Enabled||!p.TabStop?-1:Number(p.TabIndex)||0);attr(c.viewport,'aria-disabled',!p.Enabled);this.paint();
  }
  scrollToCell(rowIndex=this.control.props.Row,colIndex=this.control.props.Col){
    const {row,col,fixedRows,fixedCols,rows,cols}=this.geometry(),v=this.control.viewport;
    if(rowIndex>=0&&rowIndex<rows&&rowIndex>=fixedRows){const fixed=row[fixedRows];if(row[rowIndex]<v.scrollTop+fixed)v.scrollTop=Math.max(0,row[rowIndex]-fixed);else if(row[rowIndex+1]>v.scrollTop+v.clientHeight)v.scrollTop=Math.max(0,row[rowIndex+1]-v.clientHeight);}
    if(colIndex>=0&&colIndex<cols&&colIndex>=fixedCols){const fixed=col[fixedCols];if(col[colIndex]<v.scrollLeft+fixed)v.scrollLeft=Math.max(0,col[colIndex]-fixed);else if(col[colIndex+1]>v.scrollLeft+v.clientWidth)v.scrollLeft=Math.max(0,col[colIndex+1]-v.clientWidth);}
  }
  getTop(axis){const {row,col,fixedRows,fixedCols,rows,cols}=this.geometry(),isRow=axis==='row',offsets=isRow?row:col,count=isRow?rows:cols,fixed=isRow?fixedRows:fixedCols,scroll=isRow?this.control.viewport.scrollTop:this.control.viewport.scrollLeft;return Math.min(Math.max(0,count-1),Math.max(fixed,axisIndex(offsets,scroll+offsets[fixed])));}
  setTop(axis,value){const {row,col,fixedRows,fixedCols,rows,cols}=this.geometry(),isRow=axis==='row',count=isRow?rows:cols,fixed=isRow?fixedRows:fixedCols;value=controlInteger(value,fixed,count-1);const offsets=isRow?row:col;this.control.viewport[isRow?'scrollTop':'scrollLeft']=offsets[value]-offsets[fixed];this.paint();}
  position(axis,index){const {row,col,rows,cols,fixedRows,fixedCols}=this.geometry(),isRow=axis==='row',offsets=isRow?row:col;index=controlInteger(index,0,(isRow?rows:cols)-1,381);return (offsets[index]-(index<(isRow?fixedRows:fixedCols)?0:this.control.viewport[isRow?'scrollTop':'scrollLeft']))*15;}
  select(row,col,extend=false,header=false){
    const c=this.control,p=c.props,{rows,cols,fixedRows,fixedCols}=this.geometry();if(!rows||!cols)return;
    row=Math.max(0,Math.min(rows-1,row));col=Math.max(0,Math.min(cols-1,col));const previous=[p.Row,p.Col,p.RowSel,p.ColSel];
    if(extend){p.RowSel=row;p.ColSel=col;}else{p.Row=p.RowSel=row;p.Col=p.ColSel=col;}
    if(Number(p.SelectionMode)===1||header&&row<fixedRows&&col<fixedCols){p.Col=fixedCols;p.ColSel=cols-1;}
    if(Number(p.SelectionMode)===2){p.Row=fixedRows;p.RowSel=rows-1;}
    if(header&&p.AllowBigSelection){if(row<fixedRows){p.Row=fixedRows;p.RowSel=rows-1;}if(col<fixedCols){p.Col=fixedCols;p.ColSel=cols-1;}}
    p.Row=Math.min(rows-1,p.Row);p.Col=Math.min(cols-1,p.Col);p.RowSel=Math.min(rows-1,p.RowSel);p.ColSel=Math.min(cols-1,p.ColSel);
    c.syncGridCursor();if(previous[0]!==p.Row||previous[1]!==p.Col)c.event('RowColChange');if(previous.some((value,index)=>value!==[p.Row,p.Col,p.RowSel,p.ColSel][index]))c.event('SelChange');
    if(!header)this.scrollToCell(extend?p.RowSel:p.Row,extend?p.ColSel:p.Col);this.paint();
  }
  nextVisible(offsets,index,direction,minimum=0){let n=index+direction;while(n>=minimum&&n<offsets.length-1&&offsets[n]===offsets[n+1])n+=direction;return n>=minimum&&n<offsets.length-1?n:index;}
  keydown(event){
    const c=this.control,p=c.props;if(event.defaultPrevented||event.isComposing||!acceptsInput(c)||event.target.closest('input'))return;
    const g=this.geometry();let r=Number(event.shiftKey?p.RowSel:p.Row)||0,k=Number(event.shiftKey?p.ColSel:p.Col)||0,handled=true;
    switch(event.key){
      case 'ArrowUp':r=this.nextVisible(g.row,r,-1,g.fixedRows);break;case 'ArrowDown':r=this.nextVisible(g.row,r,1,g.fixedRows);break;
      case 'ArrowLeft':k=this.nextVisible(g.col,k,-1,g.fixedCols);break;case 'ArrowRight':k=this.nextVisible(g.col,k,1,g.fixedCols);break;
      case 'Home':k=g.fixedCols;if(event.ctrlKey||event.metaKey)r=g.fixedRows;break;
      case 'End':k=g.cols-1;if(event.ctrlKey||event.metaKey)r=g.rows-1;break;
      case 'PageUp':r=Math.max(g.fixedRows,axisIndex(g.row,Math.max(0,g.row[r]-c.viewport.clientHeight+g.row[g.fixedRows])));break;
      case 'PageDown':r=Math.min(g.rows-1,axisIndex(g.row,g.row[r]+Math.max(1,c.viewport.clientHeight-g.row[g.fixedRows])));break;
      case 'F2':case 'Enter':{const cell=c.table.querySelector(`td[data-row="${r}"][data-col="${k}"]`);if(cell)c.beginGridEdit(cell,r,k);event.preventDefault();return;}
      default:handled=false;
    }
    if(handled){event.preventDefault();this.select(r,k,event.shiftKey);}
  }
  startResize(event,axis,index,handle){
    const c=this.control;if(event.button!==0||!acceptsInput(c))return;event.preventDefault();event.stopPropagation();this.cancelResize?.();
    const initial=axis==='row'?c.RowHeight(index):c.ColWidth(index),start=axis==='row'?event.clientY:event.clientX,rect=c.node.getBoundingClientRect(),ratio=axis==='row'?rect.height/(c.node.offsetHeight||1):rect.width/(c.node.offsetWidth||1);
    handle.setPointerCapture(event.pointerId);this.gesture=true;
    const move=e=>{const position=axis==='row'?e.clientY:e.clientX;c.setIndexed(axis==='row'?'RowHeight':'ColWidth',[index],Math.max(0,Math.min(300000,initial+(position-start)/(ratio||1)*15)));};
    const end=()=>{this.cancelResize=null;this.gesture=false;handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);handle.removeEventListener('lostpointercapture',end);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);this.paint();};
    this.cancelResize=end;handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);
  }
  makeCell(row,col,fixed){
    const c=this.control,td=el(fixed?'th':'td'),label=el('div',{class:'vb-grid-cell-text'}),entry={td,label,fixed,columnHandle:null,rowHandle:null};
    td.addEventListener('click',event=>{if(acceptsInput(c)&&!event.target.closest('.vb-grid-resize')){c.viewport.focus({preventScroll:true});this.select(row,col,event.shiftKey,entry.fixed);}});
    td.addEventListener('dblclick',()=>{if(!entry.fixed&&acceptsInput(c))c.beginGridEdit(td,row,col);});
    return entry;
  }
  paint(){
    const c=this.control;if(c.disposed||c.gridEditor||this.gesture)return;
    const g=this.geometry(),v=c.viewport,p=c.props,width=v.clientWidth||Number(p.Width)/15,height=v.clientHeight||Number(p.Height)/15,rows=visibleAxis(g.row,v.scrollTop,height,g.fixedRows),columns=visibleAxis(g.col,v.scrollLeft,width,g.fixedCols),parts=segments(columns,g.col),range=gridRange(c),table=c.table;
    style(table,{width:Math.max(1,g.col.at(-1))+'px',minWidth:'0'});attr(table,'aria-rowcount',g.rows);attr(table,'aria-colcount',g.cols);attr(table,'aria-multiselectable',true);
    const partKeys=new Set(parts.map(part=>part.key)),colNodes=[];
    for(const key of this.cols.keys())if(!partKeys.has(key))this.cols.delete(key);
    for(const part of parts){let node=this.cols.get(part.key);if(!node){node=el('col');this.cols.set(part.key,node);}style(node,{width:part.width+'px'});colNodes.push(node);}reconcile(this.group,colNodes);
    const span=Math.max(1,parts.length),rowNodes=[],rowKeys=new Set(rows),padKeys=new Set();let current=0;
    const pad=(start,height)=>{if(height<=0)return;const key=String(start);padKeys.add(key);let entry=this.pads.get(key);if(!entry){const td=el('td',{class:'vb-grid-spacer','aria-hidden':'true'}),tr=el('tr',{'aria-hidden':'true'});tr.append(td);entry={tr,td};this.pads.set(key,entry);}attr(entry.td,'colspan',span);style(entry.tr,{height:height+'px'});style(entry.td,{height:height+'px',minWidth:'0',padding:'0',border:'0'});rowNodes.push(entry.tr);};
    for(const r of rows){pad(current,g.row[r]-current);current=g.row[r+1];let rowEntry=this.rows.get(r);if(!rowEntry){rowEntry={tr:el('tr'),cells:new Map()};this.rows.set(r,rowEntry);}const {tr,cells}=rowEntry,fixedRow=r<g.fixedRows,cellNodes=[];
      style(tr,{height:(g.row[r+1]-g.row[r])+'px'});attr(tr,'aria-rowindex',r+1);
      for(const key of cells.keys())if(!partKeys.has(key))cells.delete(key);
      for(const part of parts){let entry=cells.get(part.key);
        if(part.index===undefined){if(!entry){entry={td:el('td',{'aria-hidden':'true',class:'vb-grid-spacer'})};cells.set(part.key,entry);}style(entry.td,{width:part.width+'px',minWidth:'0',padding:'0',border:'0'});cellNodes.push(entry.td);continue;}
        const k=part.index,fixedCol=k<g.fixedCols,fixed=fixedRow||fixedCol,active=r===p.Row&&k===p.Col,selected=!!range&&r>=range.r1&&r<=range.r2&&k>=range.c1&&k<=range.c2,highlight=selected&&Number(p.HighLight)!==0&&(Number(p.HighLight)!==2||c.node.contains(c.node.ownerDocument.activeElement)),value=c.gridValue(r,k),paint=cellStyle(c,r,k),align=paint.CellAlignment??(fixedRow?c._colAlignmentFixed?.[k]??c._colAlignment?.[k]:c._colAlignment?.[k])??9,alignment=align===9?(String(value).trim()!==''&&Number.isFinite(Number(value))?7:1):align;
        if(!entry||entry.fixed!==fixed){entry=this.makeCell(r,k,fixed);cells.set(part.key,entry);}const {td,label}=entry;
        attr(td,'id','grid-'+c.model.id+'-'+r+'-'+k);attr(td,'data-row',r);attr(td,'data-col',k);attr(td,'aria-rowindex',r+1);attr(td,'aria-colindex',k+1);attr(td,'aria-selected',selected);td.classList.toggle('active',active);td.classList.toggle('selected',highlight);
        style(td,{width:part.width+'px',minWidth:'0',height:(g.row[r+1]-g.row[r])+'px',position:fixed?'sticky':'relative',left:fixedCol?g.col[k]+'px':'',top:fixedRow?g.row[r]+'px':'',zIndex:fixedRow&&fixedCol?'3':fixedRow?'2':fixedCol?'1':'',background:highlight?'var(--vb-selection)':paint.CellBackColor!==undefined?cssColor(paint.CellBackColor):fixed?'var(--vb-face)':'var(--vb-window)',color:highlight?'var(--vb-selection-text)':paint.CellForeColor!==undefined?cssColor(paint.CellForeColor):'inherit',fontFamily:paint.CellFontName?fontFamily(paint.CellFontName):'',fontSize:paint.CellFontSize?paint.CellFontSize*96/72+'px':'',fontWeight:paint.CellFontBold?'bold':'normal',fontStyle:paint.CellFontItalic?'italic':'normal',textDecoration:[paint.CellFontUnderline?'underline':'',paint.CellFontStrikeThrough?'line-through':''].filter(Boolean).join(' '),textAlign:horizontal(alignment),verticalAlign:vertical(alignment)});
        text(label,value);style(label,{maxHeight:Math.max(0,g.row[r+1]-g.row[r]-5)+'px',overflow:'hidden',whiteSpace:p.WordWrap?'normal':'nowrap',textOverflow:'ellipsis'});const contents=[label];
        if(fixedRow&&(Number(p.AllowUserResizing)&1)){if(!entry.columnHandle){const handle=el('span',{class:'vb-grid-resize vb-grid-resize-col','aria-label':'Resize column '+k});handle.addEventListener('pointerdown',event=>this.startResize(event,'col',k,handle));entry.columnHandle=handle;}contents.push(entry.columnHandle);}
        if(fixedCol&&(Number(p.AllowUserResizing)&2)){if(!entry.rowHandle){const handle=el('span',{class:'vb-grid-resize vb-grid-resize-row','aria-label':'Resize row '+r});handle.addEventListener('pointerdown',event=>this.startResize(event,'row',r,handle));entry.rowHandle=handle;}contents.push(entry.rowHandle);}
        reconcile(td,contents);cellNodes.push(td);
      }reconcile(tr,cellNodes);rowNodes.push(tr);
    }pad(current,g.row.at(-1)-current);
    for(const key of this.rows.keys())if(!rowKeys.has(key))this.rows.delete(key);for(const key of this.pads.keys())if(!padKeys.has(key))this.pads.delete(key);
    reconcile(this.body,rowNodes);
  }
  dispose(){this.cancelResize?.();this.resize.disconnect();this.rows.clear();this.pads.clear();this.cols.clear();}
}
