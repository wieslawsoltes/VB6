/** The IDE, not an application iframe, owns this connection. Credentials remain
 * private memory; projects, layout snapshots, exports and logs never contain it. */
export class NativeDebuggerClient {
  #token='';#url='';#generation=0;#pending=new Set();
  constructor({fetch:fetcher=globalThis.fetch?.bind(globalThis)}={}){this.fetch=fetcher;}
  get connected(){return !!this.#token;}
  async connect(endpoint,token){
    const url=new URL(endpoint);
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!=='/debugger')throw new Error('Use the local bridge URL http://127.0.0.1:PORT/debugger.');
    if(typeof token!=='string'||token.length<32||token.length>512)throw new Error('Paste the random token printed by your local debugger bridge.');
    this.disconnect();this.#url=url.href;this.#token=token;const generation=this.#generation;
    try{const capabilities=await this.request('capabilities');if(capabilities.version!==1||capabilities.engine!=='CDB')throw new Error('Unsupported native debugger bridge.');return capabilities;}
    catch(error){if(generation===this.#generation)this.disconnect();throw error;}
  }
  disconnect(){this.#generation++;for(const controller of this.#pending)controller.abort();this.#pending.clear();this.#token='';this.#url='';}
  async request(method,params={}){
    if(!this.connected)throw new Error('Connect the native debugger bridge first.');
    const controller=new AbortController(),generation=this.#generation;this.#pending.add(controller);
    const timer=setTimeout(()=>controller.abort(),method==='attach'||method==='launch'?95000:25000);
    try{
      const response=await this.fetch(this.#url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.#token},body:JSON.stringify({method,params}),credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',cache:'no-store',signal:controller.signal});
      if(!/application\/json/i.test(response.headers.get('content-type')||''))throw new Error('The bridge returned a non-JSON response.');
      const reader=response.body?.getReader();let text='';
      if(reader){let size=0;const decoder=new TextDecoder();try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>3*1024*1024){await reader.cancel();throw new Error('Debugger response exceeds the 3 MiB limit.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}}
      else{text=await response.text();if(text.length>3*1024*1024)throw new Error('Debugger response exceeds the 3 MiB limit.');}
      if(generation!==this.#generation)throw new Error('Native debugger connection changed.');
      const value=JSON.parse(text);if(!response.ok||value.error){const error=new Error(value.error?.message||'Native debugger request failed.');error.code=value.error?.code;throw error;}
      if(!Object.hasOwn(value,'result'))throw new Error('Invalid native debugger response.');return value.result;
    }finally{clearTimeout(timer);this.#pending.delete(controller);}
  }
}
