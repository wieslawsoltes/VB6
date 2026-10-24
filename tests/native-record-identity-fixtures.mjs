/** Nominal record contracts shared by the VM, C++ source kit and direct AOT. */
const vb = (name, code, kind = 'module') => ({name, kind, language: 'vb6', code});
const project = (name, code, modules = []) => ({
  schema: 1, name, language: 'vb6', startup: 'Sub Main', settings: {},
  modules: [vb('Main', code), ...modules],
});

function qualifiedAliases() {
  return {
    name: 'qualified-aliases',
    project: project('QualifiedRecordAliases', `Option Explicit
Public Sub Main()
  Dim Plain(0 To 0) As TItem
  Dim Qualified() As Records.TItem
  Dim MixedCase(0 To 0) As rEcOrDs.tItEm
  Dim RecordValue As records.titem
  Dim Copy As Variant
  ReDim Qualified(0 To 0)
  Records.Fill Qualified
  Records.Bump Qualified(0)
  Debug.Print "value:" & CStr(Qualified(0).Value)
  Debug.Print "plain:" & TypeName(Plain)
  Debug.Print "qualified:" & TypeName(Qualified)
  Debug.Print "mixed-case:" & TypeName(MixedCase)
  Debug.Print "record:" & TypeName(RecordValue)
  Records.Inspect Qualified
  Copy = Qualified
  Debug.Print "variant:" & TypeName(Copy)
  ReDim Preserve Qualified(0 To 2) As TItem
  Debug.Print "preserved:" & TypeName(Qualified) & ":" & CStr(Qualified(0).Value) & ":" & CStr(Qualified(2).Value)
  Qualified = Records.MakeItems()
  Debug.Print "result:" & TypeName(Qualified) & ":" & CStr(Qualified(0).Value)
End Sub`, [vb('Records', `Option Explicit
Public Type TItem
  Value As Long
End Type
Public Sub Fill(ByRef Items() As TItem)
  Items(0).Value = 42
End Sub
Public Sub Bump(ByRef Item As TItem)
  Item.Value = Item.Value + 1
End Sub
Public Sub Inspect(ByRef Items() As TItem)
  Debug.Print "formal:" & TypeName(Items)
End Sub
Public Function MakeItems() As Records.TItem()
  Dim Original(0 To 0) As TItem
  Original(0).Value = 23
  MakeItems = Original
End Function`)]),
    expectedOutput: [
      'value:43', 'plain:TItem()', 'qualified:Records.TItem()',
      'mixed-case:rEcOrDs.tItEm()', 'record:TItem',
      'formal:Records.TItem()', 'variant:Records.TItem()',
      'preserved:Records.TItem():43:0', 'result:TItem():23',
    ],
  };
}

function pascalRecordArray() {
  return {
    name: 'pascal-record-array',
    project: {
      schema: 1, name: 'PascalQualifiedRecordArray', language: 'pascal',
      startup: 'Sub Main', settings: {}, modules: [
        {name: 'Main', kind: 'module', language: 'pascal', code: `program Main;
type TItems = array[0..0] of Records.TItem;
var Items: TItems; Value: Records.TItem;
begin
  Records.Fill(Items);
  Records.Bump(Items[0]);
  Records.Bump(Value);
  WriteLn('pascal:', Items[0].Value, ':', Value.Value);
  WriteLn(TypeName(Items));
  WriteLn(TypeName(Value))
end.`},
        vb('Records', `Public Type TItem
  Value As Long
End Type
Public Sub Fill(ByRef Items() As TItem)
  Items(0).Value = 42
End Sub
Public Sub Bump(ByRef Item As TItem)
  Item.Value = Item.Value + 1
End Sub`),
      ],
    },
    expectedOutput: ['pascal:43:1', 'Records.TItem()', 'TItem'],
  };
}

function separateOwners() {
  return {
    name: 'separate-owners',
    project: project('SeparateRecordOwners', `Option Explicit
Public Sub Main()
  Dim Value As Foo.Item
  Dim Items() As Foo.Item
  Dim EmptyItems() As Foo.Item
  Dim Foreign As Variant
  Value.Value = 7
  ReDim Items(0 To 0)
  Items(0).Value = 11
  On Error Resume Next
  Value = Bar.MakeItem()
  Debug.Print "record:" & CStr(Err.Number) & ":" & CStr(Value.Value)
  Err.Clear
  Items = Bar.MakeItems()
  Debug.Print "array:" & CStr(Err.Number) & ":" & CStr(Items(0).Value)
  Err.Clear
  EmptyItems = Bar.MakeItems()
  Debug.Print "empty:" & CStr(Err.Number) & ":" & TypeName(EmptyItems)
  Err.Clear
  Foreign = Bar.MakeItems()
  Items = Foreign
  Debug.Print "variant-array:" & CStr(Err.Number) & ":" & CStr(Items(0).Value)
  Err.Clear
  Bar.Change Value
  Debug.Print "byref-record:" & CStr(Err.Number) & ":" & CStr(Value.Value)
  Err.Clear
  Bar.ChangeItems Items
  Debug.Print "byref-array:" & CStr(Err.Number) & ":" & CStr(Items(0).Value)
  Err.Clear
  Bar.ChangeItems (EmptyItems)
  Debug.Print "temporary-array:" & CStr(Err.Number) & ":" & TypeName(EmptyItems)
  Err.Clear
  On Error GoTo 0
  Foo.ChangeItems Items
  Debug.Print "correct-owner:" & CStr(Items(0).Value) & ":" & TypeName(Value)
End Sub`, [vb('Foo', `Public Type Item
  Value As Long
End Type
Public Sub ChangeItems(ByRef Items() As Item)
  Items(0).Value = 19
End Sub`), vb('Bar', `Public Type Item
  Value As Long
End Type
Public Function MakeItem() As Variant
  Dim Value As Item
  Value.Value = 99
  MakeItem = Value
End Function
Public Function MakeItems() As Variant
  Dim Items() As Item
  MakeItems = Items
End Function
Public Sub Change(ByRef Value As Item)
  Debug.Print "WRONG_RECORD_OWNER_ENTERED"
  Value.Value = 99
End Sub
Public Sub ChangeItems(ByRef Items() As Item)
  Debug.Print "WRONG_ARRAY_OWNER_ENTERED"
End Sub`)]),
    expectedOutput: [
      'record:13:7', 'array:13:11', 'empty:13:Foo.Item()',
      'variant-array:13:11', 'byref-record:13:7', 'byref-array:13:11',
      'temporary-array:13:Foo.Item()', 'correct-owner:19:Item',
    ],
  };
}

