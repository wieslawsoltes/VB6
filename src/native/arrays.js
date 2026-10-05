/** Owned SAFEARRAY storage for fixed/dynamic native arrays. The internal array ABI
 * passes a descriptor slot by reference; it is never exposed to browser code. */
const key = value => String(value).toLowerCase();
const A = 'native:array:';
const DLL = 'oleaut32.dll';
const arg = argument => ({argument});
const addr = address => ({address});
const VT = {byte:17, integer:2, long:3, boolean:11, string:8, single:4, double:5};
export const NATIVE_ARRAY_MAX_BYTES = 1024 * 1024;
export const NATIVE_ARRAY_MAX_RANK = 8;
const save = (x, offset) => x.emit(0x89,0x85).imm(offset);

export const nativeArrayMethods = {
  arrayWorkspace(bytes, name = 'array-work') {
    const c = this.context, variable = {name:this.x.unique(name), type:'Long', nativeBytes:bytes};
    if(c?.proc?.name) {
      c.size += bytes;
      if(c.size > 512 * 1024) this.fail('Native procedure workspace exceeds 512 KiB');
      variable.offset = -c.size;
    } else {variable.label = variable.name; this.allocateStorage(variable);}
    return variable;
  },
  arrayPin() {
    const pin = this.arrayWorkspace(4,'array-pin');
    if(this.context?.proc?.name)this.context.arrayPins.push(pin);
    return pin;
  },
  releaseArrayPin(pin) {
    if(!pin)return;
    const x=this.x;x.push();this.rawStorageAddress(pin);x.push().call(A+'unpin').emit(0x58);
  },
  arrayRef(variable) {
    this.rawStorageAddress(variable);
    this.x.emit(0x8b,0x00).test().branch('e','error:9');
  },
  elementAddress(variable) {
    const x=this.x, array=variable.elementOf, rank=variable.indices.length;
    if(rank < 1 || rank > NATIVE_ARRAY_MAX_RANK)this.fail('Native array rank must be 1..8');
    const indices=this.arrayWorkspace(rank*4), out=this.arrayWorkspace(4), pin=this.arrayPin();
    // Evaluate every subscript exactly once, left-to-right, before dereferencing
    // the current descriptor. A subscript expression may itself resize the array.
    variable.indices.forEach((node,i)=>{
      this.numeric(node);x.push();this.rawStorageAddress(indices);x.emit(0x5a,0x89,0x90).imm(i*4);
    });
    this.arrayRef(array);x.emit(0x89,0xc3,0x53).invoke(DLL,'SafeArrayGetDim').compare(rank).branch('ne','error:9');
    x.emit(0x53).invoke(DLL,'SafeArrayLock').call(A+'check');
    // Publish ownership before a fallible index lookup. Recovery and procedure
    // exit release this pin even when another argument or the callee throws.
    this.rawStorageAddress(pin);x.emit(0x89,0x18);
    this.rawStorageAddress(out);x.push();this.rawStorageAddress(indices);x.push().emit(0x53).invoke(DLL,'SafeArrayPtrOfIndex').call(A+'check');
    this.rawStorageAddress(out);x.emit(0x8b,0x00);
    return pin;
  },
  initializeArrayStorage(variable) {
    if(!variable.nativeArray || variable.parameter || variable.nativeDynamic)return;
    const x=this.x, done=x.unique(), label=x.unique('fixed-bounds');
    this.ro.align(4).label(label);
    for(const bound of variable.nativeBounds)this.ro.u32(bound.upper-bound.lower+1).u32(bound.lower);
    this.rawStorageAddress(variable);x.emit(0x83,0x38,0).branch('ne',done);
    x.push(variable.fixedLength || 0).push(0).push(label).push(variable.nativeBounds.length).push(VT[key(variable.type)]);
    this.rawStorageAddress(variable);x.push().call(A+'redim');
    this.arrayRef(variable);x.emit(0x66,0x83,0x48,2,0x10).label(done); // FADF_FIXEDSIZE
  },
  destroyArrayStorage(variable) {
    this.rawStorageAddress(variable);this.x.push().call(A+'destroy');
  },
  redimArrayStorage(decl, preserve) {
    const x=this.x, variable=this.variable({kind:'id',name:decl.name});
    if(!variable?.nativeArray || variable.elementOf)this.fail('ReDim requires a declared native array: '+decl.name);
    if(!variable.nativeDynamic)this.fail('ReDim cannot resize a fixed native array: '+decl.name);
    if(decl.explicitType && key(decl.type)!==key(variable.type))this.fail('ReDim cannot change a typed array element type');
    if(decl.fixedLength && decl.fixedLength!==variable.fixedLength)this.fail('ReDim cannot change a fixed String element length');
    const rank=decl.bounds?.length;
    if(!rank || rank>NATIVE_ARRAY_MAX_RANK)this.fail('Native ReDim requires one to eight dimensions');
    const bounds=this.arrayWorkspace(rank*8);
    // Keep a stable slot address, not a stale SAFEARRAY pointer, across bound expressions.
    this.rawStorageAddress(variable);x.push();
    for(let i=0;i<rank;i++) {
      this.numeric(decl.bounds[i][0] || {kind:'literal',value:this.context.module.module.optionBase || 0});x.push();
      this.numeric(decl.bounds[i][1]);x.emit(0x5b,0x39,0xd8).branch('l','error:9').emit(0x29,0xd8).branch('o','error:7').emit(0x40).branch('o','error:7');
      x.push();this.rawStorageAddress(bounds);x.emit(0x5a,0x89,0x90).imm(i*8).emit(0x89,0x98).imm(i*8+4);
    }
    x.emit(0x5b).push(variable.fixedLength || 0).push(preserve?1:0);
    this.rawStorageAddress(bounds);x.push().push(rank).push(VT[key(variable.type)]).emit(0x53).call(A+'redim');
  },
  arrayBoundCall(node, upper) {
    if(node.args.length<1||node.args.length>2)this.fail('LBound/UBound expects an array and optional dimension');
    const variable=this.variable(node.args[0]);
    if(!variable?.nativeArray||variable.elementOf)this.fail('LBound/UBound requires a native array');
    this.rawStorageAddress(variable);this.x.push();this.numeric(node.args[1] || {kind:'literal',value:1});
    this.x.emit(0x5b).push().emit(0x53).call(A+(upper?'upper':'lower'));
  },
  eraseStorage(node) {
    const variable=this.variable(node);
    if(!variable?.nativeArray||variable.elementOf)this.fail('Native Erase requires an array');
    this.x.push(variable.fixedLength || 0);this.rawStorageAddress(variable);this.x.push().call(A+'erase');
  },
  assignArrayStorage(variable, node) {
    const source=this.variable(node);
    if(!variable.nativeDynamic)this.fail('Whole-array assignment requires a dynamic destination');
    if(!source?.nativeArray || source.elementOf || key(variable.type)!==key(source.type) || (variable.fixedLength||0)!==(source.fixedLength||0))this.fail('Array assignment requires identical declared element types and fixed String lengths');
    this.rawStorageAddress(variable);this.x.push();this.rawStorageAddress(source);this.x.emit(0x5b).push().emit(0x53).call(A+'copy');
  }
};

