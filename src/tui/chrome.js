import {TUI_SURFACE_PIXEL_BUDGET} from './cells.js';
import {formCellMetrics} from './form-space.js';
import {captureTranscript} from './transcript.js';
import {captureTextRuns} from './text-runs.js';
import {CellBuffer,CanvasCellRenderer,TUI_PROFILES} from './cells.js';
import {FrameCellRenderer} from './frame.js';
import {tuiAttribute,commandLabel,fitLabel} from './appearance.js';
import {layoutText} from './text-layout.js';
import {projectionGrid} from './projection.js';
const CONTROL='.vb-control,.vb-form';
const CONTAINER_PARTS='.vb-form-title,.vb-form-menu,.vb-frame-legend,.vb-tab-header';
const SHELL_PARTS='.object-search,.tool-section-label,.tool-list-row,.tool-status,.object-definition,.output-text,.immediate-input-row,.watch-entry,.debug-table tr,.property-object,.ide-dialog-body,.debug-context-bar,.debug-value-header,.debug-value-row,.debug-stack-row,.object-toolbar,.object-search-bar,.object-class-row,.object-member-row,.app-title,.ide-titlebar,.tool-caption,.dock-caption,.document-title,.statusbar,.document-tabs,.dock-tabs,.dock-tabbar,.toolbar,.panel-toolbar,.ide-menubar,.menubar,.dialog-tabs,.ide-dialog-title,.ide-dialog-footer,.dos-function-bar,.property-row,.property-description,.property-tabs,.property-category,.tree-row,.toolbox-tabs,.toolbox-grid,.layout-monitor,.debug-tabs,.debug-toolbar,.watch-row,.locals-row,.stack-row,.option-field,.options-group>legend,.ide-dialog-content>p';
const PORTAL_PARTS='.vb-tui-picker,.classic-menu,.vb-combo-popup,.vb-dialog-actions,.vb-dialog-message';
const SOURCE_PARTS='.syntax-layer,.code-gutter,.code-selectors,.code-view-buttons,.xaml-highlight,.xaml-gutter,.xaml-toolbar,.xaml-note';
const OUTLINES='.vb-form,.vb-frame,.vb-picture,.vb-tabs,.vb-sstab,.dock-group,.mdi-window,.ide-dialog,.vb-dialog';
const IGNORE='svg,canvas,script,style,[aria-hidden=true],.icon,.vb-tui-surface,.vb-tui-chrome-surface';
const title=node=>node.matches('.vb-form-title,.app-title,.ide-titlebar,.tool-caption,.dock-caption,.document-title,.ide-dialog-title');
const restore=(node,key,value)=>value===null?node.removeAttribute(key):node.setAttribute(key,value);
const complex=text=>/[\u0590-\u08ff\u0900-\u0dff\u200c-\u200f\u202a-\u202e\u2066-\u2069]/u.test(text);

