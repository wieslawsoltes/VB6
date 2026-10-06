/* Independent native oracle only: no VB compiler, CLR or VB runtime. */
#include <windows.h>
#include <oleauto.h>
#include <psapi.h>
int _fltused = 0;
static long calls = 0;
typedef long (__stdcall *Callback)(long);
long __stdcall EmptyKind(BSTR s) { return !s ? 1 : SysStringByteLen(s) == 0 ? 2 : 0; }
long __stdcall Embedded(BSTR s) {
 return s && SysStringByteLen(s)==3 && ((char*)s)[0]=='a' && ((char*)s)[1]==0 && ((char*)s)[2]=='b';
}
long __stdcall WriteBuffer(BSTR s) {
 calls++;
 if (!s || SysStringByteLen(s)<3) return -1;
 ((char*)s)[0]='X';((char*)s)[1]='Y';((char*)s)[2]=0;
 SetLastError(17767);return 123;
}
void __stdcall ResizeString(BSTR *s) {
 BSTR result=SysAllocStringByteLen("grown\0tail",10);
 if(!result) ExitProcess(230);
 SysFreeString(*s);*s=result;SetLastError(17768);
}
void __stdcall ClearString(BSTR *s) { SysFreeString(*s);*s=0;SetLastError(17769); }
BSTR __stdcall ReturnString(long kind) {
 BSTR result=0;
 if(kind==0) result=SysAllocStringByteLen("r\0x",3);
 if(kind==2) result=SysAllocStringByteLen("",0);
 if(kind==3) {
  long i;result=SysAllocStringByteLen(0,1048577);
  if(!result)ExitProcess(231);
  for(i=0;i<1048577;i++)((char*)result)[i]='q';
 }
 SetLastError(17770);return result;
}
double __stdcall ReturnDouble(BSTR s,double n) { ((char*)s)[0]='D';SetLastError(17771);return n+0.125; }
float __stdcall ReturnSingle(BSTR s,float n) { ((char*)s)[0]='S';SetLastError(17772);return n+1.25f; }
__int64 __stdcall ReturnCurrency(BSTR s,__int64 n) { ((char*)s)[0]='M';SetLastError(17773);return n+1; }
short __stdcall ReturnInteger(BSTR s) { ((char*)s)[0]='I';SetLastError(17774);return -32768; }
unsigned char __stdcall ReturnByte(BSTR s) { ((char*)s)[0]='B';SetLastError(17775);return 255; }
short __stdcall ReturnBoolean(BSTR s) { ((char*)s)[0]='T';SetLastError(17776);return -1; }
long __stdcall Reenter(BSTR s,Callback cb) {
 long result=cb(9);
 if(result!=18 || !s || SysStringByteLen(s)!=7)return -1;
 ((char*)s)[0]='R';SetLastError(17777);return 901;
}
long __stdcall CallCount(void) { return calls; }
long __stdcall Order(long n,BSTR first,BSTR last) {
 calls++;return n==42 && ((char*)first)[0]=='A' && ((char*)last)[0]=='Z' ? 902 : -1;
}
long __stdcall CheckEncoding(BSTR ansi,const WCHAR *wide,long length) {
 long n=WideCharToMultiByte(CP_ACP,0,wide,length,0,0,0,0),i;BSTR expected;
 if(n<=0 || !ansi || (long)SysStringByteLen(ansi)!=n)return -1;
 expected=SysAllocStringByteLen(0,n);if(!expected)ExitProcess(232);
 if(WideCharToMultiByte(CP_ACP,0,wide,length,(char*)expected,n,0,0)!=n){SysFreeString(expected);return -2;}
 for(i=0;i<n;i++)if(((char*)ansi)[i]!=((char*)expected)[i]){SysFreeString(expected);return -3;}
 SysFreeString(expected);SetLastError(17778);return 903;
}
long __stdcall PrivateBytes(void) {
 PROCESS_MEMORY_COUNTERS_EX counters;
 if(!GetProcessMemoryInfo(GetCurrentProcess(),(PROCESS_MEMORY_COUNTERS*)&counters,sizeof(counters)))return -1;
 return (long)counters.PrivateUsage;
}
