import {createRenderingStatus} from './settings-status.js';
import {el} from '../core/core.js';
import {DEFAULT_RENDERING, normalizeRendering} from './policy.js';
import {benchmarkRendering} from './benchmark.js';
/** Classic Options tab; nothing changes until the parent dialog validates OK. */
export function createRenderingOptions(ide) {
  const initial = normalizeRendering(ide.rendering?.policy);
  const names = {webgpu: 'WebGPU (default)', webgl2: 'WebGL2', canvas2d: 'Canvas2D', html: 'HTML / CSS'};
  const select = (label, items, value) => {
    const node = el('select', {'aria-label': label}, ...items.map(([key, text]) => el('option', {value: key}, text)));
    node.value = value; return node;
  };
  const backend = select('UI rendering backend', Object.entries(names), initial.backend);
  const fallbacks = [0, 1].map(index => select('Rendering fallback ' + (index + 1), [['', 'None'], ['webgpu', 'WebGPU'], ['webgl2', 'WebGL2'], ['canvas2d', 'Canvas2D']], initial.fallbacks.filter(name => name !== 'html')[index] || ''));
  const text = select('Text rendering', [['native', 'Native text (maximum font fidelity / IME)'], ['gpu', 'GPU atlas for eligible text (experimental)']], initial.text);
  const snap = el('input', {type: 'checkbox', checked: initial.pixelSnap, 'aria-label': 'Snap graphics to device pixels'});
  const exported = el('input', {type: 'checkbox', checked: false, 'aria-label': 'Use these settings in exported applications'});
  const restore = el('button', {type: 'button'}, 'Restore Default Backends');
  restore.addEventListener('click', () => {
    backend.value = DEFAULT_RENDERING.backend;
    fallbacks.forEach((select, i) => { select.value = DEFAULT_RENDERING.fallbacks.filter(name => name !== 'html')[i] || ''; });
    updateAvailability();
  });
  const updateAvailability = () => { for (const input of fallbacks) input.disabled = backend.value === 'html'; };
  backend.addEventListener('change', updateAvailability);
  const useHTML = el('button', {type: 'button'}, 'Use HTML / CSS');
  useHTML.addEventListener('click', () => { backend.value = 'html'; updateAvailability(); });
  updateAvailability();
  const status = createRenderingStatus(ide, names);
  const node = el('div', {},
    el('fieldset', {}, el('legend', {}, 'Rendering'),
      el('div', {class: 'dialog-grid'}, el('label', {}, 'Preferred backend:'), backend,
        el('label', {}, 'First fallback:'), fallbacks[0], el('label', {}, 'Second fallback:'), fallbacks[1],
        el('label', {}, 'Text:'), text),
      el('label', {class: 'option-check'}, snap, 'Snap graphics to device pixels'),
      el('label', {class: 'option-check'}, exported, 'Use these settings in exported applications'),
      restore, useHTML, el('p', {class: 'tool-note'}, 'Default backends are restored in this dialog only. Press OK to apply; Cancel keeps the saved order.')),
    el('p', {class: 'tool-note'}, 'Without usable GPU APIs the default goes directly to HTML / CSS. With browser graphics acceleration disabled, HTML / CSS avoids the additional canvas scene and repaint work. Use HTML / CSS stages that choice until OK; Canvas2D remains available when explicitly selected. GPU mode paints classic UI geometry; native inputs, code editing, SVG icons and unsupported effects remain browser-rendered. Text-atlas mode is experimental. No screenshot rasterization is used.'),
    status.node);
  const output = el('pre', {class:'tool-note', 'aria-live':'polite', style:'white-space:pre-wrap;max-height:150px;overflow:auto'}, 'Measure this browser and adapter without changing the project or renderer preference.');
  const measure = el('button', {type:'button'}, 'Measure Rendering');
  const cancel = el('button', {type:'button', disabled:true}, 'Cancel Measurement');
  const save = el('button', {type:'button', disabled:true}, 'Save Report...');
  let controller, report;
  measure.addEventListener('click', async () => {
    const doc = node.ownerDocument, view = doc.defaultView;
    controller = new view.AbortController(); measure.disabled = true; cancel.disabled = false; save.disabled = true;
    const lifecycle = new view.MutationObserver(() => { if (!node.isConnected) controller?.abort(); });
    lifecycle.observe(doc.documentElement,{childList:true,subtree:true});
    try {
      report = await benchmarkRendering(doc, {signal:controller.signal, onProgress:backend => { output.textContent='Measuring '+backend+'...'; }});
      status.setMeasurement(report);
      output.textContent = report.results.map(result => result.available ? result.backend+': CPU submit p50 '+result.cpuSubmission.p50Ms.toFixed(3)+' ms, p95 '+result.cpuSubmission.p95Ms.toFixed(3)+' ms; GPU pass '+(result.gpuPass ? result.gpuPass.p50Ms.toFixed(3)+' ms p50' : 'timestamps unavailable') : result.backend+': '+result.reason).join('\n')+'\n'+report.note;
      save.disabled = false;
    } catch (error) { output.textContent = error.message || String(error); }
    finally { lifecycle.disconnect(); controller=null; measure.disabled=false; cancel.disabled=true; }
  });
  cancel.addEventListener('click', () => controller?.abort());
  save.addEventListener('click', () => {
    if (!report) return;
    const view = node.ownerDocument.defaultView, url = view.URL.createObjectURL(new view.Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
    const link=node.ownerDocument.createElement('a');link.href=url;link.download='vb6-rendering-measurements.json';link.hidden=true;
    try { node.ownerDocument.body.append(link); link.click(); }
    finally { link.remove(); view.setTimeout(()=>view.URL.revokeObjectURL(url),3000); }
  });
  node.append(el('fieldset',{},el('legend',{},'Local measurement'),measure,cancel,save,output));
  return {node, dispose() { status.dispose(); controller?.abort(); }, apply() {
    const policy = normalizeRendering({backend: backend.value, fallbacks: fallbacks.map(input => input.value), text: text.value, pixelSnap: snap.checked});
    if (exported.checked) ide.project.settings.rendering = policy;
    if (JSON.stringify(policy) !== JSON.stringify(initial)) ide.setRenderingPolicy?.(policy);
  }};
}
