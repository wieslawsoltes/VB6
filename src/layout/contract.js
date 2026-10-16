import {AnchorStyles,DockStyle,LayoutMode,parseAnchor,parseDock,parseLayoutMode} from '../../packages/auto-layout/src/index.js';
import {normalizeTracks} from '../../packages/auto-layout/src/advanced.js';
import {normalizeGridLine,normalizeAreas} from '../../packages/auto-layout/src/grid-lines.js';
import {normalizeVariables} from '../../packages/auto-layout/src/track-expression.js';
import {VBError} from '../language/lexer.js';

// All extensions are project scoped. Never mutate the classic control catalog.
export const LAYOUT_DEFAULTS=Object.freeze({Anchor:5,Dock:0,MinimumWidth:0,MinimumHeight:0,MaximumWidth:0,MaximumHeight:0,
  LayoutMode:0,LayoutPadding:0,LayoutMargin:0,LayoutGap:0,LayoutGrow:0,LayoutShrink:1,LayoutAlign:5,LayoutJustify:0,
  LayoutWidthMode:0,LayoutHeightMode:0,LayoutIgnore:0,LayoutAlignItems:0,LayoutAlignContent:0,LayoutCrossGap:-1,LayoutBasis:-1,
  LayoutPaddingTop:-1,LayoutPaddingRight:-1,LayoutPaddingBottom:-1,LayoutPaddingLeft:-1,
  LayoutMarginTop:-1,LayoutMarginRight:-1,LayoutMarginBottom:-1,LayoutMarginLeft:-1,
  LayoutGridAutoFlow:0,LayoutGridColumns:'1fr 1fr',LayoutGridRows:'',LayoutColumn:-1,LayoutRow:-1,LayoutColumnSpan:1,LayoutRowSpan:1,LayoutJustifySelf:4,
  LayoutDirection:2,LayoutReverse:0,LayoutWrapReverse:0,LayoutVariables:'',LayoutGridAreas:'',LayoutArea:'',LayoutColumnStart:'',LayoutColumnEnd:'',LayoutRowStart:'',LayoutRowEnd:'',
  LayoutClipContents:-1,LayoutStacking:0});
export const LAYOUT_KEYS=Object.freeze(Object.keys(LAYOUT_DEFAULTS));
export const LAYOUT_CHOICES=Object.freeze({Dock:['None','Top','Bottom','Left','Right','Fill'],LayoutMode:['Absolute','Horizontal','Vertical','Horizontal Wrap','Vertical Wrap','Grid','Masonry','Horizontal Masonry'],
  LayoutAlign:['Start','Center','End','Stretch','Text baseline','Inherit'],LayoutAlignItems:['Start','Center','End','Stretch','Text baseline'],
  LayoutJustify:['Start','Center','End','Space between','Space around','Space evenly'],LayoutAlignContent:['Start','Center','End','Space between','Space around','Space evenly','Stretch'],
  LayoutWidthMode:['Fixed','Hug contents','Fill container'],LayoutHeightMode:['Fixed','Hug contents','Fill container'],LayoutJustifySelf:['Start','Center','End','Stretch','Inherit'],
  LayoutDirection:['Left to right','Right to left','Inherit'],
  LayoutGridAutoFlow:['Rows','Columns','Rows, dense','Columns, dense'],
  LayoutStacking:['Last on top','First on top']});
export const LAYOUT_CONSTANTS=Object.freeze(Object.fromEntries([
  ...Object.entries(AnchorStyles).map(([k,v])=>['vbAnchor'+k,v]),...Object.entries(DockStyle).map(([k,v])=>['vbDock'+k,v]),...Object.entries(LayoutMode).map(([k,v])=>['vbLayout'+k,v]),
  ...['Start','Center','End','Stretch','Baseline','Inherit'].map((k,v)=>['vbLayoutAlign'+k,v]),...['Start','Center','End','SpaceBetween','SpaceAround','SpaceEvenly'].map((k,v)=>['vbLayoutJustify'+k,v]),
  ...['Row','Column','RowDense','ColumnDense'].map((k,v)=>['vbLayoutGridFlow'+k,v]),
  ...['LeftToRight','RightToLeft','Inherit'].map((k,v)=>['vbLayoutDirection'+k,v]),
  ...['Fixed','Hug','Fill'].map((k,v)=>['vbLayoutSize'+k,v])
]));
const hiddenTypes=new Set(['timer','imagelist','commondialog','menu']);
export const layoutEnabled=project=>project?.settings?.anchoring===true;
export const layoutEligible=target=>!!target?.type&&!hiddenTypes.has(target.type.toLowerCase());
export const layoutContainer=target=>['form','mdiform','frame','picturebox','sstab','tabstrip','usercontrol'].includes(String(target?.type).toLowerCase());
export const layoutKey=key=>LAYOUT_KEYS.find(k=>k.toLowerCase()===String(key).toLowerCase());
export const LAYOUT_FORM_KEYS=Object.freeze(['LayoutMode','LayoutPadding','LayoutGap','LayoutCrossGap','LayoutJustify','LayoutAlignItems','LayoutAlignContent',
  'LayoutPaddingTop','LayoutPaddingRight','LayoutPaddingBottom','LayoutPaddingLeft','LayoutGridColumns','LayoutGridRows','LayoutGridAutoFlow','LayoutClipContents','LayoutStacking','LayoutWidthMode','LayoutHeightMode','LayoutDirection','LayoutReverse','LayoutWrapReverse','LayoutVariables','LayoutGridAreas']);
