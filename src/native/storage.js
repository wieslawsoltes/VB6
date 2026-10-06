/** Native storage lowering. BSTR ownership is explicit; no JS or VB runtime is embedded. */
import {NATIVE_ARRAY_MAX_BYTES, NATIVE_ARRAY_MAX_RANK} from './arrays.js';
const key = value => String(value).toLowerCase();
const types = new Set(['byte', 'integer', 'long', 'boolean', 'string', 'single', 'double', 'currency', 'date']);
export const MAX_NATIVE_STRING = 1024 * 1024;

function boundValue(compiler, node, module, proc) {
  if (node === null) return module.optionBase;
  if (node.kind === 'group') return boundValue(compiler, node.expr, module, proc);
  if (node.kind === 'literal' && Number.isInteger(node.value)) return node.value;
  if (node.kind === 'id') {
    for (const map of [proc?.constantBindings, module.constantBindings, module.importedConstantBindings, module.globalEnumMembers]) {
      if (map?.has(key(node.name))) return Number(map.get(key(node.name)));
    }
  }
  if (node.kind === 'unary') {
    const n = boundValue(compiler, node.expr, module, proc);
    if (node.op === '-') return -n;
    if (node.op === '+') return n;
  }
  if (node.kind === 'binary') {
    const a = boundValue(compiler, node.left, module, proc), b = boundValue(compiler, node.right, module, proc);
    if (node.op === '+') return a + b;
    if (node.op === '-') return a - b;
    if (node.op === '*') return a * b;
    if (node.op === '\\' && b) return Math.trunc(a / b);
  }
  compiler.fail('Native fixed-array bounds must be integral constant expressions', module);
}

export function storageLayout(compiler, decl, module, proc) {
  if (!types.has(key(decl.type)) || decl.autoNew || decl.withEvents) compiler.fail('Native storage requires Byte, Integer, Long, Boolean, Single, Double, Currency, Date or String: ' + decl.name, module);
  if (decl.fixedLength !== null && decl.fixedLength !== undefined && (!Number.isInteger(decl.fixedLength) || decl.fixedLength < 1 || decl.fixedLength > 65535)) compiler.fail('Invalid fixed String length: ' + decl.name, module);
  const elementBytes = key(decl.type) === 'byte' ? 1 : ['integer', 'boolean'].includes(key(decl.type)) ? 2 : ['double','currency','date'].includes(key(decl.type)) ? 8 : 4;
  decl.nativeElementBytes = elementBytes;
  let count = 1;
  if (decl.bounds !== null && decl.bounds !== undefined) {
    decl.nativeArray = true;
    decl.nativeDynamic = !decl.bounds.length;
    if (decl.parameter && (!decl.byRef || decl.bounds.length)) compiler.fail('Native array parameters must be unsized and ByRef', module);
    if (decl.bounds.length > NATIVE_ARRAY_MAX_RANK) compiler.fail('Native fixed arrays support at most 60 dimensions', module);
    decl.nativeBounds = decl.bounds.map(([low, high]) => {
      const lower = boundValue(compiler, low, module, proc), upper = boundValue(compiler, high, module, proc);
      if (![lower, upper].every(n => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647) || upper < lower) compiler.fail('Invalid native array bounds: ' + decl.name, module);
      const stride = count * elementBytes;
      count *= upper - lower + 1;
      if (!Number.isSafeInteger(count) || count * elementBytes > (compiler.maxArrayBytes ?? NATIVE_ARRAY_MAX_BYTES)) compiler.fail('Native fixed array exceeds checked x86 backing-address range or configured budget', module);
      return {lower, upper, stride};
    });
  }
  decl.nativeCount = decl.nativeDynamic ? 0 : count;
  decl.nativeDataBytes = decl.nativeDynamic ? 0 : count * elementBytes;
  // Arrays own a SAFEARRAY pointer; backing storage is allocated by OleAut32.
  decl.nativeBytes = decl.nativeArray ? 4 : Math.ceil(count * elementBytes / 4) * 4;
  return decl;
}

