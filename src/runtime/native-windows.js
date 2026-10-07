import {runtimeDialog,messageBoxOptions} from '../controls/dialog.js';
import {nativeCaptionMode,nativeChromeInsets,updateNativeCaption} from './native-caption.js';
import {THEMES,themeId} from '../theme/theme.js';
import {APPLICATION_THEME_ATTRIBUTES,copyApplicationTheme} from '../theme/application-appearance.js';
import {refreshGraphicsSurfaces} from '../graphics/surface.js';
/** Native Windows adapter. One VM owns all forms; same-origin windows retain DOM/event identity. */
export function installNativeHost(host, bridge = globalThis.vb6Native) {
  if (!bridge || bridge.version !== 1 || host.nativeWindows) return false;
  const document = host.container.ownerDocument, browser = document.defaultView;
  const forms = new Map(), dialogs = new Map();
  let disposed = false;
  const background=()=>THEMES[themeId(host.container.getAttribute('data-vb-theme'))].colors.face;
  const themeChanged=()=>{for(const record of [...forms.values(),...dialogs.values()]){
    const {doc,id}=record;if(!doc)continue;copyApplicationTheme(host.container,doc.documentElement);
    doc.documentElement.dispatchEvent(new doc.defaultView.CustomEvent('vb-theme-change',{bubbles:true}));
    if(bridge.capabilities?.applicationCaptions===true)command(id,'appearance',background());
    record.sync?.();
  }};
  host.container.addEventListener('vb-theme-change',themeChanged);
  const report = error => host.send('output', { text: 'Native window: ' + error.message, newline: true });
  const command = (id, name, value) => bridge.windowCommand(id, name, value).catch(report);
  function open(options) {
    const id = bridge.prepareWindow(options);
    // An empty URL keeps the initial same-origin document, as in the IDE's
    // detached window host. Electron normalizes it to about:blank before the
    // main-process reservation check; no new navigation is requested.
    const win = browser.open('', id, 'popup');
    if (!win) { command(id,'cancel-reservation'); throw new Error('Native window creation was denied'); }
    const doc = win.document;
    // Establish standards mode before adopting live nodes. Only constant markup
    // is written; titles, themes and app content use DOM APIs below. Inherited
    // origin/CSP and the root-owned native bridge remain unchanged.
    // https://www.electronjs.org/docs/latest/api/window-open
    doc.open();
    doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
    doc.close();
    doc.documentElement.setAttribute('data-native-caption',options.captionMode||'system');
    doc.title=options.title??'';
    if(browser.vb6NativeGPUUnavailable)win.vb6NativeGPUUnavailable=browser.vb6NativeGPUUnavailable;
    for (const name of [...APPLICATION_THEME_ATTRIBUTES, 'lang']) {
      const value = host.container.getAttribute(name)??document.documentElement.getAttribute(name); if (value) doc.documentElement.setAttribute(name, value);
    }
    for (const node of document.querySelectorAll('style,link[rel="stylesheet"]')) doc.head.append(node.cloneNode(true));
    const style = doc.createElement('style');
    style.textContent = `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--vb-face,#c0c0c0)}
      .vb-form[data-native-window]{position:relative!important;inset:0!important;transform:none!important;width:100%!important;height:100%!important}
      .vb-form[data-native-window]:not([hidden]){display:flex!important;flex-direction:column}
      [data-native-caption=system] .vb-form[data-native-window]{border:0!important;padding:0!important;box-shadow:none!important}
      [data-native-caption=system] .vb-form[data-native-window]>.vb-form-title{display:none!important}
      .vb-form[data-native-window]>.vb-form-grip{display:none!important}
      .vb-form[data-native-window]>.vb-form-title,.vb-dialog>.vb-form-title{-webkit-app-region:drag;app-region:drag;user-select:none}
      .vb-form-title>button{-webkit-app-region:no-drag;app-region:no-drag}
      [data-native-caption=system] .vb-dialog>.vb-form-title{display:none!important}
      .vb-modal-shade{padding:0;display:block}
      .vb-modal-shade>.vb-dialog{margin:0;width:100%;height:100%;max-width:none;max-height:none;display:flex;flex-direction:column}
      .vb-dialog>.vb-dialog-body{flex:1;min-height:0;overflow:auto}
      .vb-dialog>.vb-dialog-actions{flex:none}
      [data-native-caption=system] .vb-dialog{border:0;box-shadow:none;padding:0}
      .vb-form[data-native-window].vb-native-maximized{border-radius:0}
      .vb-form[data-native-window]>.vb-form-content{flex:1 1 auto;min-height:0;width:100%!important;height:0!important}
      .vb-form[data-native-window]>.vb-form-menu{flex:none}`;
    doc.head.append(style);
    return { id, win, doc };
  }
  function size(form) {
    const p = form.props,insets=nativeChromeInsets(form,form.nativeWindow?.captionMode||'system');
    return { x: Number(p.Left || 0) / 15, y: Number(p.Top || 0) / 15,
      width: Math.max(96, Number(p.ClientWidth ?? p.Width ?? 9000) / 15 + insets.width),
      height: Math.max(64, Number(p.ClientHeight ?? p.Height ?? 6000) / 15 + insets.height) };
  }
  function attach(form) {
    if (form.MDIChild) return; // MDI children stay inside their native MDI parent, not independent taskbar windows.
    const record = { form, id: null, win: null, state: Number(form.props.WindowState) || 0, focused: false, applying: false };
    const refresh = form.refresh.bind(form), show = form.Show.bind(form), hide = form.Hide.bind(form), dispose = form.dispose.bind(form);
    form.movedByUser = true;
    form.nativeWindow = record;
    form.closeButton.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();requestClose(record);},true);
    const chrome=()=>({borderStyle:Number(form.props.BorderStyle??2),minButton:form.props.MinButton!==0,maxButton:form.props.MaxButton!==0,controlBox:form.props.ControlBox!==0});
    function sync() {
      if (!record.id || record.applying) return;
      const title = String(form.props.Caption ?? form.model.name), bounds = size(form), signature = JSON.stringify(bounds);
      form.captionNode.textContent=title;form.node.setAttribute('aria-label',title);
      if (title !== record.title) { record.title = title; record.win.document.title = title; command(record.id, 'title', title); }
      if (signature !== record.bounds && record.state === 0) { record.bounds = signature; command(record.id, 'bounds', bounds); }
      const flags=JSON.stringify(chrome());
      if(flags!==record.chrome&&bridge.capabilities?.applicationCaptions===true){record.chrome=flags;command(record.id,'chrome',chrome());}
      updateNativeCaption(form,record.state,record.focused);
    }
    function ensure() {
      if (record.id) return;
      record.captionMode=nativeCaptionMode(host.themeController?.appearance,bridge);
      Object.assign(record, open({ ...size(form), captionMode:record.captionMode,backgroundColor:background(),title: String(form.props.Caption ?? form.model.name),
        borderStyle: Number(form.props.BorderStyle ?? 2), minButton: form.props.MinButton !== 0,
        maxButton: form.props.MaxButton !== 0, controlBox: form.props.ControlBox !== 0 }));
      forms.set(record.id, record);
      form.node.setAttribute('data-native-window', record.id);
      record.doc.body.append(form.node);
      record.sync=sync;
      refreshGraphicsSurfaces(form.node);
      form.cancelWindowInteraction?.();
      record.doc.addEventListener('focusin', () => {
        if (form.shown && !record.focused) command(record.id, 'focus');
      });
      record.doc.addEventListener('keydown', event => { if (event.altKey && event.key === 'F4' && form.props.ControlBox!==0) { event.preventDefault(); requestClose(record); } });
      sync();
    }
    form.refresh = () => { refresh(); sync(); };
    form.Show = () => { ensure(); record.focused = true; show(); command(record.id, 'show'); command(record.id, 'state', record.state); command(record.id, 'focus'); };
    form.Hide = () => { hide(); if (record.id) { command(record.id, 'modal', false); command(record.id, 'hide'); } };
    Object.defineProperty(form, 'WindowState', { configurable: true, get: () => record.state, set: value => {
      value = Number(value); if (!Number.isInteger(value) || value < 0 || value > 2) throw new Error('Invalid WindowState');
      record.state = value; form.props.WindowState = value; updateNativeCaption(form,value,record.focused); if (record.id) command(record.id, 'state', value);
    } });
    form.toggleMinimize = () => { form.WindowState = record.state === 1 ? 0 : 1; };
    form.toggleMaximize = () => { form.WindowState = record.state === 2 ? 0 : 2; };
    form.showMenu = async (items, anchor, all) => {
      ensure();
      const map = entries => entries.filter(m => m.properties.Visible !== 0).map(m => m.properties.Caption === '-' ? null : {
        id: m.name, label: String(m.properties.Caption || m.name), enabled: m.properties.Enabled !== 0,
        checked: m.properties.Checked ? true : undefined,
        items: all.some(c => c.parent === m.name) ? map(all.filter(c => c.parent === m.name)) : undefined
      });
      try {
        const rect = anchor.getBoundingClientRect();
        const selected = await bridge.popupMenu(record.id, map(items), { x: rect.left, y: rect.bottom });
        if (selected && !form.disposed) await form.vm.dispatch(form.instance, selected + '_Click', []);
      } catch (error) { report(error); }
    };
    form.dispose = () => {
      if (form.disposed) return;
      if (record.id) { forms.delete(record.id); command(record.id, 'destroy'); }
      dispose();
    };
    record.ensure = ensure;
  }
  async function requestClose(record) {
    if (record.closing) return;
    record.closing = true;
    try { await host.vm.requestUnload(record.form.instance); }
    catch (error) { report(error); }
    finally {
      record.closing = false;
      if (record.id && !record.form.disposed) await command(record.id, 'cancel-close');
      // Unload releases the VB lifetime, not the reusable JS form object. Hide alone never exits.
      if (!record.form.instance.loaded && ![...host.vm.formInstances].some(instance => instance.loaded)) {
        setTimeout(() => { if (!disposed && ![...host.vm.formInstances].some(instance => instance.loaded)) command('controller', 'quit'); }, 0);
      }
    }
  }
  const unsubscribe = bridge.onWindowEvent(event => {
    if (disposed) return;
    const dialog = dialogs.get(event.id);
    if (dialog) {
      if(event.type==='state')dialog.node?.classList.toggle('vb-inactive',!event.focused);
      if(event.type==='close-request'){if(dialog.cancelAllowed)dialog.finish();else command(event.id,'cancel-close');}
      if(event.type==='closed')dialog.finish();
      return;
    }
    const record = forms.get(event.id); if (!record) return;
    if (event.type === 'close-request') { requestClose(record); return; }
    if (event.type === 'closed') { forms.delete(event.id); record.id = null; record.win = null; return; }
    if (event.type !== 'state') return;
    const form = record.form, previous = size(form), p = form.props;
    record.applying = true;
    record.state = event.state; p.WindowState = event.state;
    if (event.state !== 1) {
      p.Left = event.bounds.x * 15; p.Top = event.bounds.y * 15;
      const insets=nativeChromeInsets(form,record.captionMode);
      p.ClientWidth = Math.max(1, event.contentBounds.width-insets.width) * 15;
      p.ClientHeight = Math.max(1, event.contentBounds.height-insets.height) * 15;
      record.bounds = JSON.stringify(size(form)); form.refresh(); form.surface?.resize();
      host.mdi?.layout();
    }
    record.applying = false;
    updateNativeCaption(form,record.state,!!event.focused);
    if (event.focused) {
      const active = form.type === 'MDIForm' && form.mdiController?.active?.shown ? form.mdiController.active.instance : form.instance;
      host.vm.library.get('screen').ActiveForm = active;
    }
    if (event.focused !== record.focused) { record.focused = event.focused; form.event(event.focused ? 'Activate' : 'Deactivate'); }
    const current = size(form);
    if (current.width !== previous.width || current.height !== previous.height) form.event('Resize', [], true);
  });
  const createForm = host.createForm.bind(host);
  host.createForm = async (...args) => { const form = await createForm(...args); attach(form); return form; };
  const beginModal = host.beginModal.bind(host);
  host.beginModal = form => {
    const end = beginModal(form), record = form.nativeWindow;
    if (record) { record.ensure(); command(record.id, 'modal', true); }
    return () => { end(); if (record?.id && forms.has(record.id)) command(record.id, 'modal', false); };
  };
  // Reuse the same accessible themed dialog view as browser applications. The
  // OS owns modality/movement; the existing VB runtime owns return/cancel values.
  host.modal = (title,body,buttons=[{caption:'OK',value:1}],input=null,options={}) => {
    const captionMode=nativeCaptionMode(host.themeController?.appearance,bridge);
    const cancelValue=input!==null?'':options.cancelValue??buttons.find(b=>b.caption.replace('&','').toLowerCase()==='cancel')?.value??(buttons.length===1?buttons[0].value:undefined);
    let record;
    try {
      record=open({title:String(title),width:460,height:210,borderStyle:3,minButton:false,maxButton:false,
        controlBox:cancelValue!==undefined,captionMode,backgroundColor:background()});
      const dialogHost={container:record.doc.body,get dialogs(){return host.dialogs;},set dialogs(value){host.dialogs=value;}};
      const result=runtimeDialog(dialogHost,title,body,buttons,input,{...options,nativeWindow:true});
      const shade=host.dialogs.at(-1);record.node=shade.querySelector('.vb-dialog');
      record.cancelAllowed=cancelValue!==undefined;record.finish=()=>shade.vbFinish();
      dialogs.set(record.id,record);
      if(host.vm?.debugEvaluation)host.vm.debugEvaluation.dialogs.add(shade);
      command(record.id,'modal',true);command(record.id,'show');
      return result.finally(()=>{dialogs.delete(record.id);command(record.id,'destroy');});
    } catch(error) {if(record?.id)command(record.id,'destroy');return Promise.reject(error);}
  };
  host.msgBox=(message,style=0,title=host.project.name)=>{
    const options=messageBoxOptions(style);return host.modal(title,message,options.buttons,null,options);
  };
  host.inputBox=(message,title=host.project.name,initial='')=>host.modal(title,message,
    [{caption:'OK',value:1},{caption:'Cancel',value:''}],String(initial));
  host.openFile = props => bridge.openFile({ title: String(props?.DialogTitle || 'Open') });
  host.saveFile = (name, data) => bridge.saveFile(String(name), typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
  const send = host.send.bind(host);
  host.send = (type, data) => { send(type, data); if (type === 'stopped' && !disposed) command('controller','quit'); };
  const start = host.start.bind(host);
  host.start = async () => { const result = await start(); if (!forms.size) await command('controller', 'show'); return result; };
  const dispose = host.dispose.bind(host);
  host.dispose = () => { if (disposed) return; disposed = true; host.container.removeEventListener('vb-theme-change',themeChanged); dispose(); for (const d of dialogs.values()) d.finish(''); unsubscribe(); };
  host.nativeWindows = { forms, dialogs };
  return true;
}