export function layoutDefaults(target){if(!layoutEligible(target))return {};return ['form','mdiform'].includes(target.type.toLowerCase())?Object.fromEntries(LAYOUT_FORM_KEYS.map(k=>[k,LAYOUT_DEFAULTS[k]])):{...LAYOUT_DEFAULTS};}
export function layoutProperty(key,value,properties={}){
  try{
    if(key==='Anchor')return parseAnchor(value);if(key==='Dock')return parseDock(value);if(key==='LayoutMode')return parseLayoutMode(value);
    if(['LayoutGridColumns','LayoutGridRows'].includes(key)){value=String(value);normalizeTracks(value);if(key==='LayoutGridColumns'&&!value.trim())throw new RangeError('Grid needs at least one column');return value.trim();}
    if(/^Layout(?:Column|Row)(?:Start|End)$/.test(key))return normalizeGridLine(value);
    if(key==='LayoutGridAreas'){value=String(value);normalizeAreas(value);return value.trim();}
    if(key==='LayoutVariables'){value=String(value);normalizeVariables(value);return value.trim();}
    if(key==='LayoutArea'){value=String(value).trim();if(value&&!/^[A-Za-z_][\w-]{0,63}$/.test(value)||/^(auto|span)$/i.test(value))throw new RangeError('Invalid grid area name');return value;}
    value=Number(value);
    const sentinel=['LayoutBasis','LayoutCrossGap','LayoutColumn','LayoutRow'].includes(key)||/^Layout(?:Padding|Margin)(?:Top|Right|Bottom|Left)$/.test(key);
    const min=key==='LayoutGap'||key==='LayoutCrossGap'?-300000:sentinel?-1:0;
    if(['LayoutIgnore','LayoutClipContents','LayoutReverse','LayoutWrapReverse'].includes(key)){if(![-1,0,1].includes(value))throw new RangeError(key+' must be Boolean');return value? -1:0;}
    if(!Number.isFinite(value)||value<min||value>300000)throw new RangeError(key+' must be between '+min+' and 300000');
    if(LAYOUT_CHOICES[key]&&(!Number.isInteger(value)||value>=LAYOUT_CHOICES[key].length))throw new RangeError('Invalid '+key);
    if(['LayoutColumn','LayoutRow','LayoutColumnSpan','LayoutRowSpan'].includes(key)&&(!Number.isInteger(value)||value>(key==='LayoutColumn'?1023:key==='LayoutRow'?262143:1024)||key.endsWith('Span')&&value<1))throw new RangeError('Invalid grid cell coordinate/span');
    const p={...properties,[key]:value};for(const axis of ['Width','Height'])if(Number(p['Maximum'+axis])>0&&Number(p['Maximum'+axis])<Number(p['Minimum'+axis]||0))throw new RangeError('Maximum'+axis+' must be zero (unlimited) or at least Minimum'+axis);
    return value;
  }catch(error){throw new VBError(error.message,380);}
}
export function validateLayout(project,normalize=true){
  if(!layoutEnabled(project))return;
  for(const m of project.modules||[])if(m.form)for(const n of [m.form,...m.form.controls])for(const key of LAYOUT_KEYS)if(Object.hasOwn(n.properties||{},key)){
    if(!Object.hasOwn(layoutDefaults(n),key))throw new VBError(n.name+'.'+key+' is not a layout property for this component',438);
    const value=layoutProperty(key,n.properties[key],n.properties);if(normalize)n.properties[key]=value;
  }
}
export function setLayoutProperty(target,key,value){const p=target.properties||target.props;p[key]=layoutProperty(key,value,p);if(key==='Anchor')p.Dock=0;if(key==='Dock')p.Anchor=5;}
export const LAYOUT_ENUMS=Object.freeze(Object.fromEntries(['AnchorStyles','DockStyle','LayoutMode','LayoutSizeMode'].map(name=>[name.toLowerCase(),Object.freeze(Object.fromEntries(Object.entries(LAYOUT_CONSTANTS).filter(([k])=>name==='AnchorStyles'?k.startsWith('vbAnchor'):name==='DockStyle'?k.startsWith('vbDock'):name==='LayoutSizeMode'?k.startsWith('vbLayoutSize'):/^vbLayout(?:Absolute|Horizontal|Vertical|Wrap|VerticalWrap|Grid|Masonry|HorizontalMasonry)$/.test(k))))])));
