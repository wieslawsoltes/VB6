/** Classic toolbar and status bar adapters with owned popup/timer lifecycles. */
import {el} from '../core/core.js';
import {ToolbarButtons,StatusPanels} from './collections.js';
import {acceptsInput} from './input.js';
import {showMenu,closeMenu,mnemonicText} from '../theme/menu.js';
import {attr,text,style,reconcile,scale,ImageBindings} from './collection-view.js';

export function activateToolbarButton(collection,button){
  collection.require(button);if(!button.Enabled||!button.Visible||button.Style===3||button.Style===4)return false;
  if(button.Style===1)button.Value=button.Value?0:1;else if(button.Style===2)button.Value=1;return true;
}
export function statusPanelText(panel,now=new Date(),locks={}){
  const type=Number(panel.Style);return type===5?now.toLocaleTimeString():type===6?now.toLocaleDateString():['', 'CAPS','NUM','INS','SCRL'][type]||String(panel.Text??'');
}
const plain=value=>String(value??'').replace(/&&/g,'\0').replace(/&/g,'').replace(/\0/g,'&');
export class ToolbarController{
  constructor(control,safeImage){
    this.control=control;this.rows=new Map();this.images=new ImageBindings(control,safeImage);this.popup=null;this.popupButton=null;this.focused=null;
    control.node.classList.add('vb-toolbar');attr(control.node,'role','toolbar');
    control.Buttons=new ToolbarButtons(()=>control.invalidate());
    control.Buttons.batch(()=>{for(const entry of control.props.Buttons||[]){const button=control.Buttons.Add(undefined,entry.Key,entry.Caption,entry.Style,entry.Image);for(const key of ['Enabled','Visible','Value','ToolTipText','Tag','Description','MixedState','Width'])if(entry[key]!==undefined)button[key]=entry[key];for(const menu of entry.ButtonMenus||[]){const added=button.ButtonMenus.Add(undefined,menu.Key,menu.Text);for(const key of ['Enabled','Visible','Checked','Tag'])if(menu[key]!==undefined)added[key]=menu[key];}}});
    control.node.addEventListener('keydown',event=>this.keydown(event));
  }
  invoke(button){if(!acceptsInput(this.control)||!this.control.Buttons.owns(button)||!activateToolbarButton(this.control.Buttons,button))return;this.control.event('ButtonClick',[button]);this.refresh();}
  closePopup(){if(this.popup?.isConnected)closeMenu(false);this.popup=null;this.popupButton=null;}
  async dropdown(button,opener){
    const c=this.control;if(!acceptsInput(c)||!c.Buttons.owns(button)||!button.Enabled||!button.Visible||button.Style!==5)return;
    await c.event('ButtonDropDown',[button]);
    if(!acceptsInput(c)||!c.Buttons.owns(button)||!button.Enabled||!button.Visible||!opener.isConnected)return;
    const entries=button.ButtonMenus.items.filter(menu=>menu.Visible),lookup=new Map(),items=entries.map((menu,i)=>{const id='item-'+i;lookup.set(id,menu);return menu.Text==='-'?null:{id,label:menu.Text,enabled:!!menu.Enabled,checked:!!menu.Checked};});if(!items.length)return;
    const bounds=opener.getBoundingClientRect();this.closePopup();this.popupButton=button;this.popup=showMenu(items,bounds.left,bounds.bottom,id=>{const menu=lookup.get(id);this.popup=null;this.popupButton=null;if(acceptsInput(c)&&c.Buttons.owns(button)&&button.Enabled&&button.Visible&&menu&&button.ButtonMenus.owns(menu)&&menu.Enabled&&menu.Visible)c.event('ButtonMenuClick',[menu]);},{opener,runtime:true,label:plain(button.Caption)||'Button menu'});
  }
  keydown(event){
    const c=this.control;if(event.defaultPrevented||!acceptsInput(c))return;const entries=[...this.rows].filter(([button])=>button.Enabled&&button.Visible&&![3,4].includes(button.Style)),index=entries.findIndex(([,entry])=>entry.node===event.target||entry.node.contains(event.target));
    if(event.key==='F4'||event.altKey&&event.key==='ArrowDown'){const selected=entries[index];if(selected&&selected[0].Style===5){event.preventDefault();this.dropdown(selected[0],selected[1].main);}return;}
    const target=event.key==='Home'?0:event.key==='End'?entries.length-1:['ArrowLeft','ArrowUp'].includes(event.key)?(index-1+entries.length)%entries.length:['ArrowRight','ArrowDown'].includes(event.key)?(index+1)%entries.length:-1;
    if(target>=0&&entries[target]){event.preventDefault();this.focused=entries[target][0];entries[target][1].main.focus({preventScroll:true});this.refresh();}
  }
  create(button){
    const c=this.control,node=el('div',{class:'vb-toolbar-slot'}),main=el('button',{type:'button',class:'vb-toolbar-button'}),image=el('img',{class:'vb-item-image',alt:''}),label=el('span'),arrow=el('button',{type:'button',class:'vb-toolbar-dropdown',text:'▾',tabindex:-1,'aria-label':'Open button menu','aria-haspopup':'menu'});main.append(image,label);node.append(main,arrow);
    main.addEventListener('click',()=>{this.focused=button;this.invoke(button);});arrow.addEventListener('click',()=>this.dropdown(button,arrow));main.addEventListener('focus',()=>{this.focused=button;});
    return {node,main,image,label,arrow,caption:null};
  }
  refresh(){
    const c=this.control;if(c.disposed)return;const buttons=c.Buttons.items.filter(button=>button.Visible),keep=new Set(buttons),nodes=[];
    if(!c.props.Enabled||!c.props.Visible||this.popupButton&&(!c.Buttons.owns(this.popupButton)||!this.popupButton.Enabled||!this.popupButton.Visible))this.closePopup();
    for(const [button,entry]of this.rows)if(!keep.has(button)){if(entry.node.contains(c.node.ownerDocument.activeElement))this.focused=null;entry.node.remove();this.rows.delete(button);}
    if(!keep.has(this.focused)||!this.focused?.Enabled||[3,4].includes(this.focused?.Style))this.focused=buttons.find(button=>button.Enabled&&![3,4].includes(button.Style))||null;
    for(const button of buttons){let entry=this.rows.get(button);if(!entry){entry=this.create(button);this.rows.set(button,entry);}const {node,main,image,label,arrow}=entry,kind=Number(button.Style),enabled=!c.design&&!!c.props.Enabled&&!!button.Enabled,interactive=kind!==3&&kind!==4;
      attr(node,'data-key',button.Key);attr(node,'data-style',kind);attr(node,'role',kind===3?'separator':null);attr(main,'hidden',interactive?null:'');attr(arrow,'hidden',kind===5?null:'');attr(main,'disabled',enabled?null:'');attr(arrow,'disabled',enabled?null:'');attr(main,'tabindex',enabled&&c.props.TabStop&&button===this.focused?Number(c.props.TabIndex)||0:-1);attr(main,'aria-label',plain(button.Caption||button.Key));attr(main,'aria-pressed',kind===1||kind===2?!!button.Value:null);attr(main,'title',button.ToolTipText||plain(button.Caption));attr(arrow,'title',button.ToolTipText||'Open menu');
      main.classList.toggle('pressed',!!button.Value);main.classList.toggle('mixed',!!button.MixedState);style(node,{width:kind===4?button.Width/scale(c)+'px':kind===3?'8px':'',height:c.props.ButtonHeight>0?c.props.ButtonHeight/scale(c,true)+'px':''});style(main,{minWidth:c.props.ButtonWidth>0?c.props.ButtonWidth/scale(c)+'px':'',flexDirection:Number(c.props.TextAlignment)===0?'column':'row'});
      if(entry.caption!==String(button.Caption||'')){entry.caption=String(button.Caption||'');mnemonicText(label,entry.caption);}this.images.paint(image,'ImageList',button.Image,Number(this.images.resolve('ImageList')?.props.ImageWidth||16));nodes.push(node);
    }
    if(c.design&&!buttons.length){this.placeholder??=el('span',{text:'New   Open   Save'});nodes.push(this.placeholder);}
    style(c.node,{flexWrap:c.props.Wrappable?'wrap':'nowrap'});attr(c.node,'tabindex',-1);reconcile(c.node,nodes);
  }
  dispose(){this.closePopup();this.images.dispose();this.rows.clear();}
}
export class StatusBarController{
  constructor(control,safeImage){
    this.control=control;this.safeImage=safeImage;this.rows=new Map();this.locks={CapsLock:false,NumLock:false,Insert:true,ScrollLock:false};this.timer=null;
    control.node.classList.add('vb-statusbar');attr(control.node,'role','status');control.Panels=new StatusPanels(()=>control.invalidate());
    control.Panels.batch(()=>{for(const entry of control.props.Panels||[]){const panel=control.Panels.Add(undefined,entry.Key,entry.Text,entry.Style);for(const key of ['Width','MinWidth','Alignment','Enabled','Visible','AutoSize','ToolTipText','Picture','Bevel','Tag'])if(entry[key]!==undefined)panel[key]=entry[key];}});
    this.abort=new control.node.ownerDocument.defaultView.AbortController();
    const update=event=>{if(control.disposed)return;let changed=false;for(const key of ['CapsLock','NumLock','ScrollLock']){const value=event.getModifierState(key);if(this.locks[key]!==value){this.locks[key]=value;changed=true;}}if(event.type==='keydown'&&event.key==='Insert'&&!event.repeat){this.locks.Insert=!this.locks.Insert;changed=true;}if(changed)control.invalidate();};
    for(const name of ['keydown','keyup'])control.node.ownerDocument.addEventListener(name,update,{signal:this.abort.signal});
    this.simple=el('div',{class:'vb-status-panel vb-status-simple'});
  }
  refresh(){
    const c=this.control;if(c.disposed)return;const panels=Number(c.props.Style)===1?[]:c.Panels.items.filter(panel=>panel.Visible),nodes=[],keep=new Set(panels),now=new Date();
    for(const [panel,entry]of this.rows)if(!keep.has(panel)){entry.node.remove();this.rows.delete(panel);}
    for(const panel of panels){let entry=this.rows.get(panel);if(!entry){const node=el('div',{class:'vb-status-panel'}),image=el('img',{class:'vb-item-image',alt:''}),label=el('span');node.append(image,label);entry={node,image,label};this.rows.set(panel,entry);node.addEventListener('click',()=>{if(acceptsInput(c)&&panel.Enabled&&c.Panels.owns(panel))c.event('PanelClick',[panel]);});node.addEventListener('dblclick',()=>{if(acceptsInput(c)&&panel.Enabled&&c.Panels.owns(panel))c.event('PanelDblClick',[panel]);});}
      const {node,image,label}=entry,display=statusPanelText(panel,now,this.locks),indicator=['','CapsLock','NumLock','Insert','ScrollLock'][Number(panel.Style)],enabled=!!panel.Enabled&&(!indicator||this.locks[indicator]);text(label,display);attr(node,'data-key',panel.Key);attr(node,'title',panel.ToolTipText||null);attr(node,'aria-disabled',!enabled);attr(node,'data-bevel',panel.Bevel);style(node,{minWidth:Math.max(0,panel.MinWidth/scale(c))+'px',flex:panel.AutoSize===1?'1 1 0':panel.AutoSize===2?'0 0 auto':'0 0 '+panel.Width/scale(c)+'px',justifyContent:['flex-start','center','flex-end'][Number(panel.Alignment)||0],opacity:enabled?'1':'.55'});const source=this.safeImage(panel.Picture,c.assets);attr(image,'src',source||null);attr(image,'hidden',source?null:'');nodes.push(node);
    }
    if(!panels.length){text(this.simple,c.props.SimpleText??'');nodes.push(this.simple);}reconcile(c.node,nodes);
    const timed=!c.design&&c.props.Visible&&panels.some(panel=>panel.Style===5||panel.Style===6);if(timed&&!this.timer)this.timer=setInterval(()=>{if(!c.disposed)c.invalidate();},1000);else if(!timed&&this.timer){clearInterval(this.timer);this.timer=null;}
  }
  dispose(){clearInterval(this.timer);this.timer=null;this.abort.abort();this.rows.clear();}
}
