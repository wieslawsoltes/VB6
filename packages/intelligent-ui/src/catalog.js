import {ICON_PATHS} from './icons.js';
import {UIError, record, safeKey} from './safety.js';

const common = {key:'string', name:'string', label:'string', title:'string', hidden:'boolean', disabled:'boolean', padding:'spacing', gap:'spacing', border:'boolean', block:'boolean', width:'dimension', height:'dimension', maxWidth:'dimension', tone:['default','muted','accent','success','warning','danger'], size:['xs','sm','md','lg','xl']};
const specs = {
  box:{}, row:{}, column:{}, grid:{columns:'columns'}, title:{level:'level'}, text:{}, caption:{}, bold:{}, italic:{}, code:{}, codeBlock:{language:'string'}, quote:{}, divider:{}, list:{ordered:'boolean'}, listItem:{}, badge:{}, icon:{name:Object.keys(ICON_PATHS),inline:'boolean'},
  button:{onClick:'event',submit:'boolean'}, link:{href:'url',onClick:'event'},
  slider:{min:'number',max:'number',step:'positive',value:'number',onChange:'event'},
  input:{value:'primitive',placeholder:'string',type:['text','number','email','search','date'],onChange:'event',required:'boolean'},
  textarea:{value:'string',placeholder:'string',rows:'rows',onChange:'event',required:'boolean'},
  checkbox:{checked:'boolean',value:'boolean',onChange:'event'}, radio:{checked:'boolean',value:'string',name:'string',onChange:'event'},
  select:{value:'string',onChange:'event',required:'boolean'}, option:{value:'string'},
  form:{onSubmit:'event'}, progress:{value:'number',max:'positive'}, metric:{value:'primitive',unit:'string',change:'primitive'},
  table:{rows:'array',columns:'array',pageSize:'pageSize'}, chart:{data:'array',x:'string',y:'string',kind:['bar','line'],unit:'string'},
  tabs:{value:'string',onChange:'event'}, tab:{value:'string'}, details:{open:'boolean'}, summary:{},
  image:{src:'url',alt:'string',ref:'string',aspectRatio:'ratio',objectFit:['contain','cover']}, AsyncImage:{query:'string',ref:'string',alt:'string',aspectRatio:'ratio',objectFit:['contain','cover']}, AsyncImageGroup:{ref:'string',aspectRatio:'ratio',objectFit:['contain','cover']},
  Entity:{ref:'string'}, Cite:{ref:'string'}, AppBlock:{title:'string',app_block_id:'string'},
  // These primitives can be supplied by a host renderer. The default DOM renderer has matching semantic fallbacks.
  VB6Button:{caption:'string',onClick:'event'}, VB6TextBox:{value:'string',onChange:'event'}, VB6CheckBox:{checked:'boolean',caption:'string',onChange:'event'}, VB6Label:{caption:'string'}
};
export const CATALOG = Object.freeze(Object.fromEntries(Object.entries(specs).map(([name,props])=>[name,Object.freeze({...common,...props})])));
export function createCatalog(extensions = {}) {
  if(!record(extensions))throw new UIError('catalog','Catalog extensions must be an object.');
  const result = {...CATALOG};
  for(const [name,props] of Object.entries(extensions)){safeKey(name);if(!/^[A-Za-z][\w]*$/.test(name)||!record(props))throw new UIError('catalog','Invalid component descriptor.');for(const key of Object.keys(props))safeKey(key);result[name]=Object.freeze({...common,...props});}
  return Object.freeze(result);
}
export function validProp(type, value, event = false) {
  if(type==='event')return event;
  if(Array.isArray(type))return type.includes(value);
  if(type==='primitive')return ['string','number','boolean'].includes(typeof value);
  if(type==='array')return Array.isArray(value);
  if(type==='dimension')return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=4096 || typeof value==='string'&&/^(?:auto|100%|\d{1,4}(?:px|%))$/.test(value);
  if(type==='url')return typeof value==='string';
  if(type==='ratio') {
    const parts=typeof value==='string'&&/^[0-9]{1,3}[:/][0-9]{1,3}$/.test(value)?value.split(/[:/]/).map(Number):null;
    const ratio=parts?parts[0]/parts[1]:value;
    return typeof ratio==='number'&&Number.isFinite(ratio)&&ratio>=1/16&&ratio<=16;
  }
  if(['spacing','columns','rows','pageSize','level'].includes(type)){const ranges={spacing:[0,12],columns:[1,12],rows:[1,30],pageSize:[1,100],level:[1,6]};return Number.isInteger(value)&&value>=ranges[type][0]&&value<=ranges[type][1];}
  if(type==='positive')return typeof value==='number'&&Number.isFinite(value)&&value>0;
  if(type==='number')return typeof value==='number'&&Number.isFinite(value);
  return typeof value===type;
}
export function catalogDescription(catalog = CATALOG) {return Object.entries(catalog).map(([name,props])=>({name,properties:props}));}
