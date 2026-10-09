/** Native Declare strings: ANSI byte-BSTR temporaries, never writable .rdata.
 * Original implementation of the Microsoft VB5 DLL contract, section 5:
 * https://classicvb.net/tips/vb5dll/ (Microsoft's paper, republished with permission).
 * Allocation/conversion contracts:
 * https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-sysallocstringbytelen
 * https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte
 * https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/lastdllerror-property
 */
import {MAX_NATIVE_STRING} from './storage.js';
const key = value => String(value).toLowerCase();
const I = 'native:interop:', OLE = 'oleaut32.dll', KERNEL = 'kernel32.dll';
const arg = argument => ({argument});
const save = (x, offset) => x.emit(0x89, 0x85).imm(offset);
// CP_ACP can be UTF-8 on modern Windows. Query actual byte lengths, never assume
// one byte per UTF-16 unit. This bounds temporary storage, not foreign DLL writes.
export const MAX_NATIVE_ANSI_BYTES = MAX_NATIVE_STRING * 4;

export const nativeStringInteropMethods = {
  nativeNullString(node) {
    if (node.kind === 'group') return this.nativeNullString(node.expr);
    return node.kind === 'id' && key(node.name) === 'vbnullstring' &&
      !this.variable(node) && !this.nativeConstant(node) && !this.nativeFunctionType(node);
  },
  captureNativeDllError() {
    // Called after ST(0) has been spilled, before any allocation or conversion.
    // GetLastError's volatile EAX/EDX cannot overwrite the DLL's return value.
    this.x.emit(0x50,0x52).api(KERNEL,'GetLastError').store('native:error:lastdllerror').emit(0x5a,0x58);
  },
  nativeConvertString(owner, helper) {
    if(helper==='to-utf8'||helper==='from-utf8')this.nativeStringUTF8Interop=true;
    else this.nativeStringInterop = true;
    const x = this.x;
    x.push(); this.rawStorageAddress(owner);
    x.emit(0x59).push().emit(0x51).call(I + helper);
  },
  nativeExternalStringArgument(parameter, expression) {
    const byval = expression.kind === 'byval', node = byval ? expression.expr : expression;
    const variable = this.variable(node), forced = node.kind === 'group';
    if (variable?.nativeArray && !variable.elementOf)
      this.fail('Native Declare String arguments must be scalar values or String array elements');
    if (parameter.byRef && !byval && !forced && variable && key(variable.type) !== 'string')
      this.fail('ByRef native String argument must have the exact declared type');
    const owner = this.temporaryString(), x = this.x;
    let destination = null, pin = null;
    if (variable && key(variable.type) === 'string' && !forced) {
      // Capture the destination address/subscript once, before later arguments.
      // An array-element pin spans argument evaluation, foreign reentry and copy-back.
      destination = this.arrayWorkspace(4,'dll-string-destination');
      pin = this.address(variable); x.push(); this.rawStorageAddress(destination);
      x.emit(0x59,0x89,0x08);
      if(variable.nativeInlineString){x.push(variable.fixedLength).pushOperand('ecx').invoke(OLE,'SysAllocStringLen').test().branch('e','error:7');this.ownString();}
      else x.emit(0x8b,0x01);
    } else if (this.type(node) === 'string') this.expression(node);
    else this.textExpression(node);
    this.nativeConvertString(owner,'to-ansi');
    if (parameter.byRef && !byval) this.rawStorageAddress(owner);
    return {owner,destination,pin,fixedLength:variable?.fixedLength || 0,inline:!!variable?.nativeInlineString};
  },
  nativeStringCopyBack({owner,destination,fixedLength,inline}) {
    if (!destination) return;
    const wide = this.temporaryString(), x = this.x;
    this.rawStorageAddress(owner); x.emit(0x8b,0x00);
    this.nativeConvertString(wide,'to-unicode');
    if (fixedLength&&!inline) {
      x.emit(0x89,0xc3).push(fixedLength).emit(0x53).call('native:string:fixed');
      this.ownString();
    }
    // The original owner is replaced only after decoding/allocation succeeds.
    // The stored destination, not a second evaluation of its subscript, is used.
    x.push(); this.rawStorageAddress(destination); x.emit(0x8b,0x00);if(inline)x.pushOperand(fixedLength).push().call('native:record:assign-fixed');else x.push().call('native:string:assign');
  },
  nativeExternalStringResult(ansiOwner) {
    const wide = this.temporaryString(), x = this.x;
    this.nativeConvertString(wide,'to-unicode');
    x.push(); this.clearStringStorage(ansiOwner); x.emit(0x58);
  }
};

/** Conversion helpers receive (source BSTR, destination owner-slot pointer). Newly
 * allocated memory is adopted immediately, before a conversion can raise an
 * error. The caller's ordinary statement/error cleanup owns every byte-BSTR. */
export function emitNativeStringInteropHelpers(c) {
  if (!c.nativeStringInterop&&!c.nativeStringUTF8Interop) return;
  const x = c.x;
  for (const utf8 of [false,true]) {
    if(utf8?!c.nativeStringUTF8Interop:!c.nativeStringInterop)continue;
    const codepage=utf8?65001:0;
    for (const ansi of [true,false]) {
      const empty = x.unique(), allocate = x.unique(), done = x.unique(), nil = x.unique();
      x.label(I + (utf8?(ansi?'to-utf8':'from-utf8'):(ansi?'to-ansi':'to-unicode'))).enter(8);
      x.value(arg(12)).emit(0x89,0xc6,0xff,0x36).invoke(OLE,'SysFreeString').emit(0xc7,0x06,0,0,0,0);
      x.value(arg(8)).test().branch('e',nil);
      x.api(OLE,ansi ? 'SysStringLen' : 'SysStringByteLen',[arg(8)])
        .compare(ansi ? MAX_NATIVE_STRING : MAX_NATIVE_ANSI_BYTES).branch('a','error:7');
      save(x,-4); x.test().branch('e',empty);
      if (ansi) x.api(KERNEL,'WideCharToMultiByte',[codepage,utf8?128:0,arg(8),arg(-4),0,0,0,0]);
      else x.api(KERNEL,'MultiByteToWideChar',[codepage,utf8?8:0,arg(8),arg(-4),0,0]);
      x.test().branch('e','error:5').compare(ansi ? MAX_NATIVE_ANSI_BYTES : MAX_NATIVE_STRING)
        .branch('a','error:7').jump(allocate);
      x.label(empty).value(0).label(allocate); save(x,-8);
      x.api(OLE,ansi ? 'SysAllocStringByteLen' : 'SysAllocStringLen',[0,arg(-8)])
        .test().branch('e','error:7').emit(0x89,0xc3);
      x.value(arg(12)).emit(0x89,0x18); // Adopt BEFORE conversion can fail.
      x.value(arg(-4)).test().branch('e',done);
      if (ansi) x.push(0).push(0);
      x.push(arg(-8)).emit(0x53).push(arg(-4)).push(arg(8)).push(utf8?(ansi?128:8):0).push(codepage)
        .invoke(KERNEL,ansi ? 'WideCharToMultiByte' : 'MultiByteToWideChar');
      x.test().branch('e','error:5');
      x.label(done).emit(0x89,0xd8).leave(8);
      x.label(nil).value(0).leave(8);
    }
  }
}
