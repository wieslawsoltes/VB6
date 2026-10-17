import {PascalError, tokenizePascal} from './lexer.js';
import {preprocessPascalTokens} from './preprocessor.js';

const PRECEDENCE = Object.freeze({'=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, in: 1, '+': 2, '-': 2, or: 2, xor: 2, '*': 3, '/': 3, div: 3, mod: 3, and: 3, shl: 3, shr: 3});
const DECLARATIONS = new Set(['const', 'type', 'var', 'label', 'procedure', 'function', 'constructor', 'destructor']);
const SECTION_END = new Set([...DECLARATIONS, 'begin', 'implementation', 'interface', 'uses', 'end', 'initialization', 'finalization']);

export class PascalParser {
  constructor(input, options = {}) {
    this.input = typeof input === 'string' ? {code: input} : input || {};
    this.source = String(this.input.code ?? this.input.source ?? '');
    this.name = this.input.name || options.sourceName || 'PascalModule';
    const scanned = tokenizePascal(this.source, {...options, sourceName: this.name, tolerant: true});
    this.tokens = preprocessPascalTokens(scanned, {...options, conditionalConstants: this.input.conditionalConstants || options.conditionalConstants || {}, sourceName: this.name});
    if (this.tokens.diagnostics.length && !options.tolerant) {const diagnostic = this.tokens.diagnostics[0]; throw new PascalError(diagnostic.message, diagnostic, this.name, diagnostic.code);}
    this.index = 0; this.depth = 0; this.maxDepth = options.maxDepth || 128;
  }
  peek(offset = 0) {return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];}
  is(value) {return this.peek().lower === value;}
  take() {const token = this.peek(); if (token.type !== 'eof') this.index++; return token;}
  match(value) {if (!this.is(value)) return false; return this.take();}
  expect(value) {if (!this.is(value)) this.fail(`Expected '${value}', found '${this.peek().raw || 'end of source'}'`); return this.take();}
  fail(message, token = this.peek(), code = 'TP_SYNTAX') {throw new PascalError(message, token.loc || token, this.name, code);}
  identifier() {const token = this.take(); if (token.type !== 'id') this.fail('Expected identifier', token); return token;}
  finish(kind, start, data = {}, end = this.tokens[Math.max(0, this.index - 1)]) {
    return {kind, ...data, loc: {start: start.start, end: end.end, line: start.line, column: start.column, endLine: end.endLine, endColumn: end.endColumn}};
  }
  nested(work) {if (++this.depth > this.maxDepth) this.fail('Pascal syntax nesting limit exceeded', this.peek(), 'TP_LIMIT'); try {return work();} finally {this.depth--;}}
  identifiers() {const names = [this.identifier().value]; while (this.match(',')) names.push(this.identifier().value); return names;}
  qualifiedName() {let name = this.identifier().value; while (this.match('.')) name += '.' + this.identifier().value; return name;}
  uses() {const start = this.expect('uses'), units = []; do {const token = this.peek(), name = this.qualifiedName(); let path = null; if (this.match('in')) {const file = this.take(); if (file.type !== 'string') this.fail('Expected unit source path', file); path = file.value;} units.push(this.finish('unitReference', token, {name, path}));} while (this.match(',')); this.expect(';'); return this.finish('uses', start, {units});}
  parse() {
    const start = this.peek(); let moduleKind = 'fragment', name = this.input.name || 'PascalModule', header = null;
    if (this.is('program') || this.is('unit')) {
      header = this.take(); moduleKind = header.lower; name = this.identifier().value;
      if (moduleKind === 'program' && this.match('(')) {if (!this.match(')')) {this.identifiers(); this.expect(')');}}
      this.expect(';');
    }
    const uses = [], interfaceDeclarations = [], implementationDeclarations = [];
    if (moduleKind === 'unit') {
      this.expect('interface'); while (this.is('uses')) uses.push({...this.uses(), section: 'interface'});
      interfaceDeclarations.push(...this.declarations(true)); this.expect('implementation');
      while (this.is('uses')) uses.push({...this.uses(), section: 'implementation'});
    } else while (this.is('uses')) uses.push({...this.uses(), section: 'implementation'});
    implementationDeclarations.push(...this.declarations(false));
    let body = null;
    if (this.is('begin')) body = this.block();
    else if (this.match('initialization')) {
      const token = this.tokens[this.index - 1]; body = this.finish('block', token, {statements: this.statementList(new Set(['end', 'finalization']))}); this.expect('end');
    } else if (moduleKind === 'unit') this.expect('end');
    else if (moduleKind === 'program') this.fail('Program requires a begin/end statement block');
    if (moduleKind !== 'fragment') this.expect('.');
    else this.match('.');
    if (this.peek().type !== 'eof') this.fail(`Unexpected '${this.peek().raw}' after module`);
    return this.finish('pascalModule', start, {name, sourceName: this.name, moduleKind, header: header ? {...header} : null, uses, interfaceDeclarations, implementationDeclarations, declarations: [...interfaceDeclarations, ...implementationDeclarations], body, source: this.source, comments: this.tokens.comments, directives: this.tokens.directives});
  }
  declarations(interfaceOnly) {
    const result = [];
    while (DECLARATIONS.has(this.peek().lower)) {
      const section = this.take();
      if (['procedure', 'function', 'constructor', 'destructor'].includes(section.lower)) {result.push(this.procedure(section, interfaceOnly)); continue;}
      if (section.lower === 'label') {const labels = []; do {const label = this.take(); if (!['id', 'number'].includes(label.type)) this.fail('Expected label identifier or number', label); labels.push(String(label.value));} while (this.match(',')); this.expect(';'); result.push(this.finish('labels', section, {labels})); continue;}
      while (this.peek().type === 'id' && !SECTION_END.has(this.peek().lower)) {
        const start = this.peek();
        if (section.lower === 'const') {
          const name = this.identifier().value, type = this.match(':') ? this.type() : null; this.expect('=');
          const value = type ? this.initializer() : this.expression(); this.expect(';');
          result.push(this.finish('constant', start, {name, type, value, typed: !!type, section: interfaceOnly ? 'interface' : 'implementation'}));
        } else if (section.lower === 'type') {
          const name = this.identifier().value; this.expect('='); const type = this.type(); this.expect(';'); result.push(this.finish('typeDeclaration', start, {name, type, section: interfaceOnly ? 'interface' : 'implementation'}));
        } else {
          const names = this.identifiers(); this.expect(':'); const type = this.type(); let absolute = null, initial = null;
          if (this.match('absolute')) absolute = this.expression();
          if (this.match('=')) initial = this.initializer();
          this.expect(';'); result.push(this.finish('variable', start, {names, type, absolute, initial, section: interfaceOnly ? 'interface' : 'implementation'}));
        }
      }
    }
    return result;
  }
  parameters() {
    if (!this.match('(')) return [];
    const params = [];
    if (!this.match(')')) {
      do {
        const start = this.peek(), byRef = !!this.match('var'), constant = !byRef && !!this.match('const');
        const names = this.identifiers(), type = this.match(':') ? this.type() : this.finish('untyped', start);
        for (const name of names) params.push(this.finish('parameter', start, {name, type, byRef, constant}));
      } while (this.match(';'));
      this.expect(')');
    }
    return params;
  }
  procedure(start, interfaceOnly) {
    const name = this.qualifiedName(), explicitParams = this.is('('), params = this.parameters();
    const returnType = start.lower === 'function' && this.match(':') ? this.type() : null; this.expect(';');
    const modifiers = [];
    while (['forward', 'external', 'far', 'near', 'assembler', 'interrupt', 'virtual', 'inline'].includes(this.peek().lower)) {
      const modifier = this.take(), args = [];
      while (!this.is(';') && this.peek().type !== 'eof') args.push(this.take()); this.expect(';');
      modifiers.push({name: modifier.lower, args, loc: this.finish('modifier', modifier).loc});
    }
    const declarationOnly = interfaceOnly || modifiers.some(m => ['forward', 'external'].includes(m.name));
    let declarations = [], body = null;
    if (!declarationOnly) {declarations = this.nested(() => this.declarations(false)); if (this.is('asm')) body = this.assembly(); else body = this.block(); this.expect(';');}
    return this.finish(start.lower, start, {name, params, explicitParams, returnType, modifiers, declarations, body, declarationOnly, section: interfaceOnly ? 'interface' : 'implementation'});
  }
  type() {return this.nested(() => this.typeBody());}
  typeBody() {
    const start = this.peek(), packed = !!this.match('packed');
    if (this.match('array')) {
      const indices = [];
      if (this.match('[')) {do {indices.push(this.type());} while (this.match(',')); this.expect(']');}
      this.expect('of'); const elementType = this.type(); return this.finish('arrayType', start, {indices, elementType, open: !indices.length, packed});
    }
    if (this.match('record')) {
      const fields = [], variants = [];
      while (!this.is('end') && this.peek().type !== 'eof') {
        if (this.is('case')) {variants.push(this.variantPart()); break;}
        const fieldStart = this.peek(), names = this.identifiers(); this.expect(':'); const type = this.type(); fields.push(this.finish('field', fieldStart, {names, type}));
        if (!this.match(';')) break;
      }
      this.expect('end'); return this.finish('recordType', start, {fields, variants, packed});
    }
    if (this.match('set')) {this.expect('of'); return this.finish('setType', start, {base: this.type(), packed});}
    if (this.match('file')) {return this.finish('fileType', start, {elementType: this.match('of') ? this.type() : null, packed});}
    if (this.match('^')) return this.finish('pointerType', start, {target: this.qualifiedName()});
    if (this.match('string')) {let capacity = null; if (this.match('[')) {capacity = this.expression(); this.expect(']');} return this.finish('stringType', start, {capacity});}
    if (this.match('(')) {const members = this.identifiers(); this.expect(')'); return this.finish('enumType', start, {members});}
    if (this.is('procedure') || this.is('function')) {const kind = this.take().lower, params = this.parameters(), returnType = kind === 'function' && this.match(':') ? this.type() : null; return this.finish('procedureType', start, {procedureKind: kind, params, returnType});}
    if (this.match('object')) {
      let parent = null; if (this.match('(')) {parent = this.qualifiedName(); this.expect(')');}
      const members = []; let visibility = 'public';
      while (!this.is('end') && this.peek().type !== 'eof') {
        if (this.is('private') || this.is('public')) {visibility = this.take().lower; continue;}
        if (['procedure', 'function', 'constructor', 'destructor'].includes(this.peek().lower)) {members.push({...this.procedure(this.take(), true), visibility}); continue;}
        const fieldStart = this.peek(), names = this.identifiers(); this.expect(':'); const type = this.type(); members.push(this.finish('field', fieldStart, {names, type, visibility})); if (!this.match(';')) break;
      }
      this.expect('end'); return this.finish('objectType', start, {parent, members});
    }
    const low = this.expression(2);
    if (this.match('..')) return this.finish('subrangeType', start, {low, high: this.expression(2)});
    if (low.kind === 'identifier' || low.kind === 'member') return this.finish('namedType', start, {name: this.expressionName(low)});
    this.fail('Expected a type name or ordinal subrange', start);
  }
  expressionName(expr) {return expr.kind === 'identifier' ? expr.name : expr.kind === 'member' ? this.expressionName(expr.object) + '.' + expr.name : this.fail('Expected qualified type name', expr);}
  variantPart() {
    const start = this.expect('case'); let tag = null, tagType;
    if (this.peek().type === 'id' && this.peek(1).lower === ':') {tag = this.take().value; this.take();}
    tagType = this.type(); this.expect('of'); const cases = [];
    while (!this.is('end') && !this.is(')') && this.peek().type !== 'eof') {
      const labels = [this.expression()]; while (this.match(',')) labels.push(this.expression()); this.expect(':'); this.expect('('); const fields = [];
      while (!this.is(')')) {if (this.is('case')) {fields.push(this.variantPart()); break;} const fieldStart = this.peek(), names = this.identifiers(); this.expect(':'); const type = this.type(); fields.push(this.finish('field', fieldStart, {names, type})); if (!this.match(';')) break;}
      this.expect(')'); cases.push({labels, fields}); if (!this.match(';')) break;
    }
    return this.finish('variantPart', start, {tag, tagType, cases});
  }
  initializer() {
    if (!this.is('(')) return this.expression();
    const start = this.take(), entries = [];
    if (!this.match(')')) {
      do {
        const field = this.peek().type === 'id' && this.peek(1).lower === ':' ? this.take().value : null;
        if (field) this.expect(':'); entries.push({field, value: this.initializer()});
      } while (this.match(',') || this.match(';'));
      this.expect(')');
    }
    return this.finish('aggregate', start, {entries});
  }
  block() {const start = this.expect('begin'), statements = this.statementList(new Set(['end'])); this.expect('end'); return this.finish('block', start, {statements});}
  statementList(stops) {
    const statements = [];
    while (!stops.has(this.peek().lower) && this.peek().type !== 'eof') {
      if (this.match(';')) continue;
      statements.push(this.statement());
      if (!this.match(';') && !stops.has(this.peek().lower)) this.fail(`Expected ';' between statements, found '${this.peek().raw}'`);
    }
    return statements;
  }
  statement() {return this.nested(() => this.statementBody());}
  statementBody() {
    const start = this.peek();
    if (this.is('begin')) return this.block();
    if (['end', 'else', 'until', ';'].includes(start.lower)) return this.finish('empty', start, {}, start);
    if (this.match('if')) {const test = this.expression(); this.expect('then'); const consequent = this.statement(), alternate = this.match('else') ? this.statement() : null; return this.finish('if', start, {test, consequent, alternate});}
    if (this.match('while')) {const test = this.expression(); this.expect('do'); return this.finish('while', start, {test, body: this.statement()});}
    if (this.match('repeat')) {const statements = this.statementList(new Set(['until'])); this.expect('until'); return this.finish('repeat', start, {statements, test: this.expression()});}
    if (this.match('for')) {const variable = this.postfix(this.primary()); this.expect(':='); const initial = this.expression(); const direction = this.take(); if (!['to', 'downto'].includes(direction.lower)) this.fail("Expected 'to' or 'downto'", direction); const limit = this.expression(); this.expect('do'); return this.finish('for', start, {variable, initial, limit, direction: direction.lower, body: this.statement()});}
    if (this.match('case')) {
      const selector = this.expression(); this.expect('of'); const cases = []; let alternate = [];
      while (!this.is('end') && this.peek().type !== 'eof') {
        if (this.match('else')) {alternate = this.statementList(new Set(['end'])); break;}
        const caseStart = this.peek(), labels = [];
        do {const low = this.expression(), high = this.match('..') ? this.expression() : null; labels.push({low, high});} while (this.match(','));
        this.expect(':'); cases.push(this.finish('caseArm', caseStart, {labels, body: this.statement()})); if (!this.match(';')) break;
      }
      this.expect('end'); return this.finish('case', start, {selector, cases, alternate});
    }
    if (this.match('with')) {const objects = [this.expression()]; while (this.match(',')) objects.push(this.expression()); this.expect('do'); return this.finish('with', start, {objects, body: this.statement()});}
    if (this.match('goto')) {const label = this.take(); if (!['id', 'number'].includes(label.type)) this.fail('Expected label', label); return this.finish('goto', start, {label: String(label.value)});}
    if (this.is('asm')) return this.assembly();
    if (['id', 'number'].includes(start.type) && this.peek(1).lower === ':') {this.take(); this.take(); return this.finish('label', start, {label: String(start.value), statement: this.statement()});}
    const expression = this.expression();
    if (this.match(':=')) return this.finish('assignment', start, {target: expression, value: this.expression()});
    if (!['identifier', 'call', 'member', 'inherited'].includes(expression.kind)) this.fail('Expected assignment or procedure call', start);
    return this.finish('callStatement', start, {expression});
  }
  assembly() {const start = this.expect('asm'), tokens = []; while (!this.is('end') && this.peek().type !== 'eof') tokens.push(this.take()); this.expect('end'); return this.finish('assembly', start, {tokens});}
  expression(minimum = 0) {
    return this.nested(() => {
      let expression = this.postfix(this.primary());
      while (Object.hasOwn(PRECEDENCE, this.peek().lower) && PRECEDENCE[this.peek().lower] >= minimum) {
        const operator = this.take(), right = this.expression(PRECEDENCE[operator.lower] + 1);
        expression = this.finish('binary', expression.loc, {operator: operator.lower, left: expression, right});
      }
      return expression;
    });
  }
  primary() {
    const start = this.take();
    if (start.type === 'number') return this.finish('number', start, {value: start.value, raw: start.raw});
    if (start.type === 'string' || start.type === 'charCode') {
      let value = start.type === 'charCode' ? String.fromCharCode(start.value) : start.value;
      while (this.peek().type === 'string' || this.peek().type === 'charCode') {const next = this.take(); value += next.type === 'charCode' ? String.fromCharCode(next.value) : next.value;}
      return this.finish('string', start, {value});
    }
    if (['+', '-', 'not', '@'].includes(start.lower)) return this.finish('unary', start, {operator: start.lower, operand: this.expression(4)});
    if (start.lower === '(') {const expression = this.expression(); this.expect(')'); return this.finish('group', start, {expression});}
    if (start.lower === '[') {
      const elements = [];
      if (!this.match(']')) {do {const low = this.expression(), high = this.match('..') ? this.expression() : null; elements.push({low, high});} while (this.match(',')); this.expect(']');}
      return this.finish('set', start, {elements});
    }
    if (start.type === 'id') {
      if (start.lower === 'inherited') {const name = this.peek().type === 'id' && !['end', 'else', 'until'].includes(this.peek().lower) ? this.take().value : null; return this.finish('inherited', start, {name});}
      if (start.lower === 'nil') return this.finish('nil', start);
      if (['true', 'false'].includes(start.lower)) return this.finish('boolean', start, {value: start.lower === 'true'});
      if (['begin', 'end', 'then', 'else', 'do', 'of', 'until', 'to', 'downto'].includes(start.lower)) this.fail(`Expected expression, found '${start.raw}'`, start);
      return this.finish('identifier', start, {name: start.value});
    }
    this.fail(`Expected expression, found '${start.raw || 'end of source'}'`, start);
  }
  postfix(expression) {
    while (true) {
      if (this.match('.')) {expression = this.finish('member', expression.loc, {object: expression, name: this.identifier().value}); continue;}
      if (this.match('[')) {const indices = [this.expression()]; while (this.match(',')) indices.push(this.expression()); this.expect(']'); expression = this.finish('index', expression.loc, {object: expression, indices}); continue;}
      if (this.match('(')) {
        const args = [];
        if (!this.match(')')) {
          do {const value = this.expression(); if (this.match(':')) {const width = this.expression(), precision = this.match(':') ? this.expression() : null; args.push(this.finish('formatted', value.loc, {value, width, precision}));} else args.push(value);} while (this.match(',')); this.expect(')');
        }
        expression = this.finish('call', expression.loc, {callee: expression, args}); continue;
      }
      if (this.match('^')) {expression = this.finish('dereference', expression.loc, {object: expression}); continue;}
      return expression;
    }
  }
}

export function parsePascalModule(input, options = {}) {return new PascalParser(input, options).parse();}
