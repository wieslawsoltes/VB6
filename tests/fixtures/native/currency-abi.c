/* Test-only, independently compiled x86 ABI oracle. Never shipped in an app or
 * compiler SDK. No CRT entry point, dependencies or DLL registration required. */
int _fltused = 0;
static long calls;
__int64 __stdcall EchoCurrency(__int64 value) { ++calls; return value; }
double __stdcall EchoDouble(double value) { ++calls; return value; }
float __stdcall EchoSingle(float value) { ++calls; return value; }
short __stdcall EchoInteger(short value) { ++calls; return value; }
unsigned char __stdcall EchoByte(unsigned char value) { ++calls; return value; }
short __stdcall EchoBoolean(short value) { ++calls; return value; }
__int64 __stdcall BumpCurrency(__int64 *value) { ++calls; *value += 1; return *value; }
double __stdcall WholeDouble(void) { ++calls; return 2.0; }
double __stdcall InvalidDouble(void) {
  union { unsigned __int64 bits; double value; } result;
  ++calls; result.bits = 0x7ff8000000000000ui64; return result.value;
}
long __stdcall Calls(void) { return calls; }
void __stdcall ResetCalls(void) { calls = 0; }