function syntaxColor(node) {
  const classes=node.closest('[class*=syn-],[class*=xaml-token-]')?.className||'';
  if(/comment/i.test(classes))return 7;
  if(/string|attributevalue/i.test(classes))return 11;
  if(/keyword|elementname|tagname|\bkw\b/i.test(classes))return 15;
  if(/number|numeric/i.test(classes))return 13;
  return null;
}
function caption(node) {
  const walk=n=>n.nodeType===3?n.textContent.replaceAll('&','&&'):n.nodeType!==1||n.matches(IGNORE)?'':
    n.tagName==='U'?'&'+n.textContent.replaceAll('&','&&'):[...n.childNodes].map(walk).join('');
  return walk(node).trim();
}
function buttonText(node) {
  const action=node.getAttribute('data-caption-action');
  if(action)return ({close:'[■]',minimize:'[_]',maximize:'[↑]',restore:'[↕]'})[action]||'[ ]';
  if(node.matches('.property-edit-button'))return '[…]';
  if(node.matches('.mdi-system-menu'))return '[■]';
  if(node.closest('.tool-caption,.document-title,.app-title,.ide-titlebar,.ide-dialog-title')) {
    const name=node.getAttribute('aria-label')||node.title||'';
    if(/^(?:Hide|Close|Stop)\b/i.test(name))return '[■]';
    if(/^Minimize\b/i.test(name))return '[_]';
    if(/^(?:Maximize|Restore|Toggle maximize)\b/i.test(name))return '[↕]';
    if(node.matches('.browser-detach'))return '[↑]';
  }
  if(node.matches('.debug-expand,.font-expander'))return /collapse/i.test(node.getAttribute('aria-label')||node.title)?'−':'+';
  if(node.matches('.caption-close')||node.closest('.tool-section-label')&&/Hide|Close/.test(node.title||''))return '[■]';
  if(node.matches('.popup-menu-item'))return caption(node.querySelector('.menu-label')||node);
  if(node.closest('.toolbox-grid'))return node.dataset.controlType||node.title||'Pointer';
  if(node.dataset.command||node.closest('.object-toolbar'))return commandLabel(node.dataset.command,node.getAttribute('aria-label')||node.title||caption(node));
  return caption(node)||node.getAttribute('aria-label')||node.title||node.dataset.controlType||'';
}

