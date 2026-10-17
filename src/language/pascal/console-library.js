/** Line input uses the shared InputBox host. The command-line runner supplies
 * stdin lines and forms hosts supply their existing input dialog. Keeping the
 * buffer in the compiled project's common I/O owner preserves Read/ReadLn state
 * when calls cross unit boundaries. InputBox does not expose an EOF sentinel;
 * default-input EOF therefore requires an explicit stream host extension.
 */
export const PASCAL_CONSOLE_SOURCE = `
Private Sub __PascalConsoleEnsure(ByRef buffer As String, ByRef position As Long, ByRef ready As Boolean, ByVal checked As Boolean, ByRef status As Long)
  If status <> 0 Then Exit Sub
  On Error GoTo Failed
  If Not ready Then
    buffer = CStr(InputBox("", "Turbo Pascal input"))
    position = 1
    ready = True
  End If
  Exit Sub
Failed:
  Call __PascalFileCapture(Err.Number, Err.Source, checked, status)
End Sub

Private Function __PascalConsoleReadText(ByRef buffer As String, ByRef position As Long, ByRef ready As Boolean, ByVal capacity As Long, ByVal checked As Boolean, ByRef status As Long) As String
  Call __PascalConsoleEnsure(buffer, position, ready, checked, status)
  If status <> 0 Then Exit Function
  __PascalConsoleReadText = Mid$(buffer, position, capacity)
  position = Len(buffer) + 1
End Function

Private Function __PascalConsoleReadChar(ByRef buffer As String, ByRef position As Long, ByRef ready As Boolean, ByVal checked As Boolean, ByRef status As Long) As String
  Call __PascalConsoleEnsure(buffer, position, ready, checked, status)
  If status <> 0 Then Exit Function
  If position > Len(buffer) Then
    __PascalConsoleReadChar = ChrW(13)
    ready = False
  Else
    __PascalConsoleReadChar = Mid$(buffer, position, 1)
    position = position + 1
  End If
End Function

Private Function __PascalConsoleReadToken(ByRef buffer As String, ByRef position As Long, ByRef ready As Boolean, ByVal checked As Boolean, ByRef status As Long) As String
  Dim first As Long
  Do
    Call __PascalConsoleEnsure(buffer, position, ready, checked, status)
    If status <> 0 Then Exit Function
    Do While position <= Len(buffer)
      If AscW(Mid$(buffer, position, 1)) > 32 Then Exit Do
      position = position + 1
    Loop
    If position <= Len(buffer) Then Exit Do
    ready = False
  Loop
  first = position
  Do While position <= Len(buffer)
    If AscW(Mid$(buffer, position, 1)) <= 32 Then Exit Do
    position = position + 1
  Loop
  __PascalConsoleReadToken = Mid$(buffer, first, position - first)
End Function

Private Sub __PascalConsoleReadLn(ByRef buffer As String, ByRef position As Long, ByRef ready As Boolean, ByVal checked As Boolean, ByRef status As Long)
  Call __PascalConsoleEnsure(buffer, position, ready, checked, status)
  If status = 0 Then ready = False
End Sub

Private Function __PascalConsoleEOLN(ByRef buffer As String, ByRef position As Long, ByRef ready As Boolean, ByVal checked As Boolean, ByRef status As Long) As Boolean
  Call __PascalConsoleEnsure(buffer, position, ready, checked, status)
  If status = 0 Then __PascalConsoleEOLN = position > Len(buffer)
End Function
`;
