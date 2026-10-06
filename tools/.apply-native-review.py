# One-time source publication aid, removed before review/merge. All offsets refer
# to fingerprint-checked original lines; postimages must match reviewed sources.
from pathlib import Path
import hashlib

def edit(path, before, after, patches):
    p=Path(path); data=p.read_bytes()
    assert hashlib.sha256(data).hexdigest()==before, 'Changed preimage: '+path
    lines=data.decode().splitlines(keepends=True)
    for start, end, text in reversed(patches):
        lines[start:end]=text.splitlines(keepends=True)
    result=''.join(lines).encode()
    assert hashlib.sha256(result).hexdigest()==after, 'Changed result: '+path
    p.write_bytes(result)

edit('docs/WIN32-AOT.md', '085e080c4cb52f226057ad665ecd2ff4d4792651e48519b3cd0c0ff987294ad8', 'ff68da2dca6506211901dcfb4cdeb497689072b8a7c6028317574c411841ce56', [
    (57, 58, 'Fixed arrays support up to sixty dimensions, explicit constant lower/upper bounds and Option Base. The first dimension is contiguous; Byte/Integer/Boolean/Long/Single/Double/Currency elements use their native widths, and String elements own their BSTRs. Indexes are checked before access. `LBound`/`UBound` accept an optional checked dimension; `Erase` resets numeric elements and frees/resets String elements. Each array is limited by checked x86 backing-size arithmetic (2,147,483,640 bytes by default, optionally lowered with maxArrayBytes), and each procedure workspace to 512 KiB. The compiler probes stack pages. Dynamic arrays, ReDim/Preserve and exact-type whole-array ByRef calls/assignment use owned SAFEARRAY storage; see [Native arrays](WIN32-ARRAYS.md). Variants, Decimal, records and class instances remain unsupported. Fixed-length String ByRef copy-back is explicitly rejected.\n'),
    (97, 98, 'Numeric standard-module AddressOf callbacks are supported through guarded same-thread stdcall thunks; see [Native callbacks](WIN32-CALLBACKS.md). Native DLL String/BSTR ABI parameters, C calling convention, structs, arbitrary cross-thread callbacks, dynamic library discovery, COM/IDispatch and OCX hosting are not implemented. Supporting a scalar Declare is not equivalent to full Win32 API or ActiveX compatibility.\n'),
])

edit('docs/WIN32-ARRAYS.md', '00c2f4edbb11e260c9b7359311c742870b687ef434f446d8fe63b2afedfee80a', '1fbf054aa9546d342e0129d0d54c94147e77dde1248c7248d3eebaa5cd069a09', [
    (28, 29, 'Element types are Byte, Integer, Boolean, Long, Single, Double, Currency, Date and String. Single\n'),
    (32, 33, '`ReDim` accepts one through sixty dimensions with runtime signed 32-bit bounds and\n'),
    (71, 73, 'The former one-MiB backing quota is removed. The checked x86 per-array ceiling\nis 2,147,483,640 bytes, excluding separately owned BSTR contents and descriptor\nmetadata. This is an address-arithmetic ceiling, not a promise that Windows can\nallocate that much contiguous memory. Rank is limited to sixty. Failed dimension,\nproduct, width or allocation checks preserve an existing destination descriptor.\n\nHosts can request a stricter per-array limit with\n`compileWin32(project, {maxArrayBytes: 1048576})`, or the repository CLI option\n`--max-array-bytes 1048576`. The option must be a positive integer no greater than\nthe x86 ceiling. It checks both fixed declarations and dynamic allocation/Preserve\nbefore changing live storage; byte counts need not be multiples of element width.\nIt is not a cumulative process-memory budget or a bound on separate String data. Procedure workspace remains limited to\n'),
])

