/** Sparse, validated grid state shared by the three flat grid adapters. */
import {controlInteger} from './collections.js';
import {VBError} from '../language/lexer.js';
import {coerce} from '../runtime/values.js';
export const GRID_TYPES=new Set(['MSFlexGrid','MSHFlexGrid','DataGrid']);
export const GRID_DEFAULTS={RowSel:1,ColSel:1,FillStyle:0,SelectionMode:0,AllowBigSelection:-1,AllowUserResizing:0,HighLight:1,WordWrap:0,CellAlignment:9,CellBackColor:-2147483643,CellForeColor:-2147483640,CellFontName:'MS Sans Serif',CellFontSize:8.25,CellFontBold:0,CellFontItalic:0,CellFontUnderline:0,CellFontStrikeThrough:0};
export const CELL_KEYS=new Set(['CellAlignment','CellBackColor','CellForeColor','CellFontName','CellFontSize','CellFontBold','CellFontItalic','CellFontUnderline','CellFontStrikeThrough']);
const limits=c=>({rows:Number(c.props.Rows)||0,cols:Number(c.props.Cols)||0});
export function gridRange(c){const {rows,cols}=limits(c);if(!rows||!cols)return null;const p=c.props,clamp=(value,count)=>Math.min(count-1,Math.max(0,Math.trunc(Number(value)||0))),row=clamp(p.Row,rows),col=clamp(p.Col,cols),endRow=clamp(p.RowSel??row,rows),endCol=clamp(p.ColSel??col,cols);return {r1:Math.min(row,endRow),r2:Math.max(row,endRow),c1:Math.min(col,endCol),c2:Math.max(col,endCol)};}
function clampCursor(c){const p=c.props;for(const [key,count]of [['Row',p.Rows],['RowSel',p.Rows],['Col',p.Cols],['ColSel',p.Cols]])p[key]=Math.max(0,Math.min(Math.max(0,count-1),Number(p[key])||0));p.FixedRows=Math.min(Number(p.FixedRows)||0,p.Rows);p.FixedCols=Math.min(Number(p.FixedCols)||0,p.Cols);}
export function initializeGrid(c){if(!GRID_TYPES.has(c.type))return;c._rowHeights=[];c._rowData=[];c._colData=[];c._colAlignment=[];c._colAlignmentFixed=[];c._cellStyles=new Map();c._gridGeometryRevision=0;clampCursor(c);}
export function gridChanged(c,geometry=false){if(geometry)c._gridGeometryRevision++;c.invalidate();}
export function cellStyle(c,row,col){return c._cellStyles?.get(row)?.get(col)||{};}
export function setCellStyle(c,key,value){
  if(key==='CellAlignment')value=controlInteger(value,0,9);
  else if(key==='CellFontSize'){value=Number(value);if(!Number.isFinite(value)||value<=0||value>1000)throw new VBError('Invalid cell font size',380);}
  else if(key==='CellFontName')value=String(value);
  else value=coerce(value,key.includes('Color')?'Long':'Boolean');
  const range=gridRange(c);if(!range)return;
  const {r1,r2,c1,c2}=c.props.FillStyle?range:{r1:c.props.Row,r2:c.props.Row,c1:c.props.Col,c2:c.props.Col};
  if((r2-r1+1)*(c2-c1+1)>1000000)throw new VBError('Cell formatting exceeds one million cells',7);
  for(let row=r1;row<=r2;row++){let styles=c._cellStyles.get(row);if(!styles)c._cellStyles.set(row,styles=new Map());for(let col=c1;col<=c2;col++)styles.set(col,{...styles.get(col),[key]:value});}
  gridChanged(c);
}
export function setGridProperty(c,key,value){
  if(!GRID_TYPES.has(c.type))return false;const p=c.props;
  if(CELL_KEYS.has(key)){setCellStyle(c,key,value);return true;}
  if(['FillStyle','SelectionMode','AllowUserResizing','HighLight'].includes(key)){p[key]=controlInteger(value,0,key==='FillStyle'?1:key==='AllowUserResizing'?3:2);gridChanged(c);return true;}
  if(['Rows','Cols'].includes(key)){
    value=controlInteger(value,0,10000);if(p[key]===value)return true;
    if(key==='Rows'){c.gridData.length=value;c._rowHeights.length=value;c._rowData.length=value;for(const row of c._cellStyles.keys())if(row>=value)c._cellStyles.delete(row);}
    else{for(const row of c.gridData)if(row&&row.length>value)row.length=value;c._colWidths.length=value;c._colData.length=value;c._colAlignment.length=value;c._colAlignmentFixed.length=value;for(const styles of c._cellStyles.values())for(const col of styles.keys())if(col>=value)styles.delete(col);}
    p[key]=value;clampCursor(c);gridChanged(c,true);return true;
  }
  if(['FixedRows','FixedCols'].includes(key)){p[key]=controlInteger(value,0,key==='FixedRows'?p.Rows:p.Cols);gridChanged(c,true);return true;}
  if(['Row','Col','RowSel','ColSel'].includes(key)){
    value=controlInteger(value,0,key.startsWith('Row')?p.Rows-1:p.Cols-1);const previous=p[key];p[key]=value;
    if(key==='Row'||key==='Col')p[key+'Sel']=value;
    if(previous!==value){if(key==='Row'||key==='Col'){c.syncGridCursor();c.event('RowColChange');}c.event('SelChange');gridChanged(c);}return true;
  }
  return false;
}
export function gridIndex(c,key,index){return controlInteger(index,0,key.startsWith('row')?c.props.Rows-1:c.props.Cols-1,381);}
export function gridIndexed(c,key,args,value){
  const names={rowheight:['_rowHeights',315],colwidth:['_colWidths',1200],rowdata:['_rowData',0],coldata:['_colData',0],colalignment:['_colAlignment',9],colalignmentfixed:['_colAlignmentFixed',9]};
  if(!Object.hasOwn(names,key))return false;
  if(args.length!==1)throw new VBError('Wrong number of arguments',450);
  const count=key.startsWith('row')?c.props.Rows:c.props.Cols,all=['rowheight','colwidth','colalignment','colalignmentfixed'].includes(key),index=controlInteger(args[0],all?-1:0,count-1,380);
  if(key.endsWith('data'))value=coerce(value,'Long');
  else if(key.includes('alignment'))value=controlInteger(value,0,9);
  else{value=Number(value);if(!Number.isFinite(value)||value<0||value>300000)throw new VBError('Invalid cell size',380);}
  if(index===-1)c[names[key][0]]=Array(count).fill(value);else c[names[key][0]][index]=value;
  gridChanged(c,key==='rowheight'||key==='colwidth');return true;
}
export function gridClip(c){const range=gridRange(c);if(!range)return '';const {r1,r2,c1,c2}=range;if((r2-r1+1)*(c2-c1+1)>1000000)throw new VBError('Clipboard selection exceeds one million cells',7);return Array.from({length:r2-r1+1},(_,i)=>Array.from({length:c2-c1+1},(_,j)=>c.TextMatrix(r1+i,c1+j)).join('\t')).join('\r');}
export function setGridClip(c,text){
  const range=gridRange(c);if(!range)return;const rows=String(text).split(/\r\n|\r|\n/),{r1,r2,c1,c2}=range,writes=[];
  for(let row=r1;row<=r2&&row-r1<rows.length;row++){const cells=rows[row-r1].split('\t');for(let col=c1;col<=c2&&col-c1<cells.length;col++){if(writes.length>=1000000)throw new VBError('Clip write exceeds one million cells',7);writes.push([row,col,cells[col-c1]]);}}
  if(c._boundRS){if(writes.some(([row])=>row===0))throw new VBError('Bound column headers are read-only',445);if(writes.length>1)throw new VBError('Multi-cell bound Clip writes require a Recordset transaction',445);}
  for(const [row,col,value]of writes)c.setIndexed('TextMatrix',[row,col],value);
}
function shiftCursor(p,at,delta){for(const key of ['Row','RowSel'])if(p[key]>=at)p[key]=Math.max(at,p[key]+delta);}
export function addGridItem(c,text,index){
  const count=c.props.Rows,at=index===undefined?count:controlInteger(index,0,count,381);if(count>=10000)throw new VBError('Grid row limit exceeded',7);
  const row=String(text).split('\t').slice(0,c.props.Cols);c.gridData.length=count;c.gridData.splice(at,0,row);c._rowHeights.length=count;c._rowHeights.splice(at,0,undefined);c._rowData.length=count;c._rowData.splice(at,0,0);
  c._cellStyles=new Map([...c._cellStyles].map(([row,styles])=>[row>=at?row+1:row,styles]));c.props.Rows++;shiftCursor(c.props,at,1);clampCursor(c);gridChanged(c,true);
}
export function removeGridItem(c,index){
  const at=controlInteger(index,0,c.props.Rows-1,381);c.gridData.splice(at,1);c._rowHeights.splice(at,1);c._rowData.splice(at,1);c._cellStyles=new Map([...c._cellStyles].filter(([row])=>row!==at).map(([row,styles])=>[row>at?row-1:row,styles]));c.props.Rows--;shiftCursor(c.props,at,-1);clampCursor(c);gridChanged(c,true);
}

/** FillStyle applies to Text, but a bound rectangle needs an atomic provider. */
export function setGridText(c,value){
  const range=gridRange(c);if(!range)return;value=String(value);
  const {r1,r2,c1,c2}=c.props.FillStyle?range:{r1:c.props.Row,r2:c.props.Row,c1:c.props.Col,c2:c.props.Col};
  if((r2-r1+1)*(c2-c1+1)>1000000)throw new VBError('Cell fill exceeds one million cells',7);
  if(c._boundRS&&(r1!==r2||c1!==c2))throw new VBError('Multi-cell bound Text writes require a Recordset transaction',445);
  for(let row=r1;row<=r2;row++)for(let col=c1;col<=c2;col++)c.setIndexed('TextMatrix',[row,col],value);
}
