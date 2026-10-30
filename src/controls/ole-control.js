/** Browser presentation for the intrinsic OLE document container. Imported
 * documents are data: HTML, scripts, macros and native servers are never run.
 */
import {el} from '../core/core.js';
import {VBError} from '../language/lexer.js';
import {truth} from '../runtime/values.js';
import {cssColor} from '../theme/theme.js';
import {showMenu} from '../theme/menu.js';
import {OleDocument,OLE_CLASSES} from './ole-document.js';
import {RichTextController} from './richtext.js';

const enumValues={OLETypeAllowed:[0,1,2],AutoActivate:[0,1,2,3],SizeMode:[0,1,2,3],DisplayType:[0,1]};
const methods={CreateEmbed:'createEmbed',CreateLink:'createLink',DoVerb:'doVerb',Close:'close',Delete:'delete',Update:'update',SaveToFile:'saveToFile',ReadFromFile:'readFromFile',SaveDocument:'saveDocument'};

export function getOleProperty(control,key){
  const doc=control.oleController?.document;if(!doc)return undefined;
  if(key==='Object')return doc.object;
  if(key==='OLEType')return doc.type;
  if(key==='Class')return doc.className||control.props.Class||'';
  if(key==='SourceDoc')return doc.source||control.props.SourceDoc||'';
  if(key==='Modified')return doc.dirty?-1:0;
  if(key==='AppIsRunning')return doc.active?-1:0;
  return undefined;
}
export function setOleProperty(control,key,value){
  if(control.type!=='OLE')return false;
  if(['Object','OLEType','Modified','AppIsRunning'].includes(key))throw new VBError(key+' is read-only',383);
  if(Object.hasOwn(enumValues,key)){
    value=Number(value);if(!enumValues[key].includes(value))throw new VBError('Invalid '+key,380);
    if(key==='OLETypeAllowed'&&control.oleController&&!control.oleController.document.empty&&value!==2&&value!==control.oleController.document.type)throw new VBError('OLETypeAllowed conflicts with the loaded object',380);
  }else if(['Class','SourceDoc'].includes(key)){
    value=String(value??'');if(value.length>4096||/[\0-\x1f]/.test(value))throw new VBError('Invalid '+key,380);
  }else return false;
  control.props[key]=value;if(key==='OLETypeAllowed'&&control.oleController)control.oleController.document.allowed=value;control.invalidate();return true;
}

