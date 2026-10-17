import {TUI_SURFACE_PIXEL_BUDGET} from './cells.js';
import {paintRichText} from './rich-text.js';
import {TuiPickers} from './pickers.js';
import {TuiTextViews} from './text-view.js';
import {TuiFormSpace,formCellMetrics} from './form-space.js';
import {TuiWorkspaceLayout} from './workspace-layout.js';
import {composeCellLayers} from './screen.js';
import {registerPresentationRoot} from '../rendering/presentation-portals.js';
import {TuiChromeRenderer} from './chrome.js';
import {TuiImageProjector} from './graphics.js';
import {graphicsSurfaceFor} from '../graphics/surface.js';
import {observeRootLifetime} from './lifetime.js';
import {CellBuffer, CanvasCellRenderer, CellGlyphAtlas, TUI_PROFILES, normalizeDOSSettings} from './cells.js';
import {TuiControlRegistry} from './controls.js';
import {applyTUIStyle, retainTUIStyle} from './styles.js';
import {observeControlPaint} from '../rendering/invalidation.js';
import {captureControl} from './projection.js';
export {captureControl};

const SELECTOR = '.vb-control,.vb-form';
const owners = new WeakMap();
const roots = new WeakMap();
const surface = node => node.nodeType === 1 && (node.classList.contains('vb-tui-text-view') || node.classList.contains('vb-tui-surface') || node.classList.contains('vb-tui-chrome-surface'));
const restoreAttribute = (node, key, value) => value === null ? node.removeAttribute(key) : node.setAttribute(key, value);

/** Demand-driven, scoped presentation over the existing control tree. Paint
 * invalidation is shared with BrowserControl, not inferred from .value setters.
 * Canvases never receive input, replace controls, or change authored geometry. */
