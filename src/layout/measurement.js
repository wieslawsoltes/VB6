import {measureWrappedText} from './text-wrap.js';
import {fontFamily} from '../theme/theme.js';
let context,cacheCost=0;const cache=new Map(),MAX_COST=1048576,MAX_ENTRIES=1024;
const measuredTypes=new Set(['Label','CommandButton','TextBox','CheckBox','OptionButton']);
const winui3MeasurementValues=new WeakMap();
const winui3MeasuredTypes=Object.freeze({TextBlock:'Label',Button:'CommandButton',HyperlinkButton:'CommandButton',ToggleButton:'CheckBox',
  TextBox:'TextBox',PasswordBox:'TextBox',CheckBox:'CheckBox',RadioButton:'OptionButton',ToggleSwitch:'CheckBox'});
const winui3BoxInsets=new Set(['TextBlock','Button','HyperlinkButton','ToggleButton','TextBox','PasswordBox']);
function measurementValues(values) {
  if(!values||typeof values!=='object'||Array.isArray(values))throw new TypeError('WinUI measurement values must be an object.');
  const next={};
  for(const key of ['FontFamily','FontSize','FontWeight','TextWrapping','Padding','BorderThickness'])if(values[key]!==undefined) {
    const value=values[key];
    if(key==='FontFamily') {
      if(typeof value!=='string'||!value.length||value.length>1024||/[\u0000-\u001f]/u.test(value))throw new TypeError('WinUI measurement FontFamily requires a bounded family name.');
    } else if(key==='FontSize') {
      if(typeof value!=='number'||!Number.isFinite(value)||value<=0||value>20000)throw new TypeError('WinUI measurement FontSize requires a positive finite DIP size.');
    } else if(key==='FontWeight') {
      if(!Number.isInteger(value)||value<1||value>1000)throw new TypeError('WinUI measurement FontWeight requires an integer from 1 through 1000.');
    } else if(key==='TextWrapping') {
      if(!['NoWrap','Wrap','WrapWholeWords'].includes(value))throw new TypeError('Invalid WinUI measurement TextWrapping.');
    } else if(!Array.isArray(value)||value.length!==4||[...value].some(n=>typeof n!=='number'||!Number.isFinite(n)||n<0||n>20000))
      throw new TypeError('WinUI measurement '+key+' requires four finite nonnegative DIP values.');
    next[key]=Array.isArray(value)?Object.freeze([...value]):value;
  }
  return Object.freeze(next);
}
function measurementStyle(p,type) {
  const active=winui3MeasurementValues.get(p),source=active?.sourceType??p.WinUI3?.sourceType;
  const values=winui3MeasuredTypes[source]===type?(active?.values??measurementValues(p.WinUI3?.properties??{})):{};
  const size=values.FontSize??Number(p.FontSize||8.25)*96/72,weight=values.FontWeight??(p.FontBold?700:400);
  const font=`${p.FontItalic?'italic ':''}${weight===400?'':weight+' '}${size}px ${fontFamily(values.FontFamily??p.FontName)}`;
  let insets=type==='Label'?[0,0,0,0]:type==='TextBox'?[3,3,3,3]:type==='CommandButton'?[9,5,9,5]:[20,2,0,2];
  if(winui3BoxInsets.has(source)&&(values.Padding!==undefined||values.BorderThickness!==undefined)) {
    const padding=values.Padding??[0,0,0,0],border=values.BorderThickness??[0,0,0,0];
    insets=padding.map((value,i)=>value+border[i]);
  }
  return {font,size,insets,wrapping:values.TextWrapping};
}
/** Only a small immutable measurement snapshot is retained per live properties
 * object. It never mutates authored font/chrome values or retains control/DOM
 * objects. Changes to paint-only resources return false; unsupported rich text
 * runs and glyph/content-margin templates keep their existing measurement path.
 */