edit('docs/WIN32-DATES.md', '135c26e33350139decdba66f517162a380e92b3ff6129430672395cc5bcf0eba', 'b46d6b106dfb439cb1afc4253214a6631583c1ce8e16c2b2f431dcc601183fe5', [
    (18, 19, 'and retain existing bounds, checked x86 backing-size limits, element locks and error\n'),
    (74, 76, 'supply a correctly matching DLL and signature. Guarded same-thread scalar AddressOf callbacks are documented separately;\nthis does not add structure or arbitrary COM support.\n'),
    (92, 94, 'Native `DateAdd`, `DateDiff`, `DatePart`, and `FormatDateTime` now have the\nseparate implemented contract linked below; general Format syntax is not included.\n'),
    (128, 128, '\n## Calendar interval extension\n\nDateAdd, DateDiff, DatePart and FormatDateTime are now implemented by the direct exporter; their contracts, raw-reference differences and validation are documented in [Native calendar intervals](WIN32-CALENDAR-INTERVALS.md). Standard-module numeric/Date callbacks now use [guarded AddressOf thunks](WIN32-CALLBACKS.md); this is not general callback or COM support.\n'),
])

edit('src/native/arrays.js', 'af5ff04d2ecf1e1806a90bedc0c68009a4edbd61226700d970fb7a6c9a2053dc', '1caefde7e337391fa810a35f0198b933f9f668564cbf1946376c567ead8aa2e8', [
    (16, 16, "\n/** Optional stricter host budget; it cannot relax checked x86 size arithmetic. */\nexport function nativeArrayLimit(value, fail = message => { throw new Error(message); }) {\n  if(value === undefined)return NATIVE_ARRAY_MAX_BYTES;\n  if(!Number.isSafeInteger(value) || value < 1 || value > NATIVE_ARRAY_MAX_BYTES)\n    fail('maxArrayBytes must be an integer from 1 to ' + NATIVE_ARRAY_MAX_BYTES);\n  return value;\n}\n"),
    (113, 114, '  const x=compiler.x, maxBytes=compiler.maxArrayBytes ?? NATIVE_ARRAY_MAX_BYTES;\n'),
    (130, 131, "    .label(countDone).emit(0x89,0xd8).compare(maxBytes).branch('g','error:7').leave(4);\n"),
    (148, 149, "    .emit(0x0f,0xaf,0x45,0xf0).branch('o','error:7').compare(maxBytes).branch('g','error:7');save(x,-16);\n"),
    (151, 154, "    .value(arg(-16)).compare(Math.floor(maxBytes/4)).branch('g','error:7').jump(limitDone);\n  x.label(halfLimit).value(arg(-16)).compare(Math.floor(maxBytes/2)).branch('g','error:7').jump(limitDone);\n  x.label(doubleLimit).value(arg(-16)).compare(Math.floor(maxBytes/8)).branch('g','error:7').jump(limitDone);\n"),
])

edit('src/native/compiler.js', '8230402dcf16f14860bf041393956011ef06eec23d14de962c4c8cd1de868d9b', '0585f2f42c56a3b40ba535f16fdeaba84e8eac8e883c55c8afb28c9b225ca966', [
    (6, 6, "import {nativeCallbackMethods,emitNativeCallbackHelpers} from './callbacks.js';\n"),
    (12, 13, "import {nativeArrayLimit,nativeArrayMethods,emitNativeArrayHelpers} from './arrays.js';\n"),
    (46, 47, '  constructor(project, options = {}) {\n    this.maxArrayBytes=nativeArrayLimit(options.maxArrayBytes, message=>this.fail(message));\n'),
    (632, 632, '    emitNativeCallbackHelpers(this);\n'),
    (635, 635, "    if(this.nativeCallbacks?.size)x.api('kernel32.dll','GetCurrentThreadId').store('native:callback:thread');\n"),
    (655, 656, "    return {bytes:linked.bytes,report:{target:'win32-aot',architecture:'x86',format:'PE32',extraction:false,arrayLimits:{maxBytes:this.maxArrayBytes,maxRank:60},runtime:'Win32 system DLLs; no embedded JavaScript engine or VB6 runtime',graphics:'native Windows controls / GDI, not WebGPU',size:linked.bytes.length,imports:linked.imports,sections:linked.sections,sourceMap:this.sourceMap.map(s => ({...s,rva:linked.symbols[s.symbol]})),callbacks:[...(this.nativeCallbacks?.values()||[])].map(({target,label})=>({module:target.module.name,procedure:target.proc.name,rva:linked.symbols[label],argumentBytes:target.argumentBytes,thread:'application',convention:'stdcall'})),limits:['Typed integer/Single/Double/Currency/Date/String storage, fixed/dynamic arrays and error recovery; unsupported VB constructs fail compilation.','Native controls use Windows theme/font metrics, not pixel-identical VB6 styling.','WebGPU remains a separate Electron target.']}};\n"),
    (658, 659, 'Object.assign(NativeCompiler.prototype,nativeCallbackMethods,nativeCallMethods,nativeBindingMethods,nativeStorageMethods,nativeErrorMethods,nativeArrayMethods,nativeNumericMethods,nativeControlArrayMethods,nativeCurrencyMethods,nativeDateMethods,nativeDateIntervalMethods);\n'),
    (663, 664, '  return new NativeCompiler(project,options).build();\n'),
])

