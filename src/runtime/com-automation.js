import {ComError,HRESULT,IID,ComByRef,COM_MISSING,DisplayNameMoniker} from '../../packages/com-ole/src/com.js';
import {AutomationRegistry,isAutomationObject} from './automation.js';
import {VBError} from '../language/lexer.js';
import {MISSING,VBArray,cloneValue} from './values.js';
const bridges=new WeakMap();
function vbError(error){
  if(!(error instanceof ComError))return error;
  const number=new Map([[HRESULT.DISP_E_MEMBERNOTFOUND,438],[HRESULT.DISP_E_UNKNOWNNAME,438],[HRESULT.DISP_E_BADPARAMCOUNT,450],[HRESULT.DISP_E_PARAMNOTOPTIONAL,449],[HRESULT.DISP_E_TYPEMISMATCH,13],[HRESULT.CO_E_OBJNOTCONNECTED,91],[HRESULT.REGDB_E_CLASSNOTREG,429],[HRESULT.MK_E_UNAVAILABLE,429]]).get(error.hresult)||440;
  const result=new VBError(error.message,number);result.hresult=error.hresult;for(const field of ['source','description','helpFile','helpContext','argErr'])if(Object.hasOwn(error,field))result[field]=error[field];return result;
}
class ComAutomationBridge {
  constructor(session){this.session=session;this.adapters=new Map();this.objects=new WeakMap();this.borrowed=new WeakMap();}
  // Arguments are borrowed interfaces. Keep a distinguishable view so unchanged
  // ByRef cells/array elements cannot consume the session's owning reference.
  borrow(object){
    const state={object,owned:0},view=Object.create(null);
    for(const name of ['QueryInterface','GetTypeInfoCount','GetTypeInfo','GetIDsOfNames','Invoke','Call'])if(typeof object[name]==='function')view[name]=(...args)=>object[name](...args);
    view.AddRef=()=>{const refs=object.AddRef();state.owned++;return refs;};
    view.Release=()=>{if(!state.owned)throw new ComError(HRESULT.E_UNEXPECTED,'Cannot release a borrowed COM argument without AddRef');state.owned--;return object.Release();};
    this.borrowed.set(view,state);return Object.freeze(view);
  }
  input(value,depth=0){
    if(depth>16)throw new VBError('COM argument nesting limit',7);if(value===MISSING)return COM_MISSING;
    if(isAutomationObject(value)){const object=this.objects.get(value);if(!object)throw new VBError('Object belongs to a different Automation provider',13);return this.borrow(object);}
    if(value instanceof VBArray){if(value.data.length>10000||value.bounds.length>8||!['variant','byte','integer','long','single','double','currency','decimal','date','string','boolean','object'].includes(value.type.toLowerCase()))throw new VBError('Unsupported COM array shape or element type',13);const copy=cloneValue(value);copy.data=copy.data.map(v=>this.input(v,depth+1));return copy;}
    return value;
  }
  output(value,depth=0){
    if(depth>16)throw new VBError('COM result nesting limit',7);if(value===COM_MISSING)return MISSING;
    if(value?.QueryInterface&&value?.Release){
      const loan=this.borrowed.get(value);if(loan){if(loan.owned){loan.owned--;value=loan.object;}else value=loan.object.QueryInterface(IID.IDispatch);}
      return this.session.adopt(this.adoptOwned(value));
    }
    if(value instanceof VBArray){if(value.data.length>10000||value.bounds.length>8)throw new VBError('COM result array limit',7);const copy=cloneValue(value);copy.data=copy.data.map(v=>this.output(v,depth+1));return copy;}
    if(Array.isArray(value)){if(value.length>10000)throw new VBError('COM result array limit',7);return VBArray.from(value.map(v=>this.output(v,depth+1)),0);}
    return value;
  }
  /** Consume one owned interface reference, reusing the session proxy for the same IUnknown. */
  adoptOwned(object){
    if(!object||typeof object.QueryInterface!=='function'||typeof object.Release!=='function')throw new VBError('Factory must return an owned COM interface',429);
    let identity,dispatch;
    try{
      identity=object.QueryInterface(IID.IUnknown);const existing=this.adapters.get(identity);if(existing)return existing;
      dispatch=object.QueryInterface(IID.IDispatch);const metadata=dispatch.GetTypeInfo(0),bridge=this;
      const adapter={metadata:{...metadata,members:metadata.members.filter(m=>m.dispid!==-4)},
        invoke(name,mode,args,byRef=[]){
          try{
            const values=args.map((v,i)=>byRef.includes(i)?new ComByRef(bridge.input(v)):bridge.input(v));
            const [id]=dispatch.GetIDsOfNames([name]);const value=dispatch.Invoke(id,mode,{rgvarg:[...values].reverse(),rgdispidNamedArgs:mode===4||mode===8?[-3]:[]});
            return {value:bridge.output(value),args:values.map((v,i)=>byRef.includes(i)?bridge.output(v.value):args[i])};
          }catch(error){throw vbError(error);}
        },
        release(){if(adapter.closed)return;adapter.closed=true;bridge.adapters.delete(identity);dispatch.Release();}
      };
      adapter.invokeScalar=adapter.invoke;
      if(metadata.members.some(m=>m.dispid===-4))adapter.enumerate=()=>{
        let enumerator;const values=[];
        try{enumerator=dispatch.Invoke(-4,2);for(;;){const row=enumerator.Next(1);if(!row.fetched)break;if(values.length>=10000)throw new VBError('COM enumeration limit',7);values.push(bridge.output(row.values[0]));}return values;}
        catch(error){throw vbError(error);}finally{enumerator?.Release();}
      };
      this.adapters.set(identity,adapter);
      try{const proxy=this.session.adopt(adapter);this.objects.set(proxy,dispatch);return adapter;}catch(error){this.adapters.delete(identity);throw error;}
    }catch(error){dispatch?.Release();throw vbError(error);}
    finally{try{identity?.Release();}finally{object.Release();}}
  }
}
function bridge(session){let value=bridges.get(session);if(!value)bridges.set(session,value=new ComAutomationBridge(session));return value;}
export function registerComClass(registry,progId,factory){
  if(!(registry instanceof AutomationRegistry)||typeof factory!=='function')throw TypeError('Expected an AutomationRegistry and an owned COM factory');
  registry.register(progId,async session=>{try{return bridge(session).adoptOwned(await factory());}catch(error){throw vbError(error);}});return registry;
}
/** Grants only the listed class factories and exact ROT monikers to newly created VM sessions. */
export function createComAutomationRegistry({classes=null,progIds=[],runningObjects=null,active=[],monikers=[]}={}){
  if(!Array.isArray(progIds)||progIds.length>256||!Array.isArray(active)||active.length>256||!Array.isArray(monikers)||monikers.length>256)throw TypeError('Invalid COM registration lists');
  const registry=new AutomationRegistry();
  for(const name of progIds)registerComClass(registry,name,()=>classes.CreateInstance(name,IID.IDispatch));
  const resolver=name=>session=>{const moniker=new DisplayNameMoniker(name);try{return bridge(session).adoptOwned(runningObjects.GetObject(moniker));}catch(error){throw vbError(error);}finally{moniker.Release();}};
  for(const item of active)registry.registerActive(item.className,resolver(item.moniker));
  for(const item of monikers)registry.registerMoniker(item.name,resolver(item.moniker??item.name),{className:item.className??null});
  return registry;
}
