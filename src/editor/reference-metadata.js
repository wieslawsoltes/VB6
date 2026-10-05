import {validParameterList} from './signature-syntax.js';
import {IDENTIFIER,TYPE_NAME,symbolKey,mapParameterType} from './source-context.js';
import {parameterSymbol} from './declaration-index.js';
import {member} from './type-catalog.js';

const identifier=new RegExp('^'+IDENTIFIER+'$','u');
const typeName=new RegExp('^'+TYPE_NAME+'$','u');
const memberKinds=new Set(['method','property','function','sub','event','constant','field','variable']);
const kinds=new Set(['class','interface','module','enum','type','alias']);
/** Reject accessors/functions before cloning; even toJSON must not execute. */
function metadataCopy(input){
  const active=new Set();let nodes=0,characters=0;
  const copy=(value,depth)=>{
    if(++nodes>100000||depth>32)throw new RangeError('Type-library metadata is too deeply nested');
    if(value===null||typeof value==='boolean')return value;
    if(typeof value==='string'){characters+=value.length;if(characters>4*1024*1024)throw new RangeError('Type-library metadata exceeds 4 MiB');return value;}
    if(typeof value==='number'&&Number.isFinite(value))return value;
    if(!value||typeof value!=='object'||active.has(value))throw new TypeError('Metadata must contain only acyclic JSON data');
    const array=Array.isArray(value),prototype=Object.getPrototypeOf(value);
    if(!array&&prototype!==Object.prototype&&prototype!==null)throw new TypeError('Metadata must contain plain objects');
    const result=array?[]:Object.create(null),descriptors=Object.getOwnPropertyDescriptors(value);active.add(value);
    for(const [key,descriptor] of Object.entries(descriptors)){
      if(!descriptor.enumerable)continue;
      if(!Object.hasOwn(descriptor,'value'))throw new TypeError('Metadata accessors are not allowed');
      Object.defineProperty(result,key,{enumerable:true,configurable:true,writable:true,value:copy(descriptor.value,depth+1)});
    }
    active.delete(value);return result;
  };
  return copy(input,0);
}
// Read only own data descriptors. Neither native-reference wrappers nor
// portable project metadata are allowed to run accessors/toJSON while an editor
// constructs a cache key. Malformed entries are isolated from valid neighbors.
function ownData(object,key){
  if(!object||typeof object!=='object')return undefined;
  const descriptor=Object.getOwnPropertyDescriptor(object,key);
  return descriptor&&Object.hasOwn(descriptor,'value')?descriptor.value:undefined;
}
function dataEntries(array){
  if(!Array.isArray(array)||array.length>4096)return [];
  const entries=[];
  for(let i=0;i<array.length;i++){const value=ownData(array,String(i));if(value!==undefined)entries.push(value);}
  return entries;
}
export function referenceSnapshot(project){
  const attached=dataEntries(ownData(project,'references')).flatMap(reference=>{
    if(!reference||typeof reference!=='object')return [];
    const missing=Object.getOwnPropertyDescriptor(reference,'missing');
    if(missing&&(!Object.hasOwn(missing,'value')||missing.value))return [];
    const library=ownData(reference,'typeLibrary');return library?[library]:[];
  });
  const descriptors=[];let size=0;
  for(const value of [...attached,...dataEntries(ownData(project,'typeLibraries'))]){
    try{
      const safe=metadataCopy(value);
      if(!safe||typeof safe!=='object'||Array.isArray(safe)||safe.enabled===false)continue;
      const json=JSON.stringify(safe);size+=json.length;
      if(size>4*1024*1024)return {key:'[]',descriptors:[]};
      descriptors.push(safe);
    }catch{/* Reject data with callbacks, cycles or invalid limits, not the editor. */}
  }
  return {key:JSON.stringify(descriptors),descriptors};
}
const clean=value=>String(value).replace(/\[([^\]]+)\]/g,'$1').replace(/\s*\.\s*/g,'.');
/** Portable, bounded, data-only metadata. Type names in signatures are resolved
 * in the declaring library, never accidentally in the consumer's module. */
export function normalizeTypeLibrary(name,types){
  if(typeof name!=='string'||!typeName.test(name)||!Array.isArray(types)||types.length>4096)throw new TypeError('Invalid type-library name or type list');
  const safe=metadataCopy(types),json=JSON.stringify(safe);
  if(json.length>4*1024*1024)throw new RangeError('Type-library metadata exceeds 4 MiB');
  const copy=JSON.parse(json),names=new Set(),library=clean(name);
  for(const type of copy){
    if(!type||typeof type.name!=='string'||!typeName.test(type.name)||!Array.isArray(type.members)||type.members.length>10000||!kinds.has(type.kind||'class'))throw new TypeError('Invalid type-library descriptor');
    const local=clean(type.name),full=local.toLowerCase().startsWith(library.toLowerCase()+'.')?local:library+'.'+local;
    if(names.has(symbolKey(full)))throw new TypeError('Duplicate type name: '+full);
    names.add(symbolKey(full));type.name=full;
  }
  const qualify=value=>{
    const text=clean(value||'Variant'),qualified=library+'.'+text;
    return names.has(symbolKey(qualified))?qualified:text;
  };
  let count=0;
  return copy.map(type=>{
    const kind=type.kind||'class';
    if(type.aliases!==undefined&&(!Array.isArray(type.aliases)||type.aliases.some(a=>typeof a!=='string'||!typeName.test(a))))throw new TypeError('Invalid type aliases');
    if(kind==='alias'&&(typeof type.target!=='string'||!typeName.test(type.target)))throw new TypeError('Invalid alias target');
    if(type.defaultMember!==undefined&&(typeof type.defaultMember!=='string'||!identifier.test(type.defaultMember)))throw new TypeError('Invalid default member');
    const members=type.members.map(raw=>{
      if(++count>50000)throw new RangeError('Too many type-library members');
      if(!raw||raw.accessors!==undefined||raw.kind!==undefined&&!memberKinds.has(raw.kind)||raw.accessor!==undefined&&!['get','let','set'].includes(raw.accessor)||typeof raw.name!=='string'||!identifier.test(raw.name)||raw.type!==undefined&&(typeof raw.type!=='string'||!typeName.test(raw.type))||raw.params!==undefined&&!validParameterList(raw.params))throw new TypeError('Invalid member descriptor');
      if(raw.accessor&&(!raw.params||raw.accessor!=='get'&&(!raw.params.length||/^\s*(?:Optional|ParamArray)\b/i.test(raw.params.at(-1)))))throw new TypeError('Invalid property accessor descriptor');
      const params=raw.params?.map(p=>mapParameterType(p,qualify));
      const valueType=kind==='enum'?type.name:qualify(raw.type);
      const result={...member(clean(raw.name),valueType,params??null),...raw,name:clean(raw.name),type:valueType,library,params,parameters:params?.map(p=>parameterSymbol(p)),insertText:raw.name};
      if(kind==='enum'){result.kind='constant';result.parentType=type.name;delete result.params;delete result.parameters;}
      if(!raw.signature)result.signature=result.kind==='constant'?result.name+(raw.value!==undefined?' = '+JSON.stringify(raw.value):' As '+valueType):member(result.name,valueType,params??null).signature;
      return result;
    });
    return {...type,kind,library,target:type.target?qualify(type.target):undefined,members};
  });
}
