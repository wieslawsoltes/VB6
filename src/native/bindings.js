/** Resolve compile-time values with their declaration types intact. The source
 * binder has already evaluated these expressions without executing user code.
 * Keep lexical visibility separate from the machine representation in EAX. */
import {VBCurrency} from '../runtime/values.js';
const key = value => String(value).toLowerCase();
const declarations = new WeakMap();
const supported = new Set(['byte','integer','long','boolean','single','double','currency','string']);
function scopeDeclarations(scope) {
  let result = declarations.get(scope);
  if (!result) {
    result = new Map();
    for (const d of scope.declarations || []) result.set(key(d.name),d);
    for (const ins of scope.code || []) if (ins.op === 'dim') for (const d of ins.decls) result.set(key(d.name),d);
    declarations.set(scope,result);
  }
  return result;
}
function descriptor(c, scope, name) {
  if (!scope?.constantBindings?.has(name)) return null;
  const value = scope.constantBindings.get(name), d = scopeDeclarations(scope).get(name);
  let type = key(d?.storageType || d?.type || 'variant');
  if (type === 'variant') {
    type = value instanceof VBCurrency ? 'currency' : typeof value === 'string' ? 'string' :
      typeof value === 'boolean' ? 'boolean' : typeof value === 'number' ?
      Number.isInteger(value) && value >= -32768 && value <= 32767 ? 'integer' :
      Number.isInteger(value) && value >= -2147483648 && value <= 2147483647 ? 'long' : 'double' : 'unknown';
  }
  if (!supported.has(type)) c.fail('Native constant type is not supported: '+(d?.name || name)+' As '+type);
  return {value,type};
}
export const nativeBindingMethods = {
  nativeConstant(node) {
    if (!node) return null;
    while (node.kind === 'group') node = node.expr;
    const context = this.context, owner = context?.module, module = owner?.module;
    if (node.kind === 'id') {
      const name = key(node.name);
      const local = descriptor(this,context?.proc,name);
      if (local) return local;
      // A local/parameter/return slot or module variable shadows public constants.
      if (context?.locals?.has(name) || owner?.globals?.has(name)) return null;
      const own = descriptor(this,module,name);
      if (own) return own;
      const matches = [];
      for (const m of this.modules.values()) if (m !== owner) {
        const d = scopeDeclarations(m.module).get(name);
        if (d?.constant && d.scope !== 'private' && (m.module.kind === 'module' || d.enumName)) matches.push(m.module);
      }
      if (matches.length > 1) this.fail('Ambiguous native constant: '+node.name);
      return matches.length ? descriptor(this,matches[0],name) : null;
    }
    if (node.kind !== 'member' || node.object.kind !== 'id') return null;
    const name = key(node.name), namespace = key(node.object.name), m = this.modules.get(namespace);
    if (m) {
      const d = scopeDeclarations(m.module).get(name);
      if (!d?.constant) return null;
      if (m !== owner && d.scope === 'private') this.fail('Private native constant is not accessible: '+node.object.name+'.'+node.name);
      return descriptor(this,m.module,name);
    }
    const enumeration = module?.enumBindings?.get(namespace);
    if (enumeration?.ambiguous) this.fail('Ambiguous native enum: '+node.object.name);
    if (enumeration && Object.hasOwn(enumeration.values,name)) return {type:'long',value:enumeration.values[name]};
    return null;
  },
  emitNativeConstant(binding) {
    const {type,value} = binding;
    if (type === 'currency') this.x.value(this.currencyLiteral(value));
    else if (type === 'single' || type === 'double') this.x.value(this.floatLiteral(value));
    else if (type === 'string') this.x.value(this.string(value));
    else {
      const n = typeof value === 'boolean' ? value ? -1 : 0 : value;
      if (!Number.isInteger(n) || n < -2147483648 || n > 2147483647) this.fail('Invalid native integral constant');
      this.x.value(n);
    }
  },
  nativeFunctionType(node) {
    if (node.kind === 'group') return this.nativeFunctionType(node.expr);
    const target = this.resolveProcedure(node.kind === 'call' ? node.callee : node);
    const signature = target?.proc || target;
    return signature?.kind === 'function' ? key(signature.returnType) : null;
  }
};
