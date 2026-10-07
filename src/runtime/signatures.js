import {FINANCIAL_SIGNATURES} from './financial.js';
/** Public names for named-argument binding. A trailing ? denotes Optional. */
export const BUILTIN_SIGNATURES={
  Error:'errornumber?',Erl:'',
  ...FINANCIAL_SIGNATURES,
  Abs:'number',Atn:'number',Cos:'number',Exp:'number',Fix:'number',Int:'number',Log:'number',Sgn:'number',Sin:'number',Sqr:'number',Tan:'number',Round:'number,numdigitsafterdecimal?',Rnd:'number?',Randomize:'number?',
  CDec:'expression',CBool:'expression',CByte:'expression',CCur:'expression',CDate:'expression',CDbl:'expression',CInt:'expression',CLng:'expression',CSng:'expression',CStr:'expression',CVar:'expression',CVErr:'errornumber',
  Val:'string',Str:'number',Hex:'number',Oct:'number',Len:'expression',LenB:'expression',Left:'string,length',Right:'string,length',Mid:'string,start,length?',Trim:'string',LTrim:'string',RTrim:'string',UCase:'string',LCase:'string',Space:'number',String:'number,character',Chr:'charcode',ChrW:'charcode',Asc:'string',AscW:'string',StrReverse:'expression',
  InStr:'start?,string1,string2,compare?',InStrRev:'stringcheck,stringmatch,start?,compare?',Replace:'expression,find,replace,start?,count?,compare?',Split:'expression,delimiter?,limit?,compare?',Join:'sourcearray,delimiter?',Filter:'sourcearray,match,include?,compare?',StrComp:'string1,string2,compare?',StrConv:'string,conversion',
  Format:'expression,format?',FormatNumber:'expression,numdigitsafterdecimal?',FormatCurrency:'expression,numdigitsafterdecimal?',FormatPercent:'expression,numdigitsafterdecimal?',FormatDateTime:'date,namedformat?',
  LBound:'arrayname,dimension?',UBound:'arrayname,dimension?',IsArray:'varname',IsEmpty:'expression',IsNull:'expression',IsNumeric:'expression',IsDate:'expression',IsObject:'identifier',IsMissing:'argname',IsError:'expression',TypeName:'varname',VarType:'varname',
  IIf:'expr,truepart,falsepart',Now:'',Date:'',Time:'',Timer:'',DateValue:'date',TimeValue:'time',Year:'date',Month:'date',Day:'date',Hour:'time',Minute:'time',Second:'time',Weekday:'date,firstdayofweek?',MonthName:'month,abbreviate?',WeekdayName:'weekday,abbreviate?,firstdayofweek?',
  DateSerial:'year,month,day',TimeSerial:'hour,minute,second',DateAdd:'interval,number,date',DateDiff:'interval,date1,date2,firstdayofweek?,firstweekofyear?',DatePart:'interval,date,firstdayofweek?,firstweekofyear?',
  LoadResString:'index',LoadResData:'index,format',LoadResPicture:'index,format?',RGB:'red,green,blue',QBColor:'color',MsgBox:'prompt,buttons?,title?',InputBox:'prompt,title?,default?',DoEvents:'',CreateObject:'class',GetObject:'pathname?,class?',FreeFile:'rangenumber?',EOF:'filenumber',LOF:'filenumber',Loc:'filenumber',Seek:'filenumber,position?',Input:'number,filenumber',FileLen:'pathname',Kill:'pathname',Reset:'',CurDir:'',ChDir:'path',MkDir:'path',RmDir:'path',Dir:'pathname?',SaveSetting:'appname,section,key,setting',GetSetting:'appname,section,key,default?',DeleteSetting:'appname,section,key?',Beep:'',Environ:'expression?',Command:'',
};
export function signatureParameters(text){return !text?[]:text.split(',').map(name=>({name:name.replace(/\?$/,''),optional:name.endsWith('?')}));}
