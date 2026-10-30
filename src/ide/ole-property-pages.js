/** Transactional authoring for portable OLE documents. The draft owns its bytes;
 * cancel, stale selections and delayed file reads cannot mutate a project.
 */
import {el} from '../core/core.js';
import {OleDocument,OLE_CLASSES,OLE_DOCUMENT_LIMIT} from '../controls/ole-document.js';
import {VirtualFileSystem} from '../runtime/filesystem.js';
import {modal} from './ui.js';

export async function olePropertyPages(ide,control){
  const project=ide.project,module=ide.activeModule,before=JSON.stringify(module.form),selected=ide.designer.selected().map(c=>c.id).join('\n');
  const draft=new OleDocument({fs:new VirtualFileSystem(project.vfs),assets:project.assets,allow:control.properties.OLETypeAllowed??2});
  const source=el('input',{'aria-label':'OLE source document',value:control.properties.SourceDoc||''});
  const kind=el('select',{'aria-label':'OLE source mode'},el('option',{value:1},'Embed a copy'),el('option',{value:0},'Link to application disk'));
  const size=el('select',{'aria-label':'OLE size mode'},...['Clip','Stretch','Auto size','Zoom'].map((text,value)=>el('option',{value},text)));size.value=String(control.properties.SizeMode??0);
  const activation=el('select',{'aria-label':'OLE activation'},...['Manual','On focus','Double-click','Automatic'].map((text,value)=>el('option',{value},text)));activation.value=String(control.properties.AutoActivate??2);
  const status=el('p',{role:'status','aria-label':'OLE document status'}),preview=el('textarea',{'aria-label':'OLE document preview',style:{width:'100%',height:'200px',boxSizing:'border-box'},spellcheck:false});
  let accepted=false,closed=false,request=0;
  const render=()=>{kind.value=String(draft.empty?1:draft.type);source.value=draft.source;preview.readOnly=draft.kind!=='text';preview.value=draft.empty?'':draft.kind==='text'||draft.kind==='rtf'?draft.text:('Embedded '+draft.kind+': '+draft.name);status.textContent=draft.empty?'No object':draft.className+' — '+draft.name+(draft.kind==='rtf'?' — formatting is preserved; edit rich text at run time.':'');};
  const run=action=>{try{action();render();}catch(error){status.textContent=error.message;}};
  const upload=el('input',{type:'file','aria-label':'Insert OLE document file'});
  upload.addEventListener('change',async()=>{
    const id=++request,revision=draft.revision,file=upload.files?.[0];if(!file)return;
    try{if(file.size>OLE_DOCUMENT_LIMIT)throw new Error('Document exceeds 8 MiB.');const bytes=new Uint8Array(await file.arrayBuffer());if(closed||id!==request||revision!==draft.revision)return;run(()=>draft.importBytes(file.name,bytes));}catch(error){if(!closed)status.textContent=error.message;}
  });
  preview.addEventListener('input',()=>{if(!preview.readOnly)try{draft.text=preview.value;}catch(error){status.textContent=error.message;}});
  const button=(text,action)=>el('button',{type:'button',onclick:()=>run(action)},text);
  const content=el('div',{},el('p',{},'Embed text, RTF, raster images or a file package. Source paths are resolved inside the application disk or project assets. Native COM/Office servers are not executed.'),
    el('div',{class:'dialog-grid'},el('label',{},'Source:'),source,el('label',{},'Mode:'),kind,el('label',{},'Image size:'),size,el('label',{},'Activation:'),activation),
    el('div',{class:'designer-collection-actions'},button('Load source',()=>draft[Number(kind.value)===0?'createLink':'createEmbed'](source.value)),button('New text',()=>draft.createEmbed('',OLE_CLASSES.text)),button('New rich text',()=>draft.createEmbed('',OLE_CLASSES.rtf)),button('Clear object',()=>draft.delete())),
    el('label',{},'Import a local file: ',upload),status,preview);
  try{
    if(control.properties.OLEDocument)draft.restore(control.properties.OLEDocument);
    else if(control.properties.SourceDoc)run(()=>draft[Number(control.properties.OLETypeAllowed)===0?'createLink':'createEmbed'](control.properties.SourceDoc,control.properties.Class||''));
    render();
    await modal('OLE Document - '+control.name,{width:640,content,buttons:[{label:'OK',value:true,primary:true,action:()=>{
      if(ide.runState!=='design'||ide.designer.locked||ide.project!==project||ide.activeModule!==module||JSON.stringify(module.form)!==before||ide.designer.selected().map(c=>c.id).join('\n')!==selected)throw new Error('The form or selection changed while the document editor was open. Reopen it before applying.');
      accepted=true;
    }},{label:'Cancel',value:false}]});
    if(accepted){const form=structuredClone(module.form),owner=form.controls.find(c=>c.id===control.id);Object.assign(owner.properties,{OLEDocument:draft.snapshot(),Class:draft.className,SourceDoc:draft.source,SizeMode:Number(size.value),AutoActivate:Number(activation.value)});ide.designer.transaction('Edit OLE document',()=>{module.form=form;});ide.designer.render();}
  }finally{closed=true;request++;draft.dispose();}
  return accepted;
}
