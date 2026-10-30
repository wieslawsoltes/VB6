const lower = value => String(value).toLowerCase();

function definition(modules, identity) {
  const at = String(identity).indexOf('.');
  if (at < 1) return null;
  const module = modules.get(lower(identity.slice(0, at)));
  if (module?.language !== 'pascal') return null;
  const object = module.pascal?.objectTypes?.find(value => lower(value.identity) === lower(identity));
  if (!object || lower(module.name) + '.' + lower(object.name) !== lower(identity)) return null;
  const fields = Object.entries(module.types).find(([name]) => lower(name) === lower(object.name))?.[1];
  return fields ? {module, object, fields} : null;
}

function fieldType(field, module) {
  const type = lower(field.storageType || field.type);
  if (type.includes('.')) return type;
  return Object.keys(module.types).some(name => lower(name) === type) ? lower(module.name) + '.' + type : type;
}

function prefix(descendant, ancestor) {
  if (descendant.fields.length < ancestor.fields.length) return false;
  return ancestor.fields.every((field, index) => {
    const other = descendant.fields[index];
    return lower(field.name) === lower(other.name) && fieldType(field, ancestor.module) === fieldType(other, descendant.module)
      && field.fixedLength === other.fixedLength && JSON.stringify(field.bounds) === JSON.stringify(other.bounds);
  });
}

/** Turbo Pascal permits a descendant object variable as an ancestor var
 * argument. This opt-in relationship is compiler metadata backed by identical
 * declared field prefixes. Ordinary VB records retain nominal type identity.
 */
export function pascalObjectReferenceCompatible(modules, sourceIdentity, targetIdentity) {
  if (!sourceIdentity || !targetIdentity || sourceIdentity === targetIdentity) return false;
  let current = definition(modules, sourceIdentity);
  const target = lower(targetIdentity), seen = new Set();
  while (current?.object.parent && seen.size < 128) {
    const identity = lower(current.object.identity);
    if (seen.has(identity)) return false;
    seen.add(identity);
    const parent = current.object.parent;
    if (lower(parent.module) + '.' + lower(parent.name) !== lower(parent.identity)) return false;
    const ancestor = definition(modules, parent.identity);
    if (!ancestor || !prefix(current, ancestor)) return false;
    if (lower(ancestor.object.identity) === target) return true;
    current = ancestor;
  }
  return false;
}

/** A generated virtual thunk may narrow its ancestor Self to the defining type
 * of an override. Return the allowed runtime tags only after independently
 * checking the receiver, implementation and every nominal ancestry link.
 * Source code cannot opt into this contract: __Pascal names are reserved.
 */
export function pascalObjectDispatchBranches(modules, callerModule, callerProcedure, receiverName, targetModule, targetProcedure, viewIdentity) {
  const module=modules.get(lower(callerModule)), target=modules.get(lower(targetModule));
  if(module?.language!=='pascal'||target?.language!=='pascal'||!/^__PascalDispatch_/i.test(callerProcedure)||!/^__PascalMethod_/i.test(targetProcedure))return null;
  const dispatch=module.pascal?.objectDispatchers?.find(value=>lower(value.name)===lower(callerProcedure));
  if(!dispatch||lower(dispatch.receiver.parameter)!==lower(receiverName)||dispatch.receiver.vmtField!=='__PascalTypeId')return null;
  const receiver=definition(modules,dispatch.receiver.identity),view=definition(modules,viewIdentity);
  const caller=module.procedures.get(lower(callerProcedure)),callee=target.procedures.get(lower(targetProcedure));
  if(!receiver||!view||!receiver.object.hasVmt||!caller?.params[0]?.byRef||!callee?.params[0]?.byRef)return null;
  if(lower(caller.params[0].name)!==lower(receiverName)||fieldType(caller.params[0],module)!==lower(receiver.object.identity)||fieldType(callee.params[0],target)!==lower(view.object.identity))return null;
  if(!view.object.methods?.some(method=>method.virtual&&lower(method.vbName)===lower(targetProcedure)&&lower(method.module)===lower(targetModule)&&lower(method.declaringType)===lower(view.object.name)))return null;
  const compatible=(from,to)=>lower(from)===lower(to)||pascalObjectReferenceCompatible(modules,from,to);
  const branches=dispatch.branches.filter(branch=>lower(branch.targetModule)===lower(targetModule)&&lower(branch.targetProcedure)===lower(targetProcedure)&&lower(branch.viewType)===lower(viewIdentity));
  if(!branches.length||branches.some(branch=>{
    const runtime=definition(modules,branch.runtimeType);
    return !runtime||!runtime.object.hasVmt||!Number.isInteger(branch.typeId)||branch.typeId<1||branch.typeId>2147483647||runtime.object.typeId!==branch.typeId||!compatible(runtime.object.identity,receiver.object.identity)||!compatible(runtime.object.identity,view.object.identity);
  }))return null;
  const header=receiver.fields[0];
  if(!header||header.name!==dispatch.receiver.vmtField||lower(header.type)!=='long'||header.bounds!=null)return null;
  return {receiver:dispatch.receiver,branches};
}
