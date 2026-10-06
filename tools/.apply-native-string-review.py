# One-time reviewed-source publication; deleted after application.
from pathlib import Path
import hashlib

def edit(path,before,after,patches):
    p=Path(path);data=p.read_bytes()
    assert hashlib.sha256(data).hexdigest()==before,'Changed preimage: '+path
    lines=data.decode().splitlines(keepends=True)
    for start,end,text in reversed(patches):lines[start:end]=text.splitlines(keepends=True)
    result=''.join(lines).encode()
    assert hashlib.sha256(result).hexdigest()==after,'Changed postimage: '+path
    p.write_bytes(result)

edit('docs/WIN32-AOT.md', 'ff68da2dca6506211901dcfb4cdeb497689072b8a7c6028317574c411841ce56', '2560a7b8fbbad16dff59ae9c229f39e2da348c0c51149e1415194956982a2bc3', [
    (55, 56, 'Stored Unicode Strings use owned BSTR allocations from the Windows Automation system library. Globals, locals, statics, ByVal copies, ByRef mutation and String function return values have explicit ownership. Expressions snapshot stored values before evaluating a later operand that could mutate them. Each expression temporary is released at the next lowered instruction and procedure exit; recursive calls have independent ownership slots. Fixed-length Strings (1–65,535 UTF-16 units) pad/truncate on assignment and initialize with spaces. `Space$`, `Len`, `LenB`, `Left$`, `Right$`, `Mid$`, `ChrW`, `AscW`, `CStr`, explicit numeric conversions and ordinal comparisons preserve explicit String lengths, including embedded NULs. Strict numeric conversion rejects embedded NUL rather than silently accepting a numeric prefix; `Val` deliberately parses a prefix using a period as the decimal separator. `InStr` uses explicit BSTR lengths. `StrPtr(variable)` reads its current storage pointer without creating a copy; pointers to computed text are only valid through the current statement.\n'),
    (57, 58, 'Fixed arrays support up to sixty dimensions, explicit constant lower/upper bounds and Option Base. The first dimension is contiguous; Byte/Integer/Boolean/Long/Single/Double/Currency elements use their native widths, and String elements own their BSTRs. Indexes are checked before access. `LBound`/`UBound` accept an optional checked dimension; `Erase` resets numeric elements and frees/resets String elements. Each array is limited by checked x86 backing-size arithmetic (2,147,483,640 bytes by default, optionally lowered with maxArrayBytes), and each procedure workspace to 512 KiB. The compiler probes stack pages. Dynamic arrays, ReDim/Preserve and exact-type whole-array ByRef calls/assignment use owned SAFEARRAY storage; see [Native arrays](WIN32-ARRAYS.md). Variants, Decimal, records and class instances remain unsupported. Fixed-length String ByRef copy-back to project procedures is still rejected; external Declare String copy-back has the separate contract below.\n'),
    (63, 64, '`On Error GoTo label`, `On Error Resume Next`, `On Error GoTo 0`, `Resume`, `Resume Next`, `Resume label`, `Error number`, `Err.Raise(number)`, `Err.Clear`, `Err.Number`, `Err.Description`, `Err.Source`, `Err.LastDLLError` and `Erl` are lowered. A procedure has separate enabled/active handler state. A fault in an active handler propagates to its caller; a failed callee unwinds its owned Strings before the caller handles the failed call. Resume restores the recorded instruction, not the current handler location. Interrupted expression/argument stacks are discarded without discarding addressable locals. Floating values are materialized before calls and error checkpoints, with no live x87 values spanning a nonlocal error transfer. Handled bounds, overflow, division and conversion faults do not terminate the process.\n'),
    (85, 86, 'The compiler links named/aliased/ordinal **stdcall** imports with scalar Byte/Integer/Long/Boolean/Single/Double/Currency/Date/String parameters and returns. ByVal Double and Currency occupy eight stack bytes; Single occupies four; a ByRef argument is an address of the exact declared type. Floating returns use ST(0); Currency returns use EDX:EAX. Both are immediately captured by the caller. `StrPtr(text)` supplies a UTF-16 pointer for synchronous Unicode APIs, for example:\n'),
    (97, 98, 'Numeric standard-module AddressOf callbacks are supported through guarded same-thread stdcall thunks; see [Native callbacks](WIN32-CALLBACKS.md). Native Declare String parameters/returns and multiline declarations now follow [the ANSI byte-BSTR contract](WIN32-STRING-INTEROP.md). C calling convention, structs, arbitrary cross-thread callbacks, dynamic library discovery, COM/IDispatch and OCX hosting are not implemented. Supporting a scalar Declare is not equivalent to full Win32 API or ActiveX compatibility.\n'),
])