export function captureChrome(node,columns,rows,settings) {
  if(node.matches('.object-definition,.output-text'))return captureTranscript(node,columns,rows,settings);
  const source=node.matches('.syntax-layer,.xaml-highlight,.code-gutter,.xaml-gutter'),content=node.matches('.ide-dialog-body');
  const grid=projectionGrid(node,columns,rows,settings),items=[],covered=new Set(),holes=[],textBudget={remaining:24000};
  if(content)for(const island of node.querySelectorAll('.ide-theme-preview,.application-theme-preview,iframe,object,embed,[data-vb-native-render]')){
    if(island.getClientRects().length&&!island.closest('[hidden]'))holes.push(grid.project(island.getBoundingClientRect()));covered.add(island);
  }
  if(content)for(const box of node.querySelectorAll('fieldset')){
    if(box.getClientRects().length&&!box.closest('[hidden]'))items.push({...grid.project(box.getBoundingClientRect()),kind:'outline',text:'',background:true});
  }
  const selectedNode=node.matches('.tree-row.selected,.tree-row.active,.property-row:focus-within,.debug-value-row.selected,.debug-stack-row.selected,.tool-list-row.selected');
  const append=(element,text,kind='text',extra={})=>{
    if(!element.getClientRects().length||element.closest('[hidden]'))return null;
    const rect=element.getBoundingClientRect(),bounds=grid.project(rect);
    // Adjacent unaligned rectangles share a cell if both ends are ceiled. Own
    // only complete cells, leaving a partial remainder to the next hit target.
    if(!source){
      bounds.width=Math.max(1,Math.floor(rect.width/grid.pitchX));bounds.height=Math.max(1,Math.floor(rect.height/grid.pitchY));
      if(rect.height<=grid.pitchY*1.5){bounds.y=Math.floor((rect.top+rect.height/2-grid.y)/grid.pitchY);bounds.height=1;}
    }
    if(bounds.width<1||bounds.height<1)return null;
    const item={...bounds,text,kind,disabled:!!element.disabled||element.getAttribute('aria-disabled')==='true',
      selected:selectedNode||element.matches('.selected,.active,.menu-selected,.menu-open,[aria-selected=true]')||element.contains(node.ownerDocument.activeElement),pressed:element.matches(':active'),
      checked:element.getAttribute('aria-checked')==='true',submenu:kind==='menu'&&element.getAttribute('aria-haspopup')==='menu',
      shortcut:element.querySelector('.menu-shortcut')?.textContent||'',...extra};
    items.push(item);covered.add(element);return item;
  };
  for(const button of node.querySelectorAll('button,[role=option],.menu-separator')) {
    if(button.closest(CONTROL)!==node.closest(CONTROL)||button.closest('.vb-tui-chrome-surface,.ide-theme-preview,.application-theme-preview'))continue;
    let kind=button.matches('.menu-separator')?'separator':button.matches('.popup-menu-item')?'menu':button.matches('[role=option]')?'option':'button';
    if(node.matches('.toolbox-grid'))kind='tool';
    if(node.matches('.menubar,.ide-menubar,.vb-form-menu'))kind='menubar';
    if(node.matches('.dos-function-bar'))kind='function';
    if(title(node))kind='captionButton';
    const key=button.querySelector('kbd')?.textContent||'';
    const text=kind==='function'?Array.from(button.childNodes).filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim():buttonText(button);
    append(button,text,kind,{key});
  }
  for(const row of node.querySelectorAll('.gutter-line')) {
    append(row,row.classList.contains('has-execution')?'►':row.classList.contains('has-breakpoint')?'•':row.classList.contains('has-bookmark')?'♦':row.classList.contains('has-error')?'!':row.textContent,'text',
      {syntax:row.classList.contains('has-breakpoint')||row.classList.contains('has-error')?12:14,mnemonics:false});
  }
  for(const field of [...(node.matches('input,textarea,select')?[node]:[]),...node.querySelectorAll('input,textarea,select')]) {
    if(field.type==='hidden'||field.closest(CONTROL)!==node.closest(CONTROL)||field.closest('.ide-theme-preview,.application-theme-preview'))continue;
    const text=field.tagName==='SELECT'?field.selectedOptions?.[0]?.textContent||'':field.value||'';
    const editing=node.ownerDocument.activeElement===field&&settings.editing!=='native'&&
      ['INPUT','TEXTAREA'].includes(field.tagName)&&['text','search','password','email','url','tel','number',''].includes(field.type||'')&&!complex(text);
    append(field,text,'field',{password:field.type==='password',check:['checkbox','radio'].includes(field.type),radio:field.type==='radio',checked:field.checked,
      dropdown:field.tagName==='SELECT',editing,selectionStart:field.selectionStart,selectionEnd:field.selectionEnd,selectionDirection:field.selectionDirection,
      readOnly:field.readOnly,scrollColumn:Math.floor((field.scrollLeft||0)/settings.cellWidth),scrollRow:Math.floor((field.scrollTop||0)/settings.cellHeight)});
  }
  if(node.matches('.layout-monitor')){
    append(node.querySelector('.layout-screen'),'','outline');append(node.querySelector('.layout-mini-form'),'Form','outline',{selected:true});
  }
  const walker=node.ownerDocument.createTreeWalker(node,4);let text;
  while((text=walker.nextNode())) {
    if((!source&&!text.textContent.trim())||text.parentElement.closest(source?'svg,canvas,script,style,.icon':IGNORE))continue;
    if(text.parentElement.closest('[hidden]')||text.parentElement.closest(CONTROL)!==node.closest(CONTROL))continue;
    let skip=false;for(let p=text.parentElement;p&&p!==node;p=p.parentElement)if(covered.has(p)){skip=true;break;}
    if(skip)continue;
    const range=node.ownerDocument.createRange();range.selectNodeContents(text);const rect=range.getBoundingClientRect();
    if(!rect.width||!rect.height)continue;
    if(content){
      const label=text.parentElement.closest('label'),disabled=!!label?.querySelector('input:disabled,select:disabled');
      items.push(...captureTextRuns(text,grid,columns,rows,textBudget).map(run=>({...run,disabled})));continue;
    }
    let bounds=grid.project(rect);
    // Font ink can extend above its line box (notably nested flex spans).
    // The line's center owns the cell, not a negative antialias/ink overhang.
    // Source layers retain their own measured virtual line coordinates.
    if(!source&&rect.height<=grid.pitchY*1.5){bounds.y=Math.floor((rect.top+rect.height/2-grid.y)/grid.pitchY);bounds.height=1;}
    if(title(node)&&text.parentElement.matches('strong,.caption'))bounds=grid.project(text.parentElement.getBoundingClientRect());
    let value=source?text.textContent:text.textContent.trim();
    if(node.matches('.app-title'))value=value.replace('Microsoft Visual Basic','VB6 DOS Studio');
    items.push({...bounds,width:Math.max(bounds.width,Math.min(columns-bounds.x,Array.from(value).length)),text:value,kind:'text',mnemonics:false,
      wrap:!source&&node.matches('.property-description,.vb-dialog-message,.ide-dialog-content>p'),syntax:source?syntaxColor(text.parentElement):null,
      selected:selectedNode||source&&!!text.parentElement.closest('.code-selection,.syntax-selection,.code-execution')});
  }
  for(const item of items)if(item.kind==='text'){
    const obstacle=items.filter(other=>other!==item&&other.kind!=='text'&&other.x>item.x&&other.y<item.y+item.height&&other.y+other.height>item.y).sort((a,b)=>a.x-b.x)[0];
    if(obstacle)item.width=Math.min(item.width,obstacle.x-item.x);
  }
  return {source,content,holes,title:title(node),inactive:!!node.closest('.mdi-window:not(.mdi-active),.vb-inactive'),menu:node.matches('.classic-menu'),
    functionBar:node.matches('.dos-function-bar'),toolbar:node.matches('.toolbar,.panel-toolbar'),property:node.matches('.property-row'),
    frameTitle:node.matches('.tool-caption,.document-title,.ide-dialog-title'),selected:selectedNode,items};
}