export const nativeStorageMethods = {
  allocateStorage(variable) {
    this.data.align(4).label(variable.label).zero(variable.nativeBytes || 4);
  },
  temporaryString() {
    const c = this.context;
    const variable = {name: this.x.unique('string-temp'), type: 'String', nativeCount: 1, nativeBytes: 4, temporary: true};
    if (c?.proc?.name) {
      c.size += 4;
      if (c.size > 512 * 1024) this.fail('Native procedure workspace exceeds 512 KiB');
      variable.offset = -c.size;
      (c.stringTemps ||= []).push(variable);
    } else { variable.label = variable.name; this.allocateStorage(variable); }
    return variable;
  },
  /** Adopt a freshly allocated BSTR in EAX. Each source expression has its own slot. */
  ownString() {
    const variable = this.temporaryString(), x = this.x;
    x.push(); this.address(variable); x.emit(0x89, 0xc3, 0x5f, 0xff, 0x33).invoke('oleaut32.dll', 'SysFreeString').emit(0x89, 0x3b, 0x89, 0xf8);
    return variable;
  },
  stringPointer() {
    const ready = this.x.unique(); this.x.test().branch('ne', ready).value(this.string('')).label(ready);
  },
  storageExpression(variable, node) {
    if (variable.nativeArray && !variable.elementOf) this.fail('Whole-array values require array assignment or a ByRef array parameter');
    if(key(variable.type)==='date')this.dateExpression(node);else if(key(variable.type)==='currency')this.currencyExpression(node);else if (key(variable.type) === 'string') this.textExpression(node); else if(['single','double'].includes(key(variable.type))){this.floatExpression(node,key(variable.type)==='single');}else if(key(variable.type)==='boolean')this.truth(node);else this.numeric(node);
  },
  rawStorageAddress(variable) {
    if (variable.owner?.form) this.x.call(variable.owner.initialize);
    if (variable.label) this.x.value(variable.label);
    else if (variable.parameter && variable.byRef) this.x.value({argument: variable.offset});
    else this.x.local(variable.offset);
  },
  zeroStorage(variable) {
    this.rawStorageAddress(variable);
    this.x.emit(0x89, 0xc7, 0xb9).imm((variable.nativeBytes || 4) / 4).emit(0x31, 0xc0, 0xfc, 0xf3, 0xab);
  },
  clearStringStorage(variable) {
    if (variable.nativeArray) return this.destroyArrayStorage(variable);
    this.x.push(variable.nativeCount || 1); this.rawStorageAddress(variable); this.x.push().call('native:string:clear');
  },
  initializeFixedString(variable) {
    if (variable.nativeArray) return this.initializeArrayStorage(variable);
    if (key(variable.type) !== 'string' || !variable.fixedLength || (variable.parameter||variable.ownedParameter)) return;
    const x = this.x;
    x.push(variable.fixedLength).push(variable.nativeCount || 1); this.rawStorageAddress(variable); x.push().call('native:string:initialize-fixed');
  },
  stringBuiltin(node, name) {
    const x = this.x, args = node.args;
    if (['len','lenb','ascw','strptr'].includes(name)) {
      if(args.length===1&&['len','lenb'].includes(name)&&this.type(args[0])!=='string'){const size={byte:1,integer:2,boolean:2,long:4,single:4,double:8,currency:8,date:8}[this.type(args[0])];if(!size)this.fail(name+' requires a supported value');this.expression(args[0]);x.value(size);return true;}
      if (args.length !== 1 || this.type(args[0]) !== 'string') this.fail(name + ' expects one String argument');
      if(name==='strptr'){
        const variable=this.variable(args[0]);
        if(variable){if(variable.nativeBounds&&!variable.elementOf)this.fail('StrPtr requires a String element, not an array');const pin=this.address(variable);x.emit(0x8b,0x00);this.releaseArrayPin(pin);}
        else if(args[0].kind==='id'&&key(args[0].name)==='vbnullstring')x.value(0);
        else this.expression(args[0]);
        return true;
      }
      this.expression(args[0]);
      if (name === 'ascw') { x.push().push().invoke('oleaut32.dll','SysStringLen').test().branch('e','error:5').emit(0x58,0x0f,0xbf,0x00); }
      else { x.push().invoke('oleaut32.dll','SysStringLen'); if (name === 'lenb') x.emit(0xd1,0xe0); }
      return true;
    }
    if (['left','right','mid','chrw'].includes(name)) {
      if (name === 'chrw') {
        if (args.length !== 1) this.fail('ChrW expects one argument'); this.numeric(args[0]); x.push().call('native:string:chrw');
      } else {
        if (args.length < 2 || args.length > (name === 'mid' ? 3 : 2)) this.fail(name + ' argument count mismatch');
        this.textExpression(args[0]); x.push(); this.numeric(args[1]); x.push();
        if (name === 'mid') { this.numeric(args[2] || {kind:'literal',value:MAX_NATIVE_STRING}); x.emit(0x5b,0x59).push().emit(0x53,0x51).call('native:string:mid'); }
        else x.emit(0x5b,0x59,0x53,0x51).call('native:string:'+name);
      }
      this.ownString(); return true;
    }
    return false;
  }
};