edit('docs/WIN32-ARRAYS.md', '1fbf054aa9546d342e0129d0d54c94147e77dde1248c7248d3eebaa5cd069a09', '304fdd8c202243cdc1b3c4543ec76b69e6f5a88fdb527f7d5cfd82e18fad2e9a', [
    (85, 87, 'String whole-array arguments and fixed-length String scalar ByRef copy-back to\nproject procedures are not implemented. External Declare String element and fixed\nString copy-back follow [the separate marshalling contract](WIN32-STRING-INTEROP.md). Native Declare array/SAFEARRAY signatures remain rejected;\n'),
])

edit('docs/WIN32-CALLBACKS.md', 'b5944de4ac88e1ddc2086da7b6b337a414df950f9c9ec2d3dcad8fe8c3cb60d4', '6dca10a0b9dc7e1bd6ad6717a66cd194d5fcaec4228a731bb75ba4f752178bde', [
    (21, 23, 'The Declare reader supports physical line continuations while preserving source\npositions. Invoke the example with\n'),
    (38, 39, "suspended caller's Err state, including its LastDLLError snapshot. Its owned local Strings/arrays are cleaned by the\n"),
])

edit('docs/WIN32-CALLS.md', '3da1b74437df11e1cb26dab264d33c5e54a616655121b7ab6db76cff2ad79492', '1c0a51daf55b65b97e4b9f264558256bca584940f1b9c6a9c9e9a37e736e653b', [
    (100, 101, 'but fixed-length String **copy-back to project procedures** is still unsupported. Parenthesized\n'),
    (119, 120, 'The external ByRef String override is now implemented separately under\n[the ANSI byte-BSTR marshalling contract](WIN32-STRING-INTEROP.md). This remains\nnot a general reinterpret-cast for Currency, Double, arrays, records,\n'),
])

edit('src/native/callbacks.js', '96c21d763614c569142f1b63b19c97a74053693ef4c9a2f533aa575afd9c03b3', '0334767524d5e9421c0b0ce530ec1850aca0c7e080d8eaeb68a7f0a0f62a992a', [
    (9, 10, "const state = ['frame','pending','number','description','source','erl','lastdllerror'];\n"),
    (48, 49, '    x.label(label).enter(40);\n'),
    (54, 55, "    x.emit(0xd9,0x7d,0xd8); // fnstcw [ebp-40]; preserve the foreign caller's x87 CW.\n"),
    (60, 62, "    if (signature.kind === 'function' && real.has(type)) x.emit(0xdd,0x5d,0xdc); // fstp qword [ebp-36]\n    else { save(x,-36); x.emit(0x89,0x55,0xe0); } // EAX, EDX\n"),
    (67, 70, "    x.emit(0xd9,0x6d,0xd8); // fldcw [ebp-40]\n    if (signature.kind === 'function' && real.has(type)) x.emit(0xdd,0x45,0xdc);\n    else x.value(arg(-36)).emit(0x8b,0x55,0xe0);\n"),
])

edit('src/native/calls.js', '23f4a333d980a6a811c534e2106fe728e1ab4e31fd2800bf32bc1d6a7894fea7', 'b406192b30b49a392cdad30c3e857def98ba9e84ddd0990b71a5498f6374afa2', [
    (66, 68, "      if(entry.node.kind==='byval'&&(target.proc||!p.byRef||!['long','string'].includes(key(p.type))||p.bounds!==null&&p.bounds!==undefined))\n        this.fail('Call-site ByVal requires an external scalar Long or String parameter declared ByRef; use parentheses for a project ByRef value');\n"),
])