export function paintChrome(buffer,state,profile='turbo') {
  const base=tuiAttribute(profile,state.source?'editor':state.title?(state.inactive?'inactiveTitle':'title'):state.functionBar?'status':state.selected?'selected':'panel');
  const {foreground:fg,background:bg}=base,selection=tuiAttribute(profile,'selected');
  buffer.fill(0,0,buffer.columns,buffer.rows,' ',fg,bg);
  if(state.frameTitle)buffer.fill(0,0,buffer.columns,1,profile==='commander'?'═':'─',fg,bg);
  if(state.menu&&buffer.rows>2)buffer.frame(0,0,buffer.columns,buffer.rows,{foreground:fg,background:bg,double:profile==='commander'});
  for(const item of state.items) {
    const x=item.x,y=item.y,width=item.width,height=Math.max(1,item.height||1);
    if(![x,y,width,height].every(Number.isSafeInteger)||width<1||height<1)continue;
    const selected=!item.disabled&&(item.selected||item.pressed);
    const a=item.disabled?tuiAttribute(profile,'disabled'):selected?selection:item.kind==='field'&&(!state.property||item.editing)?tuiAttribute(profile,'field'):base;
    const ink=item.syntax??a.foreground,paper=a.background;
    if(item.kind==='separator'){buffer.fill(x,y,width,1,'─',fg,bg);continue;}
    buffer.pushClip(x,y,width,height);
    try{
      const cy=y+(state.toolbar?Math.max(0,Math.floor((height-1)/2)):0);
      if(item.kind==='outline'){
        buffer.fill(x,y,width,height,' ',fg,selected?tuiAttribute(profile,'window').background:bg);
        buffer.frame(x,y,width,height,{foreground:fg,background:paper,title:item.text,double:profile==='commander'});continue;
      }
      if(item.kind==='function'){
        buffer.fill(x,cy,width,1,' ',ink,paper);
        buffer.text(x,cy,item.key,{foreground:item.disabled?ink:a.hotkey,background:paper,width});
        buffer.text(x+item.key.length+1,cy,item.text,{foreground:ink,background:paper,width:Math.max(0,width-item.key.length-1)});continue;
      }
      const text=String(item.text??'');
      if(item.kind==='field'&&item.check){buffer.text(x,y,(item.radio?'(':'[')+(item.checked?'X':' ')+(item.radio?')':']'),{foreground:ink,background:paper,width});continue;}
      if(item.kind==='field'){
        buffer.fill(x,y,width,height,' ',ink,paper);
        const n=Math.max(1,Math.min(256,width-(item.dropdown?1:0)));
        const layout=layoutText(text,{columns:n,rows:Math.min(256,height),focused:item.editing&&!item.disabled,password:item.password,
          selectionStart:item.selectionStart,selectionEnd:item.selectionEnd,selectionDirection:item.selectionDirection,
          scrollColumn:item.scrollColumn||0,scrollRow:item.scrollRow||0,wrap:height>1});
        for(const cell of layout.cells)buffer.put(x+cell.x,y+cell.y,cell.glyph,cell.selected?selection.foreground:ink,cell.selected?selection.background:paper);
        if(layout.caret&&!item.readOnly){const cx=x+layout.caret.x,cy=y+layout.caret.y;
          const i=cy*buffer.columns+cx;if(cx>=0&&cy>=0&&cx<buffer.columns&&cy<buffer.rows)buffer.put(cx,cy,buffer.glyphs[i],paper,ink);}
        if(item.dropdown)buffer.put(x+width-1,y,'▼',ink,paper);continue;
      }
      if(item.wrap){
        buffer.fill(x,y,width,height,' ',ink,paper);
        const layout=layoutText(text,{columns:Math.min(256,width),rows:Math.min(256,Math.max(height,buffer.rows-y)),wrap:true});
        for(const cell of layout.cells)buffer.put(x+cell.x,y+cell.y,cell.glyph,ink,paper);continue;
      }
      if(state.frameTitle&&item.kind==='text'){
        const available=Math.min(width,buffer.columns-x),label=' '+fitLabel(text,Math.max(0,available-2))+' ';
        const center=x+Math.max(0,Math.floor((available-Array.from(label).length)/2));buffer.text(center,cy,label,{foreground:fg,background:bg,width:available});continue;
      }
      buffer.fill(x,y,width,height,' ',ink,paper);
      const button=item.kind==='button'&&width>=4&&!/^\[.*\]$/.test(text);
      const left=item.kind==='menu'?2:button||item.kind==='tool'||item.kind==='menubar'?1:0;
      if(item.kind==='menu')buffer.put(x,cy,item.checked?'√':' ',ink,paper);
      if(button){buffer.put(x,cy,'[',ink,paper);buffer.put(x+width-1,cy,']',ink,paper);}
      const max=Math.max(0,width-left-(button?1:0)-(item.submenu?1:0)),trimmed=fitLabel(text,max,{ellipsis:!state.source});
      buffer.text(x+left,cy,trimmed,{width:max,foreground:ink,background:paper,mnemonics:item.mnemonics!==false,hotkey:a.hotkey});
      if(item.shortcut&&width>item.shortcut.length+text.length+4)buffer.text(x+width-item.shortcut.length-2,cy,item.shortcut,{foreground:ink,background:paper,width:item.shortcut.length});
      if(item.submenu)buffer.put(x+width-1,cy,'►',ink,paper);
    }finally{buffer.popClip();}
  }
  return buffer;
}
/** Character-painted nonclient regions keep their original menus, keyboard
 * handlers, focus targets and hit rectangles. No shell command model is copied. */
