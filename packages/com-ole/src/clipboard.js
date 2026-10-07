import {ComError,HRESULT,IID} from './contracts.js';
import {sameComIdentity} from './identity.js';
import {OleDataObject} from './data-object.js';
import {MemoryStream} from './stream.js';
import {StgMedium} from './medium.js';
// Flush materializes independent data, not merely a stream with another seek pointer.
function snapshotMedium(medium){
  if(medium.tymed!==4)return medium.clone();
  const stream=medium.data.Clone();let owned;
  try{
    const size=stream.Stat().size;if(!Number.isSafeInteger(size)||size<0||size>16*1024*1024)throw new ComError(HRESULT.STG_E_MEDIUMFULL,'Clipboard stream limit');
    stream.Seek(0);const row=stream.Read(size);
    if(!(row.data instanceof Uint8Array)||row.bytesRead!==size||row.data.length!==size||row.hresult!==HRESULT.S_OK)throw new ComError(HRESULT.E_FAIL,'Incomplete clipboard stream snapshot');
    owned=new MemoryStream(row.data);return new StgMedium(4,owned);
  }finally{try{owned?.Release();}finally{stream.Release();}}
}
/** Scoped OLE clipboard. Does not read/write the OS clipboard or request browser permissions. */
export class OleClipboard {
  #object=null;#closed=false;#flushing=false;
  #assert(){if(this.#closed)throw new ComError(HRESULT.CO_E_OBJNOTCONNECTED,'Clipboard closed');}
  OleSetClipboard(object){this.#assert();const next=object===null?null:object.QueryInterface(IID.IDataObject),old=this.#object;this.#object=next;old?.Release();return HRESULT.S_OK;}
  OleGetClipboard(){this.#assert();if(!this.#object)throw new ComError(HRESULT.MK_E_UNAVAILABLE,'Clipboard is empty');this.#object.AddRef();return this.#object;}
  OleIsCurrentClipboard(object){this.#assert();return this.#object&&sameComIdentity(this.#object,object)?HRESULT.S_OK:HRESULT.S_FALSE;}
  OleFlushClipboard(){
    this.#assert();if(!this.#object)return HRESULT.S_OK;if(this.#flushing)throw new ComError(HRESULT.E_ABORT,'Reentrant clipboard flush');
    const original=this.OleGetClipboard(),copy=new OleDataObject();let enumerator;this.#flushing=true;
    try{
      enumerator=original.EnumFormatEtc(1);const seen=new Set();let count=0;
      for(;;){const row=enumerator.Next(1);if(!row.fetched)break;if(++count>256)throw new ComError(HRESULT.E_OUTOFMEMORY,'Clipboard format limit');
        const f=row.values[0],id=JSON.stringify(f);if(seen.has(id))throw new ComError(HRESULT.E_INVALIDARG,'Duplicate clipboard format');seen.add(id);
        const medium=original.GetData(f);let snapshot;
        try{snapshot=snapshotMedium(medium);copy.SetData({...f,tymed:snapshot.tymed},snapshot,true);}
        finally{try{if(snapshot&&!snapshot.released)snapshot.release();}finally{medium.release();}}
      }
      this.#assert();if(this.#object!==original)throw new ComError(HRESULT.E_ABORT,'Clipboard changed during delayed rendering');
      this.OleSetClipboard(copy);return HRESULT.S_OK;
    }finally{this.#flushing=false;try{enumerator?.Release();}finally{try{copy.Release();}finally{original.Release();}}}
  }
  close(){if(this.#closed)return;this.#closed=true;const old=this.#object;this.#object=null;old?.Release();}
}
