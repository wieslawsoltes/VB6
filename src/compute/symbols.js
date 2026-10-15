import {externalSymbolSnapshot,projectSymbolSnapshot} from '../language/symbol-snapshot.js';

// The opt-in compute target owns these names. They are not ordinary VB6 globals.
const fn=(name,type,params=[])=>Object.freeze({name,type,params:Object.freeze(params)});
export const COMPUTE_SYMBOLS=Object.freeze([
  Object.freeze({name:'Me',type:'Object',readOnly:true}), // synthetic graphics receiver, never a native Form
  ...['Index','Count','Width','Height','LocalIndex','GroupIndex','GroupCount','WorkgroupSize','SharedLength'].map(n=>fn('Compute'+n,'Long')),
  fn('ComputeTime','Single'),
  fn('ComputeLoad','Long',['ByVal index As Long']),fn('ComputeStore','Void',['ByVal index As Long','ByVal value As Long']),
  fn('Cls','Void'),
  ...['Long','Single'].flatMap(t=>[fn('ComputeLoad'+t,t,['ByVal index As Long']),fn('ComputeStore'+t,'Void',['ByVal index As Long','ByVal value As '+t])]),
  ...['Add','Sub','Exchange','And','Or','Xor'].map(n=>fn('ComputeAtomic'+n,'Long',['ByVal index As Long','ByVal value As Long'])),
  fn('ComputeAtomicCompareExchange','Long',['ByVal index As Long','ByVal compare As Long','ByVal value As Long']),
  ...['Sin','Cos','Tan','Atan','Sqrt','Exp','Log'].map(n=>fn('Compute'+n,'Single',['ByVal value As Single'])),
  ...['Min','Max'].map(n=>fn('Compute'+n,'Single',['ByVal a As Single','ByVal b As Single'])),
  fn('ComputeClear','Void',['ByVal color As Long']),
  fn('ComputeRect','Void',['ByVal x As Single','ByVal y As Single','ByVal width As Single','ByVal height As Single','ByVal color As Long']),
  fn('ComputeLine','Void',['ByVal x1 As Single','ByVal y1 As Single','ByVal x2 As Single','ByVal y2 As Single','ByVal width As Single','ByVal color As Long']),
  fn('ComputeCircle','Void',['ByVal x As Single','ByVal y As Single','ByVal radius As Single','ByVal color As Long'])
]);
/** Metadata for source validation; final WGSL checks retain their own type,
 * argument and effect validation. The input namespace is temporary only while
 * checking an application before its generated source module exists. */
export function computeSourceProject(project,{input=false}={}) {
  const metadata=projectSymbolSnapshot(project),extras=input?[{name:'ComputeInput',type:'Object'}]:[];
  return {...project,symbolMetadata:{...metadata,globals:[...externalSymbolSnapshot(metadata.globals),...COMPUTE_SYMBOLS,...extras]}};
}
// Retain the existing extension API and its declaration-rich public symbols.
export function computeSymbolProject(project) {
  return {...project,externalSymbols:[...externalSymbolSnapshot(project.externalSymbols),...COMPUTE_SYMBOLS]};
}
