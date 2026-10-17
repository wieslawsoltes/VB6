import {PascalError} from './lexer.js';
import {parsePascalModule} from './parser.js';
import {resolveObjectType, prepareObjectMethods, validateObjectMethodLocals, validateObjectMethodSignature, objectReferenceCompatible} from './object-lowering.js';
import {builtinType, BUILTIN_SYMBOLS, CONSTANT_SYMBOLS} from '../type-catalog.js';

const key = value => String(value).toLowerCase();
export const PASCAL_TYPES = Object.freeze({
  integer: {kind: 'ordinal', name: 'Integer', vb: 'Integer', bits: 16, signed: true, low: -32768, high: 32767},
  shortint: {kind: 'ordinal', name: 'ShortInt', vb: 'Integer', bits: 8, signed: true, low: -128, high: 127},
  byte: {kind: 'ordinal', name: 'Byte', vb: 'Byte', bits: 8, signed: false, low: 0, high: 255},
  word: {kind: 'ordinal', name: 'Word', vb: 'Long', bits: 16, signed: false, low: 0, high: 65535},
  longint: {kind: 'ordinal', name: 'LongInt', vb: 'Long', bits: 32, signed: true, low: -2147483648, high: 2147483647},
  boolean: {kind: 'boolean', name: 'Boolean', vb: 'Boolean', low: 0, high: 1},
  char: {kind: 'char', name: 'Char', vb: 'String', low: 0, high: 255, capacity: 1},
  real: {kind: 'real', name: 'Real', vb: 'Double'}, single: {kind: 'real', name: 'Single', vb: 'Single'},
  double: {kind: 'real', name: 'Double', vb: 'Double'}, extended: {kind: 'real', name: 'Extended', vb: 'Double'},
  string: {kind: 'string', name: 'String', vb: 'String', capacity: 255},
  variant: {kind: 'variant', name: 'Variant', vb: 'Variant'}, object: {kind: 'object', name: 'Object', vb: 'Object'},
  text: {kind: 'file', name: 'Text', vb: 'String', fileKind: 'text', element: null},
});
export const ORDINAL_KINDS = new Set(['ordinal', 'enum', 'subrange', 'char', 'boolean']);
export const isOrdinal = type => ORDINAL_KINDS.has(type?.kind);
export const isString = type => ['char', 'string'].includes(type?.kind) || type?.kind === 'subrange' && isString(type.base);
export const isNumeric = type => ['ordinal', 'real'].includes(type?.kind) || type?.kind === 'subrange' && isNumeric(type.base);
export const isAggregate = type => ['array', 'record'].includes(type?.kind);
export function foreignType(name = 'Variant') {
  const normalized = key(name), primitive = {long: 'longint', integer: 'integer', byte: 'byte', boolean: 'boolean', single: 'single', double: 'double', string: 'string', variant: 'variant'}[normalized];
  if (primitive) return {...PASCAL_TYPES[primitive], foreign: true};
  if (builtinType(name)?.kind === 'enum' || /constants$|enum$|^vb/i.test(name) && !builtinType(name)) return {...PASCAL_TYPES.longint, foreign: true};
  return {kind: 'object', name, vb: 'Object', catalogName: name, foreign: true};
}
const basicIntrinsics = new Map(BUILTIN_SYMBOLS.map(symbol => [key(symbol.name), symbol]));
const basicConstants = new Map(CONSTANT_SYMBOLS.map(symbol => [key(symbol.name), symbol]));
export function numericType(left, right) {
  if (left?.kind === 'subrange') left = left.base;
  if (right?.kind === 'subrange') right = right.base;
  if (left?.kind === 'real' || right?.kind === 'real') {
    for (const name of ['double', 'real', 'single']) if ([left, right].some(type => type?.kind === 'real' && key(type.name) === name)) return PASCAL_TYPES[name];
    return PASCAL_TYPES.real;
  }
  if (left?.kind === 'variant' || right?.kind === 'variant') return PASCAL_TYPES.longint;
  const low = Math.min(left?.low ?? -32768, right?.low ?? -32768), high = Math.max(left?.high ?? 32767, right?.high ?? 32767);
  // Byte operands use an intermediate word before arithmetic (TP7, p. 25).
  // The remaining common type must contain every possible operand value.
  return [PASCAL_TYPES.integer, PASCAL_TYPES.word, PASCAL_TYPES.longint].find(type => type.low <= low && type.high >= high) || PASCAL_TYPES.longint;
}
export function sameType(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.kind === 'subrange') return sameType(left.base, right.kind === 'subrange' ? right.base : right);
  if (right.kind === 'subrange') return sameType(left, right.base);
  if (left.kind !== right.kind) return false;
  if (left.kind === 'array' || left.kind === 'record' || left.kind === 'enum') return !!left.identity && left.identity === right.identity;
  if (left.kind === 'pointer') return left.target && right.target ? sameType(left.target, right.target) : left.identity === right.identity;
  if (left.kind === 'file') return left.fileKind === right.fileKind && (left.fileKind !== 'typed' || sameType(left.element, right.element));
  if (left.kind === 'set') return sameType(left.base, right.base);
  return left.name === right.name && (left.kind !== 'string' || left.capacity === right.capacity);
}
export function assignmentCompatible(target, value) {
  if (!target || !value || target.kind === 'variant' || value.kind === 'variant') return true;
  if (sameType(target, value)) return true;
  if (objectReferenceCompatible(target, value)) return true;
  if (isNumeric(target) && isNumeric(value)) return target.kind === 'real' || value.kind !== 'real';
  if (target.kind === 'string' && isString(value)) return true;
  if (target.kind === 'char' && value.kind === 'string') return value.literalLength === 1;
  if (target.kind === 'set' && value.kind === 'set') return !value.base || !target.base || sameType(target.base, value.base);
  if (target.kind === 'array' && value.kind === 'array' && target.open) return sameType(target.element, value.element);
  if (target.kind === 'pointer' && value.kind === 'nil' || target.kind === 'object' && value.kind === 'nil') return true;
  return target.kind === 'object' && value.kind === 'object';
}

