/** Binary/Random transfers use the existing process-owned Win32 file slots.
 * The transfer kernel is compiled VB source with small checked memory hosts;
 * no VM, JavaScript evaluator or binary template is embedded in the result.
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/get-statement
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/put-statement
 */
import {mem32} from './x86-operands.js';

const P='native:file:',arg=argument=>({argument}),at=(base,displacement=0)=>mem32({base,displacement});
const scalarBytes=Object.freeze({byte:1,integer:2,boolean:2,long:4,single:4,double:8,currency:8,date:8});

export const NATIVE_BINARY_FILE_SOURCE=`Option Explicit
Private Declare Function ReadFile Lib "kernel32" (ByVal handle As Long, ByVal buffer As Long, ByVal count As Long, ByVal actual As Long, ByVal overlapped As Long) As Long
Private Declare Function WriteFile Lib "kernel32" (ByVal handle As Long, ByVal buffer As Long, ByVal count As Long, ByVal actual As Long, ByVal overlapped As Long) As Long
Private Declare Function GetLastError Lib "kernel32" () As Long
Private Function Word(ByVal pointer As Long, ByVal offset As Long) As Long
End Function
Private Sub PutWord(ByVal pointer As Long, ByVal offset As Long, ByVal value As Long)
End Sub
Private Sub Snapshot(ByVal entry As Long, ByVal generation As Long)
End Sub
Private Function Tell(ByVal entry As Long) As Long
End Function
Private Function Length(ByVal entry As Long) As Long
End Function
Private Sub SeekRecord(ByVal entry As Long, ByVal generation As Long, ByVal position As Long)
End Sub
Private Sub SeekBytes(ByVal entry As Long, ByVal generation As Long, ByVal position As Long)
End Sub
Private Sub RaiseIO(ByVal number As Long)
End Sub
Private Sub Transfer(ByVal entry As Long, ByVal generation As Long, ByVal position As Long, ByVal buffer As Long, ByVal size As Long, ByVal writing As Boolean)
  Dim mode As Long, access As Long, recordSize As Long, start As Long, finish As Long
  Dim handle As Long, chunk As Long, transferred As Long, done As Long, success As Long
  Dim zero As Long, fileLength As Long, record As Long
  Call Snapshot(entry, generation)
  mode = Word(entry, 4)
  If mode <> 4 And mode <> 5 Then Err.Raise 54
  access = Word(entry, 8)
  If writing Then
    If (access And 2) = 0 Then Err.Raise 54
  Else
    If (access And 1) = 0 Then Err.Raise 54
  End If
  If size < 0 Or size > 20971520 Then Err.Raise 7
  recordSize = size
  If mode = 5 Then
    recordSize = Word(entry, 48)
    If size > recordSize Then Err.Raise 59
  End If
  If position <> 0 Then Call SeekRecord(entry, generation, position)
  start = Tell(entry)
  If start > 2147483647 - recordSize Then Err.Raise 6
  finish = start + recordSize
  If Not writing Then
    If finish > Length(entry) Then Err.Raise 62
  End If
  ' Reconcile read-ahead before a direct transfer or a change of direction.
  Call SeekBytes(entry, generation, start)
  handle = Word(entry, 0)
  Do While done < size
    chunk = size - done
    If chunk > 32767 Then chunk = 32767
    If writing Then
      success = WriteFile(handle, buffer + done, chunk, VarPtr(transferred), 0)
    Else
      success = ReadFile(handle, buffer + done, chunk, VarPtr(transferred), 0)
    End If
    If success = 0 Then Call RaiseIO(GetLastError())
    If transferred < 0 Or transferred > chunk Then Err.Raise 75
    If transferred = 0 Then
      If writing Then Err.Raise 61
      Err.Raise 62
    End If
    done = done + transferred
  Loop
  If mode = 5 Then
    If writing Then
      fileLength = Length(entry)
      If fileLength < finish Then
        Call SeekBytes(entry, generation, fileLength)
        Do While fileLength < finish
          chunk = finish - fileLength
          If chunk > 4 Then chunk = 4
          success = WriteFile(handle, VarPtr(zero), chunk, VarPtr(transferred), 0)
          If success = 0 Then Call RaiseIO(GetLastError())
          If transferred < 0 Or transferred > chunk Then Err.Raise 75
          If transferred = 0 Then Err.Raise 61
          fileLength = fileLength + transferred
        Loop
      End If
    End If
    Call SeekBytes(entry, generation, finish)
    record = start \\ recordSize + 1
    Call PutWord(entry, 56, record)
  End If
End Sub`;

function kernel(c) {
  return c.nativeBinaryFileKernel ||= c.privateNativeKernel('NativeFileBinary',NATIVE_BINARY_FILE_SOURCE,{
    word:(c,p)=>c.x.label(p.label).enter().value(arg(8)).mov('edx','eax').value(arg(12)).add('edx','eax').mov('eax',at('edx')).leave(8),
    putword:(c,p)=>c.x.label(p.label).enter().value(arg(8)).mov('edx','eax').value(arg(12)).add('edx','eax').value(arg(16)).mov(at('edx'),'eax').leave(12),
    snapshot:(c,p)=>c.x.label(p.label).enter().push(arg(12)).push(arg(8)).call(P+'snapshot').leave(8),
    tell:(c,p)=>c.x.label(p.label).enter().push(arg(8)).call(P+'tell').leave(4),
    length:(c,p)=>c.x.label(p.label).enter().push(arg(8)).call(P+'length').leave(4),
    seekrecord:(c,p)=>c.x.label(p.label).enter().push(arg(16)).push(arg(12)).push(arg(8)).call(P+'seek-to').leave(12),
    seekbytes:(c,p)=>c.x.label(p.label).enter().push(arg(16)).push(arg(12)).push(arg(8)).call(P+'seek-bytes').leave(12),
    raiseio:(c,p)=>c.x.label(p.label).enter().value(arg(8)).jump(P+'error'),
  },{word:'load32',putword:'store32'});
}

export function nativeFileRecord(c,ins,entry,generation) {
  const x=c.x,save=name=>{const v=c.arrayWorkspace(4,name);x.mov(at('ebp',v.offset),'eax');return v;};
  c.numeric(ins.position||{kind:'literal',value:0});const position=save('record-position');
  const variable=c.variable(ins.target),type=String(variable?.type).toLowerCase(),size=scalarBytes[type];
  if(!variable||!size||variable.nativeArray&&!variable.elementOf||variable.recordFieldArray||variable.nativeRecord)
    c.fail('Native Get/Put requires a numeric scalar variable or array/record element; aggregate and String record codecs are not yet lowered');
  const pin=c.address(variable),destination=save('record-destination');
  const buffer=c.arrayWorkspace(Math.ceil(size/4)*4,'record-transfer');
  c.rawStorageAddress(buffer);const pointer=save('record-buffer');
  const temporary={type:variable.type,nativeKernelPointer:arg(pointer.offset)};
  if(ins.action==='put'){
    c.load({type:variable.type,nativeKernelPointer:arg(destination.offset)});c.store(temporary);
  }
  c.invokePrivateNative(kernel(c),'Transfer',[
    c.nativeKernelValue(arg(entry.offset)),c.nativeKernelValue(arg(generation.offset)),c.nativeKernelValue(arg(position.offset)),
    c.nativeKernelValue(arg(pointer.offset)),{kind:'literal',value:size},{kind:'literal',value:ins.action==='put'},
  ]);
  if(ins.action==='get'){
    c.load(temporary);c.store({type:variable.type,nativeKernelPointer:arg(destination.offset)});
  }
  c.releaseArrayPin(pin);
}
