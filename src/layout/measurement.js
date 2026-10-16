import {measureWrappedText} from './text-wrap.js';
import {fontFamily} from '../theme/theme.js';
let context,cacheCost=0;const cache=new Map(),MAX_COST=1048576,MAX_ENTRIES=1024;
const measuredTypes=new Set(['Label','CommandButton','TextBox','CheckBox','OptionButton']);
function cached(key){const entry=cache.get(key);if(!entry)return;cache.delete(key);cache.set(key,entry);return entry.value;}
function remember(key,value){Object.freeze(value);const cost=key.length*2+96;if(cost>MAX_COST)return value;
  while(cache.size>=MAX_ENTRIES||cacheCost+cost>MAX_COST){const oldest=cache.keys().next().value;cacheCost-=cache.get(oldest).cost;cache.delete(oldest);}
  cache.set(key,{value,cost});cacheCost+=cost;return value;}
/** Browser adapter only. Fixed controls still supply actual font baselines for
 * inherited baseline alignment, without measuring their entire text. The LRU
 * cache is bounded by both entry count and estimated UTF-16 key storage. */
export function measureLayoutControl(model){
  const p=model.properties||model.props||{},fallback={preferredWidth:Number(p.Width||0),preferredHeight:Number(p.Height||0)};
  if(!measuredTypes.has(model.type))return fallback;
  if(!context){try{context=typeof OffscreenCanvas==='function'?new OffscreenCanvas(1,1).getContext('2d'):globalThis.document?.createElement('canvas').getContext('2d');}catch{}if(!context)return fallback;}
  const size=Number(p.FontSize||8.25)*96/72,font=`${p.FontItalic?'italic ':''}${p.FontBold?'bold ':''}${size}px ${fontFamily(p.FontName)}`;
  const chrome=model.type==='Label'?[0,0]:model.type==='TextBox'?[6,6]:model.type==='CommandButton'?[18,10]:[20,4];
  const metricsKey='metrics:'+font;
  let metrics=cached(metricsKey);
  if(!metrics){context.font=font;const m=context.measureText('Mg');metrics=remember(metricsKey,{lineHeight:Math.max(size*1.2,(m.fontBoundingBoxAscent||size)+(m.fontBoundingBoxDescent||0)),ascent:m.fontBoundingBoxAscent||m.actualBoundingBoxAscent||size*.8});}
  const baseline=(chrome[1]/2+metrics.ascent)*15;
  if(!p.LayoutWidthMode&&!p.LayoutHeightMode)return {...fallback,baseline};
  const raw=String(model.type==='TextBox'?p.Text??'':p.Caption??p.Text??'');
  const text=model.type==='TextBox'?raw:raw.replace(/&&/g,'\u0000').replace(/&(?=.)/g,'').replace(/\u0000/g,'&');
  const wrap=(model.type==='Label'||model.type==='CommandButton'||p.MultiLine)&&p.LayoutWidthMode!==1,available=Math.max(1,Number(p.Width||0)/15-chrome[0]);
  const key=JSON.stringify([font,text,wrap?available:0,model.type]),hit=cached(key);if(hit)return hit;
  context.font=font;const {width,lineCount:lines}=measureWrappedText(text,t=>context.measureText(t).width,available,{wrap});
  return remember(key,{preferredWidth:(width+chrome[0])*15,preferredHeight:(lines*metrics.lineHeight+chrome[1])*15,baseline});
}
export const hasLayoutMeasurement=model=>measuredTypes.has(model.type);
export function clearLayoutMeasurements(){cache.clear();cacheCost=0;}
export function layoutMeasurementCacheStats(){return {entries:cache.size,estimatedBytes:cacheCost,maxEntries:MAX_ENTRIES,maxEstimatedBytes:MAX_COST};}