function privateNestedFields() {
  return {
    name: 'private-nested-fields',
    project: project('PrivateNestedRecordFields', `Option Explicit
Private Type Detail
  Wrong As String
End Type
Public Sub Main()
  Dim Value As Types.Envelope
  Dim LocalDetail As Detail
  Value.Data.Value = 12
  Value.Items(-1).Value = 23
  LocalDetail.Wrong = "caller"
  Types.Touch Value
  Debug.Print "nested:" & CStr(Value.Data.Value) & ":" & CStr(Value.Items(-1).Value) & ":" & CStr(Value.Items(1).Value)
  Debug.Print "names:" & TypeName(Value.Data) & ":" & TypeName(Value.Items)
  Debug.Print "caller:" & LocalDetail.Wrong
End Sub`, [vb('Types', `Option Explicit
Private Type Detail
  Value As Long
End Type
Public Type Envelope
  Data As Detail
  Items(-1 To 1) As Detail
End Type
Public Sub Touch(ByRef Value As Envelope)
  TouchDetail Value.Data
  TouchDetail Value.Items(-1)
End Sub
Private Sub TouchDetail(ByRef Value As Detail)
  Value.Value = Value.Value + 1
End Sub`)]),
    expectedOutput: ['nested:13:24:0', 'names:Detail:Detail()', 'caller:caller'],
  };
}

function recordClassCollision() {
  return {
    name: 'record-class-collision',
    project: project('RecordClassCollision', `Option Explicit
Private Type Item
  Value As Long
End Type
Public Sub Main()
  Dim Value As Item
  Dim AliasValue As Main.Item
  Dim Instance As Object
  Value.Value = 17
  AliasValue = Value
  Set Instance = New Item
  Instance.Other = 31
  Debug.Print "collision:" & CStr(AliasValue.Value) & ":" & CStr(Instance.Other) & ":" & TypeName(Value) & ":" & TypeName(Instance)
End Sub`, [vb('Item', 'Public Other As Long', 'class')]),
    expectedOutput: ['collision:17:31:Item:Item'],
  };
}

function dynamicRecordField() {
  return {
    name: 'dynamic-record-field',
    project: project('DynamicRecordField', `Option Explicit
Private Type Detail
  Wrong As String
End Type
Public Sub Main()
  Dim Value As Types.Envelope
  Dim Copy As Variant
  Debug.Print "unallocated:" & CStr(IsArray(Value.Items)) & ":" & TypeName(Value.Items)
  Types.Fill Value.Items
  Debug.Print "field:" & CStr(Value.Items(-1).Value) & ":" & CStr(Value.Items(1).Value) & ":" & TypeName(Value.Items)
  Copy = Value.Items
  ReDim Preserve Copy(-1 To 2)
  Types.Touch Copy
  Debug.Print "copy:" & CStr(Copy(-1).Value) & ":" & CStr(Copy(2).Value) & ":" & CStr(Value.Items(-1).Value) & ":" & TypeName(Copy)
  Types.Inspect Value.Items
End Sub`, [vb('Types', `Option Explicit
Private Type Detail
  Value As Long
End Type
Public Type Envelope
  Items() As Detail
End Type
Public Sub Fill(ByRef Items() As Detail)
  ReDim Items(-1 To 1)
  Items(-1).Value = 41
End Sub
Public Sub Touch(ByRef Items() As Detail)
  Items(-1).Value = Items(-1).Value + 1
End Sub
Public Sub Inspect(ByRef Items() As Detail)
  Debug.Print "formal:" & TypeName(Items) & ":" & CStr(UBound(Items))
End Sub`)]),
    expectedOutput: [
      'unallocated:True:Detail()', 'field:41:0:Detail()',
      'copy:42:0:41:Detail()', 'formal:Detail():1',
    ],
  };
}

/** Return fresh projects because target compilation normalizes their snapshots. */
export function nativeRecordIdentityCases() {
  return [qualifiedAliases(), pascalRecordArray(), separateOwners(), privateNestedFields(), recordClassCollision(), dynamicRecordField()];
}
