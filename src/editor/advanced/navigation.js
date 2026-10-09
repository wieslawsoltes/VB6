import {guardLinkedEditingCancellation} from './monaco-compat.js';
import {fromRange} from './protocol-converters.js';
import {el} from '../../core/core.js';
import {modal} from '../../ide/ui.js';

export const EDITOR_SNIPPETS=Object.freeze([
  {label:'Sub procedure',text:'Private Sub ${1:Name}()\n\t$0\nEnd Sub'},
  {label:'Function',text:'Private Function ${1:Name}() As ${2:Variant}\n\t$0\nEnd Function'},
  {label:'Property Get',text:'Public Property Get ${1:Name}() As ${2:Variant}\n\t${1:Name} = ${3:value}\nEnd Property'},
  {label:'Property Let',text:'Public Property Let ${1:Name}(ByVal value As ${2:Variant})\n\t$0\nEnd Property'},
  {label:'For loop',text:'For ${1:i} = ${2:0} To ${3:10}\n\t$0\nNext ${1:i}'},
  {label:'For Each loop',text:'For Each ${1:item} In ${2:items}\n\t$0\nNext ${1:item}'},
  {label:'If statement',text:'If ${1:condition} Then\n\t$0\nEnd If'},
  {label:'Select Case',text:'Select Case ${1:expression}\n\tCase ${2:value}\n\t\t$0\nEnd Select'},
  {label:'Error handler',text:'On Error GoTo ${1:HandleError}\n$0\nExit Sub\n${1:HandleError}:\n\tMsgBox Err.Description, vbExclamation'},
]);

export async function chooseSnippet(surface) {
  if(surface.readOnly())return;
  const select=el('select',{'aria-label':'Code snippet',size:EDITOR_SNIPPETS.length},...EDITOR_SNIPPETS.map((s,i)=>el('option',{value:String(i)},s.label)));select.value='0';
  const version=surface.record.model.getVersionId();
  if(await modal('Insert VB6 Snippet',{content:select})&&!surface.disposed&&surface.record.model.getVersionId()===version)surface.insertSnippet(EDITOR_SNIPPETS[Number(select.value)].text);
}

/** Inline Peek uses Monaco's public view-zone and editor APIs. The location list
 * is windowed, and previews share project models rather than copying source. */