edit('src/native/numeric.js', '9e4d78d5d3d55f5291b68b3e478531f19a3f1bc3f4e648bc39cbde4265e2fcc4', '014fe7ba3ce6ddb32050a7bd2ecd510cde0e4a00599d041cd51bb010dc0cbf73', [
    (136, 137, "      if(node.kind==='addressOf'){this.nativeCallbackArgument(p,node);}\n      else if(node.kind==='byval'){this.numeric(node.expr);}\n"),
])

edit('src/native/storage.js', 'b2fcd68b87a6a0f96dcf6a6a05bd2665bb4c58e5d6334a6179ee03004688daa8', '96fab96e7089f601c1cbbe8f81d0404e931ab2a3f55bd9081ba6b7888f788c60', [
    (46, 47, "      if (!Number.isSafeInteger(count) || count * elementBytes > (compiler.maxArrayBytes ?? NATIVE_ARRAY_MAX_BYTES)) compiler.fail('Native fixed array exceeds checked x86 backing-address range or configured budget', module);\n"),
])

edit('tests/win32-large-arrays.test.mjs', 'aa0f7ff54feb82fb9e22c0f5bff04a99fa4a085b1308f4caee6731e7343233a6', '3357107bcf8558b125300f9a45e2a26ec910ab7db8b675ed9b87f66b6ccf9972', [
    (35, 35, "\ntest('optional array budget is validated before native source generation',()=>{\n const {project}=largeArrayFixture();\n for(const maxArrayBytes of [null,0,-1,0.5,NaN,Infinity,'1024',0x80000000])\n  assert.throws(()=>compileWin32(project,{maxArrayBytes}),/maxArrayBytes/);\n assert.throws(()=>compileWin32(project,{maxArrayBytes:1024}),/configured budget/);\n});\ntest('smaller budgets change emitted dynamic-size guards without allocating host backing',()=>{\n const {project}=largeArrayFixture();project.modules[0].code='Sub Main()\\nDim a() As Long\\nReDim a(1)\\nEnd Sub';\n const limited=compileWin32(project,{maxArrayBytes:1023}),normal=compileWin32(project);\n assert.equal(limited.report.arrayLimits.maxBytes,1023);assert.equal(limited.report.arrayLimits.maxRank,60);\n assert.notDeepEqual(limited.bytes,normal.bytes);\n assert.deepEqual(normal.bytes,compileWin32(project,{maxArrayBytes:NATIVE_ARRAY_MAX_BYTES}).bytes);\n});\ntest('native CLI parses a strict decimal byte budget without lossy unit suffixes',async()=>{\n const {parseWin32Options}=await import('../tools/build-win32.mjs');\n assert.equal(parseWin32Options(['--max-array-bytes','1048576']).maxArrayBytes,1048576);\n for(const value of ['1.5','1e6','1MiB','Infinity'])assert.throws(()=>parseWin32Options(['--max-array-bytes',value]),/integer/);\n});\n"),
])

