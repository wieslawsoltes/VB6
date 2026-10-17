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
