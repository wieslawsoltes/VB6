export const pascalNativeSource=`program PascalNative;
var I, Total: Longint;
function Twice(Value: Longint): Longint;
begin
  Twice := Value * 2;
end;
procedure Add(var Value: Longint; Amount: Longint);
begin
  Value := Value + Amount;
end;
begin
  Total := 0;
  for I := 1 to 5 do Add(Total, Twice(I));
  Writeln(Total);
  if Total = 30 then Writeln('PASCAL_NATIVE_OK');
end.
`;

export function pascalProgram(code=pascalNativeSource,units=[]) {
  return {schema:1,name:'PascalNative',language:'pascal',startup:'Sub Main',settings:{},modules:[{id:'main',name:'PascalNative',kind:'module',language:'pascal',code},...units]};
}

export function pascalFormProject() {
  return {schema:1,name:'PascalForms',language:'pascal',startup:'MainForm',settings:{},modules:[{
    id:'form',name:'MainForm',kind:'form',language:'pascal',code:`unit MainForm;
interface
implementation
procedure Form_Load;
begin
  MessageText.Text := 'Ready';
end;
procedure RunButton_Click;
begin
  MessageText.Text := 'Pascal event';
  Caption := MessageText.Text;
end;
procedure MessageText_KeyPress(var KeyAscii: Integer);
begin
  if KeyAscii = 13 then KeyAscii := 0;
end;
end.
`,form:{name:'MainForm',type:'Form',properties:{Name:'MainForm',Caption:'Pascal Forms',ClientWidth:4500,ClientHeight:2400,Width:4800,Height:2850,Visible:-1},controls:[
      {name:'MessageText',type:'TextBox',properties:{Name:'MessageText',Text:'',Left:300,Top:300,Width:3600,Height:360,Visible:-1,Enabled:-1}},
      {name:'RunButton',type:'CommandButton',properties:{Name:'RunButton',Caption:'Run Pascal',Left:300,Top:960,Width:1800,Height:450,Visible:-1,Enabled:-1}}
    ],menus:[]}
  }]};
}

/** A Basic harness observes native Pascal execution through a real file on all
 * platforms, including GUI-subsystem Win32 images without stdout handles. */
export function pascalNativeVerificationProject() {
  return {schema:1,name:'PascalVerification',startup:'Sub Main',settings:{},modules:[
    {name:'NativeHarness',kind:'module',language:'vb6',code:`Option Explicit
Public Sub Main()
  If NativeInterop.Verify() <> 1 Then Err.Raise 5, "Pascal verification", "Typed Visual Basic interop failed"
  Dim Result As Long
  Result = PascalUnit.Compute()
  Dim ObjectResult As Long, PointerResult As Long, FileResult As Long
  ObjectResult = NativeDerived.Verify()
  PointerResult = NativePointers.Verify()
  FileResult = NativeFiles.Verify()
  Open "pascal-native-result.txt" For Output As #1
  Print #1, CStr(Result) & ":" & CStr(ObjectResult) & ":" & CStr(PointerResult) & ":" & CStr(FileResult)
  Close #1
End Sub
`},
    {name:'PascalUnit',kind:'module',language:'pascal',code:`unit PascalUnit;
interface
function Compute: Longint;
implementation
var Seed: Longint;
function Twice(Value: Longint): Longint;
begin
  Twice := Value * 2;
end;
procedure Add(var Value: Longint; Amount: Longint);
begin
  Value := Value + Amount;
end;
function Compute: Longint;
var I, Total: Longint;
begin
  Total := Seed;
  for I := 1 to 5 do Add(Total, Twice(I));
  Compute := Total;
end;
begin
  Seed := 12;
end.
`}, ...pascalNativeFeatureUnits(), ...pascalNativeForeignModules()
  ]};
}

export const pascalNativeExpectedResult='42:17:3160:65579';

/** The same required native fixture crosses the typed VB boundary in both
 * directions, including a live ByRef element borrow during a later argument. */