export function emitNativeStorageHelpers(compiler) {
  const x = compiler.x, api = 'oleaut32.dll';
  x.label('native:string:numeric-text').enter().api(api,'SysStringLen',[{argument:8}]).emit(0x89,0xc3).api('kernel32.dll','lstrlenW',[{argument:8}]).emit(0x39,0xd8).branch('ne','error:13').value({argument:8}).leave(4);
  x.label('native:string:copy').enter().api(api,'SysStringLen',[{argument:8}]).compare(MAX_NATIVE_STRING).branch('g','error:7').push().push({argument:8}).invoke(api,'SysAllocStringLen').test().branch('e','error:7').leave(4);
  x.label('native:string:assign').enter().push({argument:12}).call('native:string:copy').emit(0x89,0xc7).value({argument:8}).emit(0x89,0xc3,0xff,0x33).invoke(api,'SysFreeString').emit(0x89,0x3b,0x89,0xf8).leave(8);
  x.label('native:string:from-int').enter(4).value(0).emit(0x89,0x45,0xfc).api(api,'VarBstrFromI4',[{argument:8},0x400,0,{address:-4}]).test().branch('s','error:7').value({argument:-4}).leave(4);
  x.label('native:string:concat').enter(4).api(api,'SysStringLen',[{argument:8}]).emit(0x89,0xc3).api(api,'SysStringLen',[{argument:12}]).emit(0x01,0xd8).compare(MAX_NATIVE_STRING).branch('g','error:7').value(0).emit(0x89,0x45,0xfc).api(api,'VarBstrCat',[{argument:8},{argument:12},{address:-4}]).test().branch('s','error:7').value({argument:-4}).leave(8);
  // Compare UTF-16 code units with explicit lengths, including embedded NULs.
  const loop=x.unique(), equal=x.unique(), less=x.unique(), greater=x.unique(), compareLengths=x.unique(), done=x.unique();
  x.label('native:string:compare').enter(8).api(api,'SysStringLen',[{argument:8}]).emit(0x89,0x45,0xfc).api(api,'SysStringLen',[{argument:12}]).emit(0x89,0x45,0xf8).value({argument:8}).emit(0x89,0xc6).value({argument:12}).emit(0x89,0xc7,0x31,0xdb);
  x.label(loop).emit(0x3b,0x5d,0xfc).branch('ge',compareLengths).emit(0x3b,0x5d,0xf8).branch('ge',compareLengths).emit(0x0f,0xb7,0x04,0x5e,0x0f,0xb7,0x14,0x5f,0x39,0xd0).branch('b',less).branch('ne',greater).emit(0x43).jump(loop);
  x.label(compareLengths).value({argument:-4}).emit(0x3b,0x45,0xf8).branch('l',less).branch('g',greater).label(equal).value(0).jump(done).label(less).value(-1).jump(done).label(greater).value(1).label(done).leave(8);
  const clearLoop=x.unique(), clearDone=x.unique();
  x.label('native:string:clear').enter().value({argument:8}).emit(0x89,0xc6).value({argument:12}).emit(0x89,0xc7).label(clearLoop).emit(0x85,0xff).branch('e',clearDone).emit(0xff,0x36).invoke(api,'SysFreeString').emit(0xc7,0x06,0,0,0,0,0x83,0xc6,4,0x4f).jump(clearLoop).label(clearDone).value(0).leave(8);
  // Allocate exactly the requested fixed width; pad with spaces and copy a bounded prefix.
  const widthOK=x.unique(), fill=x.unique(), copyDone=x.unique();
  x.label('native:string:fixed').enter().value({argument:12}).compare(1).branch('l','error:5').compare(65535).branch('g','error:5').emit(0x89,0xc3).push().push(0).invoke(api,'SysAllocStringLen').test().branch('e','error:7').emit(0x89,0xc6,0x89,0xc7,0x89,0xd9,0xb8).imm(32).emit(0xfc,0xf3,0x66,0xab).api(api,'SysStringLen',[{argument:8}]).emit(0x39,0xd8).branch('le',widthOK).emit(0x89,0xd8).label(widthOK).emit(0x89,0xc1,0x89,0xf7).value({argument:8}).emit(0x56,0x89,0xc6,0xfc,0xf3,0x66,0xa5,0x58).leave(8);
  const initLoop=x.unique(), initDone=x.unique();
  x.label('native:string:initialize-fixed').enter().value({argument:8}).emit(0x89,0xc6).value({argument:12}).emit(0x89,0xc7).label(initLoop).emit(0x85,0xff).branch('e',initDone).push({argument:16}).push(0).call('native:string:fixed').emit(0x89,0xc3,0xff,0x36).invoke(api,'SysFreeString').emit(0x89,0x1e,0x83,0xc6,4,0x4f).jump(initLoop).label(initDone).value(0).leave(12);
  for (const side of ['left','right']) {
    const countOK=x.unique();
    x.label('native:string:'+side).enter().value({argument:12}).test().branch('s','error:5').emit(0x89,0xc3).api(api,'SysStringLen',[{argument:8}]).emit(0x39,0xc3).branch('le',countOK).emit(0x89,0xc3).label(countOK);
    if (side==='right') x.emit(0x29,0xd8,0x01,0xc0).emit(0x03,0x45,8); else x.value({argument:8});
    x.emit(0x53,0x50).invoke(api,'SysAllocStringLen').test().branch('e','error:7').leave(8);
  }
  const startOK=x.unique(), lengthOK=x.unique(), sliceEmpty=x.unique(), sliceEnd=x.unique();
  x.label('native:string:mid').enter().value({argument:12}).compare(1).branch('l','error:5').emit(0x48,0x89,0xc6).value({argument:16}).test().branch('s','error:5').emit(0x89,0xc3).api(api,'SysStringLen',[{argument:8}]).emit(0x39,0xc6).branch('ge',sliceEmpty).emit(0x29,0xf0,0x39,0xc3).branch('le',lengthOK).emit(0x89,0xc3).label(lengthOK).value({argument:8}).emit(0x8d,0x04,0x70,0x53,0x50).invoke(api,'SysAllocStringLen').test().branch('e','error:7').jump(sliceEnd).label(sliceEmpty).api(api,'SysAllocStringLen',[0,0]).test().branch('e','error:7').label(sliceEnd).leave(12);
  x.label('native:string:chrw').enter().value({argument:8}).compare(-32768).branch('l','error:5').compare(65535).branch('g','error:5').push(1).local(8).push().invoke(api,'SysAllocStringLen').test().branch('e','error:7').leave(4);
}
