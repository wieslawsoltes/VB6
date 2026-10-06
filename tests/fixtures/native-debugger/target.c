#include <windows.h>
#include <objbase.h>
#include <stdio.h>
#include <string.h>

__declspec(dllexport) volatile LONG DebugCounter = 7;
__declspec(dllexport) volatile DWORD DebugChildPid = 0;
__declspec(dllexport) volatile LONG DebugArgumentCount = 0;
typedef int (__cdecl *LibraryFunction)(int);
static LibraryFunction libraryTick;
static DWORD WINAPI Worker(LPVOID data) {
    (void)data;
    while (DebugCounter >= 0) Sleep(50);
    return 0;
}
__declspec(dllexport) __declspec(noinline) int DebugTick(int input) {
    volatile int local = input + 1;
    InterlockedIncrement(&DebugCounter);
    if (libraryTick) local = libraryTick(local);
    Sleep(20);
    return local;
}
int main(int argc, char **argv) {
    HANDLE worker; HMODULE library; HRESULT com;
    BOOL child = argc > 1 && strcmp(argv[1], "--child") == 0;
    BOOL children = argc > 1 && strcmp(argv[1], "--children") == 0;
    DebugArgumentCount = argc;
    com = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    library = LoadLibraryW(L"DebugLibrary.dll");
    if (library) libraryTick = (LibraryFunction)GetProcAddress(library, "LibraryTick");
    worker = CreateThread(NULL, 0, Worker, NULL, 0, NULL);
    if (children) {
        WCHAR executable[MAX_PATH], command[MAX_PATH + 32];
        STARTUPINFOW startup = {sizeof(startup)}; PROCESS_INFORMATION process = {0};
        GetModuleFileNameW(NULL, executable, MAX_PATH);
        swprintf_s(command, MAX_PATH + 32, L"\"%s\" --child", executable);
        if (CreateProcessW(executable, command, NULL, NULL, FALSE, CREATE_NO_WINDOW, NULL, NULL, &startup, &process)) {
            DebugChildPid = process.dwProcessId;
            CloseHandle(process.hThread); CloseHandle(process.hProcess);
        } else return 4;
    }
    /* Long enough for debugging and detach checks, finite even if a test exits. */
    for (int i = 0; i < 10000 && DebugCounter >= 0; ++i) {
        if (child) Sleep(20); else DebugTick(i);
    }
    InterlockedExchange(&DebugCounter, -1);
    if (worker) { WaitForSingleObject(worker, 2000); CloseHandle(worker); }
    if (library) FreeLibrary(library);
    if (SUCCEEDED(com)) CoUninitialize();
    return 0;
}
