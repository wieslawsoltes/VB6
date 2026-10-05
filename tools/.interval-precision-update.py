from pathlib import Path
import hashlib
p=Path('tools/win32-date-interval-reference.mjs');s=p.read_text()
old=' ContractAdd = DateAdd(interval, number, value)'
assert s.count(old)==1
s=s.replace(old,''' ' The host wraps some counts above Long. Monotonic substeps stay within its
 ' scalar ABI without duplicating its calendar implementation.
 Do While number > 1000000000
  value = DateAdd(interval, 1000000000, value)
  number = number - 1000000000
 Loop
 Do While number < -1000000000
  value = DateAdd(interval, -1000000000, value)
  number = number + 1000000000
 Loop
 ContractAdd = DateAdd(interval, number, value)''')
old='''   else lines.push(` WScript.Echo "${i}|${kind}|" & Replace(CStr(CDbl(result)), ",", ".")`);'''
assert s.count(old)==1
s=s.replace(old,'''   else if(kind==='date')lines.push(` WScript.Echo "${i}|date|" & Replace(CStr(CDbl(result)), ",", ".") & ";" & Replace(CStr(CDbl(result) - CDbl(CStr(CDbl(result)))), ",", ".")`);
'''+old)
old=r'''   if(!/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/i.test(m[3]))throw Error('Invalid numeric reference');
   value=Number(m[3]);'''
assert s.count(old)==1
s=s.replace(old,r'''   const components=m[3].split(';');
   if(components.length>2||components.length>1&&m[2]!=='date'||components.some(n=>! /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:E[+-]?\d+)?$/i.test(n)))throw Error('Invalid numeric reference');
   // CStr exposes only 15 significant digits; add a measured low-order residual
   // instead of weakening the 1e-9-day native assertion near the year-9999 limit.
   value=Number(components[0])+(components.length===2?Number(components[1]):0);''')
s=s.replace("r.kind==='date'?`CStr(CDbl(${v}))`", "r.kind==='date'?`NumberRecord(CDbl(${v}))`")
s=s.replace('Private Function Encode(ByVal text As String) As String', '''Private Function NumberRecord(ByVal value As Double) As String
 Dim high As String
 high = CStr(value)
 NumberRecord = high & ";" & CStr(value - CDbl(high))
End Function
Private Function Encode(ByVal text As String) As String''')
assert hashlib.sha256(s.encode()).hexdigest()=='24051645d937b1e12a16c6f0baf88c1199e0501fd94eada6061cfd9e3a609df5','Unexpected interval reference result'
p.write_text(s)
p=Path('tools/win32-large-array-fixtures.mjs');s=p.read_text()
anchor=" failure('ReDim longs(0 To 536870911)',7,'Long byte-size overflow rejected before allocation');"
assert s.count(anchor)==1
extra=''' const bounds=Array.from({length:60},(_,i)=>`${i-30} To ${i-30+(i===59?1:0)}`);
 const point=Array.from({length:60},(_,i)=>String(i-30)),next=[...point];next[59]='30';
 lines.push('Dim ranked() As Long',`ReDim ranked(${bounds.join(',')})`,`ranked(${point.join(',')}) = 71`,`ranked(${next.join(',')}) = 83`);
 check(`ranked(${point.join(',')}) = 71 And ranked(${next.join(',')}) = 83 And LBound(ranked,17) = -14 And UBound(ranked,60) = 30`,'Distinct sixty-dimensional metadata and adjacent last-axis elements');
 bounds[59]='29 To 31';lines.push(`ReDim Preserve ranked(${bounds.join(',')})`);
 const tail=[...point];tail[59]='31';
 check(`ranked(${point.join(',')}) = 71 And ranked(${next.join(',')}) = 83 And ranked(${tail.join(',')}) = 0`,'Sixty-dimensional Preserve keeps values and initializes new last-axis tail');
 lines.push('Erase ranked');
'''
s=s.replace(anchor,extra+anchor)
assert hashlib.sha256(s.encode()).hexdigest()=='5efc36d9d54a15a1235c873b2c9744dadd2c17bb7684cee0268126d8d10a7e36','Unexpected array fixture result'
p.write_text(s)
