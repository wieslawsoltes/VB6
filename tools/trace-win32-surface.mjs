/** Failure-only platform probe. It never edits or replaces an authoritative
 * fixture assertion. A separate memory DC establishes how the installed GDI
 * treats GetObjectType on a successfully deleted handle, independently of the
 * VB Form/PictureBox surface owner under test. */
export function traceNativeSurfaceDeletion(module){
  module.code=module.code.replace('NativeTrace "Form_Load"','NativeTrace "Form_Load"\n NativeTrace NativeSurfaceDeleteProbe()');
  module.code+=`
Private Function NativeSurfaceDeleteProbe() As String
 Dim dc As Long, beforeType As Long, deleted As Long, afterType As Long, bitmap As Long, secondDelete As Long
 Dim before As Long, during As Long, after As Long
 before=GetGuiResources(GetCurrentProcess(),0)
 dc=CreateCompatibleDC(0)
 beforeType=GetObjectType(dc)
 during=GetGuiResources(GetCurrentProcess(),0)
 deleted=DeleteDC(dc)
 afterType=GetObjectType(dc)
 bitmap=GetCurrentObject(dc,7)
 after=GetGuiResources(GetCurrentProcess(),0)
 secondDelete=DeleteDC(dc)
 NativeSurfaceDeleteProbe="Independent DeleteDC: beforeType=" & CStr(beforeType) & ", deleted=" & CStr(deleted) & ", afterType=" & CStr(afterType) & ", bitmap=" & CStr(bitmap) & ", secondDelete=" & CStr(secondDelete) & ", counts=" & CStr(before) & "/" & CStr(during) & "/" & CStr(after)
End Function
`;
}
