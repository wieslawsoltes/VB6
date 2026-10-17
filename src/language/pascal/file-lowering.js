import {PASCAL_TYPES, isString, isNumeric, isAggregate, assignmentCompatible} from './semantics.js';
import {getPascalFileHelper, getPascalFileRuntimeSource} from './file-library.js';
import {PASCAL_CONSOLE_SOURCE} from './console-library.js';

const id = name => `[${name}]`, num = value => `${value}&`, boolean = value => value ? 'True' : 'False', quote = value => `"${String(value).replaceAll('"', '""')}"`;
const KEY = value => String(value).toLowerCase();
const EXPRESSION_NAMES = new Set(['ioresult', 'eof', 'eoln', 'filepos', 'filesize']);
const STATEMENT_NAMES = new Set(['assign', 'reset', 'rewrite', 'append', 'close', 'erase', 'rename', 'seek', 'blockread', 'blockwrite', 'flush']);

export class PascalFileLowerer {
  constructor(lowerer) {
    this.lowerer = lowerer; this.helpers = new Set();
    this.owner = lowerer.workspace.inputs.values().next().value?.name || lowerer.binder.name;
    const prefix = this.owner === lowerer.binder.name ? '' : `${id(this.owner)}.`;
    this.status = `${prefix}__PascalIOStatus`; this.mode = `${prefix}__PascalFileMode`;
    this.consoleArguments = ['Buffer', 'Position', 'Ready'].map(name => `${prefix}__PascalConsole${name}`);
    this.usesConsole = false;
  }
  helper(name) {const value = getPascalFileHelper(name); this.helpers.add(value.id); return id(value.name);}
  call(name, args, node, checked = true) {return `${this.helper(name)}(${[...args, ...(checked ? [boolean(this.lowerer.flag('ioChecks', node)), this.status] : [])].join(', ')})`;}
  source() {return getPascalFileRuntimeSource(this.helpers) + (this.usesConsole ? '\n' + PASCAL_CONSOLE_SOURCE : '');}
  globals(writer, node) {if (this.owner === this.lowerer.binder.name) {writer.emit('Public __PascalIOStatus As Long', node, true); writer.emit('Public __PascalFileMode As Long = 2&', node, true); writer.emit('Public __PascalConsoleBuffer As String\nPublic __PascalConsolePosition As Long\nPublic __PascalConsoleReady As Boolean', node, true);}}
  consoleCall(name, args, node) {this.usesConsole = true; this.helper('fileCapture'); return `${id(`__PascalConsole${name}`)}(${[...this.consoleArguments, ...args, boolean(this.lowerer.flag('ioChecks', node)), this.status].join(', ')})`;}
  file(node, context) {const type = this.lowerer.typeOf(node, context); if (type.kind !== 'file') this.lowerer.fail('File variable required', node, 'TP_FILE_TYPE'); this.lowerer.assignable(node, context); return {type, source: context.pure ? this.lowerer.expression(node, context, {lvalue: true}) : this.lowerer.freezeReference(node, context)};}
  expression(call, context) {
    const name = call.callee.kind === 'identifier' ? KEY(call.callee.name) : ''; if (!EXPRESSION_NAMES.has(name)) return null;
    const c = this.lowerer;
    if (name === 'ioresult') {c.count(call, 0); return this.call('fileIOResult', [this.status], call, false);}
    if (name === 'eoln' && !call.args.length) return this.consoleCall('EOLN', [], call);
    if (name === 'eof' && !call.args.length) c.fail('EOF of the default input requires a stream host with an end-of-input sentinel; use a named Text file', call, 'TP_UNSUPPORTED_HOST_EOF');
    c.count(call, 1); const file = this.file(call.args[0], context);
    if (name === 'eoln' && file.type.fileKind !== 'text') c.fail('Eoln requires a Text file', call);
    if (['filepos', 'filesize'].includes(name) && file.type.fileKind === 'text') c.fail('FilePos/FileSize require a typed or untyped file', call);
    return this.call({eof: 'fileEOF', eoln: 'fileEOLN', filepos: 'filePos', filesize: 'fileSize'}[name], [file.source], call);
  }
  statement(call, context, node) {
    const name = call.callee.kind === 'identifier' ? KEY(call.callee.name) : ''; if (!STATEMENT_NAMES.has(name)) return false;
    const c = this.lowerer;
    c.count(call, ['assign', 'rename', 'seek'].includes(name) ? 2 : ['blockread', 'blockwrite'].includes(name) ? 3 : 1, ['reset', 'rewrite'].includes(name) ? 2 : ['blockread', 'blockwrite'].includes(name) ? 4 : ['assign', 'rename', 'seek'].includes(name) ? 2 : 1);
    const file = this.file(call.args[0], context), value = index => c.expression(call.args[index], context);
    if (name === 'assign') c.emit(context, `Call ${this.call('fileAssign', [file.source, value(1), num({text: 0, typed: 1, untyped: 2}[file.type.fileKind]), num(file.type.fileKind === 'typed' ? c.sizeOf(file.type.element, node) : file.type.fileKind === 'text' ? 1 : 128)], node, false)}`, node);
    else if (['reset', 'rewrite', 'append'].includes(name)) {
      if (name === 'append' && file.type.fileKind !== 'text') c.fail('Append requires a Text file', node);
      if (call.args.length === 2 && file.type.fileKind !== 'untyped') c.fail('Record size is valid only for untyped files', node);
      c.emit(context, `Call ${this.call('fileOpen', [file.source, num({reset: 0, rewrite: 1, append: 2}[name]), call.args.length === 2 ? value(1) : '0&', this.mode], node)}`, node);
    } else if (name === 'close' || name === 'erase') c.emit(context, `Call ${this.call(name === 'close' ? 'fileClose' : 'fileErase', [file.source], node)}`, node);
    else if (name === 'rename') c.emit(context, `Call ${this.call('fileRename', [file.source, value(1)], node)}`, node);
    else if (name === 'seek') c.emit(context, `Call ${this.call('fileSeek', [file.source, value(1)], node)}`, node);
    else if (name === 'flush') {if (file.type.fileKind !== 'text') c.fail('Flush requires a Text file', node); c.emit(context, `Call ${this.call('fileFlush', [file.source], node)}`, node);}
    else this.blockTransfer(call, file, context, node, name === 'blockwrite');
    return true;
  }
  format(arg, context) {
    const c = this.lowerer, value = arg.kind === 'formatted' ? arg.value : arg, type = c.typeOf(value, context), expression = c.expression(value, context);
    if (isAggregate(type) || ['file', 'pointer', 'object', 'set'].includes(type.kind)) c.fail('Text Write requires a scalar value', value);
    const formatted = arg.kind !== 'formatted' && isString(type) ? expression : c.callHelper('format', [expression, arg.kind === 'formatted' ? c.expression(arg.width, context) : '-1&', arg.kind === 'formatted' && arg.precision ? c.expression(arg.precision, context) : '-1&', quote(type.kind === 'boolean' || type.kind === 'subrange' && type.base.kind === 'boolean' ? 'boolean' : type.kind === 'real' ? KEY(type.name) : isString(type) ? 'string' : 'integer')]);
    const temporary = c.temporary(context, PASCAL_TYPES.string, arg, 'formatted'); c.emit(context, `${temporary} = ${formatted}`, arg, true); return temporary;
  }
  write(call, context, node, newline) {
    const c = this.lowerer, file = this.file(call.args[0], context), args = call.args.slice(1);
    if (file.type.fileKind === 'untyped') c.fail('Untyped files require BlockWrite', node);
    if (file.type.fileKind === 'text') {
      const values = args.map(arg => this.format(arg, context));
      c.emit(context, `Call ${this.call('fileWriteText', [file.source, values.map(value => `(${value})`).join(' & ') || '""', boolean(newline)], node)}`, node);
    } else {
      if (newline) c.fail('WriteLn requires a Text file', node);
      for (const arg of args) {
        if (!assignmentCompatible(file.type.element, c.typeOf(arg, context))) c.fail('Typed file component does not match its declared element type', arg, 'TP_FILE_COMPONENT');
        const value = isAggregate(file.type.element) ? c.freezeReference(arg, context) : c.expression(arg, context), bytes = this.encode(value, file.type.element, context, arg);
        c.emit(context, `Call ${this.call('fileWriteBytes', [file.source, bytes], node)}`, node);
      }
    }
  }
  read(call, context, node, newline, console = false) {
    const c = this.lowerer, file = console ? {type: PASCAL_TYPES.text} : this.file(call.args[0], context), args = console ? call.args : call.args.slice(1);
    const readValue = (name, extra = []) => console ? this.consoleCall(name, extra, node) : this.call(`file${name}`, [file.source, ...extra], node);
    if (file.type.fileKind === 'untyped') c.fail('Untyped files require BlockRead', node);
    if (newline && file.type.fileKind !== 'text') c.fail('ReadLn requires a Text file', node);
    for (const target of args) {
      c.assignable(target, context); const type = c.typeOf(target, context), destination = c.freezeReference(target, context);
      if (file.type.fileKind === 'typed') {
        if (!assignmentCompatible(type, file.type.element)) c.fail('Typed file component does not match destination type', target, 'TP_FILE_COMPONENT');
        const bytes = c.temporary(context, PASCAL_TYPES.string, target, 'fileBytes'); c.emit(context, `${bytes} = ${this.call('fileReadBytes', [file.source, num(c.sizeOf(file.type.element, target))], node)}`, node);
        c.emit(context, `If ${this.status} = 0& Then`, node, true); this.decode(destination, type, bytes, context, target); c.emit(context, 'End If', node, true);
      } else if (isString(type)) {
        const text = c.temporary(context, PASCAL_TYPES.string, node, 'readText');
        c.emit(context, `${text} = ${readValue(type.kind === 'string' ? 'ReadText' : 'ReadChar', type.kind === 'string' ? [num(type.capacity)] : [])}`, node);
        c.emit(context, `If ${this.status} = 0& Then`, node, true); c.emit(context, `${destination} = ${c.range(text, type, context, node)}`, node, true); c.emit(context, 'End If', node, true);
      }
      else if (isNumeric(type)) {
        const text = c.temporary(context, PASCAL_TYPES.string, node, 'readToken'), result = c.temporary(context, type.kind === 'real' ? PASCAL_TYPES.double : PASCAL_TYPES.longint, node, 'readNumber'), code = c.temporary(context, PASCAL_TYPES.longint, node, 'readCode');
        c.emit(context, `${text} = ${readValue('ReadToken')}`, node);
        c.emit(context, `If ${this.status} = 0& Then`, node, true);
        c.emit(context, `Call ${c.helper(type.kind === 'real' ? 'valReal' : 'valInteger')}(${text}, ${result}, ${code}${type.kind === 'real' ? `, ${quote(KEY(type.name))}` : ''})`, node, true);
        if (type.kind !== 'real') c.emit(context, `If ${result} < ${num(type.low)} Or ${result} > ${num(type.high)} Then ${code} = 1&`, node, true);
        c.emit(context, `If ${code} <> 0& Then`, node, true); c.emit(context, `Call ${this.call('fileCapture', ['106&', '"Turbo Pascal file I/O"'], node)}`, node, true); c.emit(context, 'Else', node, true); c.emit(context, `${destination} = ${c.range(result, type, context, node)}`, node, true); c.emit(context, 'End If', node, true); c.emit(context, 'End If', node, true);
      } else c.fail('Text Read accepts characters, strings, integers and reals', target, 'TP_FILE_COMPONENT');
    }
    if (newline) c.emit(context, `Call ${readValue('ReadLn')}`, node);
  }
  encode(value, type, context, node) {
    const c = this.lowerer, size = c.sizeOf(type, node);
    if (type.kind === 'subrange' && ['char', 'boolean'].includes(type.base.kind)) return this.call('fileEncodeInteger', [c.callHelper('ord', [value]), num(size)], node, false);
    if (['ordinal', 'subrange', 'enum'].includes(type.kind)) return this.call('fileEncodeInteger', [value, num(size)], node, false);
    if (type.kind === 'char' || type.kind === 'boolean') return this.call('fileEncodeInteger', [c.callHelper('ord', [value]), '1&'], node, false);
    if (type.kind === 'real') {if (type.name === 'Real') return this.call('fileEncodeReal48', [value], node, false); if (['Single','Double'].includes(type.name)) return this.call('fileEncodeFloat', [value, num(type.name === 'Single' ? 32 : 64)], node, false); c.fail('Extended file components require an 80-bit floating point codec', node, 'TP_FILE_CODEC');}
    if (type.kind === 'string') return `(ChrW(Len(${value})) & ${value} & String$(${num(type.capacity)} - Len(${value}), ChrW(0)))`;
    if (type.kind === 'set') return `Mid$(${value} & String$(32&, ChrW(0)), ${num(Math.floor(type.base.low / 8) + 1)}, ${num(size)})`;
    if (isAggregate(type)) {
      const bytes = c.temporary(context, PASCAL_TYPES.string, node, 'encoded'); c.emit(context, `${bytes} = ""`, node, true);
      this.visit(value, type, context, node, (source, element) => c.emit(context, `${bytes} = ${bytes} & ${this.encode(source, element, context, node)}`, node, true)); return bytes;
    }
    c.fail('Typed file component contains nonserializable storage', node, 'TP_FILE_CODEC');
  }
  decode(destination, type, bytes, context, node) {
    const c = this.lowerer, position = c.temporary(context, PASCAL_TYPES.longint, node, 'decodePosition'); c.emit(context, `${position} = 1&`, node, true);
    this.visit(destination, type, context, node, (target, element) => {
      const size = c.sizeOf(element, node), part = `Mid$(${bytes}, ${position}, ${num(size)})`; let value;
      if (element.kind === 'subrange' && element.base.kind === 'char') value = part;
      else if (element.kind === 'subrange' && element.base.kind === 'boolean') value = `(AscW(${part}) <> 0&)`;
      else if (['ordinal', 'subrange', 'enum'].includes(element.kind)) value = this.call('fileDecodeInteger', [part, boolean(element.signed !== false)], node, false);
      else if (element.kind === 'char') value = part;
      else if (element.kind === 'boolean') value = `(AscW(${part}) <> 0&)`;
      else if (element.kind === 'real') {if (element.name === 'Real') value = this.call('fileDecodeReal48', [part], node, false); else if (['Single','Double'].includes(element.name)) value = this.call('fileDecodeFloat', [part, num(element.name === 'Single' ? 32 : 64)], node, false); else c.fail('Extended file components require an 80-bit floating point codec', node, 'TP_FILE_CODEC');}
      else if (element.kind === 'string') value = `Mid$(${part}, 2&, AscW(Left$(${part}, 1&)))`;
      else if (element.kind === 'set') value = `(String$(${num(Math.floor(element.base.low / 8))}, ChrW(0)) & ${part} & String$(${num(32 - Math.floor(element.base.low / 8) - size)}, ChrW(0)))`;
      else c.fail('Typed file component contains nonserializable storage', node, 'TP_FILE_CODEC');
      c.emit(context, `${target} = ${c.range(value, element, context, node)}`, node, true); c.emit(context, `${position} = ${position} + ${num(size)}`, node, true);
    });
  }
  visit(value, type, context, node, leaf) {
    const c = this.lowerer;
    if (type.isPascalObject && type.hasVmt) c.fail('Objects with virtual method storage require an address-independent file representation', node, 'TP_FILE_OBJECT_VMT');
    if (type.kind === 'record') {for (const field of type.fields.values()) if (!field.internal) this.visit(`${value}.${id(field.name)}`, field.type, context, node, leaf); return;}
    if (type.kind === 'array') {
      if (type.open) c.fail('File codecs require statically bounded arrays', node);
      const indices = type.dimensions.map(() => c.temporary(context, PASCAL_TYPES.longint, node, 'codecIndex'));
      for (let i = 0; i < indices.length; i++) c.emit(context, `For ${indices[i]} = ${num(type.dimensions[i].low)} To ${num(type.dimensions[i].high)}`, node, true);
      this.visit(`${value}(${indices.join(', ')})`, type.element, context, node, leaf);
      for (let i = indices.length - 1; i >= 0; i--) c.emit(context, `Next ${indices[i]}`, node, true); return;
    }
    leaf(value, type);
  }
  blockTransfer(call, file, context, node, writing) {
    const c = this.lowerer;
    if (file.type.fileKind !== 'untyped') c.fail('BlockRead/BlockWrite require an untyped file', node);
    const buffer = call.args[1], type = c.typeOf(buffer, context), capacity = c.sizeOf(type, buffer);
    c.assignable(buffer, context);
    if (capacity > 1048576) c.fail('Block I/O buffers cannot exceed 1 MiB in the shared runtime', buffer, 'TP_LIMIT');
    if (!isNumeric(c.typeOf(call.args[2], context)) || c.typeOf(call.args[2], context).kind === 'real') c.fail('Block I/O count must be an integer', call.args[2], 'TP_ARGUMENT_TYPE');
    const source = c.freezeReference(buffer, context), count = c.temporary(context, PASCAL_TYPES.longint, node, 'blockCount'), transferred = c.temporary(context, PASCAL_TYPES.longint, node, 'blockTransferred'), requested = c.temporary(context, PASCAL_TYPES.double, node, 'blockBytes');
    c.emit(context, `${count} = ${c.expression(call.args[2], context)}`, node, true);
    const result = call.args[3]; let destination;
    if (result) {c.assignable(result, context); const resultType = c.typeOf(result, context); if (!isNumeric(resultType) || resultType.kind === 'real') c.fail('Block I/O result must be an integer variable', result, 'TP_ARGUMENT_TYPE'); destination = c.freezeReference(result, context);}
    c.emit(context, `If ${this.status} = 0& Then`, node, true);
    c.emit(context, `${requested} = CDbl(${count}) * CDbl(${this.call('fileRecordSize', [file.source], node, false)})`, node, true);
    c.emit(context, `If ${count} < 0& Or ${requested} > ${num(capacity)} Then Err.Raise 201, "Turbo Pascal", "Block I/O exceeds the declared buffer capacity"`, node, true);
    const bytes = this.encode(source, type, context, buffer);
    if (writing) c.emit(context, `Call ${this.call('fileBlockWrite', [file.source, bytes, count, boolean(!!result), transferred], node)}`, node);
    else {
      const original = c.temporary(context, PASCAL_TYPES.string, node, 'blockOriginal'), incoming = c.temporary(context, PASCAL_TYPES.string, node, 'blockIncoming');
      c.emit(context, `${original} = ${bytes}`, node, true);
      c.emit(context, `${incoming} = ${this.call('fileBlockRead', [file.source, count, boolean(!!result), transferred], node)}`, node);
      c.emit(context, `If Len(${incoming}) > 0& Then`, node, true); c.emit(context, `${incoming} = ${incoming} & Mid$(${original}, Len(${incoming}) + 1&)`, node, true); this.decode(source, type, incoming, context, buffer); c.emit(context, 'End If', node, true);
    }
    if (result) c.emit(context, `${destination} = ${c.range(transferred, c.typeOf(result, context), context, result)}`, node, true);
    c.emit(context, 'End If', node, true);
  }
}
