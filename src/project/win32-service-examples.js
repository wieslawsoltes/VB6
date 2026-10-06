import {newProject,createForm,createControl,newId} from './model.js';

/** Original VB6 examples. All files, registry, atoms and synchronization names
 * are private to the app. No OS access, permissions or paid services required. */
export const WIN32_SERVICE_SAMPLES=[
{id:'win32-files',name:'Win32 Files and Paths',description:'FindFirstFile, private files, temporary names and shell paths',expected:['File: sample.txt','Size: 5','Matches: 1'],code:`Option Explicit
Private Type FIND_DATA
    Attributes As Long
    Times(0 To 5) As Long
    SizeHigh As Long
    SizeLow As Long
    Reserved(0 To 1) As Long
    FileName As String * 260
    AlternateName As String * 14
End Type
Private Declare Function FindFirstFile Lib "kernel32" Alias "FindFirstFileA" (ByVal path As String, data As FIND_DATA) As Long
Private Declare Function FindNextFile Lib "kernel32" Alias "FindNextFileA" (ByVal handle As Long, data As FIND_DATA) As Long
Private Declare Function FindClose Lib "kernel32" (ByVal handle As Long) As Long
Private Declare Function CreateDirectory Lib "kernel32" Alias "CreateDirectoryA" (ByVal path As String, ByVal security As Long) As Long
Private Declare Function DeleteFile Lib "kernel32" Alias "DeleteFileA" (ByVal path As String) As Long
Private Declare Function GetTempFileName Lib "kernel32" Alias "GetTempFileNameA" (ByVal path As String, ByVal prefix As String, ByVal unique As Long, ByVal buffer As String) As Long
Private Declare Function PathCombine Lib "shlwapi" Alias "PathCombineA" (ByVal result As String, ByVal folder As String, ByVal file As String) As Long
Public Function RunService(ByVal target As Long) As String
    Dim path As String, temporary As String, f As Integer, search As Long, data As FIND_DATA, count As Long, result As String
    CreateDirectory "C:\\Temp\\Services", 0
    path = String$(260, 0)
    If PathCombine(path, "C:\\Temp\\Services", "sample.txt") = 0 Then Err.Raise 5
    path = Left$(path, InStr(path, Chr$(0)) - 1)
    f = FreeFile
    Open path For Output As #f
    Print #f, "Hello";
    Close #f
    search = FindFirstFile("C:\\Temp\\Services\\*.txt", data)
    If search = -1 Then Err.Raise 5
    Do
        count = count + 1
        result = result & "File: " & Left$(data.FileName, InStr(data.FileName, Chr$(0)) - 1) & vbCrLf & "Size: " & CStr(data.SizeLow) & vbCrLf
    Loop While FindNextFile(search, data) <> 0
    FindClose search
    DeleteFile path
    temporary = String$(260, 0)
    If GetTempFileName("C:\\Temp", "svc", 0, temporary) = 0 Then Err.Raise 5
    DeleteFile temporary
    RunService = result & "Matches: " & CStr(count)
End Function
`},
{id:'win32-text',name:'Win32 Unicode and Base64',description:'UTF-8, UTF-16, Windows-1252 and bounded Base64 buffers',expected:['UTF-16 units: 3','Base64: QcOp4oKs','ANSI: Aé€'],code:`Option Explicit
Private Declare Function MultiByteToWideChar Lib "kernel32" (ByVal page As Long, ByVal flags As Long, data As Any, ByVal count As Long, wide As Any, ByVal capacity As Long) As Long
Private Declare Function WideCharToMultiByte Lib "kernel32" (ByVal page As Long, ByVal flags As Long, wide As Any, ByVal count As Long, ByVal result As String, ByVal capacity As Long, ByVal defaultChar As Long, used As Long) As Long
Private Declare Function CryptBinaryToString Lib "crypt32" Alias "CryptBinaryToStringA" (data As Any, ByVal count As Long, ByVal flags As Long, ByVal result As String, capacity As Long) As Long
Public Function RunService(ByVal target As Long) As String
    Dim utf8(0 To 5) As Byte, wide(0 To 7) As Integer, n As Long, ansi As String, encoded As String, size As Long, used As Long
    utf8(0) = 65: utf8(1) = 195: utf8(2) = 169: utf8(3) = 226: utf8(4) = 130: utf8(5) = 172
    n = MultiByteToWideChar(65001, 8, utf8(0), 6, wide(0), 8)
    If n <> 3 Then Err.Raise 5
    ansi = String$(32, 0)
    If WideCharToMultiByte(1252, 1024, wide(0), n, ansi, Len(ansi), 0, used) = 0 Then Err.Raise 5
    encoded = String$(32, 0): size = Len(encoded)
    If CryptBinaryToString(utf8(0), 6, 1073741825, encoded, size) = 0 Then Err.Raise 5
    RunService = "UTF-16 units: " & CStr(n) & vbCrLf & "Base64: " & Left$(encoded, size) & vbCrLf & "ANSI: " & Left$(ansi, 3)
End Function
`},
{id:'win32-sync',name:'Win32 Events and Semaphores',description:'Named events, wait-any, atomic wait-all and handle cleanup',expected:['Wait-any: 1','Before release: 258','Wait-all: 0'],code:`Option Explicit
Private Declare Function CreateEvent Lib "kernel32" Alias "CreateEventA" (ByVal security As Long, ByVal manual As Long, ByVal signaled As Long, ByVal name As String) As Long
Private Declare Function CreateSemaphore Lib "kernel32" Alias "CreateSemaphoreA" (ByVal security As Long, ByVal initial As Long, ByVal maximum As Long, ByVal name As String) As Long
Private Declare Function SetEvent Lib "kernel32" (ByVal handle As Long) As Long
Private Declare Function ReleaseSemaphore Lib "kernel32" (ByVal handle As Long, ByVal count As Long, previous As Long) As Long
Private Declare Function WaitForMultipleObjects Lib "kernel32" (ByVal count As Long, handles As Any, ByVal all As Long, ByVal timeout As Long) As Long
Private Declare Function CloseHandle Lib "kernel32" (ByVal handle As Long) As Long
Public Function RunService(ByVal target As Long) As String
    Dim handles(0 To 1) As Long, previous As Long, first As Long, blocked As Long, ready As Long
    handles(0) = CreateEvent(0, 0, 0, "Services.Ready")
    handles(1) = CreateSemaphore(0, 1, 2, "Services.Slots")
    If handles(0) = 0 Or handles(1) = 0 Then Err.Raise 5
    first = WaitForMultipleObjects(2, handles(0), 0, 0)
    SetEvent handles(0)
    blocked = WaitForMultipleObjects(2, handles(0), 1, 0)
    ReleaseSemaphore handles(1), 1, previous
    ready = WaitForMultipleObjects(2, handles(0), 1, 0)
    CloseHandle handles(1)
    CloseHandle handles(0)
    RunService = "Wait-any: " & CStr(first) & vbCrLf & "Before release: " & CStr(blocked) & vbCrLf & "Wait-all: " & CStr(ready)
End Function
`},
{id:'win32-registry',name:'Win32 Registry Inspector',description:'App-private registry values, size queries and enumeration',expected:['Values: 1','Name: Caption','Bytes: 5'],code:`Option Explicit
Private Declare Function RegCreateKeyEx Lib "advapi32" Alias "RegCreateKeyExA" (ByVal root As Long, ByVal name As String, ByVal reserved As Long, ByVal className As Long, ByVal options As Long, ByVal access As Long, ByVal security As Long, key As Long, ByVal disposition As Long) As Long
Private Declare Function RegSetValueEx Lib "advapi32" Alias "RegSetValueExA" (ByVal key As Long, ByVal name As String, ByVal reserved As Long, ByVal kind As Long, ByVal data As String, ByVal size As Long) As Long
Private Declare Function RegEnumValue Lib "advapi32" Alias "RegEnumValueA" (ByVal key As Long, ByVal index As Long, ByVal name As String, nameSize As Long, ByVal reserved As Long, kind As Long, ByVal data As Long, size As Long) As Long
Private Declare Function RegQueryInfoKey Lib "advapi32" Alias "RegQueryInfoKeyA" (ByVal key As Long, ByVal className As Long, ByVal classSize As Long, ByVal reserved As Long, ByVal subkeys As Long, ByVal maxKey As Long, ByVal maxClass As Long, values As Long, ByVal maxName As Long, ByVal maxData As Long, ByVal security As Long, ByVal lastWrite As Long) As Long
Private Declare Function RegDeleteValue Lib "advapi32" Alias "RegDeleteValueA" (ByVal key As Long, ByVal name As String) As Long
Private Declare Function RegCloseKey Lib "advapi32" (ByVal key As Long) As Long
Private Declare Function RegDeleteKey Lib "advapi32" Alias "RegDeleteKeyA" (ByVal root As Long, ByVal name As String) As Long
Public Function RunService(ByVal target As Long) As String
    Dim key As Long, count As Long, name As String, n As Long, kind As Long, size As Long
    If RegCreateKeyEx(-2147483647, "Software\\VB6ServicesSample", 0, 0, 0, 983103, 0, key, 0) <> 0 Then Err.Raise 5
    If RegSetValueEx(key, "Caption", 0, 1, "café" & Chr$(0), 5) <> 0 Then Err.Raise 5
    If RegQueryInfoKey(key, 0, 0, 0, 0, 0, 0, count, 0, 0, 0, 0) <> 0 Then Err.Raise 5
    name = String$(64, 0): n = Len(name)
    If RegEnumValue(key, 0, name, n, 0, kind, 0, size) <> 0 Then Err.Raise 5
    RunService = "Values: " & CStr(count) & vbCrLf & "Name: " & Left$(name, n) & vbCrLf & "Bytes: " & CStr(size)
    RegDeleteValue key, "Caption"
    RegCloseKey key
    RegDeleteKey -2147483647, "Software\\VB6ServicesSample"
End Function
`},
{id:'win32-guid',name:'Win32 GUID Workbench',description:'GUID structure layout, parsing, formatting and secure generation',expected:['Parsed: {00112233-4455-6677-8899-AABBCCDDEEFF}','Version: 4'],code:`Option Explicit
Private Declare Function CLSIDFromString Lib "ole32" (text As Any, guid As Any) As Long
Private Declare Function StringFromGUID2 Lib "ole32" (guid As Any, text As Any, ByVal capacity As Long) As Long
Private Declare Function CoCreateGuid Lib "ole32" (guid As Any) As Long
Public Function RunService(ByVal target As Long) As String
    Dim text As String, input(0 To 38) As Integer, output(0 To 38) As Integer, guid(0 To 15) As Byte, i As Long, parsed As String
    text = "{00112233-4455-6677-8899-aabbccddeeff}"
    For i = 1 To Len(text)
        input(i - 1) = AscW(Mid$(text, i, 1))
    Next i
    If CLSIDFromString(input(0), guid(0)) <> 0 Then Err.Raise 5
    If StringFromGUID2(guid(0), output(0), 39) <> 39 Then Err.Raise 5
    For i = 0 To 37
        parsed = parsed & ChrW(output(i))
    Next i
    If CoCreateGuid(guid(0)) <> 0 Then Err.Raise 5
    RunService = "Parsed: " & parsed & vbCrLf & "Version: " & CStr(guid(7) \\ 16)
End Function
`},
{id:'win32-properties',name:'Win32 Window Properties',description:'Registered-window data tags, atoms, lookups and lifetime cleanup',expected:['Atom: VB6.Services.Tag','Stored: 42','Removed: 42'],code:`Option Explicit
Private Declare Function GlobalAddAtom Lib "kernel32" Alias "GlobalAddAtomA" (ByVal name As String) As Long
Private Declare Function GlobalGetAtomName Lib "kernel32" Alias "GlobalGetAtomNameA" (ByVal atom As Long, ByVal name As String, ByVal size As Long) As Long
Private Declare Function GlobalDeleteAtom Lib "kernel32" (ByVal atom As Long) As Long
Private Declare Function SetProp Lib "user32" Alias "SetPropA" (ByVal window As Long, ByVal atom As Long, ByVal value As Long) As Long
Private Declare Function GetProp Lib "user32" Alias "GetPropA" (ByVal window As Long, ByVal name As String) As Long
Private Declare Function RemoveProp Lib "user32" Alias "RemovePropA" (ByVal window As Long, ByVal name As String) As Long
Public Function RunService(ByVal target As Long) As String
    Dim atom As Long, name As String, n As Long, stored As Long, removed As Long
    atom = GlobalAddAtom("VB6.Services.Tag")
    If atom = 0 Then Err.Raise 5
    If SetProp(target, atom, 42) = 0 Then Err.Raise 5
    name = String$(64, 0)
    n = GlobalGetAtomName(atom, name, Len(name))
    stored = GetProp(target, "VB6.Services.Tag")
    removed = RemoveProp(target, "VB6.Services.Tag")
    GlobalDeleteAtom atom
    RunService = "Atom: " & Left$(name, n) & vbCrLf & "Stored: " & CStr(stored) & vbCrLf & "Removed: " & CStr(removed)
End Function
`}];

