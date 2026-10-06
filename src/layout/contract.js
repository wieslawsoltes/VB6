import {AnchorStyles, DockStyle, LayoutMode, parseAnchor, parseDock, parseLayoutMode} from '../../packages/auto-layout/src/index.js';
import {VBError} from '../language/lexer.js';

// Project-scoped language extension. Never mutate the classic control catalog or
// intrinsic constants: two projects with different settings may coexist.
export const LAYOUT_DEFAULTS = Object.freeze({Anchor:5, Dock:0, MinimumWidth:0, MinimumHeight:0,
  MaximumWidth:0, MaximumHeight:0, LayoutMode:0, LayoutPadding:0, LayoutMargin:0,
  LayoutGap:0, LayoutGrow:0, LayoutShrink:1, LayoutAlign:0, LayoutJustify:0});
export const LAYOUT_KEYS = Object.freeze(Object.keys(LAYOUT_DEFAULTS));
export const LAYOUT_CONSTANTS = Object.freeze(Object.fromEntries([
  ...Object.entries(AnchorStyles).map(([k,v])=>['vbAnchor'+k,v]),
  ...Object.entries(DockStyle).map(([k,v])=>['vbDock'+k,v]),
  ...Object.entries(LayoutMode).map(([k,v])=>['vbLayout'+k,v]),
  ...['Start','Center','End','Stretch'].map((k,v)=>['vbLayoutAlign'+k,v]),
  ...['Start','Center','End','SpaceBetween','SpaceAround','SpaceEvenly'].map((k,v)=>['vbLayoutJustify'+k,v])
]));
const hiddenTypes = new Set(['timer','imagelist','commondialog','menu']);
export const layoutEnabled = project => project?.settings?.anchoring === true;
export const layoutEligible = target => !!target?.type && !hiddenTypes.has(target.type.toLowerCase());
export const layoutKey = key => LAYOUT_KEYS.find(k=>k.toLowerCase()===String(key).toLowerCase());
export function layoutDefaults(target) {
  if (!layoutEligible(target)) return {};
  if (['form','mdiform'].includes(target.type.toLowerCase())) return {LayoutMode:0,LayoutPadding:0,LayoutGap:0,LayoutJustify:0};
  return {...LAYOUT_DEFAULTS};
}
export function layoutProperty(key,value,properties={}) {
  try {
    if(key==='Anchor')return parseAnchor(value);
    if(key==='Dock')return parseDock(value);
    if(key==='LayoutMode')return parseLayoutMode(value);
    value=Number(value);
    if(!Number.isFinite(value)||value<0||value>300000)throw new RangeError(key+' must be between 0 and 300000');
    if(key==='LayoutAlign'&&(!Number.isInteger(value)||value>3))throw new RangeError('LayoutAlign must be 0–3');
    if(key==='LayoutJustify'&&(!Number.isInteger(value)||value>5))throw new RangeError('LayoutJustify must be 0–5');
    const p={...properties,[key]:value};
    for(const axis of ['Width','Height'])if(Number(p['Maximum'+axis])>0&&Number(p['Maximum'+axis])<Number(p['Minimum'+axis]||0))throw new RangeError('Maximum'+axis+' must be zero (unlimited) or at least Minimum'+axis);
    return value;
  } catch(error) {throw new VBError(error.message,380);}
}
export function validateLayout(project,normalize=true) {
  if(!layoutEnabled(project))return;
  for(const m of project.modules||[])if(m.form)for(const n of [m.form,...m.form.controls]) {
    for(const key of LAYOUT_KEYS)if(Object.hasOwn(n.properties||{},key)) {
      if(!Object.hasOwn(layoutDefaults(n),key))throw new VBError(n.name+'.'+key+' is not a layout property for this component',438);
      const value=layoutProperty(key,n.properties[key],n.properties);if(normalize)n.properties[key]=value;
    }
  }
}
export function setLayoutProperty(target,key,value) {
  const p=target.properties||target.props;
  p[key]=layoutProperty(key,value,p);
  // As in WinForms, setting Anchor exits docking; setting Dock resets Anchor.
  if(key==='Anchor')p.Dock=0;
  if(key==='Dock')p.Anchor=5;
}

/** Synthetic enum namespaces exist only in opted-in compiler/runtime instances. */
export const LAYOUT_ENUMS=Object.freeze(Object.fromEntries(['AnchorStyles','DockStyle','LayoutMode'].map(name=>[name.toLowerCase(),Object.freeze(Object.fromEntries(Object.entries(LAYOUT_CONSTANTS).filter(([k])=>name==='AnchorStyles'?k.startsWith('vbAnchor'):name==='DockStyle'?k.startsWith('vbDock'):/^vbLayout(?:Absolute|Horizontal|Vertical|Wrap)$/.test(k))))])));
