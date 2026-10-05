/** Structured automation of the runtime only; never queries the owner IDE's DOM. */
import {CONTROL_EVENTS, DEFAULT_EVENTS} from '../controls/controls.js';
import {clone} from '../core/core.js';
import {newId} from '../project/model.js';
const PROPERTIES=Object.freeze(['Name','Caption','Text','Value','Enabled','Visible','Left','Top','Width','Height','ListIndex','Min','Max','Row','Col','Rows','Cols','SelStart','SelLength','Checked','WindowState','ToolTipText','Tag','BackColor','ForeColor','FontName','FontSize','FontBold','FontItalic','FontUnderline','TabIndex','TabStop','MaxLength','Locked','PasswordChar','Default','Cancel','FixedRows','FixedCols','RowSel','ColSel','FormatString','SimpleText','Tab','Interval','ScaleMode','ScaleLeft','ScaleTop','ScaleWidth','ScaleHeight','DrawWidth','FillStyle','FillColor','BorderWidth','Alignment','Sorted','SortKey','SortOrder','FullRowSelect','View','Path','Pattern','Drive','DataField','SelBold','SelItalic','SelUnderline','SelColor','SelFontName','SelFontSize','Stretch','ChartType','RowCount','ColumnCount','RowLabel','ColumnLabel','Data','MultiLine','ScrollBars']);
const WRITABLE=new Set(PROPERTIES.filter(k=>k!=='Name'));
const METHODS=Object.freeze(['AddItem','RemoveItem','Clear','Move','SetFocus','Refresh','Cls','Print','Scale','Undo','Redo','Find','GetLineFromChar']);
const INDEXED=Object.freeze(['List','ItemData','Selected','TextMatrix','ColWidth','RowHeight']);
const EVENTS=new Set([...CONTROL_EVENTS,...Object.values(DEFAULT_EVENTS),'Change','Timer','Click','DblClick','GotFocus','LostFocus','NodeClick','ItemClick','ButtonClick','DateClick']);
export class RuntimeAgentControl {
  constructor(host) {this.host=host;this.ids=new WeakMap();this.sequence=0;this.epoch=newId();}
  id(object,prefix) {let id=this.ids.get(object);if(!id){id=this.epoch+'-'+prefix+'-'+(++this.sequence);this.ids.set(object,id);}return id;}
  validControl(control) {return !control.disposed && control.node?.isConnected;}
  describe(control) {
    const properties={};for(const key of PROPERTIES) {let value;try{value=control.get(key);}catch{continue;}if(value===null||['string','boolean','number'].includes(typeof value))properties[key]=typeof value==='string'?value.slice(0,10000):value;}
    return {id:this.id(control,'control'),name:control.model.name,type:control.type,index:control.props.Index??null,parent:control.model.parent||null,properties,visible:!control.node.hidden,enabled:control.props.Enabled!==0};
  }
  inspect({offset=0,limit=100}={}) {
    if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>200)throw new Error('Invalid runtime page.');
    const host=this.host,items=[];
    for(const form of host.forms) if(this.validControl(form)) {
      const formId=this.id(form,'control');items.push({control:form,formId,form:true});
      for(const c of form.controls)if(this.validControl(c))items.push({control:c,formId});
      for(const menu of form.originalModel?.menus||form.model.menus||[])items.push({menu,formId});
    }
    const dialogs=host.dialogs.filter(d=>d.isConnected).slice(-20).map(d=>({id:this.id(d,'dialog'),title:d.querySelector('[role=dialog]')?.getAttribute('aria-label')||'',message:(d.querySelector('.vb-dialog-message')?.textContent||'').slice(0,10000),input:!!d.querySelector('input'),buttons:[...d.querySelectorAll('.vb-dialog-actions button')].map((b,index)=>({index,caption:b.textContent,enabled:!b.disabled})),active:d===host.dialogs.at(-1)}));
    return {state:host.vm.state,pauseId:host.vm.debugPauseId||0,items:items.slice(offset,offset+limit).map(({control,menu,...entry})=>({...entry,...(control?this.describe(control):{id:this.id(menu,'menu'),name:menu.name,type:'Menu',parent:menu.parent,properties:clone(menu.properties)})})),offset,total:items.length,hasMore:offset+limit<items.length,dialogs,properties:PROPERTIES,writable:[...WRITABLE],events:[...EVENTS],methods:METHODS,indexed:INDEXED};
  }
  track(promise) {Promise.resolve(promise).then(()=>this.host.send('agentActivity',{complete:true}),error=>{this.host.send('output',{text:'Agent event: '+error.message,newline:true});this.host.send('agentActivity',{complete:true,error:true});});}
  interact(args) {
    const host=this.host;if(host.disposed)throw new Error('Runtime is closed.');
    if(typeof args.target!=='string')throw new Error('A runtime target ID is required.');
    if(args.action==='dialog') {
      const dialog=host.dialogs.at(-1);if(!dialog||this.ids.get(dialog)!==args.target||!dialog.isConnected)throw new Error('Dialog is stale or not the active runtime dialog.');
      const buttons=[...dialog.querySelectorAll('.vb-dialog-actions button')],button=buttons[args.button];
      if(!Number.isInteger(args.button)||!button||button.disabled)throw new Error('Invalid dialog button.');
      const field=dialog.querySelector('input');if(args.value!==undefined){if(!field||typeof args.value!=='string'||args.value.length>100000)throw new Error('This dialog does not accept that input.');field.value=args.value;}
      button.click();return {accepted:true};
    }
    if(host.dialogs.length)throw new Error('Respond to the active application dialog first.');
    if(args.action!=='indexedGet'&&!['running','idle'].includes(host.vm.state))throw new Error('Resume the application or use typed debugger operations while paused.');
    if(args.action==='menu'){
      for(const form of host.forms)for(const menu of form.originalModel?.menus||form.model.menus||[])if(this.ids.get(menu)===args.target){
        if(!this.validControl(form)||form.node.hidden||form.node.closest('[inert]'))throw new Error('Form is not interactive.');
        const all=form.originalModel?.menus||form.model.menus||[];let parent=menu;const seen=new Set();
        while(parent){if(seen.has(parent)||parent.properties.Visible===0||parent.properties.Enabled===0)throw new Error('Menu is unavailable.');seen.add(parent);parent=all.find(m=>m.name===parent.parent);}
        if(menu.properties.Caption==='-'||all.some(m=>m.parent===menu.name))throw new Error('Select a menu command, not a separator or submenu.');
        this.track(host.vm.dispatch(form.instance,menu.name+'_Click',[]));return {accepted:true};
      }throw new Error('Unknown or stale menu ID.');
    }
    const controls=host.forms.flatMap(f=>[f,...f.controls]),control=controls.find(c=>this.ids.get(c)===args.target&&this.validControl(c));
    if(!control)throw new Error('Unknown or stale runtime control ID.');
    if(control.node.closest('[inert]')||control.node.hidden||control.node.closest('.vb-form')?.hidden||!control.props.Enabled)throw new Error('Runtime control is disabled, hidden or modal-blocked.');
    if(args.action==='click')control.node.click();
    else if(args.action==='focus'){const node=control.node.querySelector('input,textarea,select,button')||control.node;node.focus();}
    else if(args.action==='set') {
      if(!WRITABLE.has(args.property))throw new Error('Unsupported runtime property.');
      if(!['string','number','boolean'].includes(typeof args.value)||typeof args.value==='string'&&args.value.length>100000||typeof args.value==='number'&&!Number.isFinite(args.value))throw new Error('Expected a bounded scalar property value.');
      control.set(args.property,args.value);
    } else if(args.action==='event') {
      if(!EVENTS.has(args.event)||!Array.isArray(args.arguments||[])||(args.arguments||[]).length>16)throw new Error('Unsupported runtime event.');
      this.track(control.event(args.event,clone(args.arguments||[])));
    } else if(args.action==='call'||args.action==='indexedGet'||args.action==='indexedSet') {
      const list=args.arguments||[];if(!Array.isArray(list)||list.length>16||list.some(v=>v!==null&&!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isFinite(v)||typeof v==='string'&&v.length>100000))throw new Error('Expected bounded scalar arguments.');
      if(args.action==='call'){if(!METHODS.includes(args.method)||typeof control[args.method]!=='function')throw new Error('Unsupported control method.');return {accepted:true,value:control[args.method](...list)??null};}
      if(!INDEXED.includes(args.method)||typeof control[args.method]!=='function'||list.some(v=>!Number.isInteger(v)||v<0||v>10000))throw new Error('Invalid indexed property.');
      if(args.action==='indexedGet')return {value:control[args.method](...list)??null};
      if(!['string','number','boolean'].includes(typeof args.value)||typeof args.value==='string'&&args.value.length>100000||typeof args.value==='number'&&!Number.isFinite(args.value))throw new Error('Expected a scalar indexed value.');
      control.setIndexed(args.method,list,args.value);
    } else throw new Error('Unsupported runtime action.');
    return {accepted:true,target:args.target,note:'Input/event queued. Use agent.wait and inspect state/output for completion.'};
  }
}
