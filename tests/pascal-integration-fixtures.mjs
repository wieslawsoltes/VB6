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
  Dim Result As Long
  Result = PascalUnit.Compute()
  Open "pascal-native-result.txt" For Output As #1
  Print #1, CStr(Result)
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
`}
  ]};
}