/** Runtime helpers preserve EBX/ESI/EDI and return HRESULT failures through the
 * existing VB error frame, never through a native Windows callback stack. */
export function emitNativeArrayHelpers(compiler) {
  const x=compiler.x;
  const checked=x.unique();
  x.label(A+'check').test().branch('ns',checked).compare(0x8002000b).branch('e','error:9')
    .compare(0x8002000d).branch('e','error:10').compare(0x8007000e).branch('e','error:7').jump('error:5').label(checked).emit(0xc3);

  const unpinned=x.unique();
  x.label(A+'unpin').enter().value(arg(8)).emit(0x89,0xc3,0x8b,0x00).test().branch('e',unpinned)
    .push().invoke(DLL,'SafeArrayUnlock').call(A+'check').emit(0xc7,0x03,0,0,0,0).label(unpinned).value(0).leave(4);
  const destroyed=x.unique();
  x.label(A+'destroy').enter().value(arg(8)).emit(0x89,0xc3,0x8b,0x00).test().branch('e',destroyed)
    .push().invoke(DLL,'SafeArrayDestroy').call(A+'check').emit(0xc7,0x03,0,0,0,0).label(destroyed).value(0).leave(4);

  // Product of counts is independent of SAFEARRAY's reversed dimension storage.
  const countLoop=x.unique(), countDone=x.unique();
  x.label(A+'count').enter().value(arg(8)).test().branch('e','error:9')
    .emit(0x0f,0xb7,0x38,0x8d,0x70,16,0xbb).imm(1).label(countLoop).emit(0x85,0xff).branch('e',countDone)
    .emit(0x0f,0xaf,0x1e).branch('o','error:7').emit(0x83,0xc6,8,0x4f).jump(countLoop)
    .label(countDone).emit(0x89,0xd8).compare(NATIVE_ARRAY_MAX_BYTES).branch('g','error:7').leave(4);

  for(const upper of [false,true]) {
    x.label(A+(upper?'upper':'lower')).enter(4).value(arg(8)).emit(0x8b,0x00).test().branch('e','error:9')
      .emit(0x89,0xc3).value(arg(12)).compare(1).branch('l','error:9');
    x.emit(0x53).invoke(DLL,'SafeArrayGetDim').emit(0x39,0x45,12).branch('g','error:9');
    x.push(addr(-4)).push(arg(12)).emit(0x53).invoke(DLL,upper?'SafeArrayGetUBound':'SafeArrayGetLBound').call(A+'check').value(arg(-4)).leave(8);
  }

  // redim(slot, vt, rank, bounds-in-declaration-order, preserve, fixedStringLength)
  const noOld=x.unique(), counts=x.unique(), counted=x.unique(), byteLimit=x.unique(), halfLimit=x.unique(), doubleLimit=x.unique(), limitDone=x.unique();
  const create=x.unique(), validate=x.unique(), preserveNow=x.unique(), success=x.unique(), publish=x.unique(), finish=x.unique();
  x.label(A+'redim').enter(24).value(arg(8)).emit(0x89,0xc3,0x8b,0x00);save(x,-4);
  x.test().branch('e',noOld).emit(0x66,0xf7,0x40,2,0x10,0).branch('ne','error:10')
    .emit(0x83,0x78,8,0).branch('ne','error:10');
  x.label(noOld).value(arg(16)).compare(1).branch('l','error:9').compare(NATIVE_ARRAY_MAX_RANK).branch('g','error:9')
    .emit(0x89,0xc7).value(arg(20)).emit(0x89,0xc6).value(1);save(x,-16);
  x.label(counts).emit(0x85,0xff).branch('e',counted).emit(0x8b,0x06).compare(1).branch('l','error:9')
    .emit(0x0f,0xaf,0x45,0xf0).branch('o','error:7').compare(NATIVE_ARRAY_MAX_BYTES).branch('g','error:7');save(x,-16);
  x.emit(0x83,0xc6,8,0x4f).jump(counts).label(counted);
  x.value(arg(12)).compare(17).branch('e',byteLimit).compare(2).branch('e',halfLimit).compare(11).branch('e',halfLimit).compare(5).branch('e',doubleLimit)
    .value(arg(-16)).compare(NATIVE_ARRAY_MAX_BYTES/4).branch('g','error:7').jump(limitDone);
  x.label(halfLimit).value(arg(-16)).compare(NATIVE_ARRAY_MAX_BYTES/2).branch('g','error:7').jump(limitDone);
  x.label(doubleLimit).value(arg(-16)).compare(NATIVE_ARRAY_MAX_BYTES/8).branch('g','error:7').jump(limitDone);
  x.label(byteLimit).label(limitDone).value(0);save(x,-12);
  x.value(arg(-4)).test().branch('e',create).value(arg(24)).test().branch('e',create);
  x.api(DLL,'SafeArrayGetDim',[arg(-4)]).emit(0x3b,0x45,16).branch('ne','error:9');
  x.push(arg(-4)).call(A+'count');save(x,-12);
  x.value(arg(20)).emit(0x89,0xc6,0xbf).imm(1).label(validate);
  x.push(addr(-20)).emit(0x57).push(arg(-4)).invoke(DLL,'SafeArrayGetLBound').call(A+'check');
  x.value(arg(-20)).emit(0x3b,0x46,4).branch('ne','error:9').emit(0x3b,0x7d,16).branch('e',preserveNow);
  x.push(addr(-20)).emit(0x57).push(arg(-4)).invoke(DLL,'SafeArrayGetUBound').call(A+'check')
    .emit(0x8b,0x06,0x03,0x46,4,0x48,0x3b,0x45,0xec).branch('ne','error:9')
    .emit(0x83,0xc6,8,0x47).jump(validate);
  x.label(preserveNow).emit(0x56).push(arg(-4)).invoke(DLL,'SafeArrayRedim').call(A+'check').jump(success);
  x.label(create).api(DLL,'SafeArrayCreate',[arg(12),arg(16),arg(20)]).test().branch('e','error:7');save(x,-8);
  x.value(arg(-4)).test().branch('e',publish).push().invoke(DLL,'SafeArrayDestroy').test().branch('ns',publish);
  // Do not leak the new allocation or overwrite the old owner if destruction fails.
  x.push().push(arg(-8)).invoke(DLL,'SafeArrayDestroy').emit(0x58).call(A+'check');
  x.label(publish).value(arg(-8)).emit(0x89,0x03).value(0);save(x,-12);
  x.label(success).value(arg(28)).test().branch('e',finish);
  x.value(arg(-16)).emit(0x2b,0x45,0xf4).test().branch('le',finish).emit(0x89,0xc7);
  x.value(arg(-12)).emit(0xc1,0xe0,2,0x8b,0x13,0x03,0x42,12,0x89,0xc6)
    .push(arg(28)).emit(0x57,0x56).call('native:string:initialize-fixed');
  x.label(finish).value(0).leave(24);

  // Erase a dynamic array destroys its descriptor. Fixed arrays keep their shape
  // and storage; BSTR elements are released, never zeroed without being freed.
  const eraseDone=x.unique(), reset=x.unique(), numeric=x.unique();
  x.label(A+'erase').enter().value(arg(8)).emit(0x89,0xc3,0x8b,0x00).test().branch('e',eraseDone)
    .emit(0x89,0xc6,0x83,0x7e,8,0).branch('ne','error:10')
    .emit(0x66,0xf7,0x46,2,0x10,0).branch('ne',reset).push(arg(8)).call(A+'destroy').jump(eraseDone);
  x.label(reset).emit(0x56).call(A+'count').emit(0x89,0xc7,0x66,0xf7,0x46,2,0,1).branch('e',numeric)
    .emit(0x57,0xff,0x76,12).call('native:string:clear');
  x.value(arg(12)).test().branch('e',eraseDone).push().emit(0x57,0xff,0x76,12).call('native:string:initialize-fixed').jump(eraseDone);
  x.label(numeric).emit(0x89,0xf8,0x0f,0xaf,0x46,4,0x89,0xc1,0x8b,0x7e,12,0x31,0xc0,0xfc,0xf3,0xaa)
    .label(eraseDone).value(0).leave(8);

  // SafeArrayCopy deep-copies BSTRs. Validate and allocate before changing the
  // destination. Copying a fixed array into a dynamic one must not copy fixedness.
  const copyUnlocked=x.unique(), copyEmpty=x.unique(), copyDone=x.unique(), copyPublish=x.unique();
  x.label(A+'copy').enter(8).value(arg(8)).emit(0x89,0xc3,0x8b,0x00,0x89,0xc6).test().branch('e',copyUnlocked)
    .emit(0x66,0xf7,0x46,2,0x10,0).branch('ne','error:10').emit(0x83,0x7e,8,0).branch('ne','error:10');
  x.label(copyUnlocked).value(arg(12)).emit(0x8b,0x00).test().branch('e',copyEmpty).emit(0x39,0xf0).branch('e',copyDone).emit(0x89,0xc7);
  x.value(0);save(x,-4);x.push(addr(-4)).emit(0x57).invoke(DLL,'SafeArrayCopy').call(A+'check');
  x.value(arg(-4)).emit(0x66,0x83,0x60,2,0xef,0x85,0xf6).branch('e',copyPublish)
    .emit(0x56).invoke(DLL,'SafeArrayDestroy').test().branch('ns',copyPublish);
  x.push().push(arg(-4)).invoke(DLL,'SafeArrayDestroy').emit(0x58).call(A+'check');
  x.label(copyPublish).value(arg(-4)).emit(0x89,0x03).jump(copyDone);
  x.label(copyEmpty).emit(0x53).call(A+'destroy');
  x.label(copyDone).value(0).leave(8);
}
