import {displayScale} from '../rendering/coordinate-space.js';
import {designerGridFor} from '../rendering/designer-grid.js';
import {arrangeFormEdit} from '../layout/model.js';
import {layoutEnabled} from '../layout/contract.js';
import {renderDesignerSelection} from './selection.js';
import {Signal, el, clone} from '../core/core.js';
import {uniqueName} from '../project/model.js';
import {BrowserForm} from '../controls/controls.js';
import {GraphicsSurface} from '../graphics/surface.js';
import {ApplicationThemeController} from '../theme/application-appearance.js';
import {activeTab, checkedTab, controlParents, materializeTabPages, tabEntries, tabPagePlan} from '../controls/tab-model.js';
import {addControl, copyControls, deleteControls, designContainer, normalizeSize, pasteControls, resizeAxes, selectionRoots, setTabIndex, tabOrderEligible, visibleDesignerIds} from './control-model.js';
import {designerPropertyValues, editDesignerProperties} from './property-model.js';

export class FormDesigner extends Signal {
  constructor(container, options = {}) {
    super(); this.container = container; this.options = options; this.selection = new Set();
    this.tool = 'Pointer'; this.zoom = 1; this.clipboard = []; this.showTabOrder = false; this.tabOrderIndex = 0;
    this.root = el('div', {class: 'designer-scroll', tabindex: 0, 'aria-label': 'Form designer'});
    this.plane = el('div', {class: 'designer-plane'}); this.root.append(this.plane); container.append(this.root);
    // The root capture phase belongs to optional workspace/auto-layout tools.
    // Handle base gestures on the plane in capture, still before native widgets,
    // so a tool that consumes an event cannot start a second base gesture.
    this.plane.addEventListener('vb-presentation-geometry',()=>{this.refreshGrid();this.scheduleSelection();});
    this.plane.addEventListener('pointerdown', e => this.safely(() => this.pointerDown(e)), true);
    this.root.addEventListener('pointerdown', e => {if (e.target === this.root) this.safely(() => this.pointerDown(e));});
    this.root.addEventListener('keydown', e => this.safely(() => this.keydown(e)));
    this.root.addEventListener('click', e => {if (this.formView?.node.contains(e.target)) {e.preventDefault(); e.stopPropagation();}}, true);
    this.root.addEventListener('dblclick', e => {
      // Pointer capture can retarget the synthesized dblclick to the root.
      // Resolve its hit again after capture ends; a background double-click
      // must open the form event, not an unrelated previously selected control.
      const hit = e.target === this.root ? this.root.ownerDocument.elementFromPoint(e.clientX, e.clientY) : e.target;
      if (!hit || !this.formView?.node.contains(hit)) return;
      e.preventDefault(); e.stopPropagation(); if (hit.closest('[data-designer-tab]')) return;
      const id = hit.closest('[data-control-id]')?.dataset.controlId || hit.closest('[data-selection-id]')?.dataset.selectionId;
      const control = this.module?.form.controls.find(c => c.id === id);
      this.emit('event', {control: control || null});
    }, true);
    this.root.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      const node = e.target.closest('[data-control-id]'), control = this.module?.form.controls.find(c => c.id === node?.dataset.controlId);
      if (control && !this.selection.has(control.id)) this.select([control.id]);
      else if (!control && this.formView?.content.contains(e.target)) this.select([]);
      this.emit('contextmenu', {x: e.clientX, y: e.clientY, event: e});
    }, true);
    this.resizeObserver = new ResizeObserver(() => this.scheduleSelection()); this.resizeObserver.observe(this.root);
  }
  safely(fn) {try {return fn();} catch (error) {this.emit('error', error);}}
  setDocument(module, project) {
    this.cancelGesture?.(); this.module = module; this.project = project; this.settings = project.settings || {};
    (this.themeController ??= new ApplicationThemeController(this.root)).apply(this.settings);
    const ids = new Set(module.form.controls.map(c => c.id)); this.selection = new Set([...this.selection].filter(id => ids.has(id))); this.render();
  }
  render() {
    this.formView?.dispose(); this.grid?.dispose(); this.plane.replaceChildren(); if (!this.module?.form) return;
    this.formView = new BrowserForm(this.module.form, {controlRegistry: this.options.controlRegistry, design: true, anchoring: layoutEnabled(this.project), assets: this.project.assets || {}, backend: this.settings.renderer || 'auto', onBackend: value => this.emit('backend', value)});
    this.formView.node.classList.add('designer-form');
    Object.assign(this.formView.node.style, {left: '8px', top: '8px', zIndex: '1', transform: `scale(${this.zoom})`, transformOrigin: 'top left'}); this.plane.append(this.formView.node);
    this.grid = new GraphicsSurface(this.formView.content, {background: this.module.form.properties.BackColor, backend: this.settings.renderer || 'auto', onBackend: value => this.emit('backend', value)});
    this.refreshGrid(); this.grid.canvas.style.zIndex = '0';
    this.formView.controls.forEach((c, i) => {c.node.style.zIndex = String(i + 1); c.node.style.pointerEvents = 'auto';});
    this.overlay = el('div', {class: 'designer-overlay'}); this.formView.content.append(this.overlay);
    this.formSelection = el('div', {class: 'designer-form-selection'}); this.plane.append(this.formSelection);
    this.formView.titleBar.style.pointerEvents = 'none'; this.formView.menuBar.style.pointerEvents = 'none';
    this.plane.style.minWidth = Number(this.module.form.properties.ClientWidth) / 15 * this.zoom + 30 + 'px';
    this.plane.style.minHeight = (Number(this.module.form.properties.ClientHeight) / 15 + 50) * this.zoom + 'px';
    this.root.classList.toggle('drawing-control', this.tool !== 'Pointer'); this.renderSelection();
  }
  setTool(type) {this.tool = type; this.root.classList.toggle('drawing-control', type !== 'Pointer'); this.emit('tool', type);}
  selected() {return this.module?.form.controls.filter(c => this.selection.has(c.id)) || [];}
  select(ids, {reveal = true} = {}) {
    const requested = Array.isArray(ids) ? ids : ids ? [ids] : [], existing = new Set(this.module.form.controls.map(c => c.id));
    this.selection = new Set(requested.filter(id => existing.has(id))); this.primaryId = [...this.selection].at(-1) || null;
    if (reveal && this.primaryId) this.revealControl(this.primaryId);
    this.renderSelection(); this.emit('selection', {controls: this.selected(), form: this.module.form});
  }
  revealControl(id) {
    const form = this.module.form, plan = tabPagePlan(form), pages = [], seen = new Set();
    for (let control = form.controls.find(c => c.id === id); control && !seen.has(control.id); control = plan.parents.get(control.id)) {
      seen.add(control.id); const binding = plan.bindings.get(control.id);
      if (binding && binding.page !== activeTab(binding.owner)) pages.push(binding);
    }
    if (!pages.length) return;
    this.transaction('Reveal control tab', () => {materializeTabPages(form); for (const {owner, page} of pages.reverse()) owner.properties.Tab = page;}); this.render();
  }
  activateTab(control, page, {focus = false} = {}) {
    page = checkedTab(control, page); this.select([control.id]);
    if (page !== activeTab(control)) {this.transaction('Select SSTab page', () => {materializeTabPages(this.module.form); control.properties.Tab = page;}); this.render();}
    if (focus) this.formView.controls.find(c => c.model.id === control.id)?.tabHeader.querySelector(`[data-designer-tab="${page}"]`)?.focus({preventScroll: true});
  }
  controlRect(control) {
    const view = this.formView.controls.find(v => v.model.id === control.id); if (!view || view.node.closest('[hidden]')) return null;
    const rect = view.node.getBoundingClientRect(), parent = this.formView.content.getBoundingClientRect(), scale=displayScale(this.formView.content,this.zoom);
    return {x: (rect.left - parent.left) / scale.x, y: (rect.top - parent.top) / scale.y, width: rect.width / scale.x, height: rect.height / scale.y};
  }
  containerRect(control) {
    const view = this.formView.controls.find(v => v.model.id === control?.id), host = view?.childHost || this.formView.content;
    const rect = host.getBoundingClientRect(), root = this.formView.content.getBoundingClientRect(), scale=displayScale(this.formView.content,this.zoom);
    return {x: (rect.left - root.left) / scale.x + host.clientLeft, y: (rect.top - root.top) / scale.y + host.clientTop, width: host.clientWidth, height: host.clientHeight};
  }
  renderSelection() {renderDesignerSelection(this);}
  reflow(before, edited = []) {
    if (!layoutEnabled(this.project)) return false;
    const logical = clone(before); materializeTabPages(logical); arrangeFormEdit(logical, this.module.form, edited); this.refreshControlPositions(); return true;
  }
  position(event) {const rect = this.formView.content.getBoundingClientRect(), scale=displayScale(this.formView.content,this.zoom); return {x: (event.clientX - rect.left) / scale.x, y: (event.clientY - rect.top) / scale.y};}
  refreshGrid() {
    if (!this.grid || this.grid.disposed) return;
    const metrics = designerGridFor(this.formView?.node), spacing = (this.settings.gridSize || 120) / 15;
    this.grid.setGrid(this.settings.showGrid === false ? 0 : metrics?.columnWidth || spacing,
      this.settings.showGrid === false ? 0 : metrics?.rowHeight || spacing);
  }
  gridStep(axis = 'x', fine = false) {
    if (fine) return 15;
    const metrics = designerGridFor(this.formView?.node);
    return metrics ? (axis === 'y' ? metrics.rowHeight : metrics.columnWidth) * 15 : Number(this.settings.gridSize) || 120;
  }
  snap(value, axis = 'x') {
    const grid = this.gridStep(axis, this.settings.snapToGrid === false), snapped = Math.round(value / grid) * grid;
    return designerGridFor(this.formView?.node) ? Math.round(snapped) : snapped;
  }
  nudge(value, direction, axis = 'x', fine = false) {
    if (!direction) return value;
    const step = this.gridStep(axis, fine);
    // Quantize from the lattice index on every cell move. Rounding a fractional
    // twip delta repeatedly would accumulate drift under readable-form scaling.
    return !fine && designerGridFor(this.formView?.node) ? Math.round((Math.round(value / step) + direction) * step) : value + direction * step;
  }
  transaction(label, fn) {
    const before = clone(this.module.form);
    try {
      fn();
      if (JSON.stringify(before) === JSON.stringify(this.module.form)) return false;
      if (layoutEnabled(this.project)) {
        const logical = clone(before); materializeTabPages(logical); const old = new Map(logical.controls.map(c => [c.id, c]));
        const edited = this.module.form.controls.filter(c => {const b = old.get(c.id); return !b || ['Left', 'Top', 'Width', 'Height', 'Anchor', 'Dock'].some(k => b.properties[k] !== c.properties[k]);}).map(c => c.id);
        this.reflow(before, edited);
      }
    } catch (error) {this.module.form = before; this.render(); throw error;}
    this.emit('change', {label, before, after: clone(this.module.form)}); this.renderSelection(); this.emit('selection', {controls: this.selected(), form: this.module.form}); return true;
  }
  pointerDown(event) {
    if (event.button !== 0 || !this.module?.form) return;
    const content = this.formView.content;
    if (!this.formView.node.contains(event.target) && !event.target.closest('[data-resize-form]')) {if (this.tool === 'Pointer') this.select([]); return;}
    event.preventDefault(); event.stopPropagation(); this.root.focus({preventScroll: true});
    const marker = event.target.closest('[data-order-id]');
    if (marker) {
      const c = this.module.form.controls.find(c => c.id === marker.dataset.orderId), count = this.module.form.controls.filter(tabOrderEligible).length;
      if (c && count) this.transaction('Set tab order', () => {setTabIndex(this.module.form, [c], this.tabOrderIndex % count); this.tabOrderIndex = (this.tabOrderIndex + 1) % count;}); return;
    }
    const point = this.position(event), target = event.target.closest('[data-control-id]'), control = this.module.form.controls.find(c => c.id === target?.dataset.controlId);
    const tab = event.target.closest('[data-designer-tab]'), handle = event.target.closest('[data-handle]'), formHandle = event.target.closest('[data-resize-form]');
    if (tab && control?.type === 'SSTab' && this.tool === 'Pointer') {this.activateTab(control, Number(tab.dataset.designerTab)); return;}
    if (!content.contains(event.target) && !formHandle) {this.select([]); return;}
    const before = clone(this.module.form), plan = tabPagePlan(this.module.form); let mode, origin, ghost, parent = null;
    const origins = () => selectionRoots(this.module.form, this.selected()).map(c => {const p = designerPropertyValues(c, this.module.form, plan); return {c, left: p.Left, top: p.Top, width: p.Width, height: p.Height};});
    if (formHandle) {if (this.locked) return; mode = 'formResize'; origin = {w: this.module.form.properties.ClientWidth, h: this.module.form.properties.ClientHeight};}
    else if (this.tool !== 'Pointer') {
      mode = 'draw'; ghost = el('div', {class: 'designer-rubberband'}); this.overlay.append(ghost);
      const parents = controlParents(this.module.form); const seen = new Set();
      for (let c = control; c && !seen.has(c.id); c = parents.get(c.id)) {seen.add(c.id); if (designContainer(c)) {parent = c; break;}}
    } else if (handle) {if (this.locked) return; mode = 'resize'; origin = origins().filter(({c}) => {const axes = resizeAxes(c); return axes.x || axes.y;}); if (!origin.length) return;}
    else if (control) {
      if (event.ctrlKey || event.metaKey || event.shiftKey) {const next = new Set(this.selection); next.has(control.id) ? next.delete(control.id) : next.add(control.id); this.select([...next]);}
      else if (!this.selection.has(control.id)) this.select([control.id]);
      if (this.locked || !this.selection.size) return; mode = 'move'; origin = origins();
    } else {mode = 'rubber'; if (!event.shiftKey) this.select([]); ghost = el('div', {class: 'designer-rubberband'}); this.overlay.append(ghost);}
    let moved = false, materialized = false; this.root.setPointerCapture(event.pointerId);
    const cleanup = () => {
      this.root.removeEventListener('pointermove', move); this.root.removeEventListener('pointerup', up); this.root.removeEventListener('pointercancel', cancel); this.root.removeEventListener('lostpointercapture', cancel);
      this.cancelGesture = null; if (this.root.hasPointerCapture(event.pointerId)) this.root.releasePointerCapture(event.pointerId); ghost?.remove();
    };
    const cancel = () => {cleanup(); this.module.form = before; this.render();}; this.cancelGesture = cancel;
    const move = e => {
      if (e.pointerId !== event.pointerId) return;
      this.safely(() => {
        const now = this.position(e), dx = (now.x - point.x) * 15, dy = (now.y - point.y) * 15;
        if (Math.abs(dx) + Math.abs(dy) > 30) moved = true;
        if (!moved) return;
        if (!materialized && mode !== 'rubber' && mode !== 'draw') {try {materializeTabPages(this.module.form); materialized = true;} catch (error) {cancel(); throw error;}}
        if (mode === 'move') {
          for (const item of origin) {item.c.properties.Left = this.snap(item.left + dx); item.c.properties.Top = this.snap(item.top + dy, 'y');}
          this.refreshControlPositions(layoutEnabled(this.project) ? null : origin.map(i => i.c.id));
        }
        if (mode === 'resize') {
          const edge = handle.dataset.handle;
          for (const item of origin) {
            let {left, top, width, height} = item; const axes = resizeAxes(item.c);
            if (axes.x && edge.includes('e')) width = this.snap(item.width + dx);
            if (axes.y && edge.includes('s')) height = this.snap(item.height + dy, 'y');
            if (axes.x && edge.includes('w')) {width = this.snap(item.width - dx); left = item.left + item.width - Math.max(item.c.type === 'Line' ? 0 : 15, width);}
            if (axes.y && edge.includes('n')) {height = this.snap(item.height - dy, 'y'); top = item.top + item.height - Math.max(item.c.type === 'Line' ? 0 : 15, height);}
            Object.assign(item.c.properties, {Left: left, Top: top}, normalizeSize(item.c, width, height));
          }
          if (!this.reflow(before, origin.map(i => i.c.id))) this.refreshControlPositions(origin.map(i => i.c.id));
        }
        if (mode === 'formResize') {
          const edge = formHandle.dataset.resizeForm;
          if (edge.includes('e')) this.module.form.properties.ClientWidth = Math.max(900, this.snap(origin.w + dx));
          if (edge.includes('s')) this.module.form.properties.ClientHeight = Math.max(600, this.snap(origin.h + dy, 'y'));
          this.reflow(before); this.formView.props.ClientWidth = this.module.form.properties.ClientWidth; this.formView.props.ClientHeight = this.module.form.properties.ClientHeight;
          this.formView.refresh(); this.formView.node.style.left = '8px'; this.formView.node.style.top = '8px'; this.renderSelection();
        }
        if (ghost) Object.assign(ghost.style, {left: Math.min(point.x, now.x) + 'px', top: Math.min(point.y, now.y) + 'px', width: Math.abs(now.x - point.x) + 'px', height: Math.abs(now.y - point.y) + 'px'});
        this.emit('position', {x: Math.round(now.x * 15), y: Math.round(now.y * 15)});
      });
    };
    const up = e => {
      if (e.pointerId !== event.pointerId) return; const end = this.position(e); cleanup();
      this.safely(() => {
        try {
          if (mode === 'draw') {
            const type = this.tool, name = uniqueName(this.project, this.options.controlRegistry?.describe?.(type)?.baseName || type, this.module), rect = this.containerRect(parent);
            const bounds = {Left: this.snap((Math.min(point.x, end.x) - rect.x) * 15), Top: this.snap((Math.min(point.y, end.y) - rect.y) * 15, 'y')};
            if (moved) Object.assign(bounds, {Width: this.snap(Math.abs(end.x - point.x) * 15), Height: this.snap(Math.abs(end.y - point.y) * 15, 'y')});
            const defaults = this.options.controlRegistry?.has?.(type, true) ? this.options.controlRegistry.defaults(type) : {};
            const model = addControl(this.module.form, type, name, bounds, parent, defaults); this.selection = new Set([model.id]); this.primaryId = model.id; this.setTool('Pointer'); this.render();
          }
          if (mode === 'rubber') {
            const left = Math.min(point.x, end.x), top = Math.min(point.y, end.y), right = Math.max(point.x, end.x), bottom = Math.max(point.y, end.y), next = new Set(this.selection);
            for (const c of this.module.form.controls) {const r = this.controlRect(c); if (r && r.x >= left && r.y >= top && r.x + r.width <= right && r.y + r.height <= bottom) next.add(c.id);}
            this.select([...next], {reveal: false});
          }
          if (mode === 'formResize') this.render();
          if (mode !== 'rubber' && JSON.stringify(before) !== JSON.stringify(this.module.form)) this.emit('change', {label: {move: 'Move controls', resize: 'Resize controls', formResize: 'Resize form', draw: 'Add control'}[mode], before, after: clone(this.module.form)});
          this.renderSelection(); this.emit('selection', {controls: this.selected(), form: this.module.form});
        } catch (error) {this.module.form = before; this.render(); throw error;}
      });
    };
    this.root.addEventListener('pointermove', move); this.root.addEventListener('pointerup', up); this.root.addEventListener('pointercancel', cancel); this.root.addEventListener('lostpointercapture', cancel);
  }
  refreshControlPositions(ids = null) {
    const filter = ids === null ? null : new Set(ids), models = new Map(this.module.form.controls.map(c => [c.id, c])), plan = tabPagePlan(this.module.form);
    for (const view of this.formView.controls) {
      if (filter && !filter.has(view.model.id)) continue;
      const model = models.get(view.model.id); if (!model) continue;
      Object.assign(view.props, model.properties); const binding = plan.bindings.get(model.id); if (binding) view.props.Left = binding.left; view.refresh();
    }
    this.renderSelection();
  }
  applyProperty(key, value) {
    this.transaction('Set ' + key, () => {
      const controls = this.selected(), result = editDesignerProperties(this.module.form, controls.map(c => c.id), {[key]: value});
      if (result) this.module.form = result; else for (const c of controls.length ? controls : [this.module.form]) c.properties[key] = value;
    }); this.render();
  }
  deleteSelected() {if (!this.selection.size) return; this.transaction('Delete controls', () => {deleteControls(this.module.form, this.selection); this.selection.clear();}); this.render();}
  copy() {this.clipboard = copyControls(this.module.form, this.selection); this.clipboardSourceFormId = this.module.form.id; this.emit('clipboard', this.clipboard.length);}
  cut() {this.copy(); this.deleteSelected();}
  paste() {
    if (!this.clipboard.length) return;
    this.transaction('Paste controls', () => {
      const selected = this.selected(), target = selected.length === 1 && designContainer(selected[0]) ? selected[0] : null;
      const created = pasteControls(this.module.form, this.clipboard, {sourceFormId: this.clipboardSourceFormId, target});
      this.selection = new Set(selectionRoots(this.module.form, created).map(c => c.id)); this.primaryId = [...this.selection].at(-1);
    }); this.render();
  }
  align(command) {
    if (this.locked) return;
    const controls = selectionRoots(this.module.form, this.selected()), primary = controls.find(c => c.id === this.primaryId) || controls[0]; if (!primary) return;
    const rects = new Map(controls.map(c => [c.id, this.controlRect(c)])), first = rects.get(primary.id); if (!first) return;
    this.transaction(command, () => {
      materializeTabPages(this.module.form);
      if (command === 'front' || command === 'back') {
        const selected = new Set(controls.map(c => c.id)), rest = this.module.form.controls.filter(c => !selected.has(c.id));
        this.module.form.controls = command === 'front' ? [...rest, ...controls] : [...controls, ...rest]; return;
      }
      if (command === 'distributeHorizontal' || command === 'distributeVertical') {
        if (controls.length < 3) return;
        const horizontal = command === 'distributeHorizontal', axis = horizontal ? 'x' : 'y', size = horizontal ? 'width' : 'height', key = horizontal ? 'Left' : 'Top';
        const sorted = [...controls].filter(c => rects.get(c.id)).sort((a, b) => rects.get(a.id)[axis] - rects.get(b.id)[axis]);
        if (sorted.length < 3) return;
        const begin = rects.get(sorted[0].id)[axis], end = rects.get(sorted.at(-1).id), total = sorted.reduce((sum, c) => sum + rects.get(c.id)[size], 0), gap = (end[axis] + end[size] - begin - total) / (sorted.length - 1);
        let position = begin;
        for (const c of sorted) {const rect = rects.get(c.id); c.properties[key] += Math.round((position - rect[axis]) * 15); position += rect[size] + gap;} return;
      }
      for (const c of controls) {
        const p = c.properties, r = rects.get(c.id); if (!r) continue;
        if (command === 'left') p.Left += Math.round((first.x - r.x) * 15);
        if (command === 'right') p.Left += Math.round((first.x + first.width - r.x - r.width) * 15);
        if (command === 'top') p.Top += Math.round((first.y - r.y) * 15);
        if (command === 'bottom') p.Top += Math.round((first.y + first.height - r.y - r.height) * 15);
        if (command === 'centerHorizontal') p.Left += Math.round((first.x + (first.width - r.width) / 2 - r.x) * 15);
        if (command === 'centerVertical') p.Top += Math.round((first.y + (first.height - r.height) / 2 - r.y) * 15);
        if (['sameWidth', 'sameHeight', 'sameSize'].includes(command)) Object.assign(p, normalizeSize(c, command === 'sameHeight' ? p.Width : primary.properties.Width, command === 'sameWidth' ? p.Height : primary.properties.Height));
        if (command === 'centerInForm') {const parent = controlParents(this.module.form).get(c.id), rect = this.containerRect(parent); p.Left = Math.round((rect.width * 15 - p.Width) / 2);}
        if (command === 'snap') {p.Left = this.snap(p.Left); p.Top = this.snap(p.Top, 'y');}
      }
    }); this.render();
  }
  keydown(event) {
    if (!this.module?.form) return;
    const key = event.key, command = event.ctrlKey || event.metaKey, handled = () => {event.preventDefault(); event.stopPropagation();};
    if (key === 'Escape') {handled(); this.cancelGesture?.(); this.setTool('Pointer'); this.showTabOrder = false; this.renderSelection(); return;}
    if (command && (key === 'PageUp' || key === 'PageDown')) {
      const parents = controlParents(this.module.form); let owner = this.selected().at(-1); const seen = new Set();
      while (owner && owner.type !== 'SSTab' && !seen.has(owner.id)) {seen.add(owner.id); owner = parents.get(owner.id);}
      if (owner?.type === 'SSTab') {handled(); const count = tabEntries(owner).length; this.activateTab(owner, (activeTab(owner) + (key === 'PageDown' ? 1 : count - 1)) % count, {focus: true});} return;
    }
    const focusedTab = event.target?.closest?.('[data-designer-tab]');
    if (focusedTab && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key) && !event.shiftKey && !command) {
      const node = focusedTab.closest('[data-control-id]'), owner = this.module.form.controls.find(c => c.id === node.dataset.controlId), count = tabEntries(owner).length;
      handled(); this.activateTab(owner, key === 'Home' ? 0 : key === 'End' ? count - 1 : (activeTab(owner) + (['ArrowRight', 'ArrowDown'].includes(key) ? 1 : count - 1)) % count, {focus: true}); return;
    }
    if (key === 'Tab' && !command && !event.altKey) {
      handled(); const visible = visibleDesignerIds(this.module.form), controls = this.module.form.controls.filter(c => visible.has(c.id));
      if (controls.length) {const index = controls.findIndex(c => c.id === this.primaryId), next = index < 0 ? event.shiftKey ? controls.length - 1 : 0 : (index + (event.shiftKey ? controls.length - 1 : 1)) % controls.length; this.select([controls[next].id]);} return;
    }
    if (key === 'Delete') {handled(); this.deleteSelected(); return;}
    if (command && ['a', 'c', 'x', 'v'].includes(key.toLowerCase())) {
      handled(); const action = key.toLowerCase();
      if (action === 'a') this.select([...visibleDesignerIds(this.module.form)], {reveal: false});
      if (action === 'c') this.copy(); if (action === 'x') this.cut(); if (action === 'v') this.paste(); return;
    }
    const moves = {ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1]};
    if (!moves[key] || !this.selection.size || this.locked) return;
    handled(); const [dx, dy] = moves[key];
    const roots = selectionRoots(this.module.form, this.selected());
    this.transaction(event.shiftKey ? 'Resize controls' : 'Move controls', () => {
      materializeTabPages(this.module.form);
      for (const c of roots) {
        const p = designerPropertyValues(c, this.module.form);
        for (const key of ['Left', 'Top', 'Width', 'Height']) c.properties[key] ??= p[key];
        if (event.shiftKey) Object.assign(c.properties, normalizeSize(c, this.nudge(c.properties.Width, dx, 'x', command), this.nudge(c.properties.Height, dy, 'y', command)));
        else {c.properties.Left = this.nudge(c.properties.Left, dx, 'x', command); c.properties.Top = this.nudge(c.properties.Top, dy, 'y', command);}
      }
    }); if (!layoutEnabled(this.project)) this.refreshControlPositions(roots.map(c => c.id));
  }
  setZoom(zoom) {this.cancelGesture?.(); this.zoom = Math.max(.25, Math.min(2, Number(zoom))); this.render();}
  scheduleSelection() {
    if (this.disposed || this.selectionFrame) return;
    this.selectionWindow = this.root.ownerDocument.defaultView;
    this.selectionFrame = this.selectionWindow.requestAnimationFrame(() => {this.selectionFrame = 0; if (!this.disposed) this.renderSelection();});
  }
  transferDocument() {
    this.selectionWindow?.cancelAnimationFrame(this.selectionFrame); this.selectionFrame = 0;
    this.resizeObserver.disconnect(); const win = this.root.ownerDocument.defaultView;
    this.resizeObserver = new win.ResizeObserver(() => this.scheduleSelection()); this.resizeObserver.observe(this.root); this.scheduleSelection();
  }
  dispose() {
    this.cancelGesture?.(); this.disposed = true; this.selectionWindow?.cancelAnimationFrame(this.selectionFrame); this.selectionFrame = 0;
    this.resizeObserver.disconnect(); this.formView?.dispose(); this.grid?.dispose(); this.themeController?.dispose?.(); this.root.remove();
  }
}