export class PascalScope {
  constructor(owner, parent = null, procedure = null) {this.owner = owner; this.parent = parent; this.procedure = procedure; this.symbols = new Map();}
  define(symbol, node = symbol.node) {
    const name = key(symbol.name);
    if (name.startsWith('__pascal') && !symbol.internal) this.owner.fail("Identifiers beginning with '__Pascal' are reserved for compiler-generated storage", node, 'TP_RESERVED_IDENTIFIER');
    if (this.symbols.has(name)) this.owner.fail(`Duplicate identifier '${symbol.name}'`, node, 'TP_DUPLICATE');
    symbol.scope = this; symbol.owner = this.owner; this.symbols.set(name, symbol); return symbol;
  }
  resolve(name, required = true, node = null) {
    const own = this.symbols.get(key(name)); if (own) return this.owner.resolveSymbol(own);
    if (this.parent) return this.parent.resolve(name, required, node);
    const imported = [];
    for (const binder of this.owner.imports) {binder.ensure(); const symbol = binder.scope.symbols.get(key(name)); if (symbol?.public) imported.push(binder.resolveSymbol(symbol));}
    if (imported.length > 1) this.owner.fail(`Ambiguous imported identifier '${name}'`, node, 'TP_AMBIGUOUS');
    if (imported.length) return imported[0];
    if (this.owner.controls.has(key(name))) return {kind: 'control', name, vbName: name, owner: this.owner, scope: this, type: foreignType(this.owner.controlTypes.get(key(name)) || 'Control')};
    if (this.owner.externalValues.has(key(name))) return {kind: 'external', name, vbName: name, owner: this.owner, scope: this, type: this.owner.externalTypes.get(key(name)) || PASCAL_TYPES.variant, ...(key(name) === 'filemode' ? {ioGlobal: 'fileMode'} : {})};
    if (key(name) === 'self' && this.owner.input.form) return {kind: 'control', name, vbName: 'Me', owner: this.owner, scope: this, type: foreignType(this.owner.input.form.type || 'Form')};
    const constant = basicConstants.get(key(name)); if (constant) return {kind: 'constant', name: constant.name, value: constant.value, type: foreignType(constant.type), builtIn: true};
    const intrinsic = basicIntrinsics.get(key(name)); if (intrinsic && !this.owner.pascalIntrinsics.has(key(name))) return {kind: 'external', name: intrinsic.name, vbName: intrinsic.name, type: foreignType(intrinsic.type), owner: this.owner, scope: this};
    if (required) this.owner.fail(`Unknown identifier '${name}'`, node, 'TP_UNKNOWN_IDENTIFIER');
    return null;
  }
}

