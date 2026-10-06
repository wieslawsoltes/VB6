#include <windows.h>
/* A deliberately unoptimized, exported native frame for CDB integration tests. */
__declspec(dllexport) __declspec(noinline) int LibraryTick(int input) {
    volatile int local = input + 3;
    Sleep(10);
    return local;
}
BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) {
    (void)instance; (void)reason; (void)reserved; return TRUE;
}
