import {ComError,HRESULT,IID,integer} from './contracts.js';
import {ComObject} from './identity.js';
const DEFAULT_LIMIT=16*1024*1024;
function bytes(value){if(!(value instanceof Uint8Array))throw new ComError(HRESULT.E_INVALIDARG,'Expected Uint8Array');return value;}
/** Bounded, direct-mode IStream. Clones share bytes/size but have independent seek pointers. */
export class MemoryStream extends ComObject {
  #storage; #position=0; #readOnly;
  constructor(data=new Uint8Array(),{maxBytes=DEFAULT_LIMIT,readOnly=false}={}){
    super([IID.IStream,IID.ISequentialStream]);integer(maxBytes,0,256*1024*1024);bytes(data);if(data.length>maxBytes)throw new ComError(HRESULT.STG_E_MEDIUMFULL);if(typeof readOnly!=='boolean')throw new ComError(HRESULT.E_INVALIDARG);
    this.#storage={data:new Uint8Array(data),size:data.length,maxBytes};this.#readOnly=readOnly;
  }
  Read(count){this.assertAlive();integer(count,0,0xffffffff);const size=Math.min(count,Math.max(0,this.#storage.size-this.#position)),data=this.#storage.data.slice(this.#position,this.#position+size);this.#position+=size;return {hresult:size===count?HRESULT.S_OK:HRESULT.S_FALSE,data,bytesRead:size};}
  Write(data){this.assertAlive();if(this.#readOnly)throw new ComError(HRESULT.STG_E_ACCESSDENIED);bytes(data);const end=this.#position+data.length;if(end>this.#storage.maxBytes)throw new ComError(HRESULT.STG_E_MEDIUMFULL);if(!data.length)return 0;this.#resize(Math.max(this.#storage.size,end));this.#storage.data.set(data,this.#position);this.#position=end;return data.length;}
  #resize(size){const s=this.#storage;if(size>s.data.length){const capacity=Math.min(s.maxBytes,Math.max(size,Math.max(64,s.data.length*2)));const data=new Uint8Array(capacity);data.set(s.data.subarray(0,s.size));s.data=data;}if(size<s.size)s.data.fill(0,size,s.size);else if(size>s.size)s.data.fill(0,s.size,size);s.size=size;}
  Seek(offset,origin=0){this.assertAlive();integer(offset,-Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER);integer(origin,0,2);const position=(origin===0?0:origin===1?this.#position:this.#storage.size)+offset;if(!Number.isSafeInteger(position)||position<0)throw new ComError(HRESULT.STG_E_INVALIDFUNCTION,'Seek before beginning or out of range');this.#position=position;return position;}
  SetSize(size){this.assertAlive();if(this.#readOnly)throw new ComError(HRESULT.STG_E_ACCESSDENIED);integer(size,0,Number.MAX_SAFE_INTEGER);if(size>this.#storage.maxBytes)throw new ComError(HRESULT.STG_E_MEDIUMFULL);this.#resize(size);return HRESULT.S_OK;}
  CopyTo(destination,count){
    this.assertAlive();integer(count,0,Number.MAX_SAFE_INTEGER);if(!destination||typeof destination.Write!=='function')throw new ComError(HRESULT.STG_E_INVALIDPOINTER);
    // Snapshot before writing so overlapping streams and clones cannot corrupt the source range.
    const size=Math.min(count,Math.max(0,this.#storage.size-this.#position)),data=this.#storage.data.slice(this.#position,this.#position+size);let written;
    this.#position+=size;written=destination.Write(data);if(!Number.isSafeInteger(written)||written<0||written>size)throw new ComError(HRESULT.E_FAIL,'Invalid destination byte count');
    if(written!==size)throw new ComError(HRESULT.STG_E_MEDIUMFULL,'Destination accepted fewer bytes than read');
    return {hresult:HRESULT.S_OK,bytesRead:size,bytesWritten:written};
  }
  Commit(flags=0){this.assertAlive();if(flags!==0)throw new ComError(HRESULT.STG_E_INVALIDFUNCTION,'Only direct-mode commit is supported');return HRESULT.S_OK;}
  Revert(){this.assertAlive();return HRESULT.S_OK;}
  LockRegion(){this.assertAlive();throw new ComError(HRESULT.STG_E_INVALIDFUNCTION,'Region locking is not supported');}
  UnlockRegion(){this.assertAlive();throw new ComError(HRESULT.STG_E_INVALIDFUNCTION,'Region locking is not supported');}
  Stat(){this.assertAlive();return Object.freeze({type:2,size:this.#storage.size,mode:this.#readOnly?0:2,locksSupported:0});}
  Clone(){this.assertAlive();const copy=new MemoryStream(new Uint8Array(),{maxBytes:this.#storage.maxBytes,readOnly:this.#readOnly});copy.#storage=this.#storage;copy.#position=this.#position;return copy;}
  toUint8Array(){this.assertAlive();return this.#storage.data.slice(0,this.#storage.size);}
  disposeResources(){this.#storage=null;}
}
