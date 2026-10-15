/** Virtualized TreeView adapter. Collection ownership and hierarchy remain in
 * TreeNodes; DOM identity is retained only for visible nodes. */
import {el} from '../core/core.js';
import {TreeNodes} from './collections.js';
import {acceptsInput} from './input.js';
import {cssColor} from '../theme/theme.js';
import {revealRect} from './view-layout.js';
import {text,attr,style,reconcile,scale,clientPoint,focusViewport,ImageBindings,LabelEditor,typeSearch} from './collection-view.js';

export class TreeViewController {
  constructor(control,safeImage) {
    this.control=control;this.rows=new Map();this.images=new ImageBindings(control,safeImage);this.editor=new LabelEditor(this);this.rowHeight=20;
    control.node.classList.add('vb-tree');
    control.viewport=el('div',{class:'vb-virtual-viewport',role:'tree',tabindex:0});
    control.spacer=el('div',{class:'vb-virtual-spacer'});control.viewport.append(control.spacer);control.node.append(control.viewport);
    this.collection=control.Nodes=new TreeNodes(()=>control.invalidate(),item=>{control._selectedNode=item;},
      {sorted:()=>control.props.Sorted,pathSeparator:()=>control.props.PathSeparator??'\\',onEnsure:item=>this.ensure(item)});
    control.viewport.addEventListener('scroll',()=>{this.editor.cancel();this.paint();});
    control.viewport.addEventListener('keydown',event=>this.keydown(event));
    control.viewport.addEventListener('click',event=>{if(event.target===control.spacer&&acceptsInput(control))control.event('Click');});
    this.resize=new ResizeObserver(()=>this.paint());this.resize.observe(control.viewport);
    const entries=control.props.Nodes||[];
    this.collection.batch(()=>{
      for(const entry of entries){const node=this.collection.Add(undefined,undefined,entry.Key,entry.Text,entry.Image,entry.SelectedImage);
        for(const name of ['Expanded','Checked','Bold','Sorted','ForeColor','BackColor','Tag','ExpandedImage'])if(entry[name]!==undefined)node[name]=entry[name];
        if(entry.Expanded===undefined)node.Expanded=-1;
      }
      for(let i=0;i<entries.length;i++){const parent=entries[i].Parent;if(parent)this.collection.items[i].Parent=this.collection.Item(parent);}
      for(const node of this.collection.items)if(node.Sorted)this.collection.sort(node);if(control.props.Sorted)this.collection.sort();
    });
  }
  refresh() {
    const c=this.control;if(c.disposed)return;focusViewport(c);
    const images=this.images.resolve('ImageList');this.rowHeight=Math.max(20,Math.ceil(Number(c.props.FontSize||8.25)*96/72)+6,images?Number(images.props.ImageHeight||16)+4:0);
    c.treeRows=this.collection.flattened();
    if(c.design&&!c.treeRows.length)c.treeRows=[{node:{Text:'Project1',Expanded:-1},depth:0,children:2},{node:{Text:'Forms'},depth:1,children:0},{node:{Text:'Modules'},depth:1,children:0}];
    style(c.spacer,{height:c.treeRows.length*this.rowHeight+'px'});this.paint();
  }
  ensure(item) {
    this.collection.require(item);const c=this.control;this.refresh();const i=c.treeRows.findIndex(row=>row.node===item);
    if(i>=0){revealRect(c.viewport,{x:c.viewport.scrollLeft,y:i*this.rowHeight,width:0,height:this.rowHeight});this.paint();}
  }
  select(item) {this.collection.select(item);this.ensure(item);this.control.event('NodeClick',[item]);this.control.event('Click');}
  expand(item,value) {
    if(!item||!this.collection.owns(item)||!item.Children||!!item.Expanded===value)return;
    item.Expanded=value?-1:0;this.refresh();this.control.event(value?'Expand':'Collapse',[item]);
  }
  check(item) {if(!this.collection.owns(item))return;item.Checked=item.Checked?0:-1;this.paint();this.control.event('NodeCheck',[item]);}
  keydown(event) {
    const c=this.control;if(event.defaultPrevented||event.isComposing||!acceptsInput(c)||event.target.matches('input'))return;
    this.editor.cancelPending();this.refresh();const rows=c.treeRows,item=this.collection.selected;let index=rows.findIndex(row=>row.node===item),target=-1,handled=true;
    const page=Math.max(1,Math.floor(c.viewport.clientHeight/this.rowHeight)-1);
    switch(event.key){
      case 'ArrowDown':target=Math.min(rows.length-1,index+1);break;
      case 'ArrowUp':target=Math.max(0,index<0?0:index-1);break;
      case 'Home':target=0;break;case 'End':target=rows.length-1;break;
      case 'PageDown':target=Math.min(rows.length-1,Math.max(0,index)+page);break;
      case 'PageUp':target=Math.max(0,index-page);break;
      case 'ArrowRight':if(item?.Children){if(!item.Expanded)this.expand(item,true);else target=index+1;}else if(index<0)target=0;break;
      case 'ArrowLeft':if(item?.Expanded&&item.Children)this.expand(item,false);else if(item?.Parent)target=rows.findIndex(row=>row.node===item.Parent);break;
      case '*':if(item){const expanded=[];this.collection.batch(()=>{const stack=[item];while(stack.length){const node=stack.pop();if(node.Children){if(!node.Expanded){node.Expanded=-1;expanded.push(node);}for(const child of this.collection.children(node))stack.push(child);}}});this.refresh();for(const node of expanded)c.event('Expand',[node]);}break;
      case '+':this.expand(item,true);break;case '-':this.expand(item,false);break;
      case ' ':if(item&&c.props.CheckBoxes)this.check(item);else handled=false;break;
      case 'Enter':if(item){c.event('NodeClick',[item]);c.event('Click');}break;
      case 'F2':if(item)this.startEdit();break;
      default:target=typeSearch(this,event,rows.map(row=>row.node),index);handled=target>=0;
    }
    if(handled){event.preventDefault();if(target>=0&&rows[target])this.select(rows[target].node);}
  }
  startEdit(fromCode=false) {const task=this.editor.start(this.collection.selected,fromCode);return fromCode?task:task.catch(error=>{this.control.LastControlError=error.message;attr(this.control.node,'data-error',error.message);});}
  createRow(item) {
    const c=this.control,row=el('div',{class:'vb-tree-row',role:'treeitem'}),toggle=el('button',{class:'vb-tree-toggle',tabindex:-1,type:'button'}),check=el('input',{class:'vb-item-check',type:'checkbox',tabindex:-1}),image=el('img',{class:'vb-item-image',alt:'',draggable:false}),label=el('span',{class:'vb-tree-label'});
    row.append(toggle,check,image,label);
    toggle.addEventListener('click',event=>{event.stopPropagation();if(acceptsInput(c)){c.viewport.focus({preventScroll:true});this.expand(item,!item.Expanded);}});
    check.addEventListener('click',event=>{event.stopPropagation();if(acceptsInput(c)){c.viewport.focus({preventScroll:true});this.check(item);}else check.checked=!!item.Checked;});
    row.addEventListener('click',event=>{if(!acceptsInput(c)||this.editor.edit?.item===item)return;this.editor.schedule(item,event,label);c.viewport.focus({preventScroll:true});this.select(item);});
    row.addEventListener('dblclick',event=>{this.editor.cancelPending();if(acceptsInput(c)&&event.target!==toggle&&event.target!==check)this.expand(item,!item.Expanded);});
    return {row,toggle,check,image,label};
  }
  paint() {
    const c=this.control;if(c.disposed||!c.treeRows)return;
    if(this.editor.edit&&!this.collection.owns(this.editor.edit.item))this.editor.cancel();
    const height=this.rowHeight,first=Math.max(0,Math.floor(c.viewport.scrollTop/height)-2),count=Math.ceil((c.viewport.clientHeight||Number(c.props.Height)/15)/height)+5,visible=c.treeRows.slice(first,first+count),keep=new Set(visible.map(entry=>entry.node)),nodes=[];
    for(const [item,entry]of this.rows)if(!keep.has(item)){if(this.editor.edit?.item===item)this.editor.cancel();entry.row.remove();this.rows.delete(item);}
    const kind=Number(c.props.Style??7),pictures=!!(kind&1),toggles=!!(kind&2),lines=!!(kind&4),indent=Number(c.props.Indentation??240)/scale(c),selected=this.collection.selected;
    for(let j=0;j<visible.length;j++){
      const {node:item,depth,children}=visible[j],index=first+j;let entry=this.rows.get(item);if(!entry){entry=this.createRow(item);this.rows.set(item,entry);}
      const {row,toggle,check,image,label}=entry;const id='tree-'+c.model.id+'-'+(item.Index||index+1);
      attr(row,'id',id);attr(row,'data-index',item.Index??index+1);attr(row,'aria-level',depth+1);attr(row,'aria-selected',item===selected);attr(row,'aria-expanded',children?!!item.Expanded:null);attr(row,'aria-checked',c.props.CheckBoxes?!!item.Checked:null);
      row.classList.toggle('selected',item===selected);row.classList.toggle('vb-full-row',!!c.props.FullRowSelect);row.classList.toggle('vb-tree-lines',lines&&(depth>0||Number(c.props.LineStyle)===1));if(row.style.getPropertyValue('--vb-tree-indent')!==(depth*indent+11)+'px')row.style.setProperty('--vb-tree-indent',(depth*indent+11)+'px');
      style(row,{top:index*height+'px',height:height+'px',paddingLeft:depth*indent+4+'px',fontWeight:item.Bold?'bold':'',background:item.BackColor!==null&&item.BackColor!==undefined?cssColor(item.BackColor):'',color:item.ForeColor!==null&&item.ForeColor!==undefined?cssColor(item.ForeColor):''});
      style(toggle,{visibility:children&&toggles?'visible':'hidden',display:toggles?'':'none'});text(toggle,item.Expanded?'−':'+');attr(toggle,'aria-label',(item.Expanded?'Collapse ':'Expand ')+item.Text);attr(toggle,'disabled',c.design||!c.props.Enabled?'':null);
      attr(check,'hidden',c.props.CheckBoxes?null:'');if(check.checked!==!!item.Checked)check.checked=!!item.Checked;attr(check,'disabled',c.design||!c.props.Enabled?'':null);attr(check,'aria-label','Check '+item.Text);
      this.images.paint(image,'ImageList',pictures?(item===selected&&item.SelectedImage!==undefined?item.SelectedImage:item.Expanded&&item.ExpandedImage!==undefined?item.ExpandedImage:item.Image):undefined,Number(this.images.resolve('ImageList')?.props.ImageWidth||16));
      if(this.editor.edit?.item!==item)text(label,item.Text);attr(row,'title',item.ToolTipText||null);nodes.push(row);
    }
    reconcile(c.spacer,nodes);const selectedRow=this.rows.get(selected);attr(c.viewport,'aria-activedescendant',selectedRow?.row.id||null);
  }
  hitTest(x,y){const point=clientPoint(this.control,x,y);return point?this.control.treeRows?.[Math.floor(point.y/this.rowHeight)]?.node||null:null;}
  firstVisible(){return this.control.treeRows?.[Math.floor(this.control.viewport.scrollTop/this.rowHeight)]?.node||null;}
  visibleCount(){return Math.min(this.control.treeRows?.length||0,Math.floor(this.control.viewport.clientHeight/this.rowHeight));}
  dispose(){this.editor.cancel();this.images.dispose();this.resize.disconnect();this.rows.clear();}
}