export function createWin32ServiceExample(sample){
  const project=newProject(sample.name),form=createForm('frmServices',sample.name);
  form.form.properties.ClientWidth=540*15;form.form.properties.ClientHeight=280*15;
  const control=(type,name,x,y,width,height,properties)=>{const c=createControl(type,name,x*15,y*15);Object.assign(c.properties,{Width:width*15,Height:height*15,...properties});return c;};
  form.form.controls=[control('Label','lblStatus',196,64,300,22,{Caption:'Starting...'}),control('Label','lblDescription',16,12,510,40,{Caption:sample.description}),control('CommandButton','cmdRun',16,58,164,28,{Caption:'&Run API sample'}),control('TextBox','txtOutput',16,100,508,124,{Text:'Click Run API sample. All state is application-private.',MultiLine:-1,ScrollBars:2,Locked:-1}),control('Label','lblBoundary',16,240,508,24,{Caption:'No access to host files, registry, other apps or native DLLs.'})];
  form.code=`Option Explicit\nPrivate completedRuns As Long\nPrivate Sub Form_Load()\n    lblStatus.Caption = "Ready"\nEnd Sub\nPrivate Sub cmdRun_Click()\n    On Error GoTo Failed\n    txtOutput.Text = RunService(Me.hWnd)\n    completedRuns = completedRuns + 1\n    lblStatus.Caption = "Completed " & CStr(completedRuns)\n    Exit Sub\nFailed:\n    txtOutput.Text = "Error " & CStr(Err.Number) & ": " & Err.Description & " (Win32 " & CStr(Err.LastDLLError) & ")"\nEnd Sub\n`.replace(/\\n/g,'\n');
  project.modules=[form,{id:newId(),name:'Services',kind:'module',code:sample.code}];project.startup='frmServices';project.description=sample.description;return project;
}
export const WIN32_SERVICE_EXAMPLES=WIN32_SERVICE_SAMPLES.map(sample=>({id:sample.id,name:sample.name,description:sample.description,create:()=>createWin32ServiceExample(sample)}));
