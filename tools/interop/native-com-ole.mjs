/** Native COM/OLE services for trusted Node embedding code; never installed by a project. */
import {NativeAutomationClient} from './native-automation.mjs';
import {guid} from '../../packages/com-ole/src/contracts.js';
import {formatEtc} from '../../packages/com-ole/src/medium.js';
const limit=512*1024,base64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
function integer(value,min,max){if(!Number.isInteger(value)||value<min||value>max)throw RangeError('Native COM/OLE integer outside bounds');return value;}
function dataBytes(value){if(!(value instanceof Uint8Array)||value.byteLength>limit)throw TypeError('Expected at most 512 KiB of bytes');return Buffer.from(value).toString('base64');}
function decoded(value){if(typeof value!=='string'||value.length>699052||!base64.test(value))throw Error('Invalid native OLE bytes');const bytes=Buffer.from(value,'base64');if(bytes.length>limit||bytes.toString('base64')!==value)throw Error('Invalid native OLE byte encoding');return new Uint8Array(bytes);}
function format(value,single=false,wildcard=false){if(value?.targetDevice===true)throw TypeError('Native target-device descriptors are not transported');const {cfFormat,dwAspect,lindex,tymed}=formatEtc(value,{singleMedium:single,wildcard});return {cfFormat,dwAspect,lindex,tymed};}
function storageTree(tree,encode,budget={entries:0,bytes:0},depth=0){
  if(depth>8||!tree||typeof tree!=='object'||Array.isArray(tree))throw TypeError('Invalid structured-storage tree');
  if(Object.keys(tree).some(k=>!['classId','entries'].includes(k)))throw TypeError('Unknown structured-storage field');
  const entries=tree.entries??[];if(!Array.isArray(entries))throw TypeError('Expected storage entries');const names=new Set();
  const result={classId:guid(tree.classId??'00000000-0000-0000-0000-000000000000'),entries:entries.map(item=>{
    if(!item||typeof item!=='object'||typeof item.name!=='string'||!item.name.length||item.name.length>31||/[\0/\\:!]/.test(item.name)||names.has(item.name.toUpperCase()))throw TypeError('Invalid or duplicate compound-file element name');
    names.add(item.name.toUpperCase());if(++budget.entries>256)throw RangeError('Structured-storage entry limit');
    if(item.type==='stream'){
      if(Object.keys(item).some(k=>!['name','type','data'].includes(k)))throw TypeError('Unknown structured-stream field');
      const bytes=encode?item.data:decoded(item.data);if(!(bytes instanceof Uint8Array))throw TypeError('Expected stream bytes');budget.bytes+=bytes.length;if(budget.bytes>limit)throw RangeError('Structured-storage byte limit');
      return {name:item.name,type:'stream',data:encode?dataBytes(bytes):bytes};
    }
    if(item.type!=='storage'||Object.keys(item).some(k=>!['name','type','classId','entries'].includes(k)))throw TypeError('Unknown storage element type or field');
    return {name:item.name,type:'storage',...storageTree({classId:item.classId,entries:item.entries},encode,budget,depth+1)};
  })};return result;
}
export class NativeComOleClient extends NativeAutomationClient {
  #grants;
  constructor({activeObjects=[],publishActiveObjects=[],clipboardRead=false,clipboardWrite=false,...options}={}){
    super(options);const allowed=new Set(this.allowed.map(n=>n.toLowerCase()));
    const grant=values=>{if(!Array.isArray(values)||values.length>64||values.some(v=>typeof v!=='string'||!allowed.has(v.toLowerCase()))||new Set(values.map(v=>v.toLowerCase())).size!==values.length)throw TypeError('Active-object grants must be distinct explicitly allowed ProgIDs');return Object.freeze([...values]);};
    if(typeof clipboardRead!=='boolean'||typeof clipboardWrite!=='boolean')throw TypeError('Clipboard permissions must be explicit Booleans');
    this.#grants=Object.freeze({activeObjects:grant(activeObjects),publishActiveObjects:grant(publishActiveObjects),clipboardRead,clipboardWrite});
  }
  send(message,options){return super.send(message.op==='init'?{...message,comOle:this.#grants}:message,options);}
  handleOf(value){const id=typeof value==='string'?value:this.objectIds.get(value)||value?.id;if(typeof id!=='string'||!/^o[1-9]\d*$/.test(id))throw TypeError('Expected a native object handle belonging to this client');return id;}
  registry(options){
    const registry=super.registry(options);
    for(const name of this.#grants.activeObjects)registry.registerActive(name,async session=>{
      if(this.session&&this.session!==session)throw Error('Use a separate native client for each VM session');this.session=session;const wire=await this.getActiveObject(name),existing=this.adapters.has(wire.id);
      try{const adapter=this.adapter(wire,session);if(!existing&&wire.metadata?.events?.length)await this.request({op:'advise',handle:wire.id});return adapter;}
      catch(error){if(!existing)await this.releaseHandle(wire.id).catch(()=>{});throw error;}
    });return registry;
  }
  getActiveObject(progId){if(!this.#grants.activeObjects.some(n=>n.toLowerCase()===String(progId).toLowerCase()))throw Error('Existing-object access was not granted');return this.request({op:'com.getActive',progId});}
  publishActiveObject(handle,progId,{weak=false}={}){if(typeof weak!=='boolean'||!this.#grants.publishActiveObjects.some(n=>n.toLowerCase()===String(progId).toLowerCase()))throw Error('Active-object publication was not granted');return this.request({op:'com.publishActive',handle:this.handleOf(handle),progId,weak});}
  revokeActiveObject(registration){if(typeof registration!=='string'||!/^a[1-9]\d*$/.test(registration))throw TypeError('Invalid active registration');return this.request({op:'com.revokeActive',registration});}
  queryInterfaces(handle,iids){if(!Array.isArray(iids)||iids.length>64)throw TypeError('Expected at most 64 IIDs');return this.request({op:'com.interfaces',handle:this.handleOf(handle),iids:iids.map(guid)});}
  /** Creates native IDataObject, not a fabricated IDispatch/COM class. */
  async createDataObject(entries=[]){
    if(!Array.isArray(entries)||entries.length>256)throw TypeError('OLE format limit');const checked=entries.map(e=>({format:format(e.format,true),data:dataBytes(e.data)}));
    const wire=await this.request({op:'ole.dataCreate'});try{for(const entry of checked)await this.request({op:'ole.dataSet',handle:wire.id,...entry});return wire;}catch(error){await this.releaseHandle(wire.id).catch(()=>{});throw error;}
  }
  registerClipboardFormat(name){if(typeof name!=='string'||!name.length||name.length>255||name.includes('\0'))throw TypeError('Invalid clipboard format name');return this.request({op:'ole.dataRegisterFormat',name});}
  clipboardFormatName(cfFormat){return this.request({op:'ole.dataFormatName',cfFormat:integer(cfFormat,0xc000,0xffff)});}
  dataFormats(handle,direction=1){return this.request({op:'ole.dataFormats',handle:this.handleOf(handle),direction:integer(direction,1,2)});}
  queryData(handle,requested){return this.request({op:'ole.dataQuery',handle:this.handleOf(handle),format:format(requested)});}
  canonicalDataFormat(handle,requested){return this.request({op:'ole.dataCanonical',handle:this.handleOf(handle),format:format(requested)});}
  async getData(handle,requested){const result=await this.request({op:'ole.dataGet',handle:this.handleOf(handle),format:format(requested)});return {...result,data:decoded(result.data)};}
  setData(handle,requested,bytes){return this.request({op:'ole.dataSet',handle:this.handleOf(handle),format:format(requested,true),data:dataBytes(bytes)});}
  async getDataHere(handle,requested,bytes){const result=await this.request({op:'ole.dataGetHere',handle:this.handleOf(handle),format:format(requested,true),data:dataBytes(bytes)});return {...result,data:decoded(result.data)};}
  adviseData(handle,requested,flags=0){integer(flags,0,71);if(flags&~71)throw TypeError('Unsupported advisory flags');return this.request({op:'ole.dataAdvise',handle:this.handleOf(handle),format:format(requested,false,!!(flags&1)),flags});}
  unadviseData(connection){if(typeof connection!=='string'||!/^d[1-9]\d*$/.test(connection))throw TypeError('Invalid data advisory connection');return this.request({op:'ole.dataUnadvise',connection});}
  /** Notifications carry copied data; dropped snapshots are reported rather than silently hidden. */
  async drainEvents(){const result=await this.request({op:'ole.dataChanges'});if(!Array.isArray(result.notifications)||result.notifications.length>64||!Number.isInteger(result.dropped)||result.dropped<0)throw Error('Invalid native event snapshot');return {...result,notifications:result.notifications.map(n=>Object.hasOwn(n,'data')?{...n,data:decoded(n.data)}:n)};}
  getSystemClipboard(){if(!this.#grants.clipboardRead)throw Error('System clipboard read was not granted');return this.request({op:'ole.clipboardGet'});}
  setSystemClipboard(handle){if(!this.#grants.clipboardWrite)throw Error('System clipboard write was not granted');return this.request({op:'ole.clipboardSet',handle:handle===null?null:this.handleOf(handle)});}
  isCurrentSystemClipboard(){if(!this.#grants.clipboardWrite)throw Error('System clipboard ownership check was not granted');return this.request({op:'ole.clipboardCurrent'});}
  flushSystemClipboard(){if(!this.#grants.clipboardWrite)throw Error('System clipboard write was not granted');return this.request({op:'ole.clipboardFlush'});}
  objectInfo(handle){return this.request({op:'ole.objectInfo',handle:this.handleOf(handle)});}
  objectVerbs(handle){return this.request({op:'ole.objectVerbs',handle:this.handleOf(handle)});}
  doObjectVerb(handle,verb=0){return this.request({op:'ole.objectDoVerb',handle:this.handleOf(handle),verb:integer(verb,-2147483648,2147483647)});}
  deactivateObject(handle,{uiOnly=false}={}){if(typeof uiOnly!=='boolean')throw TypeError('Expected Boolean deactivation mode');return this.request({op:'ole.objectDeactivate',handle:this.handleOf(handle),uiOnly});}
  setObjectExtent(handle,width,height,aspect=1){if(![1,2,4,8].includes(aspect))throw TypeError('Invalid OLE aspect');return this.request({op:'ole.objectExtent',handle:this.handleOf(handle),width:integer(width,0,2147483647),height:integer(height,0,2147483647),aspect});}
  setObjectHostNames(handle,application,document){if([application,document].some(v=>typeof v!=='string'||v.length>1024||v.includes('\0')))throw TypeError('Invalid OLE host labels');return this.request({op:'ole.objectNames',handle:this.handleOf(handle),application,document});}
  updateObject(handle){return this.request({op:'ole.objectUpdate',handle:this.handleOf(handle)});}
  isObjectUpToDate(handle){return this.request({op:'ole.objectIsUpToDate',handle:this.handleOf(handle)});}
  closeObject(handle,{save='discard'}={}){const modes={save:0,discard:1,prompt:2};if(!Object.hasOwn(modes,save))throw TypeError('Invalid OLE save option');return this.request({op:'ole.objectClose',handle:this.handleOf(handle),save:modes[save]});}
  objectData(handle){return this.request({op:'ole.objectGetData',handle:this.handleOf(handle)});}
  initializeObjectFromData(handle,dataHandle,{creation=false}={}){if(typeof creation!=='boolean')throw TypeError('Expected Boolean creation mode');return this.request({op:'ole.objectInitFromData',handle:this.handleOf(handle),dataHandle:this.handleOf(dataHandle),creation});}
  adviseObject(handle){return this.request({op:'ole.objectAdvise',handle:this.handleOf(handle)});}
  unadviseObject(connection){if(typeof connection!=='string'||!/^v[1-9]\d*$/.test(connection))throw TypeError('Invalid OLE object advisory connection');return this.request({op:'ole.objectUnadvise',connection});}
  async writeCompoundFile(tree){const result=await this.request({op:'ole.storageWrite',tree:storageTree(tree,true)});return decoded(result.data);}
  async readCompoundFile(bytes){return storageTree(await this.request({op:'ole.storageRead',data:dataBytes(bytes)}),false);}
}