export class TuiChromeRenderer {
  constructor(owner){this.owner=owner;this.entries=new Map();this.dirty=new Set();this.metrics={painted:0,fallbacks:0};}
  scan(root) {
    if(!root?.querySelectorAll)return;
    const selectors=[CONTAINER_PARTS,PORTAL_PARTS,this.owner.shell?SHELL_PARTS+','+SOURCE_PARTS:'',OUTLINES].filter(Boolean).join(',');
    const nodes=[...(root.matches?.(selectors)?[root]:[]),...root.querySelectorAll(selectors)];
    for(const node of nodes) {
      if(this.entries.has(node)||!this.owner.owns(node))continue;
      const frame=node.matches(OUTLINES);
      const control=node.closest(CONTROL);
      if(control&&this.owner.registry.capability(control.dataset.type)==='native')continue;

      // Parent regions paint their button/text descendants once, never twice.
      if(!frame&&(nodes.some(parent=>parent!==node&&!parent.matches(OUTLINES)&&parent.contains(node))||[...this.entries].some(([parent,entry])=>!entry.frame&&parent.contains(node))))continue;
      const entry={frame,field:node.matches('input,textarea,select'),source:node.matches('.syntax-layer,.xaml-highlight,.code-gutter,.xaml-gutter'),content:node.matches('.ide-dialog-body'),canvas:null,painter:null,buffer:null,next:null,pixels:0,visible:false,
        attributes:new Map(['data-tui-chrome-target','data-tui-anchor','data-tui-native-edit','data-tui-frame-target','data-tui-source-paint','data-tui-content-target','data-tui-field-target'].map(k=>[k,node.getAttribute(k)]))};
      this.entries.set(node,entry);this.owner.observeSize(node);this.dirty.add(node);
    }
  }
  invalidate(element){for(const node of this.entries.keys())if(!element||node.contains(element)||element.contains?.(node))this.dirty.add(node);}
  configure(){for(const entry of this.entries.values()){this.owner.surfacePixels-=entry.pixels;entry.pixels=0;entry.painter?.dispose();entry.painter=null;entry.buffer=entry.next=null;}this.invalidate();}
  flush(){
    const owner=this.owner;
    for(const node of [...this.dirty]){
      this.dirty.delete(node);const entry=this.entries.get(node);if(!entry)continue;
      if(!node.isConnected||!owner.owns(node)){this.remove(node);continue;}
      try {
        entry.visible=!!node.getClientRects().length&&!node.closest('[hidden]');if(!entry.visible)continue;
        let {cellWidth,cellHeight}=formCellMetrics(node,owner.settings);
        if(entry.source){
          // Reuse the editor's actual line/column pitch. Changing these through
          // CSS alone would desynchronize its virtual input and pointer mapping.
          const style=owner.view.getComputedStyle(node);this.measure||=owner.document.createElement('canvas');
          const context=this.measure.getContext('2d');context.font=style.font;
          cellWidth=context.measureText('M').width+(parseFloat(style.letterSpacing)||0);
          cellHeight=parseFloat(style.lineHeight)||owner.settings.cellHeight;
          if(!Number.isFinite(cellWidth)||cellWidth<1||cellWidth>64||cellHeight<1||cellHeight>128)throw new RangeError('Editor metrics exceed cell budget');
        }
        const width=entry.frame?node.offsetWidth:node.clientWidth,height=entry.frame?node.offsetHeight:node.clientHeight;if(width<=0||height<=0)continue;
        const columns=Math.ceil(width/cellWidth),rows=Math.ceil(height/cellHeight);
        if(columns>256||rows>256)throw new RangeError('Chrome exceeds cell budget');
        if(!entry.canvas){entry.canvas=owner.document.createElement(entry.frame?'div':'canvas');entry.canvas.className='vb-tui-chrome-surface'+(entry.frame?' vb-tui-frame-surface':'');entry.canvas.setAttribute('aria-hidden','true');}
        const host=entry.field?node.offsetParent:node;
        if(!host)continue;
        if(entry.canvas.parentNode!==host)host.append(entry.canvas);
        if(!entry.field&&owner.view.getComputedStyle(node).position==='static')node.setAttribute('data-tui-anchor','');
        entry.canvas.style.setProperty('--tui-frame-left',-node.clientLeft+'px');entry.canvas.style.setProperty('--tui-frame-top',-node.clientTop+'px');
        entry.canvas.style.setProperty('--tui-scroll-x',(entry.field?node.offsetLeft:node.scrollLeft)+'px');entry.canvas.style.setProperty('--tui-scroll-y',(entry.field?node.offsetTop:node.scrollTop)+'px');
        entry.canvas.style.width=width+'px';entry.canvas.style.height=height+'px';
        entry.canvas.style.clipPath='inset(0px)';
        const rasterWidth=entry.frame||entry.source?cellWidth:owner.settings.cellWidth,rasterHeight=entry.frame||entry.source?cellHeight:owner.settings.cellHeight;
        if(entry.painter&&(entry.painter.cellWidth!==rasterWidth||entry.painter.cellHeight!==rasterHeight)){entry.painter.dispose();entry.painter=null;}
        entry.painter||=new (entry.frame?FrameCellRenderer:CanvasCellRenderer)(entry.canvas,{cellWidth:rasterWidth,cellHeight:rasterHeight,atlas:owner.atlas,opaque:!entry.frame});
        entry.painter.setExtent(width/cellWidth*rasterWidth,height/cellHeight*rasterHeight);
        const size=entry.painter.dimensions({columns,rows},owner.view.devicePixelRatio),pixels=size.pixels??size.width*size.height;
        if(owner.surfacePixels-entry.pixels+pixels>TUI_SURFACE_PIXEL_BUDGET)throw new RangeError('Chrome exceeds surface budget');
        owner.surfacePixels+=pixels-entry.pixels;entry.pixels=pixels;
        if(!entry.buffer||entry.buffer.columns!==columns||entry.buffer.rows!==rows){entry.buffer=new CellBuffer(columns,rows);entry.next=entry.frame?entry.buffer:new CellBuffer(columns,rows);}
        if(entry.frame){const p=tuiAttribute(owner.settings.profile,node.matches('.mdi-window,.vb-form')?'window':'border');entry.next.frame(0,0,columns,rows,{foreground:p.foreground,background:p.background,double:owner.settings.profile==='commander'});}
        else {entry.state=captureChrome(node,columns,rows,{...owner.settings,cellWidth,cellHeight});paintChrome(entry.next,entry.state,owner.settings.profile);}
        if(entry.content){
          const holes=JSON.stringify(entry.state?.holes||[]);
          if(entry.holes!==holes&&entry.holes)entry.buffer.invalidate();
          entry.holes=holes;
        }
        if(!entry.frame)entry.buffer.blit(entry.next,0,0);entry.painter.render(entry.buffer,owner.view.devicePixelRatio);
        if(entry.content)for(const hole of entry.state?.holes||[]){const dpr=owner.view.devicePixelRatio||1;entry.painter.context.clearRect(hole.x*cellWidth*dpr,hole.y*cellHeight*dpr,hole.width*cellWidth*dpr,hole.height*cellHeight*dpr);}
        node.toggleAttribute('data-tui-source-paint',entry.source);node.toggleAttribute('data-tui-content-target',entry.content);
        node.setAttribute(entry.frame?'data-tui-frame-target':entry.field?'data-tui-field-target':'data-tui-chrome-target','');
        if(entry.field)entry.canvas.style.visibility=node===owner.document.activeElement?'hidden':'';
        if(!entry.frame)node.toggleAttribute('data-tui-native-edit',!entry.content&&node.contains(owner.document.activeElement)&&owner.document.activeElement.matches('input,textarea,select,[contenteditable]')&&(owner.settings.editing==='native'||owner.composing.has(owner.document.activeElement)||owner.document.activeElement.matches('select,[contenteditable],input[type=date],input[type=color]')||complex(owner.document.activeElement.value||'')));
        entry.fallback=null;this.metrics.painted++;
      }catch(error){
        if(entry.fallback!==error.message){this.metrics.fallbacks++;if(!/budget/.test(error.message))owner.onError(error,node);}
        entry.fallback=error.message;owner.surfacePixels-=entry.pixels;entry.pixels=0;entry.painter?.dispose();entry.canvas?.remove();entry.painter=entry.canvas=entry.buffer=entry.next=null;
        for(const[k,v]of entry.attributes)restore(node,k,v);
      }
    }
  }
  remove(node){const entry=this.entries.get(node);if(!entry)return;this.owner.surfacePixels-=entry.pixels;entry.painter?.dispose();entry.canvas?.remove();for(const[k,v]of entry.attributes)restore(node,k,v);this.owner.unobserveSize(node);this.entries.delete(node);this.dirty.delete(node);}
  dispose(){for(const node of [...this.entries.keys()])this.remove(node);if(this.measure)this.measure.width=this.measure.height=1;this.measure=null;}
}
