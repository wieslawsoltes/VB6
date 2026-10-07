import {fontFamily} from '../theme/theme.js';
let context;const cache=new Map();
const measuredTypes=new Set(['Label','CommandButton','TextBox','CheckBox','OptionButton']);
/** Browser adapter only: logical text metrics use the actual installed font.
 * Unknown/custom controls retain their explicit preferred bounds. */
export function measureLayoutControl(model){
  const p=model.properties||model.props||{},fallback={preferredWidth:Number(p.Width||0),preferredHeight:Number(p.Height||0)};
  if(!measuredTypes.has(model.type)||!p.LayoutWidthMode&&!p.LayoutHeightMode&&p.LayoutAlign!==4)return fallback;
  if(!context){try{context=typeof OffscreenCanvas==='function'?new OffscreenCanvas(1,1).getContext('2d'):globalThis.document?.createElement('canvas').getContext('2d');}catch{}if(!context)return fallback;}
  const size=Number(p.FontSize||8.25)*96/72,font=`${p.FontItalic?'italic ':''}${p.FontBold?'bold ':''}${size}px ${fontFamily(p.FontName)}`;
  const raw=String(model.type==='TextBox'?p.Text??'':p.Caption??p.Text??'');
  const text=model.type==='TextBox'?raw:raw.replace(/&&/g,'\u0000').replace(/&(?=.)/g,'').replace(/\u0000/g,'&');
  const chrome=model.type==='Label'?[0,0]:model.type==='TextBox'?[6,6]:model.type==='CommandButton'?[18,10]:[20,4];
  const wrap=(model.type==='Label'||p.MultiLine)&&p.LayoutWidthMode!==1,available=Math.max(1,Number(p.Width||0)/15-chrome[0]);
  const key=JSON.stringify([font,text,wrap?available:0,model.type]);if(cache.has(key))return cache.get(key);
  context.font=font;let width=0,lines=0;
  for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
    if(!wrap){width=Math.max(width,context.measureText(paragraph).width);lines++;continue;}
    let line='';for(const word of paragraph.split(/(\s+)/)){
      const next=line+word;if(line&&context.measureText(next).width>available){width=Math.max(width,context.measureText(line).width);lines++;line=word.trimStart();}else line=next;
    }
    width=Math.max(width,context.measureText(line).width);lines++;
  }
  const metrics=context.measureText('Mg'),lineHeight=Math.max(size*1.2,(metrics.fontBoundingBoxAscent||size)+(metrics.fontBoundingBoxDescent||0));
  const result={preferredWidth:(width+chrome[0])*15,preferredHeight:(lines*lineHeight+chrome[1])*15,baseline:(chrome[1]/2+(metrics.fontBoundingBoxAscent||size*.8))*15};
  if(cache.size>=4096)cache.clear();cache.set(key,result);return result;
}
export const hasLayoutMeasurement=model=>measuredTypes.has(model.type);
export function clearLayoutMeasurements(){cache.clear();}
