/** Run with Node or import from a browser ES module; no VB6 runtime is needed.
 * All files, handles and names belong to this sample's private compatibility instance.
 */
import {createWin32} from '../src/index.js';

export async function runCommonServicesSample() {
  const win32=createWin32(),memory=win32.memory;
  const call=(dll,name,...args)=>win32.invoke(dll,name,args);
  const kernel=(name,...args)=>call('kernel32',name,...args);
  const checked=(value,expected,name)=>{
    if(value!==expected)throw new Error(`${name} failed: ${value} (Win32 error ${win32.lastError})`);
    return value;
  };
  let timer;
  try {
    // File duplicates share a cursor. A seek changes the position, not file size.
    const bytes=memory.alloc(6),count=memory.alloc(4),duplicate=memory.alloc(4),position=memory.alloc(8);
    memory.bytes(bytes,6).set([65,195,169,226,130,172]); // UTF-8: Aé€
    const file=kernel('CreateFileA','C:\\common-services.txt',0xc0000000,0,0,2,0,0);
    if(file===-1)throw new Error(`CreateFile failed: ${win32.lastError}`);
    checked(kernel('WriteFile',file,bytes,6,count,0),1,'WriteFile');
    checked(kernel('DuplicateHandle',-1,file,-1,duplicate,0,0,2),1,'DuplicateHandle');
    const copy=memory.readU32(duplicate);
    checked(kernel('SetFilePointerEx',copy,2,0,0,0),1,'SetFilePointerEx');
    checked(kernel('SetFilePointerEx',file,0,0,position,1),1,'SetFilePointerEx query');
    const sharedPosition=Number(memory.view(position,8).getBigInt64(0,true));
    checked(kernel('GetFileSizeEx',file,position),1,'GetFileSizeEx');
    const fileSize=Number(memory.view(position,8).getBigInt64(0,true));
    checked(kernel('CloseHandle',file),1,'CloseHandle');
    checked(kernel('CloseHandle',copy),1,'CloseHandle duplicate');

    // Query capacities before writing. Encoding capacities use API-specific units.
    const units=checked(kernel('MultiByteToWideChar',65001,8,bytes,6,0,0),3,'UTF-8 size');
    const wide=memory.alloc((units+1)*2);
    checked(kernel('MultiByteToWideChar',65001,8,bytes,6,wide,units),units,'UTF-8 conversion');
    memory.view(wide+units*2,2).setUint16(0,0,true);
    const text=memory.string(wide,true);
    checked(call('crypt32','CryptBinaryToStringA',bytes,6,0x40000001,0,count),1,'Base64 size');
    const base64Buffer=memory.alloc(memory.readU32(count));
    checked(call('crypt32','CryptBinaryToStringA',bytes,6,0x40000001,base64Buffer,count),1,'Base64 output');
    const base64=memory.string(base64Buffer);

    // A host callback signals an asynchronous wait; the browser thread stays free.
    const event=kernel('CreateEventA',0,0,0,'Sample.Ready');
    if(!event)throw new Error(`CreateEvent failed: ${win32.lastError}`);
    const waiting=kernel('WaitForSingleObject',event,1000);
    let yielded=false;
    timer=setTimeout(()=>{yielded=true;kernel('SetEvent',event);},0);
    const wait=checked(await waiting,0,'WaitForSingleObject');
    const reset=checked(kernel('WaitForSingleObject',event,0),258,'Auto-reset event');
    checked(kernel('CloseHandle',event),1,'CloseHandle event');

    // GUID serialization uses task-owned memory and the mixed-endian GUID layout.
    const guid=call('ole32','CoTaskMemAlloc',16);
    if(!guid)throw new Error(`CoTaskMemAlloc failed: ${win32.lastError}`);
    try {
      checked(call('ole32','CLSIDFromString','{00112233-4455-6677-8899-AABBCCDDEEFF}',guid),0,'CLSIDFromString');
      const output=memory.alloc(78);
      checked(call('ole32','StringFromGUID2',guid,output,39),39,'StringFromGUID2');
      return {fileSize,sharedPosition,text,base64,wait,reset,yielded,guid:memory.string(output,true)};
    } finally {call('ole32','CoTaskMemFree',guid);}
  } finally {
    clearTimeout(timer);
    // Also releases ordinary buffers and any handles left by a failed operation.
    win32.dispose();
  }
}
