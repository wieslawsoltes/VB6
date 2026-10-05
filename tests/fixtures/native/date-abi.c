/* Test-only x86 DATE ABI and Windows calendar oracle. MSVC builds this DLL,
 * never the generated VB application or the JavaScript compiler. */
#include <windows.h>
#include <oleauto.h>
int _fltused = 0;
static LONG calls;
DATE __stdcall EchoDate(DATE value) { ++calls; return value; }
DATE __stdcall BumpDate(DATE *value) { ++calls; *value += 1; return *value; }
DATE __stdcall MixedDate(LONG a, DATE value, float b, SHORT c) { ++calls; return value + a + b + c; }
DATE __stdcall InvalidDate(void) { ++calls; return 2958466.0; }
DATE __stdcall NonfiniteDate(void) {
 union { ULONGLONG bits; DATE value; } v; ++calls; v.bits=0x7ff8000000000000ui64; return v.value;
}
LONG __stdcall Calls(void) { return calls; }
void __stdcall ResetCalls(void) { calls = 0; }
DATE __stdcall SystemDate(LONG y,LONG m,LONG d,LONG h,LONG n,LONG s) {
 SYSTEMTIME st = {0}; DATE value=0;
 st.wYear=(WORD)y;st.wMonth=(WORD)m;st.wDay=(WORD)d;st.wHour=(WORD)h;st.wMinute=(WORD)n;st.wSecond=(WORD)s;
 return SystemTimeToVariantTime(&st,&value) ? value : 2958466.0;
}
LONG __stdcall SystemPart(DATE value, LONG part) {
 SYSTEMTIME st;
 if (!VariantTimeToSystemTime(value,&st)) return -1;
 switch(part) {case 0:return st.wYear;case 1:return st.wMonth;case 2:return st.wDay;
 case 3:return st.wHour;case 4:return st.wMinute;case 5:return st.wSecond;case 6:return st.wDayOfWeek;default:return -1;}
}
LONG __stdcall ExpandedYear(LONG value) {
 DWORD maxYear=0;
 if (!GetCalendarInfoW(LOCALE_USER_DEFAULT,CAL_GREGORIAN,CAL_ITWODIGITYEARMAX|CAL_RETURN_NUMBER,NULL,0,&maxYear)) return -1;
 return (LONG)(maxYear/100)*100+value-(value>(LONG)(maxYear%100)?100:0);
}
LONG __stdcall FirstDay(void) {
 DWORD day=0;
 if (!GetLocaleInfoW(LOCALE_USER_DEFAULT,LOCALE_IFIRSTDAYOFWEEK|LOCALE_RETURN_NUMBER,(LPWSTR)&day,2)) return -1;
 return (day+1)%7+1;
}
DATE __stdcall ParseDate(LPCWSTR text,LONG flags) {
 DATE result=0;
 return SUCCEEDED(VarDateFromStr(text,LOCALE_USER_DEFAULT,VAR_CALENDAR_GREGORIAN|flags,&result))?result:2958466.0;
}
