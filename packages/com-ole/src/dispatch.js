import {ComError,HRESULT,IID,guid,integer} from './contracts.js';
import {ComObject} from './identity.js';
export const DISPATCH = Object.freeze({METHOD:1,PROPERTYGET:2,PROPERTYPUT:4,PROPERTYPUTREF:8});
export const DISPID = Object.freeze({VALUE:0,UNKNOWN:-1,PROPERTYPUT:-3,NEWENUM:-4});
export const COM_MISSING = Symbol('COM missing optional argument');
const NULL_IID='00000000-0000-0000-0000-000000000000';
const identifier=value=>typeof value==='string'&&(/^[A-Za-z][A-Za-z0-9_]{0,254}$/.test(value)||value==='_NewEnum')&&!['constructor','prototype','caller','callee','arguments'].includes(value.toLowerCase());
export class ComByRef { constructor(value){this.value=value;} }
/** Wire-neutral dispatch. Language-specific VARIANT coercion belongs to the caller's adapter. */
export class DispatchObject extends ComObject {
  #members=new Map(); #names=new Map();
  constructor(members) {
    super([IID.IDispatch]);if(!Array.isArray(members)||members.length>1024)throw new ComError(HRESULT.E_INVALIDARG,'Member limit');
    for(const m of members){
      if(!m||!identifier(m.name)||this.#names.has(m.name.toLowerCase())||this.#members.has(m.dispid))throw new ComError(HRESULT.E_INVALIDARG,'Invalid or duplicate member');
      integer(m.dispid,-2147483648,2147483647);if(!Array.isArray(m.params)||m.params.length>64)throw new ComError(HRESULT.E_INVALIDARG,'Invalid parameter list');
      const names=new Set(),ids=new Set(),params=m.params.map((p,i)=>{
        if(!p||!identifier(p.name)||names.has(p.name.toLowerCase()))throw new ComError(HRESULT.E_INVALIDARG,'Invalid parameter name');
        const id=integer(p.dispid??i,0,2147483647);if(ids.has(id))throw new ComError(HRESULT.E_INVALIDARG,'Duplicate parameter DISPID');names.add(p.name.toLowerCase());ids.add(id);
        return Object.freeze({name:p.name,dispid:id,optional:p.optional===true,byRef:p.byRef===true,...(Object.hasOwn(p,'defaultValue')?{defaultValue:p.defaultValue}:{})});
      });
      const callbacks=new Map();for(const [key,flag]of [['method',1],['get',2],['put',4],['putRef',8]])if(m[key]!==undefined){if(typeof m[key]!=='function')throw new ComError(HRESULT.E_INVALIDARG,'Expected a dispatch callback');callbacks.set(flag,m[key]);}
      if(!callbacks.size)throw new ComError(HRESULT.E_INVALIDARG,'Member has no implementation');
      const member={name:m.name,dispid:m.dispid,params:Object.freeze(params),callbacks};this.#members.set(m.dispid,member);this.#names.set(m.name.toLowerCase(),member);
    }
  }
  GetTypeInfoCount(){this.assertAlive();return 1;}
  GetTypeInfo(index=0){this.assertAlive();integer(index,0,0);return Object.freeze({members:Object.freeze([...this.#members.values()].map(m=>Object.freeze({name:m.name,dispid:m.dispid,params:m.params,modes:Object.freeze([...m.callbacks.keys()])}))),defaultMember:[...this.#members.values()].find(m=>m.dispid===0)?.name||null});}
  GetIDsOfNames(names,riid=NULL_IID){
    this.assertAlive();if(guid(riid)!==NULL_IID)throw new ComError(HRESULT.DISP_E_UNKNOWNINTERFACE);
    if(!Array.isArray(names)||!names.length||names.length>65||names.some(n=>!identifier(n)))throw new ComError(HRESULT.DISP_E_UNKNOWNNAME);
    const m=this.#names.get(names[0].toLowerCase());if(!m)throw new ComError(HRESULT.DISP_E_UNKNOWNNAME);
    return [m.dispid,...names.slice(1).map(name=>{const p=m.params.find(p=>p.name.toLowerCase()===name.toLowerCase());if(!p)throw new ComError(HRESULT.DISP_E_UNKNOWNNAME);return p.dispid;})];
  }
  Invoke(dispid,flags,{rgvarg=[],rgdispidNamedArgs=[]}={},lcid=0,riid=NULL_IID){
    this.assertAlive();if(guid(riid)!==NULL_IID)throw new ComError(HRESULT.DISP_E_UNKNOWNINTERFACE);integer(lcid,0,0xfffff);
    if(![1,2,3,4,8].includes(flags))throw new ComError(HRESULT.E_INVALIDARG,'Invalid dispatch flags');
    const m=this.#members.get(dispid),mode=flags===3?(m?.callbacks.has(1)?1:2):flags,callback=m?.callbacks.get(mode);
    if(!callback)throw new ComError(HRESULT.DISP_E_MEMBERNOTFOUND);
    if(!Array.isArray(rgvarg)||!Array.isArray(rgdispidNamedArgs)||rgvarg.length>65||rgdispidNamedArgs.length>rgvarg.length)throw new ComError(HRESULT.DISP_E_BADPARAMCOUNT);
    const put=mode===4||mode===8,params=put?[...m.params,{name:'value',dispid:-3}]:m.params;
    if(rgvarg.length>params.length)throw new ComError(HRESULT.DISP_E_BADPARAMCOUNT);
    if(put&&!rgdispidNamedArgs.includes(-3))throw new ComError(HRESULT.DISP_E_PARAMNOTFOUND,'Property puts require DISPID_PROPERTYPUT');
    const bound=new Array(params.length).fill(COM_MISSING),used=new Set();
    for(let i=0;i<rgdispidNamedArgs.length;i++){
      const id=rgdispidNamedArgs[i],index=params.findIndex(p=>p.dispid===id);
      if(index<0||used.has(index))throw new ComError(HRESULT.DISP_E_PARAMNOTFOUND,'Unknown or duplicate named argument',{argErr:i});
      used.add(index);bound[index]=rgvarg[i];
    }
    const remaining=params.map((_,i)=>i).filter(i=>!used.has(i)),positional=rgvarg.slice(rgdispidNamedArgs.length).reverse();
    if(positional.length>remaining.length)throw new ComError(HRESULT.DISP_E_BADPARAMCOUNT);
    positional.forEach((v,i)=>bound[remaining[i]]=v);
    for(let i=0;i<params.length;i++){
      const p=params[i];if(bound[i]===COM_MISSING){if(!p.optional)throw new ComError(HRESULT.DISP_E_PARAMNOTOPTIONAL,'Required argument: '+p.name);if(Object.hasOwn(p,'defaultValue'))bound[i]=p.defaultValue;}
      if(p.byRef){if(!(bound[i] instanceof ComByRef))bound[i]=new ComByRef(bound[i]);}else if(bound[i] instanceof ComByRef)bound[i]=bound[i].value;
    }
    this.AddRef();try{
      const value=callback(bound,Object.freeze({lcid,flags:mode}));if(value?.then){Promise.resolve(value).catch(()=>{});throw new ComError(HRESULT.E_INVALIDARG,'Portable IDispatch callbacks must be synchronous');}return put?undefined:value;
    }catch(error){if(error instanceof ComError)throw error;throw new ComError(HRESULT.DISP_E_EXCEPTION,error?.message||'Automation exception',{source:m.name,description:String(error?.message||error),cause:error});}finally{this.Release();}
  }
  Call(name,mode,args=[]){const [id]=this.GetIDsOfNames([name]);return this.Invoke(id,mode,{rgvarg:[...args].reverse(),rgdispidNamedArgs:mode===4||mode===8?[-3]:[]});}
}