edit('src/native/compiler.js', '0585f2f42c56a3b40ba535f16fdeaba84e8eac8e883c55c8afb28c9b225ca966', 'c018bfd79cde219aab4987de6f3d6a151d6e0bdb4402f878725c44559f6843bc', [
    (2, 2, "import {tokenize} from '../language/lexer.js';\n"),
    (5, 5, "import {nativeStringInteropMethods,emitNativeStringInteropHelpers} from './string-interop.js';\n"),
    (22, 23, "const CONSTANTS = {...NATIVE_DATE_CONSTANTS,vbtrue:-1,vbfalse:0,vbnormal:0,vbminimized:1,vbmaximized:2,vbmodal:1,vbmodeless:0,vbokonly:0,vbokcancel:1,vbyesno:4,vbyesnocancel:3,vbinformation:64,vbexclamation:48,vbcritical:16,vbquestion:32,vbok:1,vbcancel:2,vbyes:6,vbno:7,vbcrlf:'\\r\\n',vbnewline:'\\r\\n',vbtab:'\\t',vbnullchar:'\\0',vbnullstring:''};\n"),
    (30, 32, "  const lines = module.code.split(/\\r?\\n/);\n  for (let index = 0; index < lines.length; index++) {\n    if (!/^\\s*(?:Public\\s+|Private\\s+)?Declare\\b/i.test(lines[index])) continue;\n    const start = index, pieces = [];\n    // Token offsets distinguish a continuation from underscores inside names,\n    // aliases, strings or comments. Blank every consumed physical line so the\n    // language frontend and exported source map keep authored line numbers.\n    try {\n      while (true) {\n        const raw = lines[index], tokens = tokenize(raw), last = tokens.at(-2);\n        const continued = last?.type === 'id' && last.value === '_' &&\n          last.start > 0 && /\\s/.test(raw[last.start - 1]);\n        pieces.push(raw.slice(0,continued ? last.start : tokens.at(-1).start));\n        if (!continued) break;\n        if (++index >= lines.length) throw new Error('Unfinished native Declare continuation');\n      }\n    } catch (error) { throw new NativeCompileError(error.message,module.name,start + 1); }\n    const line = pieces.join(' ');\n"),
    (33, 34, "    if (!m) throw new NativeCompileError('Unsupported native Declare syntax; use a scalar stdcall declaration', module.name, start + 1);\n"),
    (35, 39, "    let params;\n    try { params = parseParameters(m[6]); }\n    catch (error) { throw new NativeCompileError(error.message,module.name,start + 1); }\n    if(params.reduce((sum,p)=>sum+nativeParameterBytes(p),0)>65532)\n      throw new NativeCompileError('Native Declare argument area exceeds the x86 stdcall return limit',module.name,start + 1);\n    if (declarations.has(name)) throw new NativeCompileError('Duplicate native declaration: ' + m[3], module.name, start + 1);\n    if (params.some(p => !INT_TYPES.has(key(p.type)) && !REAL_TYPES.has(key(p.type)) && !['currency','string'].includes(key(p.type)) || p.bounds !== null || p.optional || p.paramArray) || (key(m[2]) === 'function' && !INT_TYPES.has(key(m[7])) && !REAL_TYPES.has(key(m[7])) && !['currency','string'].includes(key(m[7])))) {\n      throw new NativeCompileError('Native Declare supports scalar Byte/Integer/Long/Boolean/Single/Double/Currency/Date/String parameters and returns; arrays and records require separate ABI support', module.name, start + 1);\n"),
    (40, 44, "    declarations.set(name, {name:m[3],kind:key(m[2]),scope:key(m[1] || 'public'),params,returnType:m[7] || 'Long',dll,symbol:/^#\\d+$/.test(m[5] || '') ? Number(m[5].slice(1)) : m[5] || m[3],line:start + 1});\n    for(let physical=start;physical<=index;physical++)lines[physical]='';\n  }\n  return {declarations, code:lines.join('\\n')};\n"),
    (186, 187, "    const errorProperty=this.errorProperty(node);if(errorProperty)return ['number','lastdllerror'].includes(errorProperty)?'long':'string';\n"),
    (190, 191, "      if(['cstr','left','right','mid','chrw','space'].includes(name))return 'string';\n"),
    (207, 207, '    if(this.nativeNullString(node)){x.value(0);return;}\n'),
    (634, 634, '    emitNativeStringInteropHelpers(this);\n'),
    (662, 663, 'Object.assign(NativeCompiler.prototype,nativeStringInteropMethods,nativeCallbackMethods,nativeCallMethods,nativeBindingMethods,nativeStorageMethods,nativeErrorMethods,nativeArrayMethods,nativeNumericMethods,nativeControlArrayMethods,nativeCurrencyMethods,nativeDateMethods,nativeDateIntervalMethods);\n'),
])

