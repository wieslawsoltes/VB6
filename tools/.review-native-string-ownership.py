# One-time reviewed source application; deleted before release.
from pathlib import Path
import hashlib
def edit(path, before, after, patches):
 p=Path(path); original=p.read_bytes()
 assert hashlib.sha256(original).hexdigest()==before,'Changed preimage: '+path
 lines=original.decode().splitlines(keepends=True)
 for start,end,text in reversed(patches): lines[start:end]=text.splitlines(keepends=True)
 result=''.join(lines).encode()
 assert hashlib.sha256(result).hexdigest()==after,'Changed result: '+path
 p.write_bytes(result)

edit('src/native/storage.js', '804998b200c41e16bf0cbee9ef09c1c3a2201ce38ad9faa83d8648845545ad20', 'c1980c0ec7359430040bad1a62d4c0a49b3929c74f1fd7efa29c4acb2a4b18a1', [
 (117, 118, ''),
])

edit('docs/WIN32-CALLS.md', '1c0a51daf55b65b97e4b9f264558256bca584940f1b9c6a9c9e9a37e736e653b', 'cf0de278e83b42bf62ab0043210a4c53f3b55ef38a9256fce5a39a690b4aa79b', [
 (118, 122, 'The numeric override is limited to an external **ByRef Long** declaration.\nThe external ByRef String override is implemented separately under\n[the ANSI byte-BSTR marshalling contract](WIN32-STRING-INTEROP.md). Neither is\na general reinterpret-cast for Currency, Double, arrays, records,\n'),
])

edit('docs/WIN32-STRING-INTEROP.md', '2cab8ea2a0cf7b6c9822bfd60874d2b0d69db93b26132c3b35ef20ef98df627c', '991383aef5b88cc413ca27de6d11bd472ce7228089b338fc8e1d0d45c9c56903', [
 (103, 103, '## Ownership edge cases\n\nThe native ownership suite also checks aliased output arguments with named-order\nreordering, grouped private copies, a successful first output followed by a\nrejected oversized second output, and repeated failure cleanup. These are explicit\nmarshaler contracts, not a claim that every original VB6 alias behavior is identical.\nAn authored constant named `vbNullString` retains its lexical binding even inside\n`StrPtr`; only the actual intrinsic maps to a null pointer.\n\n'),
 (114, 114, '`node tools/win32-string-edge-fixture.mjs` additionally emits **AotStringOwnership**\nfor the ownership/binding edge cases. Its test DLL is also explicitly declared.\n\n'),
 (115, 116, 'installed MSVC, runs all three JavaScript-generated EXEs in separate temporary folders,\n'),
])

edit('tests/fixtures/native/string-abi.c', '0b1c097d40f270afc0fb33db791f5fc1ba7ae7ebde52db8e4b8d2d9c0ca319ee', 'ff5a041b3ed682366c60b18d0e6dc5643ee9d20aeb123c1355d7ded08e1fe0b5', [
 (62, 62, '\n/* Ownership edge cases are separate from unsafe/malformed DLL contracts. Every\n * replacement is a fresh byte-BSTR, and each old owner is released exactly once. */\nlong __stdcall AliasBuffers(BSTR first,BSTR second) {\n if(!first || !second || first==second || SysStringByteLen(first)<1 || SysStringByteLen(second)<1)return -1;\n ((char*)first)[0]=\'A\';((char*)second)[0]=\'B\';return 1;\n}\nvoid __stdcall AliasOwners(BSTR *first,BSTR *second) {\n BSTR a,b;\n if(first==second || (*first && *first==*second))ExitProcess(238);\n a=SysAllocStringByteLen("first",5);b=SysAllocStringByteLen("second",6);\n if(!a || !b)ExitProcess(239);\n SysFreeString(*first);SysFreeString(*second);*first=a;*second=b;SetLastError(17800);\n}\nvoid __stdcall PartialOutputs(BSTR *first,BSTR *second) {\n BSTR a=SysAllocStringByteLen("committed",9),b=ReturnString(3);\n if(!a || !b)ExitProcess(240);\n SysFreeString(*first);SysFreeString(*second);*first=a;*second=b;SetLastError(17801);\n}\n'),
])

