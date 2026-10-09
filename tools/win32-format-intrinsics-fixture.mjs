/** Assertions appended to the existing native O0/O1/O2/pruned string fixture.
 * The generated EXEs execute OleAut32/ANSI APIs on Windows, not JS substitutes. */
export function extendNativeFormatFixture({add,check}) {
  check('Format$(7,"0000")="0007" And Format(12,"000")="012"','Format uses native Automation numeric masks');
  check('VarType(Format(7,"0"))=vbString And VarType(Format$(7,"0"))=vbString','Format Variant and Format$ String retain their source-visible result subtype');
  check('Format$(DateSerial(2024,2,29),"yyyymmdd")="20240229"','Format date fields retain leap day without a JS date formatter');
  check('Format$(TimeSerial(13,4,9),"hhnnss")="130409"','Format time fields distinguish minutes and months');
  check('Format$(DateSerial(2024,1,7),"w",vbSunday)="1" And Format$(DateSerial(2024,1,7),"w",vbMonday)="7"','VB Sunday-based first-day values match installed Automation and DatePart');
  add('For i=1 To 7');
  check('CLng(Format$(DateSerial(2024,1,7),"w",i))=DatePart("w",DateSerial(2024,1,7),i)','all seven Format weekday conventions agree with the native calendar kernel');
  add('Next');
  check('Format$(123)="123" And Format$(123,,, )="123"','omitted Format mask and week parameters use documented defaults');
  check('IsNull(Format(Null,"0"))','Format preserves Null as a Variant');
  add('sequence=0\ns=Format$(format:=Mark("@"),expression:=Mark("A"))');
  check('sequence=21 And s="A"','Format named arguments evaluate in source order, not formal order');
  add('s="@"\ns=Format$(format:=s,expression:=MutateSource(s))');
  check('s="X"','Format snapshots a mask before a later ByRef argument mutates its source');
  check('Chr$(65)="A" And Chr(charcode:=90)="Z" And Chr$(13)=vbCr','Chr uses the active ANSI conversion path and named CharCode argument');
  add('s="a" & Chr$(0) & "b"');
  check('Len(s)=3 And AscW(Mid$(s,2,1))=0 And Right$(s,1)="b"','ANSI Chr zero is one owned NUL code unit, not an empty BSTR');
  check('vbRed=255 And vbBlue=16711680 And vbButtonFace=-2147483633 And vbKeyF12=123','shared color, system-color and keyboard constants lower as signed LONGs');
  check('vbNullString="" And StrPtr(vbNullString)=0 And vbNullChar=ChrW(0)','shared constants preserve the null BSTR sentinel separately from a NUL character');
  add('On Error Resume Next\nErr.Clear\ns="unchanged"\ns=Format$(Null,"0")');
  check('Err.Number=94 And s="unchanged"','Format$ Null conversion raises 94 without overwriting the destination');
  add('Err.Clear\ns=Format$(1,"0",8)');check('Err.Number=5','Format rejects an out-of-range first day');
  add('Err.Clear\ns=Format$(1,"0",1,4)');check('Err.Number=5','Format rejects an out-of-range first week');
  add('Err.Clear\ns=Chr$(-32769)');check('Err.Number=5','Chr rejects codes below the signed DBCS range');
  add('Err.Clear\ns=Chr$(65536)');check('Err.Number=5','Chr rejects codes above the unsigned DBCS range');
  add('Err.Clear\nOn Error GoTo 0\nFor i=1 To 1000\ns=Format$(CLng(Format$(i,"0000")),"00000") & Chr$(65)\nNext');
  check('s="01000A"','nested allocating Format/Chr calls release their statement-owned outputs');
}