edit('src/native/errors.js', '291602b5f7b4bfe2d07ba9bef3a59a67c2da79039b6c7b13387f9ad364f1eca6', 'e0868fb1400d34243c6199e8f26767d0ab31480d01be7be1ca858a0cc38942f7', [
    (14, 15, "    for (const name of ['frame','pending','number','description','source','erl','lastdllerror']) this.slot(E+name);\n"),
    (19, 20, "    if(!['number','description','source','lastdllerror'].includes(name))this.fail('Native Err property is not implemented: '+node.name);\n"),
    (24, 25, "    if(property){x.value(mem(E+property));if(!['number','lastdllerror'].includes(property)){x.push().call('native:string:copy');this.ownString();}return true;}\n"),
])

edit('src/native/numeric.js', '014fe7ba3ce6ddb32050a7bd2ecd510cde0e4a00599d041cd51bb010dc0cbf73', 'f82d607c40f660f30e4a0bdfb59a1f61c76b17db4179206b265cddc81be18a0f', [
    (131, 132, '    const x=this.x,signature=target.proc||target,callPins=[],callStrings=[],marshalledStrings=[],slots=new Array(signature.params.length);\n'),
    (136, 137, "      if(!target.proc && key(p.type)==='string'){\n        const transfer=this.nativeExternalStringArgument(p,node);marshalledStrings.push(transfer);\n        if(transfer.pin)callPins.push(transfer.pin);\n      }else if(node.kind==='addressOf'){this.nativeCallbackArgument(p,node);}\n"),
    (155, 156, '      this.captureCurrencyReturn();if(!target.proc)this.captureNativeDllError();if(target.proc)this.checkNativeError();\n'),
    (158, 158, '      if(!target.proc)this.captureNativeDllError();\n'),
    (161, 162, "    }else if(target.proc)this.checkNativeError();else this.captureNativeDllError();\n    // String returns transfer ownership of an ANSI byte-BSTR, not an arbitrary LPSTR.\n    const ansiResult=!target.proc&&signature.kind==='function'&&key(signature.returnType)==='string'?this.ownString():null;\n    if(marshalledStrings.length){\n      x.push();for(const transfer of marshalledStrings)this.nativeStringCopyBack(transfer);\n      for(const {owner} of marshalledStrings)this.clearStringStorage(owner);x.emit(0x58);\n    }\n    if(ansiResult)this.nativeExternalStringResult(ansiResult);\n"),
])