export function setWinUI3MeasurementValues(p,values) {
  if(!p||typeof p!=='object'||Array.isArray(p))throw new TypeError('WinUI measurement properties must be an object.');
  const old=winui3MeasurementValues.get(p),source=p.WinUI3?.sourceType??old?.sourceType,type=winui3MeasuredTypes[source];
  if(!type){winui3MeasurementValues.delete(p);return false;}
  const before=measurementStyle(p,type);
  if(values===null)winui3MeasurementValues.delete(p);
  else winui3MeasurementValues.set(p,Object.freeze({sourceType:source,values:measurementValues(values)}));
  const after=measurementStyle(p,type);
  return before.font!==after.font||before.wrapping!==after.wrapping||before.insets.some((value,i)=>value!==after.insets[i]);
}
function cached(key){const entry=cache.get(key);if(!entry)return;cache.delete(key);cache.set(key,entry);return entry.value;}
function remember(key,value){Object.freeze(value);const cost=key.length*2+96;if(cost>MAX_COST)return value;
  while(cache.size>=MAX_ENTRIES||cacheCost+cost>MAX_COST){const oldest=cache.keys().next().value;cacheCost-=cache.get(oldest).cost;cache.delete(oldest);}
  cache.set(key,{value,cost});cacheCost+=cost;return value;}
/** Browser adapter only. Fixed controls still supply actual font baselines for
 * inherited baseline alignment, without measuring their entire text. The LRU
 * cache is bounded by both entry count and estimated UTF-16 key storage. */
export function measureLayoutControl(model,constraints={}){
  const p=model.properties||model.props||{};
  for(const axis of ['width','height'])if(constraints[axis]!==undefined&&(typeof constraints[axis]!=='number'||!Number.isFinite(constraints[axis])||constraints[axis]<0))throw new TypeError('Layout measurement constraints require finite nonnegative dimensions.');
  const width=constraints.width??Number(p.Width||0),height=constraints.height??Number(p.Height||0),fallback={preferredWidth:width,preferredHeight:height};
  if(!measuredTypes.has(model.type))return fallback;
  if(!context){try{context=typeof OffscreenCanvas==='function'?new OffscreenCanvas(1,1).getContext('2d'):globalThis.document?.createElement('canvas').getContext('2d');}catch{}if(!context)return fallback;}
  const {font,size,insets,wrapping}=measurementStyle(p,model.type),chrome=[insets[0]+insets[2],insets[1]+insets[3]];
  const metricsKey='metrics:'+font;
  let metrics=cached(metricsKey);
  if(!metrics){context.font=font;const m=context.measureText('Mg');metrics=remember(metricsKey,{lineHeight:Math.max(size*1.2,(m.fontBoundingBoxAscent||size)+(m.fontBoundingBoxDescent||0)),ascent:m.fontBoundingBoxAscent||m.actualBoundingBoxAscent||size*.8});}
  const baseline=(insets[1]+metrics.ascent)*15;
  if(!p.LayoutWidthMode&&!p.LayoutHeightMode)return {...fallback,baseline};
  const raw=String(model.type==='TextBox'?p.Text??'':p.Caption??p.Text??'');
  const text=model.type==='TextBox'?raw:raw.replace(/&&/g,'\u0000').replace(/&(?=.)/g,'').replace(/\u0000/g,'&');
  const wrap=(wrapping!==undefined?wrapping!=='NoWrap':model.type==='Label'||model.type==='CommandButton'||p.MultiLine)&&p.LayoutWidthMode!==1;
  const available=Math.max(1,width/15-chrome[0]),breakLongWords=wrapping==='Wrap';
  const key=JSON.stringify([font,text,wrap?available:0,wrap&&breakLongWords,insets,model.type]),hit=cached(key);if(hit)return hit;
  context.font=font;const {width:measuredWidth,lineCount:lines}=measureWrappedText(text,t=>context.measureText(t).width,available,{wrap,breakLongWords});
  return remember(key,{preferredWidth:(measuredWidth+chrome[0])*15,preferredHeight:(lines*metrics.lineHeight+chrome[1])*15,baseline});
}
export const hasLayoutMeasurement=model=>measuredTypes.has(model.type);
export function clearLayoutMeasurements(){cache.clear();cacheCost=0;context=undefined;}
export function layoutMeasurementCacheStats(){return {entries:cache.size,estimatedBytes:cacheCost,maxEntries:MAX_ENTRIES,maxEstimatedBytes:MAX_COST};}