export function pascalNativeForeignModules(){return [
  {name:'NativeBridgeCounter',kind:'class',language:'vb6',code:`Option Explicit
Public Value As Long
Private Stored As Long
Private PeerValue As NativeBridgeCounter
Public Sub Add(ByVal Amount As Long)
  Value = Value + Amount
End Sub
Public Property Get Entry(ByVal Index As Long) As Long
  Entry = Stored - Index
End Property
Public Property Let Entry(ByVal Index As Long, ByVal NextValue As Long)
  Stored = NextValue + Index
End Property
Public Property Get Peer() As NativeBridgeCounter
  Set Peer = PeerValue
End Property
Public Property Set Peer(ByVal NextValue As NativeBridgeCounter)
  Set PeerValue = NextValue
End Property
`},
  {name:'NativeBridge',kind:'module',language:'vb6',code:`Option Explicit
Public Type InteropItem
  Value As Long
End Type
Public Values() As Long
Public Function MakeCounter() As NativeBridgeCounter
  Set MakeCounter = New NativeBridgeCounter
End Function
Public Sub FillItems(ByRef Items() As InteropItem)
  Items(0).Value = 23
End Sub
Public Sub SetupBorrow()
  ReDim Values(1)
  Values(0) = 7
End Sub
Public Function ResizeDuringArgument() As Long
  On Error Resume Next
  Err.Clear
  ReDim Values(4)
  ResizeDuringArgument = Err.Number
End Function
Public Function ReadBorrow(ByRef Value As Long, ByVal Status As Long) As Long
  ReadBorrow = Status * 1000 + UBound(Values) * 100 + Value
End Function
`},
  {name:'NativeInterop',kind:'module',language:'pascal',code:`unit NativeInterop;
interface
function Verify: Longint;
implementation
type TItems = array[0..0] of NativeBridge.InteropItem;
function Verify: Longint;
var First, Second: NativeBridgeCounter; Items: TItems;
begin
  Verify := 0;
  First := NativeBridge.MakeCounter; Second := NativeBridge.MakeCounter;
  First.Value := 3; First.Add(4);
  if First.Value <> 7 then Exit;
  First.Entry(2) := 12;
  if First.Entry(3) <> 11 then Exit;
  Second.Value := 9; First.Peer := Second;
  if First.Peer.Value <> 9 then Exit;
  First.Peer := nil;
  NativeBridge.FillItems(Items);
  if Items[0].Value <> 23 then Exit;
  NativeBridge.SetupBorrow;
  if NativeBridge.ReadBorrow(NativeBridge.Values[0], NativeBridge.ResizeDuringArgument()) <> 10107 then Exit;
  if NativeBridge.ResizeDuringArgument() <> 0 then Exit;
  Verify := 1
end;
end.`}
];}

/** Private descendant receivers deliberately cross a unit boundary when the
 * public ancestor's generated virtual thunk calls the override. */
export function pascalNativeFeatureUnits(){return [
  {name:'NativeObjects',kind:'module',language:'pascal',code:`unit NativeObjects;
interface
type TBase = object
  X: Integer;
  constructor Init;
  function Read: Longint; virtual;
end;
function Inspect(var Item: TBase): Longint;
implementation
constructor TBase.Init; begin X := 4 end;
function TBase.Read: Longint; begin Read := X end;
function Inspect(var Item: TBase): Longint; begin Inc(Item.X); Inspect := Item.Read end;
end.`},
  {name:'NativeDerived',kind:'module',language:'pascal',code:`unit NativeDerived;
interface
uses NativeObjects;
function Verify: Longint;
implementation
type TChild = object(TBase)
  Y: Integer;
  function Read: Longint; virtual;
end;
function TChild.Read: Longint; begin Read := inherited Read + Y end;
function Verify: Longint;
var Child: TChild;
begin Child.Init; Child.Y := 12; Verify := Inspect(Child) end;
end.`},
  {name:'NativePointers',kind:'module',language:'pascal',code:`unit NativePointers;
interface
function Verify: Longint;
implementation
type PNode = ^TNode;
     TNode = record Value: Longint; Next: PNode end;
function Verify: Longint;
var First, Current, Following: PNode; I, Total: Longint;
begin
  First := nil; Total := 0;
  for I := 0 to 79 do begin New(Current); Current^.Value := I; Current^.Next := First; First := Current end;
  Current := First;
  while Current <> nil do begin Total := Total + Current^.Value; Following := Current^.Next; Dispose(Current); Current := Following end;
  Verify := Total
end;
end.`},
  {name:'NativeFiles',kind:'module',language:'pascal',code:`unit NativeFiles;
interface
function Verify: Longint;
implementation
type TReading = record Code: Word; Mean: Real end;
function Verify: Longint;
var TextFile: Text; DataFile: file of TReading;
    Original, Restored: TReading; Number: Integer;
begin
  Assign(TextFile, 'pascal-native.txt'); Rewrite(TextFile); WriteLn(TextFile, 42:4); Flush(TextFile); Close(TextFile);
  Reset(TextFile); ReadLn(TextFile, Number); Close(TextFile);
  Original.Code := 65535; Original.Mean := 1.5;
  Assign(DataFile, 'pascal-native.dat'); Rewrite(DataFile); Write(DataFile, Original);
  Seek(DataFile, 0); Read(DataFile, Restored);
  Verify := Number + Restored.Code + FilePos(DataFile) + FileSize(DataFile);
  if Restored.Mean <> 1.5 then Verify := -1;
  Close(DataFile)
end;
end.`}
];}