export class PascalWorkspace {
  constructor(project = null) {
    this.project = project; this.inputs = new Map(); this.binders = new Map();
    for (const input of project?.modules || []) if (/^(?:pascal|turbo[- ]?pascal|tp7|tp)$/i.test(input.language || input.sourceLanguage || project.language || '')) this.inputs.set(key(input.name), input);
  }
  add(input, ast) {const binder = new PascalBinder(ast, input, this); this.binders.set(key(input.name || ast.name), binder); this.binders.set(key(ast.name), binder); return binder;}
  get(name) {
    const normalized = key(name); if (this.binders.has(normalized)) return this.binders.get(normalized);
    let input = this.inputs.get(normalized);
    if (!input) for (const value of this.inputs.values()) {const ast = parsePascalModule(value); if (key(ast.name) === normalized) {input = value; break;}}
    return input ? this.add(input, parsePascalModule(input)) : null;
  }
  preparePointers() {
    for (const name of this.inputs.keys()) this.get(name)?.ensure();
    const canonical = new Map();
    for (const binder of [...new Set(this.binders.values())].sort((a, b) => key(a.name).localeCompare(key(b.name)))) for (const pointer of binder.pointerTypes) {
      if (!pointer.target) pointer.target = binder.resolveType({kind: 'namedType', name: pointer.targetName, loc: pointer.node.loc}, pointer.targetScope);
      if (pointer.target.kind === 'file') binder.fail('Pointers to files require an addressable file descriptor', pointer.node, 'TP_POINTER_TARGET');
      const identity = pointer.target.identity || key(pointer.target.name);
      if (!canonical.has(identity)) canonical.set(identity, pointer);
      pointer.canonical = canonical.get(identity);
    }
    this.pointers = canonical;
  }
}

