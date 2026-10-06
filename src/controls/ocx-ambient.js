/** Standard ActiveX ambient DISPIDs, independent of DOM and native COM objects.
 * https://learn.microsoft.com/windows/win32/com/ambient-properties-for-controls
 */
export const OCX_AMBIENT_DISPIDS=Object.freeze({
  BackColor:-701,DisplayName:-702,Font:-703,ForeColor:-704,LocaleID:-705,
  MessageReflect:-706,ScaleUnits:-707,TextAlign:-708,UserMode:-709,
  UIDead:-710,ShowGrabHandles:-711,ShowHatching:-712,DisplayAsDefault:-713,
  SupportsMnemonics:-714,AutoClip:-715,Appearance:-716
});
const booleans=new Set(['MessageReflect','UserMode','UIDead','ShowGrabHandles','ShowHatching','DisplayAsDefault','SupportsMnemonics','AutoClip']);
const names=new Map(Object.keys(OCX_AMBIENT_DISPIDS).map(n=>[n.toLowerCase(),n]));
const defaults=Object.freeze({BackColor:0x8000000f,ForeColor:0x80000012,DisplayName:'',LocaleID:1033,MessageReflect:0,ScaleUnits:'Twips',TextAlign:0,UserMode:-1,UIDead:0,ShowGrabHandles:0,ShowHatching:0,DisplayAsDefault:0,SupportsMnemonics:-1,AutoClip:-1,Appearance:1});
const defaultFont=Object.freeze({Name:'MS Sans Serif',Size:8.25,Bold:0,Italic:0,Underline:0,Strikethrough:0,Charset:0,Weight:400});
function boolean(value){if(value===true)return -1;if(value===false)return 0;if(value!==0&&value!==-1)throw new TypeError('Ambient Boolean must be True/-1 or False/0');return value;}
function font(value){
  if(!value||typeof value!=='object'||Array.isArray(value))throw new TypeError('Invalid ambient Font');
  const next={...defaultFont};
  for(const key of Object.keys(value)){
    if(!Object.hasOwn(defaultFont,key))throw new TypeError('Unknown Font property: '+key);
    const v=value[key];
    if(key==='Name'){if(typeof v!=='string'||!v.length||v.length>255)throw new TypeError('Invalid font name');}
    else if(key==='Size'){if(!Number.isFinite(v)||v<=0||v>10000)throw new RangeError('Invalid font size');}
    else if(key==='Charset'){if(!Number.isInteger(v)||v<0||v>255)throw new RangeError('Invalid font charset');}
    else if(key==='Weight'){if(!Number.isInteger(v)||v<0||v>1000)throw new RangeError('Invalid font weight');}
    else {next[key]=boolean(v);continue;}next[key]=v;
  }
  if(!Object.hasOwn(value,'Weight'))next.Weight=next.Bold?700:400;
  if(!Object.hasOwn(value,'Bold'))next.Bold=next.Weight>=700?-1:0;
  return Object.freeze(next);
}
function normalize(name,value){
  if(booleans.has(name))return boolean(value);
  if(name==='Font')return font(value);
  if(name==='DisplayName'||name==='ScaleUnits'){if(typeof value!=='string'||value.length>255)throw new TypeError('Invalid '+name);return value;}
  if(!Number.isInteger(value))throw new TypeError('Invalid '+name);
  if(name==='BackColor'||name==='ForeColor'){if(value< -2147483648||value>4294967295)throw new RangeError('Invalid OLE_COLOR');}
  else if(name==='LocaleID'){if(value<0||value>0xfffff)throw new RangeError('Invalid locale');}
  else if(name==='TextAlign'){if(value<0||value>2)throw new RangeError('Invalid TextAlign');}
  else if(value<0||value>1)throw new RangeError('Invalid Appearance');
  return value;
}
export class OcxAmbientProperties {
  #values={...defaults,Font:defaultFont};#changed;
  constructor(initial={},onChanged=()=>{}){
    if(typeof onChanged!=='function')throw new TypeError('Ambient notification must be a function');
    this.update(initial,false);this.#changed=onChanged;
    for(const name of Object.keys(OCX_AMBIENT_DISPIDS))Object.defineProperty(this,name,{enumerable:true,get:()=>this.#values[name]});
    Object.freeze(this);
  }
  get(nameOrDispid){
    const name=typeof nameOrDispid==='number'?Object.keys(OCX_AMBIENT_DISPIDS).find(n=>OCX_AMBIENT_DISPIDS[n]===nameOrDispid):names.get(String(nameOrDispid).toLowerCase());
    if(!name)throw new TypeError('Unknown ambient property');return this.#values[name];
  }
  update(changes,notify=true){
    if(!changes||typeof changes!=='object'||Array.isArray(changes))throw new TypeError('Invalid ambient properties');
    const next={...this.#values},keys=new Set();
    for(const key of Object.keys(changes)){const name=names.get(key.toLowerCase());if(!name||keys.has(name))throw new TypeError('Unknown or duplicate ambient property: '+key);keys.add(name);next[name]=normalize(name,changes[key]);}
    const changed=[...keys].filter(name=>JSON.stringify(next[name])!==JSON.stringify(this.#values[name]));
    this.#values=next;
    if(notify){const errors=[];for(const name of changed)try{this.#changed?.(name,OCX_AMBIENT_DISPIDS[name]);}catch(error){errors.push(error);}if(errors.length===1)throw errors[0];if(errors.length)throw new AggregateError(errors,'Ambient notification failed');}
    return changed;
  }
  snapshot(){return {...this.#values,Font:{...this.#values.Font}};}
}
/** OLE uses HIMETRIC (0.01 mm); screen conversions take actual host DPI. */
export function ocxTransformCoords(point,{from='himetric',to='pixels',dpiX=96,dpiY=dpiX}={}){
  if(!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isFinite(dpiX)||!Number.isFinite(dpiY)||dpiX<=0||dpiY<=0||dpiX>10000||dpiY>10000)throw new RangeError('Invalid coordinates or DPI');
  const units={himetric:[2540,2540],twips:[1440,1440],points:[72,72],pixels:[dpiX,dpiY]};
  if(!Object.hasOwn(units,from)||!Object.hasOwn(units,to))throw new TypeError('Unknown coordinate units');
  return {x:point.x/units[from][0]*units[to][0],y:point.y/units[from][1]*units[to][1]};
}