export class OleControlController {
  constructor(control){
    this.control=control;this.closed=false;this.revision=-1;this.viewKind=null;this.pendingImport=0;this.viewGeneration=0;
    if(control.props.Caption==='OLE (unsupported)')delete control.props.Caption;
    const n=control.node;n.classList.add('vb-ole');
    this.caption=el('span',{class:'vb-ole-caption'});
    this.menuButton=el('button',{type:'button',class:'vb-ole-menu','aria-label':'Document actions','aria-haspopup':'menu',onclick:event=>{event.stopPropagation();this.menu();}},'⋯');
    this.heading=el('div',{class:'vb-ole-heading'},this.caption,this.menuButton);
    this.body=el('div',{class:'vb-ole-body'});this.status=el('div',{class:'vb-ole-status',role:'status'});n.append(this.heading,this.body,this.status);
    this.document=new OleDocument({fs:control.vm?.fs,assets:control.assets,allow:control.props.OLETypeAllowed??2,onChange:(reason,doc)=>{
      if(this.closed)return;if(reason==='created'||reason==='deleted')this.viewKind=null;this.revision=-1;this.refresh();
      if(!control.design){if(['changed','created','updated','deleted'].includes(reason))control.event('Updated',[0]);else if(reason==='saved')control.event('Updated',[1]);else if(reason==='deactivated')control.event('Updated',[2]);}
      if(reason==='created'&&!control.design&&Number(control.props.AutoActivate)===3&&truth(control.props.Enabled))doc.doVerb();
    }});
    for(const [name,method]of Object.entries(methods))control[name]=(...args)=>{const result=this.document[method](...args);if(name==='DoVerb')this.focusEditor();return result;};
    control.InsertObjDlg=()=>this.insert();control.ExportDocument=()=>this.export();
    for(const key of ['Object','OLEType','Modified','AppIsRunning'])Object.defineProperty(control,key,{enumerable:true,configurable:true,get:()=>getOleProperty(control,key),set:value=>setOleProperty(control,key,value)});
    n.addEventListener('dblclick',event=>{if(!this.interactive||Number(control.props.AutoActivate)!==2||this.document.empty||event.target.closest('button'))return;this.activate();});
    n.addEventListener('focusin',()=>{if(this.interactive&&Number(control.props.AutoActivate)===1&&!this.document.empty&&!this.document.active)this.activate();});
    n.addEventListener('keydown',event=>{if(!this.interactive)return;if(event.key==='Escape'&&this.document.active){event.preventDefault();event.stopPropagation();this.document.close();control.node.focus();}else if(event.key==='Enter'&&event.target===n&&!this.document.empty){event.preventDefault();this.activate();}});
    n.addEventListener('contextmenu',event=>{if(!this.interactive)return;event.preventDefault();event.stopPropagation();this.menu(event.clientX,event.clientY);});
    try{
      if(control.props.OLEDocument)this.document.restore(control.props.OLEDocument);
      else if(control.props.SourceDoc)this.document[Number(control.props.OLETypeAllowed)===0?'createLink':'createEmbed'](control.props.SourceDoc,control.props.Class||'');
    }catch(error){if(!control.design)throw error;this.status.textContent=error.message;}
  }
  get interactive(){return !this.closed&&!this.control.design&&!this.control.disposed&&truth(this.control.props.Enabled);}
  run(action){try{const value=action();if(value?.then)value.catch(error=>this.error(error));}catch(error){this.error(error);}}
  error(error){if(this.closed)return;this.status.textContent=error.message;this.control.vm?.host?.error?.(error);}
  activate(){if(!this.interactive||this.document.empty)return;this.run(()=>{this.document.doVerb(Number(this.control.props.Verb)||0);this.focusEditor();});}
  focusEditor(){if(this.document.active)(this.editor||this.body)?.focus?.();}
  menu(x,y){
    if(!this.interactive)return;const rect=this.menuButton.getBoundingClientRect(),doc=this.document,embedded=Number(this.control.props.OLETypeAllowed)!==0;
    const item=(label,action,enabled=true)=>({label,enabled,action:()=>this.run(action)});
    showMenu([
      item('&Edit document',()=>this.activate(),!doc.empty),item('&Close editing',()=>doc.close(),doc.active),
      item('E&xport document…',()=>this.export(),!doc.empty),
      ...(doc.type===0?[item('&Update from source',()=>doc.update()),item('&Save to source',()=>doc.saveLinked())]:[]),null,
      item('New &text document',()=>doc.createEmbed('',OLE_CLASSES.text),embedded),
      item('New &rich text document',()=>doc.createEmbed('',OLE_CLASSES.rtf),embedded),
      item('&Insert file…',()=>this.insert(),embedded),
      item('&Delete object',()=>doc.delete(),!doc.empty),
    ],x??rect.left,y??rect.bottom,null,{opener:this.menuButton,runtime:true,focusFirst:true});
  }
  async insert(){
    if(!this.interactive)return;const request=++this.pendingImport,revision=this.document.revision;
    const result=await this.control.vm?.host.openFile?.({DialogTitle:'Insert document',Filter:'All files|*.*'});
    if(this.closed||!this.interactive||request!==this.pendingImport||revision!==this.document.revision||!result)return;
    const bytes=result.bytes??new TextEncoder().encode(String(result.text??''));this.document.importBytes(result.name,bytes);
  }
  export(){if(!this.interactive)return;const doc=this.document;this.control.vm?.host.saveFile?.(doc.name,doc.bytes);}
  #replaceView(kind){
    this.rich?.dispose();this.rich=null;this.editor=null;this.image=null;this.body.replaceChildren();this.viewKind=kind;
    const control=this.control,generation=++this.viewGeneration;
    if(kind==='empty'){
      this.body.append(el('span',{class:'vb-ole-empty-label'},'OLE document'),el('button',{type:'button','data-ole-action':'new',onclick:event=>{event.stopPropagation();if(this.interactive)this.run(()=>{this.document.createEmbed();this.activate();});}},'New text'),el('button',{type:'button','data-ole-action':'insert',onclick:event=>{event.stopPropagation();this.run(()=>this.insert());}},'Insert file…'));
    }else if(kind==='text'){
      const editor=this.editor=el('textarea',{class:'vb-ole-text','aria-label':control.model.name+' document',spellcheck:false});this.body.append(editor);
      editor.addEventListener('input',()=>{if(generation===this.viewGeneration&&this.interactive&&this.document.active)this.run(()=>{this.document.text=editor.value;});});
    }else if(kind==='rtf'){
      this.editor=el('div',{class:'vb-ole-rich vb-rich-input',tabindex:0,'aria-label':control.model.name+' rich document'});this.body.append(this.editor);
      const rich=this.rich=new RichTextController(this.editor,{rtf:this.document.rtf,readOnly:true,onChange:()=>{if(generation===this.viewGeneration&&!this.synchronizing&&this.interactive&&this.document.active)this.run(()=>{this.document.rtf=rich.rtf;});}});
    }else if(kind==='image'){
      const image=this.image=el('img',{class:'vb-ole-image',alt:this.document.name,draggable:false});this.body.append(image);
      image.addEventListener('load',()=>{if(generation===this.viewGeneration&&this.image===image&&!this.closed&&!control.disposed&&Number(control.props.SizeMode)===2&&image.naturalWidth>0&&image.naturalHeight>0&&!control.design){control.set('Width',Math.min(30000,Math.max(900,image.naturalWidth*15)));control.set('Height',Math.min(30000,(image.naturalHeight+22)*15));}});
    }else this.body.append(el('span',{class:'vb-ole-package',text:'▤'}),el('span',{class:'vb-ole-package-name',text:this.document.name}));
  }
  refresh(){
    if(this.closed||!this.document)return;const c=this.control,p=c.props,doc=this.document;
    const kind=doc.empty?'empty':Number(p.DisplayType)===1?'icon':doc.kind;
    if(kind!==this.viewKind)this.#replaceView(kind);
    this.caption.textContent=doc.empty?'Document':doc.name;
    this.menuButton.disabled=!this.interactive;c.node.style.background=cssColor(p.BackColor);c.node.style.borderStyle=Number(p.BorderStyle)===0?'none':'';
    c.node.classList.toggle('vb-ole-active',doc.active);c.node.dataset.oleType=String(doc.type);c.node.dataset.oleKind=doc.kind;
    this.body.dataset.sizeMode=String(p.SizeMode??0);
    for(const button of this.body.querySelectorAll('button'))button.disabled=!this.interactive||Number(p.OLETypeAllowed)===0;
    if(this.revision!==doc.revision){
      if(this.editor&&kind==='text'){const text=doc.text.replace(/\r\n/g,'\n');if(this.editor.value!==text)this.editor.value=text;}
      if(this.rich){this.synchronizing=true;try{if(this.rich.rtf!==doc.rtf)this.rich.setRTF(doc.rtf);}finally{this.synchronizing=false;}}
      if(this.image){const source=doc.image;if(this.image.src!==source)this.image.src=source;}
      if(!doc.empty)this.status.textContent=doc.type===0?'Linked: '+doc.source:doc.kind==='package'?'Embedded file — export to open in another application':doc.active?'Editing — Esc to close':'Double-click to edit';
      else this.status.textContent='';
      this.revision=doc.revision;
    }
    const unsupportedRTF=!!this.rich&&this.rich.document.warnings.length>0,readOnly=!this.interactive||!doc.active||unsupportedRTF;
    if(this.editor&&kind==='text')this.editor.readOnly=readOnly;
    if(this.rich){this.rich.readOnly=readOnly;this.editor.contentEditable=String(!readOnly);if(unsupportedRTF)this.status.textContent='Contains unsupported RTF content; original bytes preserved. Set Object.Text to convert to plain content.';}
  }
  dispose(){if(this.closed)return;this.closed=true;this.pendingImport++;this.rich?.dispose();this.rich=null;this.document.dispose();}
}