export class PascalBinder {
  constructor(ast, input, workspace = new PascalWorkspace()) {
    this.ast = ast; this.input = input || {name: ast.name, code: ast.source}; this.name = this.input.name || ast.name; this.workspace = workspace;
    this.scope = new PascalScope(this); this.imports = []; this.procedures = []; this.recordTypes = []; this.enumTypes = []; this.pointerTypes = []; this.typeId = 0; this.ready = false; this.preparing = false;
    this.controls = new Set(); this.controlTypes = new Map(); this.externalValues = new Set(['me', 'app', 'screen', 'clipboard', 'forms', 'printer', 'debug']); this.externalTypes = new Map();
    this.pascalIntrinsics = new Set('abs append arctan assign blockread blockwrite chr close concat copy cos delete dispose eof eoln erase exp filepos filesize flush frac get high include exclude inc dec insert int ioresult length ln low new odd ord paramcount paramstr pi pos pred put random randomize read readln rename reset rewrite round seek sin sizeof sqr sqrt str succ trunc upcase val write writeln'.split(' '));
    const controls = node => {if (!node) return; if (node.name) {this.controls.add(key(node.name)); this.controlTypes.set(key(node.name), node.type || 'Control');} for (const child of [...(node.controls || []), ...(node.menus || [])]) controls(child);}; controls(input?.form);
    for (const module of workspace.project?.modules || []) if (module.form) {this.controls.add(key(module.name)); this.controlTypes.set(key(module.name), module.form.type || 'Form');}
    for (const [name, type] of Object.entries({me: input?.form?.type || 'Form', app: 'App', screen: 'Screen', clipboard: 'Clipboard', forms: 'Forms', printer: 'Printer', debug: 'Debug'})) this.externalTypes.set(name, foreignType(type));
    this.externalValues.add('filemode'); this.externalTypes.set('filemode', PASCAL_TYPES.byte);
    if (input?.form) for (const member of builtinType(input.form.type || 'Form')?.members || []) {this.externalValues.add(key(member.name)); this.externalTypes.set(key(member.name), foreignType(member.type));}
    if (input?.form) for (const property of [...Object.keys(input.form.properties || {}), ...'Caption Name Tag Left Top Width Height ClientWidth ClientHeight Visible Enabled BackColor ForeColor Font MousePointer MouseIcon WindowState BorderStyle ScaleMode ScaleWidth ScaleHeight ScaleLeft ScaleTop CurrentX CurrentY AutoRedraw DrawMode DrawStyle DrawWidth FillColor FillStyle ClipControls KeyPreview ControlBox MaxButton MinButton ShowInTaskbar Picture Icon hWnd Controls ActiveControl Parent Move Show Hide Refresh Cls Print PSet Line Circle Point PaintPicture SetFocus PopupMenu'.split(' ')]) this.externalValues.add(key(property));
    for (const [name, type] of Object.entries(PASCAL_TYPES)) this.scope.define({kind: 'type', name, type, builtIn: true, public: false});
    for (const [name, value, type] of [['MaxInt', 32767, PASCAL_TYPES.integer], ['MaxLongInt', 2147483647, PASCAL_TYPES.longint], ['Pi', Math.PI, PASCAL_TYPES.real]]) this.scope.define({kind: 'constant', name, value, type, vbName: name, builtIn: true, public: false});
  }
  fail(message, node = this.ast, code = 'TP_SEMANTIC') {throw new PascalError(message, node?.loc || node || this.ast.loc, this.name, code);}
  ensure() {
    if (this.ready || this.preparing) return this;
    this.preparing = true;
    for (const use of this.ast.uses) for (const unit of use.units) {
      if (['system', 'crt'].includes(key(unit.name))) continue;
      const binder = this.workspace.get(unit.name);
      if (!binder) this.fail(`Unit '${unit.name}' is not present in the project or supported standard units`, unit, 'TP_UNIT_NOT_FOUND');
      if (!this.imports.includes(binder)) this.imports.push(binder);
    }
    this.registerDeclarations(this.scope, this.ast.declarations);
    for (const binder of this.imports) binder.ensure();
    prepareObjectMethods(this);
    for (const symbol of this.scope.symbols.values()) this.resolveSymbol(symbol);
    this.ready = true; this.preparing = false; return this;
  }
  registerDeclarations(scope, declarations) {
    for (const node of declarations) {
      const publicSymbol = scope === this.scope && (this.ast.moduleKind !== 'unit' || node.section === 'interface');
      if (node.kind === 'labels') continue;
      if (node.kind === 'typeDeclaration') scope.define({kind: 'type', name: node.name, node, public: publicSymbol});
      else if (node.kind === 'constant') scope.define({kind: node.typed ? 'variable' : 'constant', name: node.name, vbName: node.name, node, typedConstant: node.typed, public: publicSymbol});
      else if (node.kind === 'variable') {if (node.absolute) this.fail('Absolute memory aliases require the segmented-memory compatibility runtime', node, 'TP_UNSUPPORTED_ABSOLUTE'); for (const name of node.names) scope.define({kind: 'variable', name, vbName: name, node, public: publicSymbol});}
      else if (['procedure', 'function', 'constructor', 'destructor'].includes(node.kind)) {
        if (scope !== this.scope && (node.name.includes('.') || ['constructor', 'destructor'].includes(node.kind))) this.fail('Object methods must be implemented in the outermost scope of their declaring module', node, 'TP_OBJECT_SCOPE');
        const previous = scope.symbols.get(key(node.name));
        if (previous) {
          if (previous.kind !== 'procedure' || previous.definition && !node.declarationOnly) this.fail(`Duplicate routine '${node.name}'`, node, 'TP_DUPLICATE');
          previous.nodes.push(node); previous.public ||= publicSymbol;
          if (!node.declarationOnly) previous.definition = node;
        } else scope.define({kind: 'procedure', name: node.name, vbName: scope.procedure ? `__Pascal_${scope.procedure.vbName}_${node.name}` : node.name, node, nodes: [node], definition: node.declarationOnly ? null : node, public: publicSymbol});
      } else this.fail(`Turbo Pascal ${node.kind} declarations require object-model lowering`, node, 'TP_UNSUPPORTED_OBJECT');
    }
  }
  resolveSymbol(symbol) {
    if (symbol.resolved || symbol.builtIn || symbol.kind === 'result' || symbol.kind === 'parameter' || symbol.kind === 'enumMember') return symbol;
    if (symbol.owner && symbol.owner !== this) return symbol.owner.resolveSymbol(symbol);
    if (symbol.resolving) this.fail(`Circular declaration dependency involving '${symbol.name}'`, symbol.node, 'TP_CIRCULAR_TYPE');
    symbol.resolving = true;
    if (symbol.kind === 'type') symbol.type = this.resolveType(symbol.node.type, symbol.scope, symbol.name, symbol.public);
    else if (symbol.kind === 'constant') {const value = this.constant(symbol.node.value, symbol.scope); symbol.value = value.value; symbol.type = value.type;}
    else if (symbol.kind === 'variable') symbol.type = this.resolveType(symbol.node.type, symbol.scope);
    else if (symbol.kind === 'procedure') {
      const declaration = symbol.nodes.find(node => node.explicitParams || node.returnType) || symbol.node;
      const definition = symbol.definition;
      if (!definition) this.fail(`Routine '${symbol.name}' was declared but has no implementation`, symbol.node, 'TP_MISSING_ROUTINE');
      if (symbol.nodes.some(node => node.modifiers.some(modifier => ['external', 'assembler', 'interrupt', 'inline'].includes(modifier.name) || modifier.name === 'virtual' && !symbol.objectMethod))) this.fail(`Routine '${symbol.name}' requires an unsupported machine-code calling convention`, symbol.node, 'TP_UNSUPPORTED_CALLING_CONVENTION');
      symbol.params = declaration.params.map(param => ({...param, type: this.resolveType(param.type, symbol.scope)}));
      for (const param of symbol.params) if (param.type.kind === 'file' && !param.byRef) this.fail('File parameters must be declared var', param, 'TP_FILE_PARAMETER');
      symbol.returnType = symbol.node.kind === 'constructor' ? PASCAL_TYPES.boolean : symbol.node.kind === 'function' ? declaration.returnType ? this.resolveType(declaration.returnType, symbol.scope) : this.fail(`Function '${symbol.name}' requires a return type`, symbol.node) : null;
      if (symbol.returnType && isAggregate(symbol.returnType)) this.fail('Turbo Pascal functions cannot return arrays or records', symbol.node, 'TP_RETURN_TYPE');
      if (symbol.nodes.some(node => node.kind !== symbol.node.kind)) this.fail(`Routine kind does not match interface for '${symbol.name}'`, symbol.node);
      for (const node of symbol.nodes) if (node !== declaration && node.explicitParams) {
        if (node.params.length !== symbol.params.length || node.params.some((param, i) => param.byRef !== symbol.params[i].byRef || key(param.name) !== key(symbol.params[i].name) || !sameType(this.resolveType(param.type, symbol.scope), symbol.params[i].type))) this.fail(`Routine parameters do not match the earlier declaration of '${symbol.name}'`, node, 'TP_SIGNATURE');
      }
      if (symbol.objectMethod) {
        validateObjectMethodLocals(this, symbol, declaration, definition);
        validateObjectMethodSignature(this, symbol, sameType);
        symbol.self = {kind: 'parameter', name: 'Self', vbName: '__PascalSelf', type: symbol.objectMethod.declaringType, byRef: true, implicit: true, loc: definition.loc};
        symbol.params.unshift(symbol.self);
        if (symbol.objectMethod.kind === 'constructor') symbol.params.push({kind: 'parameter', name: '__PascalConstructorType', type: PASCAL_TYPES.word, byRef: false, implicit: true, loc: definition.loc});
      }
      symbol.localScope = new PascalScope(this, symbol.scope, symbol); symbol.captures = [];
      for (let parent = symbol.scope; parent && parent !== this.scope; parent = parent.parent) for (const value of parent.symbols.values()) if (['variable', 'parameter', 'result'].includes(value.kind)) symbol.captures.push({symbol: value, name: `__capture_${symbol.captures.length}_${value.name}`});
      for (const param of symbol.params) {const local = symbol.localScope.define({kind: 'parameter', name: param.name, vbName: param.vbName || param.name, type: param.type, param, node: param, resolved: true, internal: !!param.implicit}); param.symbol = local;}
      if (symbol.returnType) symbol.result = symbol.localScope.define({kind: 'result', name: symbol.objectMethod?.name || symbol.name, vbName: symbol.vbName, type: symbol.returnType, procedure: symbol, node: symbol.node, resolved: true});
      this.registerDeclarations(symbol.localScope, definition.declarations); this.procedures.push(symbol);
      symbol.resolved = true; symbol.resolving = false;
      for (const local of symbol.localScope.symbols.values()) this.resolveSymbol(local);
      return symbol;
    }
    symbol.resolved = true; symbol.resolving = false; return symbol;
  }
  resolveType(node, scope, suggestedName = null, publicType = false) {
    if (!node) return PASCAL_TYPES.variant;
    if (node.kind === 'objectType') return resolveObjectType(this, node, scope, suggestedName, publicType);
    if (node.kind === 'namedType') {
      if (key(node.name) === 'extended') this.fail('Extended requires 80-bit floating point storage; shared backend currently supports Real48, Single and Double', node, 'TP_UNSUPPORTED_REAL80');
      if (key(node.name) === 'comp') this.fail('Comp requires exact signed 64-bit integer arithmetic and storage', node, 'TP_UNSUPPORTED_COMP');
      const parts = node.name.split('.');
      if (parts.length > 1) {const binder = this.workspace.get(parts[0]); if (!binder || binder !== this && !this.imports.includes(binder)) this.fail(`Unit '${parts[0]}' is not in the uses clause`, node); binder.ensure(); const symbol = binder.scope.symbols.get(key(parts.slice(1).join('.'))); if (!symbol || symbol.kind !== 'type' || binder !== this && !symbol.public) this.fail(`Unknown exported type '${node.name}'`, node); return binder.resolveSymbol(symbol).type;}
      const symbol = scope.resolve(node.name, true, node); if (symbol.kind !== 'type') this.fail(`'${node.name}' is not a type`, node); return symbol.type;
    }
    if (node.kind === 'stringType') {const capacity = node.capacity ? this.constant(node.capacity, scope).value : 255; if (!Number.isInteger(capacity) || capacity < 1 || capacity > 255) this.fail('ShortString capacity must be between 1 and 255', node, 'TP_STRING_CAPACITY'); return {...PASCAL_TYPES.string, capacity};}
    const identity = `${key(this.name)}.${suggestedName || `__type${this.typeId++}`}`;
    if (node.kind === 'enumType') {
      if (node.members.length > 256) this.fail('Turbo Pascal enumeration cannot have more than 256 members', node);
      const type = {kind: 'enum', name: suggestedName || `__PascalEnum${this.typeId++}`, identity, vb: 'Integer', low: 0, high: node.members.length - 1, bits: 16, signed: false, members: node.members, owner: this, node, public: publicType};
      for (let value = 0; value < node.members.length; value++) scope.define({kind: 'enumMember', name: node.members[value], vbName: node.members[value], value, type, public: publicType, node});
      this.enumTypes.push(type); return type;
    }
    if (node.kind === 'subrangeType') {
      const low = this.constant(node.low, scope), high = this.constant(node.high, scope);
      if (!isOrdinal(low.type) || !isOrdinal(high.type) || !assignmentCompatible(low.type, high.type) && !sameType(low.type, high.type)) this.fail('Subrange bounds must have compatible ordinal types', node, 'TP_SUBRANGE');
      const first = this.ordinalValue(low), last = this.ordinalValue(high);
      if (first > last) this.fail('Subrange lower bound exceeds its upper bound', node, 'TP_SUBRANGE');
      const base = numericType(low.type, high.type);
      return {kind: 'subrange', name: suggestedName || `${first}..${last}`, identity, base: isString(low.type) || ['boolean', 'enum'].includes(low.type.kind) ? low.type : base, vb: low.type.kind === 'char' ? 'String' : low.type.kind === 'boolean' ? 'Boolean' : base.vb, low: first, high: last, bits: base.bits, signed: base.signed};
    }
    if (node.kind === 'arrayType') {
      const dimensions = node.indices.map(index => {const type = this.resolveType(index, scope); if (!isOrdinal(type)) this.fail('Array index type must be ordinal', index, 'TP_ARRAY_INDEX'); return {low: type.low, high: type.high, type};});
      if (dimensions.some(dimension => dimension.high - dimension.low > 1000000)) this.fail('Array dimension exceeds the compiler allocation limit', node, 'TP_LIMIT');
      let element = this.resolveType(node.elementType, scope);
      if (element.kind === 'array') {if (element.open || node.open) this.fail('Open arrays with nested array elements require a descriptor for each element', node, 'TP_OPEN_ARRAY_ELEMENT'); dimensions.push(...element.dimensions); element = element.element;}
      return {kind: 'array', name: suggestedName || '__PascalArray', identity, element, dimensions, open: node.open, vb: element.vb, owner: this, node};
    }
    if (node.kind === 'recordType') {
      if (node.variants.length) this.fail('Variant records require overlapping-storage lowering and are not supported by this backend', node.variants[0], 'TP_UNSUPPORTED_VARIANT_RECORD');
      const name = suggestedName && scope === this.scope ? suggestedName : `__PascalRecord${this.typeId++}`, type = {kind: 'record', name, vb: name, identity, fields: new Map(), owner: this, node, public: publicType};
      for (const field of node.fields) {const fieldType = this.resolveType(field.type, scope); if (fieldType.kind === 'array' && fieldType.open) this.fail('Record fields cannot be open arrays', field); for (const fieldName of field.names) {if (type.fields.has(key(fieldName))) this.fail(`Duplicate record field '${fieldName}'`, field); type.fields.set(key(fieldName), {name: fieldName, type: fieldType, node: field});}}
      this.recordTypes.push(type); return type;
    }
    if (node.kind === 'setType') {const base = this.resolveType(node.base, scope); if (!isOrdinal(base) || base.low < 0 || base.high > 255) this.fail('Set element type must be ordinal with bounds within 0..255', node, 'TP_SET_BASE'); return {kind: 'set', name: suggestedName || 'Set', vb: 'String', base, identity};}
    if (node.kind === 'pointerType') {
      const type = {kind: 'pointer', name: suggestedName || `Pointer${this.typeId++}`, vb: 'Long', targetName: node.target, targetScope: scope, target: null, identity, owner: this, node, public: publicType};
      this.pointerTypes.push(type); return type;
    }
    if (node.kind === 'fileType') {
      const element = node.elementType ? this.resolveType(node.elementType, scope) : null;
      if (element?.kind === 'file') this.fail('A file cannot contain file variables', node, 'TP_FILE_COMPONENT');
      return {kind: 'file', name: suggestedName || 'File', vb: 'String', fileKind: element ? 'typed' : 'untyped', element, identity, owner: this, node};
    }
    if (node.kind === 'untyped') this.fail('Untyped var parameters require a byte-addressable storage ABI', node, 'TP_UNSUPPORTED_UNTYPED_PARAMETER');
    const labels = {pointerType: 'Typed pointers', fileType: 'Typed and untyped files', objectType: 'Object types', procedureType: 'Procedural variables'};
    this.fail(`${labels[node.kind] || node.kind} require backend storage support`, node, 'TP_UNSUPPORTED_TYPE');
  }
  ordinalValue(value) {return value.type.kind === 'char' ? value.value.charCodeAt(0) : value.type.kind === 'boolean' ? Number(value.value) : value.value;}
  constant(node, scope = this.scope) {
    if (node.kind === 'group') return this.constant(node.expression, scope);
    if (node.kind === 'number') return {value: node.value, type: /[.eE]/.test(node.raw.replace(/^\$[a-f0-9]+$/i, '0')) ? PASCAL_TYPES.real : node.value >= -32768 && node.value <= 32767 ? PASCAL_TYPES.integer : PASCAL_TYPES.longint};
    if (node.kind === 'string') return {value: node.value, type: node.value.length === 1 ? PASCAL_TYPES.char : {...PASCAL_TYPES.string, literalLength: node.value.length}};
    if (node.kind === 'boolean') return {value: node.value, type: PASCAL_TYPES.boolean};
    if (node.kind === 'identifier') {const symbol = scope.resolve(node.name, true, node); if (!['constant', 'enumMember'].includes(symbol.kind)) this.fail('Constant expression required', node, 'TP_CONSTANT'); return {value: symbol.value, type: symbol.type};}
    if (node.kind === 'member' && node.object.kind === 'identifier') {const binder = this.workspace.get(node.object.name); binder?.ensure(); const symbol = binder?.scope.symbols.get(key(node.name)); if (!symbol?.public || !['constant', 'enumMember'].includes(symbol.kind)) this.fail('Exported constant expression required', node, 'TP_CONSTANT'); return binder.constant({kind: 'identifier', name: symbol.name, loc: node.loc}, binder.scope);}
    if (node.kind === 'unary') {const operand = this.constant(node.operand, scope), value = node.operator === '-' ? -operand.value : node.operator === '+' ? +operand.value : node.operator === 'not' ? operand.type.kind === 'boolean' ? !operand.value : ~operand.value : this.fail('Address is not a compile-time constant', node); return {value, type: operand.type};}
    if (node.kind === 'binary') {
      const left = this.constant(node.left, scope), right = this.constant(node.right, scope), a = left.value, b = right.value, op = node.operator;
      const compare = {'=': () => a === b, '<>': () => a !== b, '<': () => a < b, '>': () => a > b, '<=': () => a <= b, '>=': () => a >= b};
      if (compare[op]) return {value: compare[op](), type: PASCAL_TYPES.boolean};
      if ((op === '/' || op === 'div' || op === 'mod') && b === 0) this.fail('Division by zero in constant expression', node, 'TP_CONSTANT');
      const operations = {'+': () => a + b, '-': () => a - b, '*': () => a * b, '/': () => a / b, div: () => Math.trunc(a / b), mod: () => a % b, and: () => left.type.kind === 'boolean' ? a && b : a & b, or: () => left.type.kind === 'boolean' ? a || b : a | b, xor: () => left.type.kind === 'boolean' ? !!a !== !!b : a ^ b, shl: () => a << b, shr: () => a >>> b};
      if (!operations[op]) this.fail('Unsupported constant operator', node, 'TP_CONSTANT');
      return {value: operations[op](), type: isString(left.type) && op === '+' ? {...PASCAL_TYPES.string, literalLength: String(a + b).length} : left.type.kind === 'boolean' ? PASCAL_TYPES.boolean : op === '/' ? PASCAL_TYPES.real : numericType(left.type, right.type)};
    }
    if (node.kind === 'call' && node.callee.kind === 'identifier') {
      const args = node.args.map(argument => this.constant(argument, scope)), name = key(node.callee.name), first = args[0];
      if (name === 'ord' && args.length === 1) return {value: this.ordinalValue(first), type: PASCAL_TYPES.longint};
      if (name === 'chr' && args.length === 1 && first.value >= 0 && first.value <= 255) return {value: String.fromCharCode(first.value), type: PASCAL_TYPES.char};
      if (name === 'succ' || name === 'pred') return {value: first.type.kind === 'char' ? String.fromCharCode(this.ordinalValue(first) + (name === 'succ' ? 1 : -1)) : first.value + (name === 'succ' ? 1 : -1), type: first.type};
      if (name === 'low' || name === 'high') this.fail('Low/High require type-aware constant binding', node, 'TP_CONSTANT');
    }
    this.fail('Constant expression required', node, 'TP_CONSTANT');
  }
}