edit('src/native/storage.js', '96fab96e7089f601c1cbbe8f81d0404e931ab2a3f55bd9081ba6b7888f788c60', '804998b200c41e16bf0cbee9ef09c1c3a2201ce38ad9faa83d8648845545ad20', [
    (83, 84, "    if(key(variable.type)==='date')this.dateExpression(node);else if(key(variable.type)==='currency')this.currencyExpression(node);else if (key(variable.type) === 'string') {if(this.type(node)==='string')this.expression(node);else this.textExpression(node);} else if(['single','double'].includes(key(variable.type))){this.floatExpression(node,key(variable.type)==='single');}else if(key(variable.type)==='boolean')this.truth(node);else this.numeric(node);\n"),
    (107, 107, "    if (name === 'space') {\n      if (args.length !== 1) this.fail('Space expects one argument');\n      this.numeric(args[0]); x.push().call('native:string:space'); this.ownString(); return true;\n    }\n"),
    (139, 139, "  // https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/space-function\n  x.label('native:string:space').enter().value({argument:8}).test().branch('s','error:5')\n    .compare(MAX_NATIVE_STRING).branch('a','error:7').push().push(0).invoke(api,'SysAllocStringLen')\n    .test().branch('e','error:7').emit(0x89,0xc3,0x89,0xc7).value({argument:8}).emit(0x89,0xc1)\n    .value(32).emit(0xfc,0xf3,0x66,0xab,0x89,0xd8).leave(4);\n"),
    (140, 141, "  const copyNonNull=x.unique();\n  x.label('native:string:copy').enter().value({argument:8}).test().branch('ne',copyNonNull).leave(4).label(copyNonNull).api(api,'SysStringLen',[{argument:8}]).compare(MAX_NATIVE_STRING).branch('g','error:7').push().push({argument:8}).invoke(api,'SysAllocStringLen').test().branch('e','error:7').leave(4);\n"),
])

edit('tests/win32-aot.test.mjs', '8f50168622f71fd60304f6fab1f2a491a15e2cef525b5275dab5f04a18eb7990', 'bc582f6a730e84c195fbd0793e6d33d2e4c6e4c7953fd887fdd71ca920bbee24', [
    (64, 65, '  \'Private Declare Function F Lib "x" (ByVal s As Object) As Long\',\n'),
])

edit('tests/win32-storage.test.mjs', '28f55b687f8bae23f08f5c6973e84d64912dc0299d06ad02bd5197c058b6eeb9', 'fc91be443db262917fcb1f7ff234fc8aae48b462b931957ec180329904009b66', [
    (44, 45, "  'Public Sub Main()\\nDim n As Long\\nn=Err.HelpContext\\nEnd Sub'\n"),
])

edit('tools/browser-native-build-tests.py', 'fba6e15679828a142c8005599350094a51c3434da61716e991321a13be9c0822', '33282ec109758ff618d4e32c00038bfb6ecc3094c61b5856217d1bdba474f53f', [
    (105, 106, "        for folder, name in [('interval-contract', 'AotIntervalContract'), ('large-arrays', 'AotLargeArrays'), ('callbacks', 'AotCallbacks'), ('string-interop', 'AotStringInterop'), ('string-interop', 'AotWin32Strings')]:\n"),
    (134, 135, "        for folder, name in [('interval-contract','AotIntervalContract'), ('large-arrays','AotLargeArrays'), ('callbacks','AotCallbacks'), ('callbacks','AotCallbackThreadGuard'), ('string-interop','AotStringInterop'), ('string-interop','AotWin32Strings')]:\n"),
])

new_hashes = {'docs/WIN32-STRING-INTEROP.md': '2cab8ea2a0cf7b6c9822bfd60874d2b0d69db93b26132c3b35ef20ef98df627c', 'src/native/string-interop.js': 'c58a4e58ad1327e79088ffb4703fe841fd5ef6d63602facce179315f5b1a1d80', 'tests/fixtures/native/string-abi.c': '0b1c097d40f270afc0fb33db791f5fc1ba7ae7ebde52db8e4b8d2d9c0ca319ee', 'tests/fixtures/native/string-abi.def': 'b5ed43cb03afbef1140616e89333047c361e9ce2c447e6654480617b1d959c70', 'tests/win32-string-interop.test.mjs': '2914bb5224605d788eaf3f324bd88b0ed9c8e768741015b3e9a2f0bf748b3742', 'tools/test-win32-string-interop.ps1': 'e053331b8866740bf09e6f719ab480d8e8409aad435cb95fa3156c93bf949c41', 'tools/win32-string-fixtures.mjs': '510eae1a7bf4e2c4bac3f7b98dfad5a0204c36d3a4d513d170ee39d8d47ffdf9'}
for p,h in new_hashes.items():
    assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h,"Transferred file mismatch: "+p
print("Verified source preimages, postimages and new files")