export class PeekPanel {
  constructor(surface,locations,title) {
    this.surface=surface;this.runtime=surface.runtime;this.origin=surface.view;this.monaco=surface.monaco;this.locations=locations;this.index=0;
    const doc=surface.host.ownerDocument;
    this.root=doc.createElement('section');this.root.className='advanced-peek';this.root.setAttribute('aria-label',title);this.root.setAttribute('role','region');
    this.header=doc.createElement('div');this.header.className='advanced-peek-header';
    this.label=doc.createElement('strong');this.label.textContent=title+' · '+locations.length;this.header.append(this.label);
    const button=(name,fn)=>{const b=doc.createElement('button');b.type='button';b.textContent=name;b.addEventListener('click',fn);return b;};
    this.header.append(button('Previous',()=>this.select(this.index-1)),button('Next',()=>this.select(this.index+1)),button('Open',()=>this.open()),button('Close',()=>this.dispose()));
    const body=doc.createElement('div');body.className='advanced-peek-body';this.list=doc.createElement('div');this.list.className='advanced-peek-locations';this.list.tabIndex=0;this.list.setAttribute('role','listbox');this.list.setAttribute('aria-label','Locations');
    this.rows=doc.createElement('div');this.rows.style.height=(locations.length*26)+'px';this.rows.style.position='relative';this.list.append(this.rows);
    const preview=doc.createElement('div');preview.className='advanced-peek-preview';body.append(this.list,preview);this.root.append(this.header,body);
    // View-zone containers are aria-hidden in Monaco. Use the zone only as a
    // scroll spacer; interactive content is a public overlay widget so its
    // buttons, list and nested editor remain in the accessibility tree.
    this.overlay={getId:()=>surface.runtime.commandId+'.peek',getDomNode:()=>this.root,getPosition:()=>null};
    this.origin.addOverlayWidget(this.overlay);this.root.style.position='absolute';
    this.origin.changeViewZones(accessor=>{this.zone=accessor.addZone({afterLineNumber:this.origin.getPosition().lineNumber,heightInLines:16,domNode:doc.createElement('div'),
      onDomNodeTop:top=>{this.top=top;this.layout();},onComputedHeight:height=>{this.height=height;this.layout();}});});
    this.layoutListener=this.origin.onDidLayoutChange(()=>this.layout());
    this.preview=this.monaco.editor.create(preview,{model:null,theme:'vb6-advanced',readOnly:true,domReadOnly:true,automaticLayout:true,minimap:{enabled:false},lineNumbers:'on',scrollBeyondLastLine:false,fontSize:this.runtime.ide.appearance.editorSize||13,fontFamily:this.runtime.ide.appearance.editorFont||'monospace',codeLens:false,inlayHints:{enabled:'off'},contextmenu:false,editContext:false});
    guardLinkedEditingCancellation(this.preview,error=>this.runtime.report(error));
    this.list.addEventListener('scroll',()=>this.render());
    this.root.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();this.dispose();}else if(e.target===this.list&&['ArrowDown','ArrowUp','Enter'].includes(e.key)){e.preventDefault();if(e.key==='Enter')this.open();else this.select(this.index+(e.key==='ArrowDown'?1:-1));}});
    this.layout();this.select(0);this.list.focus();
  }
  layout(){
    if(this.disposed)return;const info=this.origin.getLayoutInfo(),top=this.top??0,height=this.height??256;
    this.root.style.left=info.contentLeft+'px';this.root.style.top=top+'px';this.root.style.height=height+'px';
    this.root.style.width=Math.max(100,info.width-info.contentLeft-info.verticalScrollbarWidth-info.minimap.minimapWidth)+'px';
    this.root.style.visibility=top+height<0||top>info.height?'hidden':'visible';this.preview?.layout();
  }
  render(){
    const first=Math.max(0,Math.floor(this.list.scrollTop/26)-2),last=Math.min(this.locations.length,first+Math.ceil((this.list.clientHeight||300)/26)+4),doc=this.root.ownerDocument;
    this.rows.replaceChildren();
    for(let i=first;i<last;i++){const item=this.locations[i],row=doc.createElement('button');row.type='button';row.setAttribute('role','option');row.setAttribute('aria-selected',String(i===this.index));row.tabIndex=-1;
      row.style.cssText='position:absolute;left:0;right:0;top:'+i*26+'px;height:26px;';row.textContent=decodeURIComponent(new URL(item.uri).pathname.split('/').pop())+':'+(item.range.start.line+1);row.title=item.uri;
      row.addEventListener('click',()=>this.select(i));row.addEventListener('dblclick',()=>this.open());this.rows.append(row);
    }
  }
  select(index){
    this.index=(index+this.locations.length)%this.locations.length;const item=this.locations[this.index],record=this.runtime.records.get(item.uri);
    if(!record)return;this.preview.setModel(record.model);const range=fromRange(item.range);this.preview.setSelection(range);this.preview.revealRangeInCenter(range);
    const top=this.index*26;if(top<this.list.scrollTop)this.list.scrollTop=top;else if(top+26>this.list.scrollTop+this.list.clientHeight)this.list.scrollTop=top+26-this.list.clientHeight;this.render();
  }
  open(){const item=this.locations[this.index];this.dispose(false);this.runtime.open(item.uri,fromRange(item.range));}
  dispose(focus=true){if(this.disposed)return;this.disposed=true;this.layoutListener?.dispose();this.preview.dispose();this.origin.removeOverlayWidget(this.overlay);if(this.zone)this.origin.changeViewZones(accessor=>accessor.removeZone(this.zone));this.root.remove();if(this.surface.peek===this)this.surface.peek=null;if(focus)this.surface.focus();}
}

export async function navigateLanguageLocation(surface,method,{peek=false,title='Definition',includeDeclaration=true}={}) {
  const {runtime,record}=surface,client=record.client;
  if(!surface.view||client.state!=='ready'||!client.capability(method,client.documents.get(record.uri))){runtime.report(new Error('The connected language server does not provide '+title.toLowerCase()+'.'));return;}
  surface.navigationAbort?.abort();const abort=new AbortController();surface.navigationAbort=abort;
  const position=surface.view.getPosition(),version=record.model.getVersionId();
  try {
    const result=await client.request(method,{textDocument:{uri:record.uri},position:{line:position.lineNumber-1,character:position.column-1},...(method==='textDocument/references'?{context:{includeDeclaration}}:{})},{signal:abort.signal});
    if(surface.disposed||version!==record.model.getVersionId())return;
    const locations=(Array.isArray(result)?result:result?[result]:[]).map(value=>value.targetUri?{uri:value.targetUri,range:value.targetSelectionRange||value.targetRange}:value).filter(value=>runtime.records.has(value.uri));
    if(!locations.length){runtime.report(new Error('No '+title.toLowerCase()+' found in the current project.'));return;}
    surface.peek?.dispose(false);
    if(peek||locations.length>1)surface.peek=new PeekPanel(surface,locations,title);else runtime.open(locations[0].uri,fromRange(locations[0].range));
  }catch(error){if(![-32800,-32801].includes(error.code))runtime.report(error);}
}
