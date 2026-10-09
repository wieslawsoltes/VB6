/** Failure-only observations and an independent Win32 SetPixelV/SetROP2 probe.
 * The authoritative graphics fixture is never edited or replaced by this code.
 * Probe coordinates are separate from the failed authored pixel. */
export function traceNativeSurfacePixels(module){
 const before='Canvas.PSet (10,50),&H123456';
 module.code=module.code.split('\n').flatMap(line=>{
  if(line===before)return [
   'NativeTrace "XOR before: mode=" & CStr(Canvas.DrawMode) & ", pixel=" & CStr(GetPixel(dc,10,50)) & ", expected=" & CStr(&H987654 Xor &H123456)',line,
   'NativeTrace "XOR after: mode=" & CStr(Canvas.DrawMode) & ", pixel=" & CStr(GetPixel(dc,10,50))'];
  if(line.startsWith('If Not (')&&line.endsWith('Then ExitProcess 6'))return ['NativeTrace NativePixelProbe(dc)',line];
  return [line];
 }).join('\n');
 module.code='Private Declare Function PixelProbeSet Lib "gdi32" Alias "SetPixelV" (ByVal dc As Long,ByVal x As Long,ByVal y As Long,ByVal color As Long) As Long\n'+
  'Private Declare Function PixelProbeSave Lib "gdi32" Alias "SaveDC" (ByVal dc As Long) As Long\n'+
  'Private Declare Function PixelProbeRestore Lib "gdi32" Alias "RestoreDC" (ByVal dc As Long,ByVal saved As Long) As Long\n'+
  'Private Declare Function PixelProbeROP Lib "gdi32" Alias "SetROP2" (ByVal dc As Long,ByVal mode As Long) As Long\n'+module.code;
 module.code+=`
Private Function NativePixelProbe(ByVal dc As Long) As String
 Dim saved As Long,n As Long,pixel As Long,expected As Long
 saved=PixelProbeSave(dc)
 If saved=0 Then Exit Function
 n=PixelProbeROP(dc,13)
 n=PixelProbeSet(dc,180,180,&H987654)
 expected=&H987654 Xor &H123456
 n=PixelProbeROP(dc,7)
 n=PixelProbeSet(dc,180,180,expected)
 pixel=GetPixel(dc,180,180)
 n=PixelProbeRestore(dc,saved)
 NativePixelProbe="Independent SetPixelV: final=" & CStr(pixel) & ", supplied=" & CStr(expected) & ", original=" & CStr(&H987654) & ", restored=" & CStr(n)
End Function
`;
}