export class DOMTuiRenderer {
  constructor(document, {root = document.documentElement, shell = root === document.documentElement,
    settings = {}, registry = new TuiControlRegistry(), onError = () => {}, onDispose = () => {}} = {}) {
    if (!root || root.ownerDocument !== document || roots.has(root)) throw new Error('TUI root must be an unowned element in its document');
    this.document = document; this.view = document.defaultView; this.root = root;
    this.shell = shell; this.portals = new Map(); this.composing = new WeakSet();
    this.settings = normalizeDOSSettings(settings); this.registry = registry; this.onError = onError; this.onDispose = onDispose;
    this.atlas = new CellGlyphAtlas(document); this.surfacePixels = 0;
    this.resizeOwners = new Map(); this.controls = new Map(); this.dirty = new Set(); this.listeners = [];
    this.frame = 0; this.disposed = false; this.pressed = null;
    this.metrics = {frames: 0, painted: 0, failures: 0, budgetFallbacks: 0};
    this.previous = new Map(['data-vb-dos', 'data-tui-root', 'data-tui-boundary', 'data-tui-shell'].map(key => [key, root.getAttribute(key)]));
    this.previousStyles = ['--dos-line', '--dos-cell-width', '--tui-desktop-pattern'].map(key => [key, root.style.getPropertyValue(key), root.style.getPropertyPriority(key)]);
    roots.set(root, this);
    this.releaseStyle = retainTUIStyle(document);
    root.setAttribute('data-tui-root', ''); root.setAttribute('data-tui-boundary', '');
    if (shell) root.setAttribute('data-tui-shell', '');
    applyTUIStyle(root, this.settings);
    const observed = root === document.documentElement ? document.body : root;
    this.observer = new this.view.MutationObserver(records => this.mutations(records));
    this.resize = typeof this.view.ResizeObserver === 'function'
      ? new this.view.ResizeObserver(entries => { for (const entry of entries) this.invalidate(entry.target); }) : null;
    this.layout = new TuiWorkspaceLayout(this);this.formSpace=new TuiFormSpace(this);
    this.chrome = new TuiChromeRenderer(this);this.textViews=new TuiTextViews(this);this.pickers=new TuiPickers(this);
    this.scan(observed);
    this.listen(document,'vb-text-view-changed',event=>{this.textViews.scan(event.target);this.textViews.invalidate(event.target);this.requestPaint();});
    this.releasePresentation = registerPresentationRoot(root, portal => this.attachPortal(portal));
    this.observer.observe(observed, {subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['style', 'class', 'hidden', 'data-type', 'data-tui-boundary', 'aria-selected', 'aria-valuenow', 'aria-expanded', 'aria-orientation', 'disabled', 'checked', 'value']});
    const invalidate = event => {
      const target=event.type==='selectionchange'?document.activeElement:event.target;
      if(event.type==='selectionchange'){
        // A selection in a read-only transcript need not move DOM focus away
        // from the Immediate input. Invalidate both the old and new range,
        // independently of the focused editor, including selection clearing.
        const selection=document.getSelection(),anchor=selection?.rangeCount?selection.getRangeAt(0).commonAncestorContainer:null;
        const element=anchor?.nodeType===1?anchor:anchor?.parentElement;
        if(this.selectionElement)this.chrome.invalidate(this.selectionElement);if(element)this.chrome.invalidate(element);
        this.selectionElement=selection&&!selection.isCollapsed?element:null;
      }
      if(event.type==='compositionstart')this.composing.add(target);
      if(event.type==='compositionend')this.composing.delete(target);
      const node = target?.closest?.(SELECTOR);
      this.chrome.invalidate(target);this.requestPaint();
      if (node) this.invalidate(node);
      else if (event.type === 'scroll') this.invalidateAll();
      if (event.type === 'pointerdown') this.pressed = node;
      if (['pointerup', 'pointercancel', 'lostpointercapture'].includes(event.type)) {
        this.invalidate(this.pressed); this.pressed = null;
      }
    };
    for (const type of ['input', 'change', 'focusin', 'focusout', 'pointerdown', 'pointerup', 'pointercancel', 'lostpointercapture', 'keydown', 'keyup', 'scroll', 'load', 'select', 'selectionchange', 'compositionstart', 'compositionupdate', 'compositionend']) this.listen(document, type, invalidate, true);
    this.listen(this.view, 'resize', () => this.invalidateAll());
    this.listen(this.view.visualViewport, 'resize', () => this.invalidateAll());
    this.listen(this.view.visualViewport, 'scroll', () => this.invalidateAll());
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) { this.view.cancelAnimationFrame(this.frame); this.frame = 0; }
      else this.invalidateAll();
    });
    this.listen(this.view, 'pagehide', event => { if (!event.persisted) this.dispose(); });
    this.listen(this.view, 'pageshow', () => this.invalidateAll());
    this.listen(document.fonts, 'loadingdone', () => this.invalidateGlyphs());
    this.watchDPR();
    this.releaseLifetime = observeRootLifetime(root, () => this.dispose());
  }
  observeSize(node) {
    const count=this.resizeOwners.get(node)||0;
    if(!count)this.resize?.observe(node);
    this.resizeOwners.set(node,count+1);
  }
  unobserveSize(node) {
    const count=this.resizeOwners.get(node)||0;
    if(count>1)this.resizeOwners.set(node,count-1);
    else{this.resizeOwners.delete(node);this.resize?.unobserve(node);}
  }
  listen(target, type, fn, capture = false) {
    target?.addEventListener(type, fn, capture);
    this.listeners.push(() => target?.removeEventListener(type, fn, capture));
  }
  watchDPR() {
    this.unwatchDPR?.();
    if (!this.view.matchMedia || this.disposed) return;
    const query = this.view.matchMedia(`(resolution: ${this.view.devicePixelRatio || 1}dppx)`);
    const changed = () => { this.invalidateGlyphs(); this.watchDPR(); };
    query.addEventListener('change', changed);
    this.unwatchDPR = () => query.removeEventListener('change', changed);
  }
  owns(node) {
    return !!node && node.ownerDocument === this.document && (this.root.contains(node) || [...this.portals.keys()].some(portal=>portal.contains(node))) &&
      (node.closest('[data-tui-boundary]') === this.root || this.portals.has(node.closest('[data-tui-boundary]')));
  }
  scan(root) {
    if (!root?.querySelectorAll) return;
    this.layout?.scan(root);this.chrome?.scan(root);this.textViews?.scan(root);
    if (root.matches?.(SELECTOR)) this.add(root);
    for (const node of root.querySelectorAll(SELECTOR)) this.add(node);
  }
  add(node) {
    if (this.controls.has(node) || !this.owns(node)) return;
    const capability = this.registry.capability(node.dataset.type);
    if (capability === 'native') return;
    const previousOwner = owners.get(node);
    if (previousOwner && previousOwner !== this) previousOwner.remove(node);
    const entry = {capability, canvas: null, painter: null, buffer: null, next: null, visible: false, pixels: 0, fallback: null,
      host:null, hostMarker:null, projector:null, inputLease:null,
      attributes: new Map(['data-tui-paint', 'data-tui-editing', 'data-tui-chrome', 'data-tui-cell-editor','data-tui-rich-editor'].map(key => [key, node.getAttribute(key)]))};
    owners.set(node, this); this.controls.set(node, entry);
    entry.unsubscribe = observeControlPaint(node, () => this.invalidate(node));
    if (capability === 'container') node.setAttribute('data-tui-chrome', '');
    this.observeSize(node); this.invalidate(node);
  }
  mutations(records) {
    for (const record of records) {
      const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      if (element?.closest?.('.vb-tui-surface,.vb-tui-chrome-surface,.vb-tui-text-view')) continue;
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(surface)) continue;
      this.formSpace.configure();this.layout.invalidate(element);this.chrome.invalidate(element);this.textViews.invalidate(element);
      const node = element?.closest?.(SELECTOR);
      if (record.attributeName === 'data-type' && node) { this.remove(node); this.add(node); }
      if (node) this.invalidate(node);
      if (record.type === 'childList') {
        for (const added of record.addedNodes) if (added.nodeType === 1 && !surface(added)) this.scan(added);
      }
      if (record.type === 'attributes' && element) {
        if (record.attributeName === 'data-tui-boundary') this.scan(element);
        for (const child of element.querySelectorAll?.(SELECTOR) || []) this.invalidate(child);
      }
    }
    // Includes controls adopted into another document and newly nested hosts.
    for (const node of this.controls.keys()) if (!node.isConnected || !this.owns(node)) this.remove(node);
    for (const node of this.chrome.entries.keys()) if (!node.isConnected || !this.owns(node)) this.chrome.remove(node);
    this.requestPaint();
  }
  requestPaint() {
    if(!this.disposed&&!this.frame&&!this.document.hidden&&(this.dirty.size||this.chrome?.dirty.size||this.textViews?.dirty.size||this.layout?.dirty||this.formSpace?.dirty))
      this.frame=this.view.requestAnimationFrame(()=>this.flush());
  }
  invalidate(node) {
    if(this.disposed)return;
    if(this.controls.has(node))this.dirty.add(node);
    this.formSpace?.configure();this.layout?.invalidate(node);this.chrome?.invalidate(node);this.textViews?.invalidate(node);this.requestPaint();
  }
  invalidateAll() {
    if(this.disposed)return;
    for(const node of this.controls.keys())this.dirty.add(node);
    this.layout?.configure();this.formSpace?.configure();this.chrome.invalidate();this.textViews.configure();this.requestPaint();
  }
  attachPortal(portal) {
    if(this.disposed||portal.ownerDocument!==this.document)return ()=>{};
    const previous=new Map(['data-tui-root','data-tui-boundary','data-vb-dos'].map(k=>[k,portal.getAttribute(k)]));
    const styles=['--dos-line','--dos-cell-width','--tui-desktop-pattern'].map(k=>[k,portal.style.getPropertyValue(k),portal.style.getPropertyPriority(k)]);
    const entry={};this.portals.set(portal,entry);portal.setAttribute('data-tui-boundary','');portal.setAttribute('data-tui-root','');
    applyTUIStyle(portal,this.settings);
    this.scan(portal);
    entry.observer=new this.view.MutationObserver(records=>this.mutations(records));
    entry.observer.observe(portal,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','aria-selected','aria-expanded','aria-checked','disabled']});
    let disposed=false;
    const off=()=>{
      if(disposed)return;disposed=true;entry.observer.disconnect();entry.releaseLifetime?.();entry.releaseRoot?.();
      for(const node of this.chrome.entries.keys())if(portal.contains(node))this.chrome.remove(node);
      for(const node of this.controls.keys())if(portal.contains(node))this.remove(node);
      this.portals.delete(portal);
      for(const[k,v]of previous)restoreAttribute(portal,k,v);
      for(const[k,v,priority]of styles)if(v)portal.style.setProperty(k,v,priority);else portal.style.removeProperty(k);
    };
    entry.off=off;entry.releaseLifetime=observeRootLifetime(portal,off);
    entry.releaseRoot=registerPresentationRoot(portal,child=>this.attachPortal(child));
    this.requestPaint();return off;
  }
  prepareInput(entry,input) {
    if(entry.inputLease?.input!==input){this.restoreInput(entry);entry.inputLease={input,value:input.style.getPropertyValue('--tui-native-spacing'),priority:input.style.getPropertyPriority('--tui-native-spacing')};}
    const metrics=formCellMetrics(input,this.settings);
    const font=`${Math.round(metrics.cellHeight*.875*100)/100}px monospace`;
    if(entry.inputFont!==font||entry.inputPitch!==metrics.cellWidth){
      this.measureCanvas||=this.document.createElement('canvas');const ctx=this.measureCanvas.getContext('2d');ctx.font=font;
      const spacing=metrics.cellWidth-ctx.measureText('M').width;
      input.style.setProperty('--tui-native-spacing',spacing+'px');entry.inputFont=font;entry.inputPitch=metrics.cellWidth;
    }
  }
  restoreInput(entry) {
    const lease=entry.inputLease;if(!lease)return;
    if(lease.value)lease.input.style.setProperty('--tui-native-spacing',lease.value,lease.priority);else lease.input.style.removeProperty('--tui-native-spacing');
    entry.inputLease=null;entry.inputFont=null;
  }
  invalidateGlyphs() {
    this.atlas.clear();
    for (const entry of [...this.controls.values(),...this.chrome.entries.values()]) entry.buffer?.invalidate();
    this.invalidateAll();
  }
  configure(settings) {
    this.pickers.configure();this.settings = normalizeDOSSettings(settings); applyTUIStyle(this.root, this.settings);
    this.layout.configure();this.formSpace.configure();this.chrome.configure();this.textViews.configure();
    for(const portal of this.portals.keys())applyTUIStyle(portal,this.settings);
    this.atlas.clear(); this.surfacePixels = 0;
    for (const entry of this.controls.values()) {
      entry.painter?.dispose(); entry.painter = null; entry.buffer = null; entry.next = null; entry.pixels = 0;
    }
    this.invalidateAll();
  }
  flush() {
    // Also safe to call synchronously from tests or a screenshot transaction.
    this.view.cancelAnimationFrame(this.frame); this.frame = 0;
    if (this.disposed) return;
    this.metrics.frames++;this.layout.flush();this.formSpace.flush();
    const dirty = [...this.dirty]; this.dirty.clear();
    for (const node of dirty) {
      if (!node.isConnected || !this.owns(node)) { this.remove(node); continue; }
      const entry = this.controls.get(node); if (!entry) continue;
      try {
        entry.visible = !!node.getClientRects().length && !node.closest('[hidden]');
        if (!entry.visible) continue;
        const type=node.dataset.type,host=['Form','MDIForm'].includes(type)?node.querySelector(':scope > .vb-form-content'):node;
        const graphics=host&&graphicsSurfaceFor(host),raster=entry.capability==='raster'||!!graphics;
        if(entry.capability==='container'&&!graphics)continue;
        if(raster&&this.settings.graphics==='native'){this.fallback(node,'native');continue;}
        const width = host.clientWidth, height = host.clientHeight;
        if(entry.host!==host){entry.host=host;entry.hostMarker=host.getAttribute('data-tui-graphics');}

        if (width <= 0 || height <= 0) continue;
        const metrics=formCellMetrics(node,this.settings),{cellWidth,cellHeight}=metrics;
        // Preserve the actual cell pitch. A partial final cell is clipped, never
        // stretched over the control and never used to move the input geometry.
        const columns = Math.max(1, Math.ceil(width / cellWidth));
        const rows = Math.max(1, Math.ceil(height / cellHeight));
        if (columns > 256 || rows > 256) { this.fallback(node, 'budget'); continue; }
        if (!entry.canvas) {
          entry.canvas = this.document.createElement('canvas'); entry.canvas.className = 'vb-tui-surface';
          entry.canvas.setAttribute('aria-hidden', 'true');
        }
        if (entry.canvas.parentNode !== host) host.append(entry.canvas);
        entry.canvas.classList.toggle('vb-tui-graphics-surface',raster&&entry.capability==='container');
        entry.canvas.style.width = width + 'px';
        entry.canvas.style.height = height + 'px';
        entry.canvas.style.clipPath = 'inset(0px)';
        if(entry.painter&&(entry.painter.cellWidth!==this.settings.cellWidth||entry.painter.cellHeight!==this.settings.cellHeight)){entry.painter.dispose();entry.painter=null;}
        if (!entry.painter) entry.painter = new CanvasCellRenderer(entry.canvas, {cellWidth:this.settings.cellWidth, cellHeight:this.settings.cellHeight, atlas: this.atlas});
        entry.painter.setExtent(width/cellWidth*this.settings.cellWidth,height/cellHeight*this.settings.cellHeight);
        const dimensions = entry.painter.dimensions({columns, rows}, this.view.devicePixelRatio);
        const pixels = dimensions.width * dimensions.height;
        if (this.surfacePixels - entry.pixels + pixels > TUI_SURFACE_PIXEL_BUDGET) { this.fallback(node, 'budget'); continue; }
        this.surfacePixels += pixels - entry.pixels; entry.pixels = pixels;
        if (!entry.buffer || entry.buffer.columns !== columns || entry.buffer.rows !== rows) {
          const p = TUI_PROFILES[this.settings.profile];
          entry.buffer = new CellBuffer(columns, rows, p); entry.next = new CellBuffer(columns, rows, p);
        }
        const state=captureControl(node,columns,rows,metrics);
        if(raster){
          const source=graphics?.rasterize()||node.querySelector('img');
          if(!source||source.tagName==='IMG'&&!source.naturalWidth){this.fallback(node,'image-pending');continue;}
          entry.projector||=new TuiImageProjector(this.document);
          entry.projector.paint(entry.next,source,{mode:this.settings.graphics==='braille'?'braille':'blocks',background:TUI_PROFILES[this.settings.profile].background,fit:source.tagName==='IMG'?this.view.getComputedStyle(source).objectFit:'fill',width,height});
          if(entry.capability==='container')host.setAttribute('data-tui-graphics','');
          else node.setAttribute('data-tui-paint','cells');
        }else{
          node.setAttribute('data-tui-paint','cells');
          const input=node.querySelector('input,textarea'),composing=input&&this.composing.has(input);
          const cellEditable=['TextBox','ComboBox'].includes(type)&&!!input&&input.selectionStart!==null&&this.settings.editing!=='native'&&
            !/[\u0590-\u08ff\u200d\u202a-\u202e\u2066-\u2069]/u.test(state.text);
          if(cellEditable)this.prepareInput(entry,input);
          state.cellEditing=cellEditable&&state.focused&&!composing;
          const rich=type==='RichTextBox'&&this.settings.editing!=='native'&&!this.composing.has(node.querySelector('[contenteditable]'))&&!/[\u0590-\u0dff\u200c-\u200f\u202a-\u202e\u2066-\u2069]/u.test(state.text);
          node.toggleAttribute('data-tui-rich-editor',rich);
          if(rich){this.prepareInput(entry,node.querySelector('[contenteditable]'));paintRichText(entry.next,node,metrics);}else {if(!cellEditable)this.restoreInput(entry);this.registry.paint(entry.next,state,this.settings.profile);}
          const editable=!!node.querySelector('input:not([type=checkbox]):not([type=radio]):not([type=range]),textarea,select,[contenteditable]');
          const nativeEditing=editable&&state.focused&&(!cellEditable||composing)&&!rich&&!node.querySelector('select,input[type=date],input[type=color]')&&!node.closest('.designer-form');
          node.toggleAttribute('data-tui-editing',nativeEditing);
          node.toggleAttribute('data-tui-cell-editor',cellEditable);
        }
        entry.buffer.blit(entry.next,0,0);entry.painter.render(entry.buffer,this.view.devicePixelRatio);
        entry.fallback = null; this.metrics.painted++;
      } catch (error) { this.fallback(node, error instanceof RangeError && /budget/.test(error.message) ? 'budget' : error.message || 'paint failure', error); }
    }
    this.chrome.flush();this.textViews.flush();
  }
  fallback(node, reason, error) {
    const entry = this.controls.get(node); if (!entry) return;
    if (entry.fallback !== reason) {
      if (reason === 'budget') this.metrics.budgetFallbacks++;
      else if(error) { this.metrics.failures++; this.onError(error, node); }
    }
    entry.fallback = reason;
    this.surfacePixels -= entry.pixels; entry.pixels = 0;
    entry.painter?.dispose(); entry.canvas?.remove();entry.projector?.dispose();entry.projector=null;this.restoreInput(entry);if(entry.host)restoreAttribute(entry.host,'data-tui-graphics',entry.hostMarker);
    entry.canvas = null; entry.painter = null; entry.buffer = null; entry.next = null;
    for (const [key, value] of entry.attributes) restoreAttribute(node, key, value);
    // Keep the resize/materialization subscriptions: shrinking the control or
    // recovering the rendering context can restore cells on a later frame.
  }
  remove(node) {
    const entry = this.controls.get(node); if (!entry) return;
    this.surfacePixels -= entry.pixels; entry.pixels = 0;
    entry.unsubscribe?.(); entry.painter?.dispose(); entry.canvas?.remove();entry.projector?.dispose();this.restoreInput(entry);
    if(entry.host)restoreAttribute(entry.host,'data-tui-graphics',entry.hostMarker);
    if (owners.get(node) === this) {
      for (const [key, value] of entry.attributes) restoreAttribute(node, key, value);
      owners.delete(node);
    }
    this.unobserveSize(node); this.controls.delete(node); this.dirty.delete(node);
  }
  /** A cell-space capture of owned surfaces, clipped to the current viewport.
   * Opaque foreign controls remain absent rather than exposing another origin. */
  screen() {
    this.flush();const {cellWidth,cellHeight}=this.settings,p=TUI_PROFILES[this.settings.profile];
    const columns=Math.max(1,Math.min(2048,Math.ceil(this.view.innerWidth/cellWidth))),rows=Math.max(1,Math.min(2048,Math.ceil(this.view.innerHeight/cellHeight)));
    const layers=[];
    const add=(node,entry)=>{
      if(!entry.buffer||!entry.visible||!this.owns(node)||!entry.canvas?.isConnected)return;
      const rect=entry.canvas.getBoundingClientRect(),x=Math.floor(rect.left/cellWidth),y=Math.floor(rect.top/cellHeight);
      let left=Math.max(0,rect.left),top=Math.max(0,rect.top),right=Math.min(this.view.innerWidth,rect.right),bottom=Math.min(this.view.innerHeight,rect.bottom);
      for(let parent=entry.canvas.parentElement;parent;parent=parent.parentElement){
        const style=this.view.getComputedStyle(parent),bounds=parent.getBoundingClientRect();
        if(/hidden|clip|scroll|auto/.test(style.overflowX)){left=Math.max(left,bounds.left+parent.clientLeft);right=Math.min(right,bounds.left+parent.clientLeft+parent.clientWidth);}
        if(/hidden|clip|scroll|auto/.test(style.overflowY)){top=Math.max(top,bounds.top+parent.clientTop);bottom=Math.min(bottom,bounds.top+parent.clientTop+parent.clientHeight);}
      }
      const z=[];for(let element=node;element;element=element.parentElement){const value=this.view.getComputedStyle(element).zIndex;if(value!=='auto')z.unshift(Number(value)||0);}
      const painter=entry.painter;
      const extentX=Math.min(entry.buffer.columns*painter.cellWidth,painter.extent?.width??Infinity);
      const extentY=Math.min(entry.buffer.rows*painter.cellHeight,painter.extent?.height??Infinity);
      // A clipped trailing cell does not reduce the pitch of all preceding
      // cells. Use the raster's logical extent, not viewport/grid division.
      const pitchX=rect.width*painter.cellWidth/extentX,pitchY=rect.height*painter.cellHeight/extentY;
      const clipX=Math.ceil((left-rect.left)/pitchX),clipY=Math.ceil((top-rect.top)/pitchY);
      layers.push({node,z,x,y,transparent:entry.frame===true,buffer:entry.buffer,clip:{x:x+clipX,y:y+clipY,width:Math.max(0,Math.floor((right-rect.left)/pitchX)-clipX),height:Math.max(0,Math.floor((bottom-rect.top)/pitchY)-clipY)}});
    };
    for(const[node,entry]of this.controls)add(node,entry);
    for(const[node,entry]of this.chrome.entries)add(node,entry);
    for(const[node,entry]of this.textViews.entries)add(node,entry);
    layers.sort((a,b)=>{for(let n=0;n<Math.max(a.z.length,b.z.length);n++){const delta=(a.z[n]||0)-(b.z[n]||0);if(delta)return delta;}return a.node===b.node?0:a.node.compareDocumentPosition(b.node)&4?-1:1;});
    return composeCellLayers(columns,rows,layers,{foreground:p.foreground,background:p.desktop});
  }
  snapshot() {
    return [...this.controls].filter(([node, entry]) => entry.buffer && entry.visible && this.owns(node))
      .map(([node, entry]) => ({id: node.dataset.controlId, name: node.dataset.control, type: node.dataset.type, ...entry.buffer.snapshot()}));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; this.view.cancelAnimationFrame(this.frame); this.frame = 0;
    this.releasePresentation?.();for(const entry of [...this.portals.values()])entry.off();this.pickers.dispose();this.textViews.dispose();this.chrome.dispose();this.layout.dispose();this.formSpace.dispose();
    this.observer.disconnect(); this.resize?.disconnect(); this.unwatchDPR?.(); this.releaseLifetime?.();
    for (const off of this.listeners) off(); this.listeners = [];
    for (const node of [...this.controls.keys()]) this.remove(node);
    this.dirty.clear(); this.pressed = null;this.selectionElement=null;
    if (roots.get(this.root) === this) {
      roots.delete(this.root);
      for (const [key, value] of this.previous) restoreAttribute(this.root, key, value);
      for (const [key, value, priority] of this.previousStyles) {
        if (value) this.root.style.setProperty(key, value, priority); else this.root.style.removeProperty(key);
      }
    }
    this.atlas.clear(); this.resizeOwners.clear(); if(this.measureCanvas)this.measureCanvas.width=this.measureCanvas.height=1;this.measureCanvas=null; this.releaseStyle(); this.onDispose();
  }
}
