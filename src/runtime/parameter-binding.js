import {Cell,LazyCell,Ref,VBArray,SCALAR_TYPES,NOTHING,unbox,coerce,scalarType,storageScalar,readScalar,arrayTypeMatches,recordTypeMatches,recordIdentity} from './values.js';
import {pascalObjectReferenceCompatible} from '../language/pascal/object-compatibility.js';
import {inheritReferenceOwners} from './array-lifetime.js';
import {VBError} from '../language/errors.js';
const lower=value=>String(value).toLowerCase();

/** Variant is the formal's declared view, even when its backing variable holds
 * a record, array, object or Nothing. Writes still use the original storage's
 * coercion and lifetime checks. Forwarding an existing view does not unwrap it.
 * MS-VBAL 5.3.1.11; this is not an external VARIANT/SAFEARRAY representation. */
export function variantParameterReference(ref) {
  if(lower(ref.type)==='variant')return ref;
  const asVariant=value=>scalarType(value)?storageScalar(value,'Variant'):value;
  const view=inheritReferenceOwners(ref,new Ref(()=>ref.get(),value=>ref.set(value),'Variant',ref.fixedLength,async()=>asVariant(await readScalar(ref))));
  view.assignmentType=ref.assignmentType||ref.type;
  for(const key of ['isArray','elementType','elementIdentity','constant'])if(ref[key]!==undefined)view[key]=ref[key];
  // Only existing storage-backed inspection paths are exposed. Never install a
  // watch getter for an arbitrary host/property accessor.
  if(ref instanceof Cell||typeof ref.debugGetScalar==='function'){
    view.debugGetScalar=()=>asVariant(ref instanceof Cell?ref.getScalar():ref.debugGetScalar());
    view.debugGet=()=>unbox(view.debugGetScalar());
  }
  return view;
}

/** Bind a genuine source-variable argument. Value/property/function arguments
 * are handled by the caller's existing temporary construction path. A returned
 * copyBack must run once, in formal order, only after normal procedure/event
 * completion; argument failures, escaping errors and reset must not invoke it. */
export async function bindReferenceParameter(vm,param,ref,module) {
  const type=param.storageType||param.type,key=lower(type);
  if(key==='variant'&&!Array.isArray(param.bounds))return {cell:variantParameterReference(ref)};
  // Scalar aliases are defined by their declared type, not their current
  // value. Do not execute a getter or resolve project records to bind them.
  if(!Array.isArray(param.bounds)&&Object.hasOwn(SCALAR_TYPES,key)){
    if(lower(ref.type)!==key)throw new VBError('ByRef argument type mismatch',13);
    return {cell:ref};
  }
  const record=vm.recordDefinition(type,module);
  if(Array.isArray(param.bounds)){
    const value=await ref.get();
    if(!arrayTypeMatches(value,type,record?.identity))throw new VBError('ByRef array type mismatch',13);
    return {cell:ref};
  }
  if(record){
    const value=await ref.get();
    if(lower(ref.type)==='variant'||!recordTypeMatches(value,type,record.identity)&&!pascalObjectReferenceCompatible(vm.program.modules,recordIdentity(value),record.identity))throw new VBError('ByRef user-defined type mismatch',13);
    return {cell:ref};
  }
  // Remaining named types are object types owned by their source/host adapter.
  // Check both the argument's declared category and its value, including Nothing.
  const sourceType=lower(ref.type);
  if(sourceType==='variant'||Object.hasOwn(SCALAR_TYPES,sourceType)||ref.isArray)throw new VBError('ByRef object type mismatch',13);
  // A typed As New cell is a variable, not a value expression. Same-type
  // binding must not run Class_Initialize before the callee first reads it.
  // Other adapters still undergo value validation below.
  if(sourceType===key&&ref instanceof LazyCell)return {cell:ref};
  const value=await ref.get();
  if(value instanceof VBArray||value?.__fields)throw new VBError('ByRef object type mismatch',13);
  if(value!==NOTHING)coerce(value,'Object');
  const checked=coerce(value,type);
  if(sourceType===key)return {cell:ref};
  const cell=new Cell(type,checked);
  return {cell,copyBack:()=>ref.set(cell.get())};
}
