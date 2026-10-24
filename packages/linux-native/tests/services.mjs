/** Projects executed from JavaScript-emitted ELF machine code in service qualification. */
export const linuxPrinterProject={schema:1,name:'LinuxPrinterAOT',startup:'Sub Main',modules:[{name:'Entry',kind:'module',code:`Option Explicit
Public Sub Main()
  Dim caught As Long, count As Long, selected As Object, item As Object
  Screen.MousePointer = 11
  Debug.Assert Screen.MousePointer = 11
  Screen.MousePointer = 0
  Debug.Assert Screen.MousePointer = 0
  Debug.Assert Printers.Count = 2
  Debug.Assert Printer.DeviceName = "VB6_B"
  Debug.Print "LINUX_PRINTERS_DEFAULT_OK"
  On Error Resume Next
  Set Printer = 42
  caught = Err.Number
  Err.Clear
  On Error GoTo 0
  Debug.Assert caught = 13
  On Error Resume Next
  Set Printer = New Collection
  caught = Err.Number
  Err.Clear
  On Error GoTo 0
  Debug.Assert caught = 13
  For Each item In Printers
    count = count + 1
    Debug.Assert Len(item.DeviceName) > 0
    Debug.Assert item.DriverName = "VB6 Virtual IPP Printer"
  Next
  Debug.Assert count = 2
  Debug.Print "LINUX_PRINTERS_ENUMERATION_OK"
  Set selected = Printers(0)
  Debug.Print "LINUX_PRINTERS_ITEM_OK"
  Debug.Assert selected.DeviceName = "VB6_A"
  selected.Copies = 4
  selected.Orientation = 2
  Debug.Print "LINUX_PRINTERS_ITEM_SETTINGS_OK"
  Set Printer = selected
  Debug.Assert Printer.DeviceName = "VB6_A"
  Debug.Assert Printer.Copies = 4
  Debug.Print "LINUX_PRINTERS_SELECTED_OK"
  Debug.Assert Printer.Orientation = 2
  Debug.Assert Not Printer.TrackDefault
  On Error Resume Next
  Printer.DeviceName = "not-installed"
  caught = Err.Number
  Err.Clear
  On Error GoTo 0
  Debug.Assert caught = 484
  Debug.Assert Printer.DeviceName = "VB6_A"
  Set Printer = Printers(1)
  Debug.Assert Printer.DeviceName = "VB6_B"
  Debug.Assert Printer.Copies = 2
  Debug.Print "LINUX_PRINTERS_AOT_OK"
End Sub`}]};

export const linuxInstanceProject={schema:1,name:'LinuxInstanceAOT',startup:'Sub Main',modules:[{name:'Entry',kind:'module',code:`Option Explicit
Private Declare Sub Sleep Lib "kernel32" (ByVal milliseconds As Long)
Public Sub Main()
  If Command = "hold" Then
    Debug.Print "INSTANCE_READY"
    Sleep 30000
  Else
    If App.PrevInstance Then
      Debug.Print "INSTANCE_PREVIOUS"
    Else
      Debug.Print "INSTANCE_FIRST"
    End If
  End If
End Sub`}]};
