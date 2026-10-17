import {getTheme,fontFamily} from '../theme/theme.js';
import {observeThemeEnvironment,writeThemeAttributes} from '../theme/environment.js';
import {winui3ThemeValues,winui3CssColor,winui3CssThickness,winui3BuiltinStyle} from '../theme/winui3-compat.js';
import {notifyControlPaint} from '../rendering/invalidation.js';

const documents=new WeakMap(),bindings=new WeakMap();
const own=(object,key)=>Object.hasOwn(object,key);
const isInputBackground=c=>c.input&&!['Slider','CheckBox','OptionButton','UpDown'].includes(c.type);

function themeFor(c,state) {
  if(state?.environment.snapshot.forcedColors||getTheme(c.node).id==='contrast')return 'HighContrast';
  const requested=c.node.closest('[data-winui-requested-theme="Light"],[data-winui-requested-theme="Dark"]');
  return requested?.getAttribute('data-winui-requested-theme')||(getTheme(c.node).scheme==='dark'?'Dark':'Light');
}
function subscribe(c) {
  const document=c.node.ownerDocument,previous=bindings.get(c);
  if(previous?.document===document)return previous.state;
  if(previous)unsubscribe(c);
  let state=documents.get(document);
  if(!state) {
    state={controls:new Set(),environment:null};
    const update=event=>{
      for(const control of [...state.controls]) {
        if(control.disposed||!state.controls.has(control))continue;
        if(event?.target?.contains&&!event.target.contains(control.node))continue;
        resetWinUI3ControlPaint(control);apply(control,state);notifyControlPaint(control.node);
      }
    };
    state.environment=observeThemeEnvironment(document.defaultView,()=>update());
    state.changed=event=>update(event);
    state.pageshow=()=>{state.environment.refresh();update();};
    document.addEventListener('vb-theme-change',state.changed,true);
    document.defaultView?.addEventListener('pageshow',state.pageshow);
    documents.set(document,state);
  }
  state.controls.add(c);bindings.set(c,{document,state});return state;
}
function unsubscribe(c) {
  const binding=bindings.get(c);if(!binding)return;
  const {document,state}=binding;bindings.delete(c);state.controls.delete(c);
  if(!state.controls.size) {
    document.removeEventListener('vb-theme-change',state.changed,true);
    document.defaultView?.removeEventListener('pageshow',state.pageshow);
    state.environment.dispose();documents.delete(document);
  }
}
function paint(c,node,key,value) {
  if(!node)return;
  const previous=node.style.getPropertyValue(key),priority=node.style.getPropertyPriority(key);
  node.style.setProperty(key,value);
  (c.winui3Paint??=[]).push({node,key,value:node.style.getPropertyValue(key),previous,priority});
}
export function resetWinUI3ControlPaint(c) {
  for(const {node,key,value,previous,priority} of (c.winui3Paint??[]).slice().reverse()) {
    if(node.style.getPropertyValue(key)!==value)continue;
    if(previous)node.style.setProperty(key,previous,priority);else node.style.removeProperty(key);
  }
  c.winui3Paint=[];
}
function apply(c,state) {
  const appearance=c.props.WinUI3;if(!appearance)return;
  const n=c.node,previousRequested=n.getAttribute('data-winui-requested-theme');
  writeThemeAttributes(n,{'data-winui-control':appearance.sourceType,
    'data-winui-requested-theme':appearance.requestedTheme&&appearance.requestedTheme!=='Default'?appearance.requestedTheme:null,
    'data-winui-style':winui3BuiltinStyle(appearance.style)});
  const theme=themeFor(c,state),values=winui3ThemeValues(appearance,theme);
  writeThemeAttributes(n,{'data-winui-effective-theme':theme});
  c.winui3Values=values;
  const body=c.content||n,content=c.label||c.input||body;
  if(own(values,'Background')) {
    const background=winui3CssColor(values.Background);
    // One paint plane: a translucent field must not be composited a second time
    // against an identically colored host.
    paint(c,isInputBackground(c)?c.input:body,'background',background);
    if(isInputBackground(c)&&c.type==='TextBox')paint(c,n,'background','transparent');
    if(c.surface)c.surface.background=background;
  }
  if(own(values,'Foreground')) {
    const color=winui3CssColor(values.Foreground);paint(c,n,'color',color);
    if(c.input)paint(c,c.input,'color',color);
  }
  const borderHost=isInputBackground(c)?c.input:body;
  if(own(values,'BorderThickness')) {
    paint(c,borderHost,'border-width',winui3CssThickness(values.BorderThickness));
    paint(c,borderHost,'border-style','solid');
    paint(c,borderHost,'box-sizing','border-box');
    // Explicit XAML borders replace the default template's elevation painter.
    paint(c,n,'--winui-BorderPainterContent','none');
  }
  if(own(values,'BorderBrush')) {
    const color=winui3CssColor(values.BorderBrush);paint(c,borderHost,'border-color',color);
    paint(c,n,'--winui-ButtonElevation','linear-gradient('+color+', '+color+')');
    paint(c,n,'--winui-ButtonFlatElevation','linear-gradient('+color+', '+color+')');
  }
  if(own(values,'Padding')) {
    const padding=winui3CssThickness(values.Padding);paint(c,isInputBackground(c)?c.input:body,'padding',padding);
    paint(c,isInputBackground(c)?c.input:body,'box-sizing','border-box');
  }
  if(own(values,'CornerRadius')) {
    const radius=values.CornerRadius.map(value=>value+'px').join(' ');
    paint(c,borderHost,'border-radius',radius);paint(c,n,'--winui-ControlRadius',radius);
  }
  if(own(values,'BackgroundSizing'))paint(c,borderHost,'background-clip',values.BackgroundSizing==='InnerBorderEdge'?'padding-box':'border-box');
  if(own(values,'Opacity'))paint(c,n,'opacity',String(values.Opacity));
  if(own(values,'FontWeight')) {paint(c,n,'font-weight',String(values.FontWeight));if(c.input)paint(c,c.input,'font-weight',String(values.FontWeight));}
  if(own(values,'FontFamily')) {paint(c,n,'font-family',fontFamily(values.FontFamily));if(c.input)paint(c,c.input,'font-family',fontFamily(values.FontFamily));}
  if(own(values,'FontSize')) {paint(c,n,'font-size',values.FontSize+'px');if(c.input)paint(c,c.input,'font-size',values.FontSize+'px');}
  writeThemeAttributes(n,{'data-winui-system-focus':own(values,'UseSystemFocusVisuals')?String(values.UseSystemFocusVisuals):null});
  const focus=values.UseSystemFocusVisuals!==false&&own(values,'FocusVisualMargin');
  if(focus) {
    if(!c.winui3Focus){c.winui3Focus=n.ownerDocument.createElement('span');c.winui3Focus.className='vb-winui-focus-ring';c.winui3Focus.setAttribute('aria-hidden','true');}
    if(c.winui3Focus.parentNode!==n)n.append(c.winui3Focus);
    paint(c,n,'--winui3-focus-inset',winui3CssThickness(values.FocusVisualMargin));
  } else if(c.winui3Focus){c.winui3Focus.remove();c.winui3Focus=null;}
  writeThemeAttributes(n,{'data-winui-custom-focus':focus?'true':null});
  if(own(values,'TextWrapping')) {
    paint(c,content,'white-space',values.TextWrapping==='NoWrap'?'pre':'pre-wrap');
    paint(c,content,'overflow-wrap',values.TextWrapping==='Wrap'?'anywhere':'normal');
  }
  if(own(values,'TextTrimming')) {
    paint(c,content,'text-overflow',values.TextTrimming.endsWith('Ellipsis')?'ellipsis':'clip');
    if(values.TextTrimming!=='None')paint(c,content,'overflow','hidden');
  }
  if(own(values,'HorizontalContentAlignment')) {
    const alignment={Left:'flex-start',Center:'center',Right:'flex-end',Stretch:'stretch'}[values.HorizontalContentAlignment];
    paint(c,body,'justify-content',alignment);
    if(c.input)paint(c,c.input,'text-align',{Left:'left',Center:'center',Right:'right',Stretch:'start'}[values.HorizontalContentAlignment]);
  }
  if(own(values,'VerticalContentAlignment'))paint(c,body,'align-items',{Top:'flex-start',Center:'center',Bottom:'flex-end',Stretch:'stretch'}[values.VerticalContentAlignment]);
  if(appearance.sourceType==='ToggleSwitch') {
    const header=values.Header??'';
    if(header&&!c.winui3Header) {
      c.winui3Header=n.ownerDocument.createElement('span');c.winui3Header.className='vb-winui-switch-header';n.prepend(c.winui3Header);
    }
    if(c.winui3Header){c.winui3Header.textContent=header;c.winui3Header.hidden=!header;}
    writeThemeAttributes(n,{'data-winui-has-header':header?'true':null});
  } else if(c.winui3Header){c.winui3Header.remove();c.winui3Header=null;}
  refreshWinUI3ControlValue(c);
  // A property write can change the requested theme without changing the host
  // palette. Repaint affected descendants once, without reconstructing inputs.
  if(previousRequested!==n.getAttribute('data-winui-requested-theme')) {
    for(const child of [...state.controls])if(child!==c&&!child.disposed&&n.contains(child.node)) {
      resetWinUI3ControlPaint(child);apply(child,state);notifyControlPaint(child.node);
    }
  }
}

