import {compileModule} from '../compiler-core.js';
import {bindConstants} from '../binding.js';
import {moduleLanguage} from '../../project/language.js';
import {builtinType} from '../type-catalog.js';
import {parseParameters} from '../declarations.js';
import {pascalFormControlTypes} from './form-bindings.js';

const key = value => String(value).toLowerCase();
const visible = value => value.scope !== 'private';
const append = (map, name, value) => {const normalized = key(name); const values = map.get(normalized) || []; values.push(value); map.set(normalized, values);};

/** A read-only view of the existing VB declaration/constant binder. The view is
 * local to one Pascal workspace: source edits and target constants cannot leak
 * through a global cache, and neither parser executes project code. */
export class PascalForeignBindings {
  constructor(project, foreignType) {
    this.project = project; this.foreignType = foreignType; this.modules = new Map();
    this.types = new Map(); this.publicTypes = new Map(); this.globals = new Map(); this.memberTables = new Map(); this.formTypes = new WeakMap();
    for (const input of project?.modules || []) if (moduleLanguage(input, project) === 'vb6') {
      const module = compileModule({...input, conditionalConstants: project.settings?.conditionalConstants || {}});
      this.modules.set(key(module.name), module);
    }
    this.diagnostics = bindConstants(this.modules, project?.settings || {});
    // Register nominal identities before resolving record fields and signatures.
    for (const module of this.modules.values()) {
      if (module.kind !== 'module') {
        const type = {kind: 'object', name: module.name, catalogName: module.name, foreign: true, vb: module.name, foreignModule: module, ...(module.form ? {catalogName: module.form.type || 'Form'} : {})};
        this.types.set(key(module.name), type); append(this.publicTypes, module.name, type);
      }
      for (const name of Object.keys(module.types)) {
        const type = {kind: 'record', name, vb: name, identity: 'vb:' + key(module.name + '.' + name), owner: module, foreign: true, fields: new Map(), resolving: false, resolved: false};
        this.types.set(key(module.name + '.' + name), type);
        if (module.typeScopes[key(name)] !== 'private') append(this.publicTypes, name, type);
      }
      for (const enumeration of Object.values(module.enums)) {
        const type = {...foreignType('Long'), kind: 'enum', name: enumeration.name, identity: 'vb:' + key(module.name + '.' + enumeration.name), owner: module, foreignMembers: new Map()};
        for (const name of enumeration.members) type.foreignMembers.set(key(name), {kind: 'constant', name, type, value: module.constantBindings.get(key(name)), foreign: true, resolved: true, owner: module});
        this.types.set(key(module.name + '.' + enumeration.name), type);
        if (visible(enumeration)) append(this.publicTypes, enumeration.name, type);
      }
    }
    for (const module of this.modules.values()) {
      const members = new Map(); this.memberTables.set(module, members);
      for (const declaration of module.declarations) {
        const symbol = {kind: declaration.constant ? 'constant' : 'variable', name: declaration.name, vbName: declaration.name, owner: module, foreign: true, resolved: true, public: visible(declaration), declaration,
          type: this.declarationType(declaration, module), ...(declaration.constant ? {value: module.constantBindings.get(key(declaration.name))} : {})};
        members.set(key(symbol.name), symbol);
        if (symbol.public && (module.kind === 'module' || declaration.enumName)) append(this.globals, symbol.name, symbol);
      }
      for (const procedure of module.procedures.values()) {
        const signature = this.signature(procedure, module);
        if (procedure.kind === 'property') {
          let property = members.get(key(procedure.name));
          if (!property || property.kind !== 'foreignProperty') {
            property = {kind: 'foreignProperty', name: procedure.name, vbName: procedure.name, owner: module, foreign: true, resolved: true, public: false};
            members.set(key(procedure.name), property);
          }
          property[procedure.accessor] = signature; property.public ||= signature.public;
        } else members.set(key(procedure.name), signature);
      }
      for (const symbol of members.values()) {
        if (symbol.kind === 'foreignProperty') symbol.type = symbol.get?.returnType || symbol.let?.params.at(-1)?.type || symbol.set?.params.at(-1)?.type;
        if (module.kind === 'module' && symbol.public && ['procedure', 'foreignProperty'].includes(symbol.kind)) append(this.globals, symbol.name, symbol);
      }
    }
  }
  signature(procedure, module) {
    const returns = procedure.kind === 'function' || procedure.kind === 'property' && procedure.accessor === 'get';
    return {kind: 'procedure', name: procedure.name, vbName: procedure.name, owner: module, foreign: true, resolved: true, public: visible(procedure), accessor: procedure.accessor,
      params: procedure.params.map(parameter => ({...parameter, type: this.declarationType(parameter, module)})),
      returnType: returns ? this.declarationType({type: procedure.returnType, bounds: procedure.returnArray ? [] : null}, module) : null,
      declaration: procedure};
  }
  resolveRecord(type) {
    if (type.kind !== 'record' || type.resolved || type.resolving) return type;
    type.resolving = true;
    for (const field of type.owner.types[type.name]) type.fields.set(key(field.name), {name: field.name, type: this.declarationType(field, type.owner), declaration: field});
    type.resolving = false; type.resolved = true; return type;
  }
  namedType(name, module = null) {
    const normalized = key(name);
    const own = module && this.types.get(key(module.name + '.' + name));
    if (own) return this.resolveRecord(own);
    const direct = this.types.get(normalized); if (direct) return this.resolveRecord(direct);
    const matches = this.publicTypes.get(normalized);
    if (matches?.length === 1) return this.resolveRecord(matches[0]);
    return this.foreignType(name);
  }
  declarationType(declaration, module) {
    const element = this.namedType(declaration.type || 'Variant', module);
    if (!Array.isArray(declaration.bounds)) return element;
    const dimensions = (declaration.boundValues || []).map(([low, high]) => ({low, high}));
    return {kind: 'array', name: element.name + ' array', vb: element.vb, element, dimensions, dynamic: !dimensions.length, foreign: true, identity: 'vb-array:' + (element.identity || key(element.name)) + ':' + dimensions.map(value => value.low + '..' + value.high).join(',')};
  }
  publicType(name, fail, node) {
    const normalized = key(name), dot = normalized.indexOf('.');
    if (dot >= 0 && this.modules.has(normalized.slice(0, dot))) {
      const module = this.modules.get(normalized.slice(0, dot)), type = this.types.get(normalized);
      const memberName = normalized.slice(dot + 1);
      if (!type || module.typeScopes[memberName] === 'private' || Object.values(module.enums).some(value => key(value.name) === memberName && !visible(value))) fail(`Visual Basic type '${name}' is not exported`, node, 'TP_FOREIGN_TYPE');
      return this.resolveRecord(type);
    }
    const matches = this.publicTypes.get(normalized) || [];
    if (matches.length > 1) fail(`Ambiguous Visual Basic type '${name}'`, node, 'TP_AMBIGUOUS');
    if (matches.length) return this.resolveRecord(matches[0]);
    if (builtinType(name) || ['currency', 'date', 'long'].includes(normalized)) return this.foreignType(name);
    return null;
  }
  resolve(name, fail, node) {
    const normalized = key(name), module = this.modules.get(normalized);
    if (module?.kind === 'module') return {kind: 'foreignNamespace', name: module.name, vbName: module.name, foreign: true, resolved: true, type: {kind: 'namespace', name: module.name, foreignModule: module}};
    if (module?.form) return {kind: 'external', name: module.name, vbName: module.name, foreign: true, resolved: true, type: this.types.get(normalized)};
    const type = this.publicType(name, fail, node);
    if (type) return {kind: 'type', name, type, foreign: true, resolved: true};
    const matches = this.globals.get(normalized) || [];
    if (matches.length > 1) fail(`Ambiguous Visual Basic identifier '${name}'`, node, 'TP_AMBIGUOUS');
    return matches[0] || null;
  }
  formMember(form, name, fail, node) {
    let controls = this.formTypes.get(form);
    if (!controls) {controls = pascalFormControlTypes(form, this.foreignType, message => fail(message, node, 'TP_FORM_DECLARATION')); this.formTypes.set(form, controls);}
    const control = key(name) !== key(form.name) ? controls.get(key(name)) : null;
    if (control) return {kind: 'variable', name, vbName: name, type: control, foreign: true, foreignHost: true, resolved: true, public: true};
    const member = builtinType(form.type || 'Form')?.members.find(value => key(value.name) === key(name));
    if (!member) return null;
    if (!member.params) return {kind: 'variable', name: member.name, vbName: member.name, type: this.foreignType(member.type), foreign: true, foreignHost: true, resolved: true, public: true};
    const params = parseParameters(member.params.join(', ')).map((parameter, index) => ({...parameter, byRef: /\bByRef\b/i.test(member.params[index]), type: this.declarationType(parameter, null)}));
    return {kind: 'procedure', name: member.name, vbName: member.name, params, returnType: member.type === 'Void' ? null : this.foreignType(member.type), foreign: true, foreignHost: true, resolved: true, public: true};
  }
  member(type, name, fail, node) {
    if (type.foreignMembers) {
      const symbol = type.foreignMembers.get(key(name));
      if (!symbol) fail(`Visual Basic type '${type.name}' has no member '${name}'`, node, 'TP_FOREIGN_MEMBER');
      return symbol;
    }
    if (!type.foreignModule) return null;
    const declaredType = this.types.get(key(type.foreignModule.name + '.' + name));
    if (type.kind === 'namespace' && declaredType) return {kind: 'type', name, type: this.publicType(type.foreignModule.name + '.' + name, fail, node), foreign: true, resolved: true};
    const symbol = this.memberTables.get(type.foreignModule)?.get(key(name));
    if (symbol) {if (!symbol.public) fail(`Visual Basic member '${type.name}.${name}' is not exported`, node, 'TP_FOREIGN_MEMBER'); return symbol;}
    if (type.foreignModule.form) {const member = this.formMember(type.foreignModule.form, name, fail, node); if (member) return member;}
    fail(`Visual Basic member '${type.name}.${name}' is not exported`, node, 'TP_FOREIGN_MEMBER');
  }
}
