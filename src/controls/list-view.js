/** ListView presentation and input. The four native view modes share one item
 * collection and selection model; only layout and realized DOM differ. */
import {el} from '../core/core.js';
import {ListItems,ColumnHeaders,controlInteger} from './collections.js';
import {acceptsInput} from './input.js';
import {cssColor} from '../theme/theme.js';
import {listLayout,revealRect} from './view-layout.js';
import {text,attr,style,reconcile,scale,clientPoint,focusViewport,ImageBindings,LabelEditor,typeSearch} from './collection-view.js';

export class ListViewController {
  constructor(control,safeImage) {
    this.control=control;this.rows=new Map();this.headers=new Map();this.images=new ImageBindings(control,safeImage);this.editor=new LabelEditor(this);this.rowHeight=20;this.anchor=null;this.focused=null;
    control.node.classList.add('vb-listview');control.header=el('div',{class:'vb-lv-header',role:'row'});
    control.viewport=el('div',{class:'vb-virtual-viewport',tabindex:0,role:'listbox'});control.spacer=el('div',{class:'vb-virtual-spacer'});control.viewport.append(control.spacer);control.node.append(control.header,control.viewport);
    this.collection=control.ListItems=new ListItems(()=>control.invalidate(),item=>{control._selectedItem=item;this.focused=item;},{multiSelect:()=>control.props.MultiSelect,onEnsure:item=>this.ensure(item)});
    control.ColumnHeaders=new ColumnHeaders(()=>control.invalidate());
    control.viewport.addEventListener('scroll',()=>{control.header.scrollLeft=control.viewport.scrollLeft;this.editor.cancel();this.paint();});
    control.viewport.addEventListener('keydown',event=>this.keydown(event));
    control.viewport.addEventListener('click',event=>{if(event.target===control.spacer&&acceptsInput(control)){if(!event.ctrlKey&&!event.metaKey)this.collection.clearSelection();this.paint();control.event('Click');}});
    this.resize=new ResizeObserver(()=>this.refresh());this.resize.observe(control.viewport);
    control.ColumnHeaders.batch(()=>{for(const column of control.props.Columns||control.props.ColumnHeaders||[])control.ColumnHeaders.Add(undefined,column.Key,column.Text,column.Width??1440,column.Alignment||0,column.Icon);});
    this.collection.batch(()=>{for(const entry of control.props.Items||control.props.ListItems||[]){const item=this.collection.Add(undefined,entry.Key,entry.Text,entry.Icon,entry.SmallIcon);item.subItems=[...(entry.SubItems||[])];for(const name of ['Checked','Bold','ForeColor','Tag','ToolTipText'])if(entry[name]!==undefined)item[name]=entry[name];}});
  }
  refresh() {
    const c=this.control;if(c.disposed)return;focusViewport(c);
    const view=Number(c.props.View??3),report=view===3,showHeader=report&&!c.props.HideColumnHeaders;
    attr(c.header,'hidden',showHeader?null:'');style(c.viewport,{height:showHeader?'calc(100% - 20px)':'100%'});attr(c.node,'data-view',view);attr(c.viewport,'aria-multiselectable',!!c.props.MultiSelect);
    if(!c.props.MultiSelect&&this.collection.selection.size>1)this.collection.select(this.collection.selected||this.collection.selection.values().next().value,true,false);
    if(this.focused&&!this.collection.owns(this.focused))this.focused=this.collection.selected;
    const columns=c.ColumnHeaders.items;this.columns=columns.length?columns:[{Text:'Name',Width:Math.max(2400,Number(c.props.Width)),Alignment:0,Index:1}];if(this.columnOrder){this.columnOrder=this.columnOrder.filter(col=>this.columns.includes(col));for(const col of this.columns)if(!this.columnOrder.includes(col))this.columnOrder.push(col);this.columns=this.columnOrder.slice();}c.listColumns=this.columns;
    if(showHeader)this.paintHeaders();
    c.listRows=this.collection.items.slice();
    if(c.props.Sorted){const key=Number(c.props.SortKey)||0,direction=c.props.SortOrder?-1:1;c.listRows.sort((a,b)=>String(key?a.SubItems(key):a.Text).localeCompare(String(key?b.SubItems(key):b.Text),undefined,{sensitivity:'base'})*direction);}
    if(c.design&&!c.listRows.length)c.listRows=[{Text:'First item',subItems:['Details']},{Text:'Second item',subItems:['Details']}];
    const images=this.images.resolve(view===0?'Icons':'SmallIcons');this.rowHeight=Math.max(20,Math.ceil(Number(c.props.FontSize||8.25)*96/72)+6,view!==0&&images?Number(images.props.ImageHeight||16)+4:0);
    const widths=this.columns.map(column=>Number(column.Width)/scale(c)),reportWidth=widths.reduce((a,b)=>a+b,0);
    this.layout=listLayout(view,c.listRows.length,c.viewport.clientWidth||Number(c.props.Width)/15,c.viewport.clientHeight||Number(c.props.Height)/15,this.rowHeight,160,reportWidth);
    style(c.spacer,{height:this.layout.height+'px',minWidth:this.layout.width+'px'});this.paint();
  }
  paintHeaders() {
    const c=this.control,nodes=[],keep=new Set(this.columns);
    for(const [column,entry]of this.headers)if(!keep.has(column)){entry.node.remove();this.headers.delete(column);}
    for(const column of this.columns){let entry=this.headers.get(column);if(!entry){
      const node=el('div',{role:'columnheader',tabindex:-1}),image=el('img',{class:'vb-item-image',alt:''}),label=el('span'),resize=el('span',{class:'vb-lv-resize',role:'separator','aria-orientation':'vertical',tabindex:-1});node.append(image,label,resize);entry={node,image,label,resize};this.headers.set(column,entry);
      node.addEventListener('click',event=>{if(acceptsInput(c)&&event.target!==resize&&c.ColumnHeaders.owns(column))c.event('ColumnClick',[column]);});
      node.addEventListener('keydown',event=>{if(acceptsInput(c)&&(event.key==='Enter'||event.key===' ')){event.preventDefault();c.event('ColumnClick',[column]);}});
      resize.addEventListener('pointerdown',event=>this.resizeColumn(event,column,resize));
      node.addEventListener('dragstart',event=>{if(!c.props.AllowColumnReorder||!acceptsInput(c)||!c.ColumnHeaders.owns(column)){event.preventDefault();return;}this.dragColumn=column;event.dataTransfer?.setData('text/plain',column.Key||String(column.Index));});
      node.addEventListener('dragover',event=>{if(this.dragColumn&&c.props.AllowColumnReorder)event.preventDefault();});
      node.addEventListener('drop',event=>{if(!this.dragColumn||!acceptsInput(c)||!c.props.AllowColumnReorder)return;event.preventDefault();const from=c.ColumnHeaders.items.indexOf(this.dragColumn),to=c.ColumnHeaders.items.indexOf(column);if(from>=0&&to>=0&&from!==to){this.columnOrder=this.columnOrder||c.ColumnHeaders.items.slice();const old=this.columnOrder.indexOf(this.dragColumn),target=this.columnOrder.indexOf(column);this.columnOrder.splice(old,1);this.columnOrder.splice(target,0,this.dragColumn);c.invalidate();}this.dragColumn=null;});
      node.addEventListener('dragend',()=>{this.dragColumn=null;});
    }
      const {node,image,label,resize}=entry;style(node,{width:Math.max(0,column.Width/scale(c))+'px',textAlign:['left','right','center'][Number(column.Alignment)||0]});text(label,column.Text);this.images.paint(image,'SmallIcons',column.Icon);attr(node,'aria-colindex',column.Index);attr(node,'draggable',!!c.props.AllowColumnReorder);attr(node,'aria-sort',c.props.Sorted&&Number(c.props.SortKey)===column.Index-1?c.props.SortOrder?'descending':'ascending':'none');attr(resize,'aria-label','Resize '+column.Text);nodes.push(node);
    }
    reconcile(c.header,nodes);
  }
  resizeColumn(event,column,handle) {
    const c=this.control;if(event.button!==0||!acceptsInput(c)||!c.ColumnHeaders.owns(column))return;
    event.preventDefault();event.stopPropagation();const start=event.clientX,width=column.Width,ratio=c.node.getBoundingClientRect().width/(c.node.offsetWidth||1)||1;
    this.cancelResize?.();handle.setPointerCapture(event.pointerId);const move=e=>{column.Width=Math.max(0,Math.min(300000,width+(e.clientX-start)/ratio*scale(c)));};
    const end=()=>{this.cancelResize=null;handle.removeEventListener('lostpointercapture',end);handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);if(handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);};
    this.cancelResize=end;handle.addEventListener('lostpointercapture',end);handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);
  }
  ensure(item) {this.collection.require(item);this.refresh();const index=this.control.listRows.indexOf(item);if(index>=0){revealRect(this.control.viewport,this.layout.box(index));this.paint();}}
  select(item,event={}) {
    const c=this.control,multi=!!c.props.MultiSelect,add=multi&&(event.ctrlKey||event.metaKey),range=multi&&event.shiftKey;this.collection.require(item);
    if(range){const list=c.listRows,start=Math.max(0,list.indexOf(this.anchor||this.collection.selected||item)),end=list.indexOf(item);
      this.collection.batch(()=>{if(!add)this.collection.clearSelection();for(let i=Math.min(start,end);i<=Math.max(start,end);i++)this.collection.select(list[i],true,true);this.collection.select(item,true,true);});
    }else{this.collection.select(item,add?!item.Selected:true,add);this.anchor=item;}
    this.focused=item;this.ensure(item);c.event('ItemClick',[item]);c.event('Click');
  }
  check(item) {if(!this.collection.owns(item))return;item.Checked=item.Checked?0:-1;this.paint();this.control.event('ItemCheck',[item]);}
  keydown(event) {
    const c=this.control;if(event.defaultPrevented||event.isComposing||!acceptsInput(c)||event.target.matches('input'))return;
    this.editor.cancelPending();this.refresh();const list=c.listRows,item=this.focused||this.collection.selected,index=list.indexOf(item),layout=this.layout,view=Number(c.props.View??3);let target=-1,handled=true;
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'&&c.props.MultiSelect){this.collection.batch(()=>{for(const row of this.collection.items)this.collection.select(row,true,true);});this.paint();}
    else switch(event.key){
      case 'ArrowDown':target=index<0?0:index+(view===0||view===1?layout.columns:1);break;
      case 'ArrowUp':target=index<0?0:index-(view===0||view===1?layout.columns:1);break;
      case 'ArrowRight':target=index<0?0:index+(view===2?layout.rows:1);break;
      case 'ArrowLeft':target=index<0?0:index-(view===2?layout.rows:1);break;
      case 'Home':target=0;break;case 'End':target=list.length-1;break;
      case 'PageDown':target=Math.max(0,index)+(view===2?layout.rows:Math.max(1,Math.floor(c.viewport.clientHeight/layout.cellHeight))*layout.columns);break;
      case 'PageUp':target=index-(view===2?layout.rows:Math.max(1,Math.floor(c.viewport.clientHeight/layout.cellHeight))*layout.columns);break;
      case ' ':if(item&&c.props.CheckBoxes&&!event.ctrlKey&&!event.metaKey)this.check(item);else if(item)this.select(item,event);break;
      case 'Enter':if(item){c.event('ItemClick',[item]);c.event('Click');}break;
      case 'F2':if(item)this.startEdit();break;
      default:target=typeSearch(this,event,list,index);handled=target>=0;
    }
    if(handled){event.preventDefault();if(target!==-1&&list.length){target=Math.max(0,Math.min(list.length-1,target));if(c.props.MultiSelect&&(event.ctrlKey||event.metaKey)&&!event.shiftKey){this.focused=list[target];this.ensure(this.focused);}else this.select(list[target],event);}}
  }
  startEdit(fromCode=false){const task=this.editor.start(fromCode?this.collection.selected:this.focused||this.collection.selected,fromCode);return fromCode?task:task.catch(error=>{this.control.LastControlError=error.message;attr(this.control.node,'data-error',error.message);});}
  createRow(item) {
    const c=this.control,row=el('div',{class:'vb-lv-row',role:'option'}),first=el('div',{class:'vb-lv-primary'}),check=el('input',{class:'vb-item-check',type:'checkbox',tabindex:-1}),image=el('img',{class:'vb-item-image',alt:'',draggable:false}),label=el('span',{class:'vb-lv-label'});first.append(check,image,label);row.append(first);
    check.addEventListener('click',event=>{event.stopPropagation();if(acceptsInput(c)){c.viewport.focus({preventScroll:true});this.check(item);}else check.checked=!!item.Checked;});
    row.addEventListener('click',event=>{if(!acceptsInput(c)||this.editor.edit?.item===item)return;this.editor.schedule(item,event,label);c.viewport.focus({preventScroll:true});this.select(item,event);});
    row.addEventListener('dblclick',()=>this.editor.cancelPending());
    return {row,first,check,image,label,cells:new Map()};
  }
  paint() {
    const c=this.control;if(c.disposed||!this.layout||!c.listRows)return;
    if(this.editor.edit&&!this.collection.owns(this.editor.edit.item))this.editor.cancel();
    const viewport=c.viewport,indices=this.layout.visible(viewport.scrollLeft,viewport.scrollTop,viewport.clientWidth||Number(c.props.Width)/15,viewport.clientHeight||Number(c.props.Height)/15),keep=new Set(indices.map(i=>c.listRows[i])),nodes=[],view=Number(c.props.View??3),report=view===3;
    for(const [item,entry]of this.rows)if(!keep.has(item)){if(this.editor.edit?.item===item)this.editor.cancel();entry.row.remove();this.rows.delete(item);}
    for(const index of indices){const item=c.listRows[index];let entry=this.rows.get(item);if(!entry){entry=this.createRow(item);this.rows.set(item,entry);}
      const {row,first,check,image,label,cells}=entry,box=this.layout.box(index),selected=!!item.Selected;
      attr(row,'id','list-'+c.model.id+'-'+(item.Index||index+1));attr(row,'data-index',item.Index??index+1);attr(row,'aria-selected',selected);attr(row,'aria-posinset',index+1);attr(row,'aria-setsize',c.listRows.length);attr(row,'aria-checked',c.props.CheckBoxes?!!item.Checked:null);attr(row,'title',item.ToolTipText||null);
      row.classList.toggle('selected',selected);row.classList.toggle('focused',item===this.focused);row.classList.toggle('vb-full-row',!!c.props.FullRowSelect);style(row,{left:box.x+'px',top:box.y+'px',width:box.width+'px',height:box.height+'px',minWidth:'0',fontWeight:item.Bold?'bold':'',color:item.ForeColor!==null&&item.ForeColor!==undefined?cssColor(item.ForeColor):''});
      attr(check,'hidden',c.props.CheckBoxes?null:'');if(check.checked!==!!item.Checked)check.checked=!!item.Checked;attr(check,'disabled',c.design||!c.props.Enabled?'':null);attr(check,'aria-label','Check '+item.Text);
      this.images.paint(image,view===0?'Icons':'SmallIcons',view===0?item.Icon:item.SmallIcon,view===0?32:16);if(this.editor.edit?.item!==item)text(label,item.Text);
      const children=[];
      if(report){
        for(const column of this.columns){const col=column.Index-1;if(col===0){style(first,{width:Math.max(0,column.Width/scale(c))+'px',textAlign:['left','right','center'][Number(column.Alignment)||0]});children.push(first);continue;}
          let cell=cells.get(column);if(!cell){cell={node:el('div'),image:el('img',{class:'vb-item-image',alt:''}),label:el('span')};cell.node.append(cell.image,cell.label);cells.set(column,cell);}
          const sub=item.ListSubItems?.items[col-1];text(cell.label,sub?.Text??item.subItems?.[col-1]??'');style(cell.node,{width:Math.max(0,column.Width/scale(c))+'px',textAlign:['left','right','center'][Number(column.Alignment)||0],fontWeight:sub?.Bold?'bold':'',color:sub?.ForeColor!==null&&sub?.ForeColor!==undefined?cssColor(sub.ForeColor):'',borderRight:c.props.GridLines?'1px solid var(--vb-face)':''});attr(cell.node,'title',sub?.ToolTipText||null);this.images.paint(cell.image,'SmallIcons',sub?.ReportIcon);children.push(cell.node);
        }
        for(const column of cells.keys())if(!this.columns.includes(column))cells.delete(column);
      }else{style(first,{width:'100%',textAlign:view===0?'center':'left'});children.push(first);cells.clear();}
      row.classList.toggle('vb-grid-lines',report&&!!c.props.GridLines);reconcile(row,children);nodes.push(row);
    }
    reconcile(c.spacer,nodes);attr(c.viewport,'aria-activedescendant',this.rows.get(this.focused||this.collection.selected)?.row.id||null);
  }
  find(textValue,where=0,index=1,match=0) {
    where=controlInteger(where,0,2);match=controlInteger(match,0,1);if(!this.collection.Count)return null;
    index=controlInteger(index,1,this.collection.Count,35600);const query=String(textValue).toLocaleLowerCase();
    for(let i=index-1;i<this.collection.Count;i++){const item=this.collection.items[i],values=where===2?[String(item.Tag??'')]:where===1?item.subItems:[item.Text];if(values.some(value=>{value=String(value).toLocaleLowerCase();return where===0&&match===1?value.startsWith(query):value===query;}))return item;}return null;
  }
  hitTest(x,y){const point=clientPoint(this.control,x,y);if(!point||!this.layout)return null;return this.control.listRows?.[this.layout.indexAt(point.x,point.y)]||null;}
  firstVisible(){if(!this.layout)return null;const c=this.control,indices=this.layout.visible(c.viewport.scrollLeft,c.viewport.scrollTop,c.viewport.clientWidth,c.viewport.clientHeight,0);return c.listRows?.[indices[0]]||null;}
  visibleCount(){if(!this.layout)return 0;const c=this.control;return this.layout.visible(c.viewport.scrollLeft,c.viewport.scrollTop,c.viewport.clientWidth,c.viewport.clientHeight,0).length;}
  dispose(){this.cancelResize?.();this.editor.cancel();this.images.dispose();this.resize.disconnect();this.rows.clear();this.headers.clear();}
}
