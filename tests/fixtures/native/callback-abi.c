/* Independent x86 test DLL only. No compiler SDK or application dependency. */
int _fltused = 0;
typedef long (__stdcall *LongCallback)(long);
typedef double (__stdcall *DoubleCallback)(double);
typedef float (__stdcall *SingleCallback)(float);
typedef __int64 (__stdcall *CurrencyCallback)(__int64);
typedef long (__stdcall *RefsCallback)(__int64 *, double *, long *);
typedef void (__stdcall *VoidCallback)(long);
typedef long (__stdcall *ZeroCallback)(void);
long __stdcall InvokeLong(LongCallback cb, long value) { return cb(value); }
double __stdcall InvokeDouble(DoubleCallback cb, double value) { return cb(value); }
float __stdcall InvokeSingle(SingleCallback cb, float value) { return cb(value); }
__int64 __stdcall InvokeCurrency(CurrencyCallback cb, __int64 value) { return cb(value); }
long __stdcall InvokeRefs(RefsCallback cb) {
 __int64 money = 9007199254740993i64; double number = 1.25; long count = 4;
 long result = cb(&money,&number,&count);
 return result == 7 && money == 9007199254740994i64 && number == 2.5 && count == 8;
}
void __stdcall InvokeVoid(VoidCallback cb,long value) { cb(value); }
long __stdcall InvokeZero(ZeroCallback cb) { return cb(); }
long __stdcall PointerValue(void *cb) { return (long)cb; }
long __stdcall PreserveRegisters(LongCallback cb) {
 long result, valid, before, after;
 unsigned short saved, mode = 0x0a7f, observed;
 __asm {
  fnstcw saved
  fldcw mode
  mov ebx, 012345678h
  mov esi, 023456789h
  mov edi, 03456789ah
  mov before, esp
  push 7
  call cb
  mov result, eax
  mov after, esp
  xor eax, eax
  cmp ebx, 012345678h
  jne done
  cmp esi, 023456789h
  jne done
  cmp edi, 03456789ah
  jne done
  inc eax
 done:
  mov valid, eax
  fnstcw observed
  fldcw saved
 }
 return valid && result == 14 && before == after && observed == mode;
}
__declspec(dllimport) void* __stdcall CreateThread(void*,unsigned long,void*,void*,unsigned long,unsigned long*);
__declspec(dllimport) unsigned long __stdcall WaitForSingleObject(void*,unsigned long);
__declspec(dllimport) int __stdcall CloseHandle(void*);
static unsigned long __stdcall OnThread(void *p) { return ((LongCallback)p)(1); }
long __stdcall InvokeOtherThread(LongCallback cb) {
 void *thread = CreateThread(0,0,OnThread,(void*)cb,0,0);
 if (!thread) return -1;
 WaitForSingleObject(thread,5000);CloseHandle(thread);return 99;
}
