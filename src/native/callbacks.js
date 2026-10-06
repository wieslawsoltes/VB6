/** Original x86 stdcall callback thunks. No executable heap or native compiler.
 * Contract: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/addressof-operator
 * Callbacks execute on the application's original thread. Foreign-thread entry
 * fails closed before accessing process-global VB error/owner state.
 */
const key = value => String(value).toLowerCase();
const types = new Set(['byte','integer','long','boolean','single','double','currency','date']);
const real = new Set(['single','double','date']);
const E = 'native:error:';
const state = ['frame','pending','number','description','source','erl','lastdllerror'];
const arg = argument => ({argument});
const mem = memory => ({memory});
const save = (x, offset) => x.emit(0x89,0x85).imm(offset);

export const nativeCallbackMethods = {
  nativeCallbackArgument(parameter, node) {
    if (parameter.byRef || key(parameter.type) !== 'long' || parameter.bounds != null)
      this.fail('AddressOf requires a scalar ByVal Long function-pointer parameter');
    const parts = node.name.split('.');
    if (parts.length > 2) this.fail('Native AddressOf requires a standard-module procedure in this project');
    const callee = parts.length === 1 ? {kind:'id', name:parts[0]} :
      {kind:'member', object:{kind:'id', name:parts[0]}, name:parts[1]};
    if (this.variable(callee)) this.fail('AddressOf cannot reference a variable');
    const target = this.resolveProcedure(callee), signature = target?.proc;
    if (!signature || target.module.module.kind !== 'module' || target.module.nativeInternal)
      this.fail('Native AddressOf requires an authored Sub or Function in a standard module');
    if (!['sub','function'].includes(signature.kind) ||
        signature.kind === 'function' && !types.has(key(signature.returnType)) ||
        signature.params.some(p => p.optional || p.paramArray || p.bounds != null || !types.has(key(p.type))))
      this.fail('Native callbacks require fixed scalar numeric/Date parameters and returns; String, arrays, Optional and ParamArray are not supported');
    if (!this.nativeCallbacks) {
      this.nativeCallbacks = new Map();
      this.slot('native:callback:thread');
    }
    let callback = this.nativeCallbacks.get(target.label);
    if (!callback) {
      callback = {target, label:'native:callback:' + this.nativeCallbacks.size};
      this.nativeCallbacks.set(target.label,callback);
    }
    this.x.value(callback.label);
  }
};

export function emitNativeCallbackHelpers(c) {
  if (!c.nativeCallbacks?.size) return;
  const x = c.x;
  for (const {target,label} of c.nativeCallbacks.values()) {
    const signature = target.proc, type = key(signature.returnType), ownThread = x.unique();
    x.label(label).enter(40);
    x.api('kernel32.dll','GetCurrentThreadId').emit(0x3b,0x05).addr('native:callback:thread').branch('e',ownThread);
    // The current backend's globals and VB error frames are single-threaded.
    // Never run application callbacks from another native thread or race its state.
    x.api('kernel32.dll','ExitProcess',[5]).label(ownThread);
    state.forEach((name,i) => { x.value(mem(E+name)); save(x,-4*(i+1)); });
    x.emit(0xd9,0x7d,0xd8); // fnstcw [ebp-40]; preserve the foreign caller's x87 CW.
    x.value(0).store(E+'frame').call(E+'clear');
    // Preserve the external stdcall argument byte layout. The authored procedure
    // handles exact-width loads, owned locals, cleanup and numeric return ABI.
    for (let offset=target.argumentBytes+4; offset>=8; offset-=4) x.push(arg(offset));
    x.call(target.label);
    if (signature.kind === 'function' && real.has(type)) x.emit(0xdd,0x5d,0xdc); // fstp qword [ebp-36]
    else { save(x,-36); x.emit(0x89,0x55,0xe0); } // EAX, EDX
    // Unhandled callback errors cannot jump across the suspended external stack.
    // Use the ordinary fatal diagnostic after the authored frame has cleaned up;
    // On Error inside the callback remains fully functional.
    x.emit(0x83,0x3d).addr(E+'pending').emit(0).branch('ne',E+'fatal');
    state.forEach((name,i) => x.value(arg(-4*(i+1))).store(E+name));
    x.emit(0xd9,0x6d,0xd8); // fldcw [ebp-40]
    if (signature.kind === 'function' && real.has(type)) x.emit(0xdd,0x45,0xdc);
    else x.value(arg(-36)).emit(0x8b,0x55,0xe0);
    x.leave(target.argumentBytes);
  }
}