edit('tools/browser-native-build-tests.py', '431c4af4aa757c4a0ef756e1ec998d30bbe422dfdac6b60365d2bfa1f447d5d7', 'fba6e15679828a142c8005599350094a51c3434da61716e991321a13be9c0822', [
    (105, 105, '        for folder, name in [(\'interval-contract\', \'AotIntervalContract\'), (\'large-arrays\', \'AotLargeArrays\'), (\'callbacks\', \'AotCallbacks\')]:\n            extra = ROOT / \'validation\' / folder\n            if not (extra / f\'{name}.vb6web\').exists():\n                continue\n            original = json.loads((extra / f\'{name}.vb6web\').read_text())\n            page.evaluate(\'p => vb6Studio.loadProject(p)\', original)\n            before = page.evaluate(\'JSON.stringify(vb6Studio.project.modules)\')\n            with page.expect_download() as pending:\n                page.evaluate(\'vb6Studio.command("exportWin32")\')\n            downloaded = pending.value\n            downloaded.save_as(OUT / f\'{name}.exe\')\n            check(f\'{name}: Make EXE preserves source\', before == page.evaluate(\'JSON.stringify(vb6Studio.project.modules)\'))\n            check(f\'{name}: Make EXE equals Node\', (OUT / f\'{name}.exe\').read_bytes() == (extra / f\'{name}.exe\').read_bytes())\n            check(f\'{name}: no page/network errors\', not errors and not requests)\n'),
    (120, 120, "        for folder, name in [('interval-contract','AotIntervalContract'), ('large-arrays','AotLargeArrays'), ('callbacks','AotCallbacks'), ('callbacks','AotCallbackThreadGuard')]:\n            extra = ROOT / 'validation' / folder\n            if (extra / f'{name}.vb6web').exists():\n                fixtures.append((extra, name))\n"),
])

edit('tools/build-win32.mjs', 'bf74641a47bbe5d95cc3f6fff0164a2ec2ba5bc8c2147027f1446f5071747c54', '48acae76b3251191b939fa0677c91478c9258f76e398fd24407cd4612e09e74a', [
    (21, 22, "  const options = {}, fields = {'--project':'project','--out':'out','--name':'name','--source-root':'sourceRoot','--arch':'arch','--graphics':'graphics','--max-array-bytes':'maxArrayBytes'};\n"),
    (27, 27, "  if(options.maxArrayBytes!==undefined){if(!/^[0-9]+$/.test(options.maxArrayBytes))throw new Error('--max-array-bytes requires a positive integer');options.maxArrayBytes=Number(options.maxArrayBytes);}\n"),
    (30, 31, "  try { const options = parseWin32Options(process.argv.slice(2)); if (options.help) console.log('Build a no-extraction x86 Windows EXE in JavaScript:\\n  npm run build:win32 -- --project file.vb6web|file.vbp [--out directory] [--name Name] [--max-array-bytes bytes]\\nNative controls/GDI; Byte/Integer/Long/Boolean, Single/Double, Currency, Date, Strings and typed arrays. Unsupported features produce diagnostics, not an executable.'); else console.log(JSON.stringify(await buildWin32(options),null,2)); }\n"),
])

expected_new = {
    'docs/WIN32-CALENDAR-INTERVALS.md': 'fb0b4d148971d9d9f5561264d6c9c31e8104df010ba0b8d9314689dd7df18dc4',
    'docs/WIN32-CALLBACKS.md': 'b5944de4ac88e1ddc2086da7b6b337a414df950f9c9ec2d3dcad8fe8c3cb60d4',
    'src/native/callbacks.js': '96c21d763614c569142f1b63b19c97a74053693ef4c9a2f533aa575afd9c03b3',
    'tests/fixtures/native/callback-abi.c': '7e669767675337662dcdaeeafe102229fa6c099046fabe6236085cdf46e733ec',
    'tests/fixtures/native/callback-abi.def': 'd02722082bbd22948724d71555dfac9edae84a0e655392629d2d6be69855ff24',
    'tests/win32-callbacks.test.mjs': '7315814aa0be03bbc7e28ceb30674fa1c5e5d101c8f73b3445931b4236a02ee6',
    'tools/test-win32-callbacks.ps1': '0047447479d3aaf7834e016507fd279864f7999dba92350c33b3b328d73ccff2',
    'tools/win32-array-budget-fixture.mjs': '87716a1984aeee4d9239a29024080b7c367e3f4d9c21857e648ebe660ec06a28',
    'tools/win32-callback-fixtures.mjs': 'a1f3131ca458ec78d87c02aa93181edeafa7ca241c3d68dbb60daf9678605d51',
}
for path, expected in expected_new.items():
    assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==expected, "Transferred file mismatch: "+path
print("Reviewed source fingerprints verified")