edit('tests/fixtures/native/string-abi.def', 'b5ed43cb03afbef1140616e89333047c361e9ce2c447e6654480617b1d959c70', '57bd02cbfe924055ef2d413e7f3dcd5ccbfbe2c24cf9ded7bb5684bd4683744c', [
 (19, 19, ' AliasBuffers=_AliasBuffers@8\n AliasOwners=_AliasOwners@8\n PartialOutputs=_PartialOutputs@8\n'),
])

edit('tools/browser-native-build-tests.py', '33282ec109758ff618d4e32c00038bfb6ecc3094c61b5856217d1bdba474f53f', '6343800b49ab47ba82c91ba1767b6103fb52aa82100be8e6baa490d6090c4153', [
 (105, 106, "        for folder, name in [('interval-contract', 'AotIntervalContract'), ('large-arrays', 'AotLargeArrays'), ('callbacks', 'AotCallbacks'), ('string-interop', 'AotStringInterop'), ('string-interop', 'AotWin32Strings'), ('string-interop', 'AotStringOwnership')]:\n"),
 (134, 135, "        for folder, name in [('interval-contract','AotIntervalContract'), ('large-arrays','AotLargeArrays'), ('callbacks','AotCallbacks'), ('callbacks','AotCallbackThreadGuard'), ('string-interop','AotStringInterop'), ('string-interop','AotWin32Strings'), ('string-interop','AotStringOwnership')]:\n"),
])

edit('tools/test-win32-string-interop.ps1', 'e053331b8866740bf09e6f719ab480d8e8409aad435cb95fa3156c93bf949c41', 'ebd2f35374182d4b8429f78d889e8028cb02d5fe46437339ae6fbbd33ccb95a7', [
 (25, 25, 'using System;\nusing System.Collections.Generic;\n'),
 (26, 26, 'using System.Text;\n'),
 (28, 28, ' delegate bool EnumProc(IntPtr h,IntPtr p);\n [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr p);\n [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr p);\n [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);\n [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode)] static extern IntPtr TextMessage(IntPtr h,uint msg,IntPtr length,StringBuilder text,uint flags,uint timeout,out UIntPtr result);\n static string Text(IntPtr h) {var text=new StringBuilder(2048);UIntPtr result;TextMessage(h,13,(IntPtr)text.Capacity,text,2,200,out result);return text.ToString();}\n public static string Diagnostics(int id) {var result=new List<string>();EnumWindows((h,p)=>{uint owner;GetWindowThreadProcessId(h,out owner);if(owner==id){result.Add(Text(h));EnumChildWindows(h,(c,q)=>{result.Add(Text(c));return true;},IntPtr.Zero);}return true;},IntPtr.Zero);return string.Join(" | ",result);}\n'),
 (31, 32, "foreach($entry in @(@('AotStringInterop','string-interop-build.json'),@('AotWin32Strings','system-strings-build.json'),@('AotStringOwnership','string-ownership-build.json'))) {\n"),
 (53, 54, "  if(-not $process.WaitForExit(60000)){throw ('String execution timed out: '+[StringOracleEnvironment]::Diagnostics($process.Id))}\n"),
])

for path,expected in {
 'tests/win32-string-ownership.test.mjs':'76e8646fcace1a474473dbb1ea069f33463a1baa4aec2e3ef991042c0bf0c1bc',
 'tools/win32-string-edge-fixture.mjs':'a81639c4de1511d0d7a331f8eb18f93a489917c4c04707dc78ebc647c011c9f2',
}.items():
 assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==expected,'New file mismatch: '+path
print('All reviewed native String ownership source fingerprints verified')