export function refreshWinUI3ControlValue(c) {
  const appearance=c.props.WinUI3;if(!appearance)return;
  const p=c.props,values=c.winui3Values??winui3ThemeValues(appearance);
  if(c.type==='CheckBox'&&['ToggleButton','ToggleSwitch'].includes(appearance.sourceType)) {
    const toggle=appearance.sourceType==='ToggleSwitch';
    writeThemeAttributes(c.input,{role:toggle?'switch':'button','aria-checked':toggle?String(!!Number(p.Value)):null,
      'aria-pressed':toggle?null:String(!!Number(p.Value))});
    if(toggle) {
      c.label.textContent=Number(p.Value)?values.OnContent??'On':values.OffContent??'Off';
      writeThemeAttributes(c.input,{'aria-label':values.Header||String(p.Caption||c.model.name)});
    }
  }
  if(c.type==='ProgressBar') {
    const indeterminate=values.IsIndeterminate===true;
    writeThemeAttributes(c.node,{'data-winui-indeterminate':indeterminate?'true':null,
      role:'progressbar','aria-valuemin':Number(p.Min)||0,'aria-valuemax':Number(p.Max)||0,
      'aria-valuenow':indeterminate?null:Number(p.Value)||0});
  }
}
export function refreshWinUI3Control(c) {
  if(!c.props.WinUI3) {
    if(bindings.has(c))disposeWinUI3Control(c);
    return;
  }
  apply(c,subscribe(c));
}
export function disposeWinUI3Control(c) {
  unsubscribe(c);resetWinUI3ControlPaint(c);
  c.winui3Header?.remove();c.winui3Header=null;c.winui3Focus?.remove();c.winui3Focus=null;c.winui3Values=null;
  writeThemeAttributes(c.node,{'data-winui-control':null,'data-winui-requested-theme':null,
    'data-winui-effective-theme':null,'data-winui-style':null,'data-winui-indeterminate':null,'data-winui-has-header':null,
    'data-winui-system-focus':null,'data-winui-custom-focus':null});
  if(c.surface)c.surface.background=c.props.BackColor;
  if(c.input&&c.type==='CheckBox')writeThemeAttributes(c.input,{role:null,'aria-checked':null,'aria-pressed':null});
}

/** Diagnostic counts expose listener ownership without retaining documents. */
export function winui3PresentationDiagnostics(document) {
  const state=documents.get(document);return Object.freeze({controls:state?.controls.size??0,themeListeners:state?1:0});
}
export function winui3ControlBackground(c,fallback) {
  const color=c.winui3Values?.Background;return color===undefined?fallback:winui3CssColor(color);
}
