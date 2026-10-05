import {referenceSnapshot} from './reference-metadata.js';
import {EditorIntelligence,wordAt} from './intelligence.js';
import {statementBefore} from './source-context.js';

let sequence=0;
/** Source scope for Immediate/Watch/Evaluate follows the selected stack frame,
 * not whichever editor happens to be visible. No runtime inspection is needed. */
export function expressionScope(ide){
  const frame=ide.runState==='paused'?ide.stack?.[ide.debuggerWindows?.frameIndex??ide.stack.length-1]:null;
  const name=frame?.module||frame?.source,modules=ide.project?.modules||[];
  const module=name?modules.find(m=>m.id===name||m.name.toLowerCase()===name.toLowerCase()):ide.activeModule;
  return module?{project:ide.project,module,line:frame?.line||ide.editor?.cursor().line||1,frame:frame?.procedure||''}:null;
}

/** Small reusable adapter for classic single-line expression editors. Enter
 * commits an open suggestion only; a subsequent Enter reaches the host's
 * explicit Evaluate/Immediate command. Completion never executes expressions. */
export class ExpressionAssistance {
  constructor(input,ide){
    this.input=input;this.ide=ide;this.service=ide.expressionIntelligence||(ide.expressionIntelligence=new EditorIntelligence());
    input.addEventListener('focus',()=>{ide.activeExpressionAssistance=this;});
    input.addEventListener('keydown',e=>this.keydown(e),true);
    input.addEventListener('input',()=>{if(this.composing||this.accepting)return;const caret=input.selectionStart;if(this.list)this.complete(this.mode);else if(ide.appearance.autoListMembers&&/[.=,( \t]$/.test(input.value.slice(0,caret)))this.complete('auto');if(ide.appearance.autoQuickInfo)this.info(false);});
    input.addEventListener('blur',()=>this.close());input.addEventListener('compositionstart',()=>{clearTimeout(this.compositionTimer);this.compositionMode=this.list?this.mode:null;this.composing=true;this.close();});input.addEventListener('compositionend',()=>{
      this.composing=false;const mode=this.compositionMode||(ide.appearance.autoListMembers?'auto':null);this.compositionMode=null;
      this.compositionTimer=setTimeout(()=>{if(this.composing||!input.isConnected||input.ownerDocument.activeElement!==input)return;if(mode)this.complete(mode);if(ide.appearance.autoQuickInfo)this.info(false);},0);
    });
    for(const event of ['select','click','keyup'])input.addEventListener(event,()=>{if(!this.composing&&(!this.list||this.seed===input.value)&&this.caret!==undefined&&this.caret!==input.selectionStart)this.close();});
  }
  validateContext(){
    const c=this.context();
    if((this.list||this.tip)&&(!c||this.project!==c.project||this.state!==this.revision(c)))this.close();
  }
  node(tag,text='',attributes={}){const node=this.input.ownerDocument.createElement(tag);node.textContent=text;for(const [key,value]of Object.entries(attributes))node.setAttribute(key,String(value));return node;}
  context(){
    const scope=expressionScope(this.ide);if(!scope)return null;
    const prefix=this.input.value.match(/^\s*\?\s*/)?.[0].length||0,text=this.input.value.slice(prefix),offset=Math.max(0,this.input.selectionStart-prefix);
    return {...scope,text,offset,prefix};
  }
  revision(context){return JSON.stringify([context.module.id,context.line,context.frame,this.ide.runState,this.service.libraryRevision,context.project.modules.map(m=>[m.id,m.name,m.code,m.form?.controls?.map(c=>[c.name,c.type,c.properties?.Index]),m.attributes,m.form?.menus]),referenceSnapshot(context.project).key,context.project.dataSources,context.project.settings?.conditionalConstants]);}
  place(node){
    const input=this.input,doc=input.ownerDocument,view=doc.defaultView,r=input.getBoundingClientRect();
    Object.assign(node.style,{position:'fixed',zIndex:32000,maxWidth:Math.max(1,view.innerWidth-10)+'px',boxSizing:'border-box',overflowWrap:'anywhere',width:node===this.tip?'max-content':'240px'});
    (input.closest('.ide-dialog')||doc.body).append(node);
    node.style.left='0px';const width=Math.ceil(node.getBoundingClientRect().width);
    node.style.left=Math.max(2,Math.min(view.innerWidth-width-4,r.left))+'px';
    const height=node.offsetHeight||180;node.style.top=Math.max(2,r.bottom+height>view.innerHeight?r.top-height-2:r.bottom+2)+'px';
    this.observer?.disconnect();this.observer=new view.MutationObserver(()=>{if(!input.isConnected||input.ownerDocument!==doc)this.close();});this.observer.observe(doc.body,{childList:true,subtree:true});
  }
  complete(mode='members'){
    const c=this.context();if(!c||this.input.readOnly||this.composing)return;
    const result=this.service.completions(c.project,c.module,c.line,c.text,c.offset,{constants:mode==='constants',contextual:mode==='auto'});
    this.list?.remove();this.list=null;this.items=result.items;this.mode=mode;this.index=0;
    if(!this.items.length){this.closeList();return;}
    this.start=result.start+c.prefix;this.end=result.end+c.prefix;this.seed=this.input.value;this.state=this.revision(c);this.project=c.project;this.caret=this.input.selectionStart;
    this.list=this.node('div','',{class:'completion-list',role:'listbox',id:'vb6-expression-completion-'+(++sequence),'aria-label':result.context==='constants'?'List Constants':'List Members'});this.list.style.height='180px';
    this.list.addEventListener('scroll',()=>this.paint());this.place(this.list);this.paint();
    this.input.setAttribute('aria-controls',this.list.id);this.input.setAttribute('aria-expanded','true');this.input.setAttribute('aria-autocomplete','list');
  }
  paint(){
    if(!this.list)return;const rowHeight=19,first=Math.max(0,Math.floor(this.list.scrollTop/rowHeight)-1),end=Math.min(this.items.length,first+13),spacer=this.node('div','',{'aria-hidden':true});spacer.style.height=this.items.length*rowHeight+'px';this.list.replaceChildren(spacer);
    for(let i=first;i<end;i++){
      const item=this.items[i],row=this.node('div',item.name,{class:'completion-item'+(i===this.index?' selected':''),role:'option',id:this.list.id+'-'+i,'aria-selected':i===this.index,'aria-posinset':i+1,'aria-setsize':this.items.length,title:item.signature||item.name});
      Object.assign(row.style,{position:'absolute',top:i*rowHeight+'px',height:rowHeight+'px',left:0,right:0});row.addEventListener('pointerdown',e=>{e.preventDefault();this.index=i;{for(const r of this.list.querySelectorAll('[role=option]')){const active=r.id===this.list.id+'-'+i;r.classList.toggle('selected',active);r.setAttribute('aria-selected',String(active));}this.input.setAttribute('aria-activedescendant',this.list.id+'-'+i);}});row.addEventListener('dblclick',e=>{e.preventDefault();this.index=i;this.accept();});this.list.append(row);
    }
    this.input.setAttribute('aria-activedescendant',this.list.id+'-'+this.index);
  }
  accept(commit=''){
    const c=this.context(),item=this.items?.[this.index];if(!this.list||!c||!item||this.input.readOnly||this.composing)return;
    if(this.project!==c.project||this.seed!==this.input.value||this.state!==this.revision(c)){this.close();return;}
    let text=item.insertText||item.name;if(this.input.value[this.start]==='['&&!text.startsWith('['))text='['+text+']';
    this.input.setRangeText(text+commit,this.start,this.end,'end');this.close();
    this.accepting=true;
    try{this.input.dispatchEvent(new this.input.ownerDocument.defaultView.Event('input',{bubbles:true}));}finally{this.accepting=false;}
    if(commit){if(this.ide.appearance.autoListMembers)this.complete('auto');if(this.ide.appearance.autoQuickInfo)this.info(false);}
  }
  info(outer=false,quick=false){
    const c=this.context();if(!c||this.composing)return;let value=this.service.parameterInfo(c.project,c.module,c.line,c.text,c.offset,{outer});
    if(!value&&quick&&statementBefore(c.text,c.offset).state==='code')value=this.service.resolve(c.project,c.module,c.line,wordAt(c.text,c.offset).text);
    this.tip?.remove();this.tip=null;if(!value){if(!this.list){this.observer?.disconnect();this.observer=null;}return;}
    const tip=this.tip=this.node('div','',{class:'source-info',role:'tooltip'});this.caret=this.input.selectionStart;this.state=this.revision(c);this.project=c.project;
    if(value.params){tip.append(this.node('span',value.name+'('));(value.displayParams||value.params).forEach((p,i)=>{if(i)tip.append(', ');tip.append(this.node(i===value.active?'strong':'span',/^Optional\s+/i.test(p)?'['+p.replace(/^Optional\s+/i,'')+']':p));});tip.append(')'+(value.type&&value.type!=='Void'?' As '+value.type:''));}else tip.textContent=value.signature||value.name+' As '+value.type;
    this.place(tip);if(this.list){const r=this.list.getBoundingClientRect();tip.style.top=Math.max(2,r.top-tip.offsetHeight-2)+'px';}
  }
  keydown(e){
    if(e.isComposing||this.composing)return;const ctrl=e.ctrlKey||e.metaKey;
    const handled=()=>{e.preventDefault();e.stopImmediatePropagation();};
    if(ctrl&&e.key.toLowerCase()==='j'){handled();this.complete(e.shiftKey?'constants':'members');return;}
    if(ctrl&&e.code==='Space'){handled();this.complete();if(this.items?.length===1)this.accept();return;}
    if(ctrl&&e.key.toLowerCase()==='i'){handled();this.info(e.shiftKey,true);return;}
    if(e.key==='Escape'&&(this.list||this.tip)){handled();this.close();return;}
    if(!this.list||ctrl||e.altKey)return;
    if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(e.key)){
      handled();const count=this.items.length;this.index=e.key==='Home'?0:e.key==='End'?count-1:Math.max(0,Math.min(count-1,this.index+({ArrowUp:-1,ArrowDown:1,PageUp:-9,PageDown:9}[e.key])));
      if(this.index*19<this.list.scrollTop)this.list.scrollTop=this.index*19;else if(this.index*19+19>this.list.scrollTop+180)this.list.scrollTop=this.index*19-161;this.paint();
    }else if(['Tab','Enter','.','(',',',' ',')'].includes(e.key)&&!e.shiftKey){handled();this.accept(['Tab','Enter'].includes(e.key)?'':e.key);}
    else if(['ArrowLeft','ArrowRight'].includes(e.key))this.close();
  }
  closeList(){this.list?.remove();this.list=null;for(const key of ['aria-controls','aria-expanded','aria-autocomplete','aria-activedescendant'])this.input.removeAttribute(key);if(!this.tip){this.observer?.disconnect();this.observer=null;}}
  close(){this.tip?.remove();this.tip=null;this.closeList();this.caret=undefined;}
}
export function attachExpressionAssistance(input,ide){return input.expressionAssistance||(input.expressionAssistance=new ExpressionAssistance(input,ide));}
