/** Early-bound native calls: separate source evaluation order from stdcall slot
 * order, and never expose a literal/read-only snapshot as writable ByRef storage. */
import {coerce, defaultValue} from '../runtime/values.js';
import {nativeParameterBytes} from './numeric.js';
const key=value=>String(value).toLowerCase().replace(/[$%&!#@]$/, '');
const scalarTypes=new Set(['byte','integer','long','boolean','single','double','currency','string']);

/** Pure binding; validates the complete list before emitting any argument code. */
export function planNativeArguments(signature,args,fail=message=>{throw new Error(message);}) {
  const params=signature.params, slots=new Array(params.length), order=[];
  const names=new Map(params.map((p,i)=>[key(p.name),i]));
  let positional=0,named=false;
  for(const argument of args) {
    let index,node=argument;
    if(argument.kind==='named') {
      named=true;index=names.get(key(argument.name));node=argument.expr;
      if(index===undefined)fail('Unknown native named argument: '+argument.name+' in '+signature.name);
    }else {
      if(named)fail('Positional argument cannot follow a named argument: '+signature.name);
      index=positional++;
      if(index>=params.length)fail('Too many native arguments: '+signature.name);
    }
    if(slots[index]!==undefined)fail('Duplicate native argument: '+params[index].name);
    if(!node||node.kind==='missing') {
      if(!params[index].optional)fail('Native argument is not optional: '+params[index].name);
      slots[index]={index,omitted:true};
    }else {const entry={index,node,omitted:false};slots[index]=entry;order.push(entry);}
  }
  params.forEach((p,index)=>{
    if(slots[index]===undefined) {
      if(!p.optional)fail('Missing required native argument: '+p.name+' in '+signature.name);
      slots[index]={index,omitted:true};
    }
  });
  // Omitted defaults have already been bound and checked in declaration scope;
  // they are not expressions that can execute inside the caller's lexical scope.
  return {slots,order:[...order,...slots.filter(s=>s.omitted)]};
}

export const nativeCallMethods={
  prepareNativeParameters(context) {
    const defaults=new Map();let bytes=0;
    for(const p of context.proc.params) {
      if(p.paramArray)this.fail('Native ParamArray requires Variant storage and is not yet lowered',context);
      if(p.optional) {
        if(p.bounds!==null&&p.bounds!==undefined)this.fail('Optional native array parameters are not supported',context);
        if(!scalarTypes.has(key(p.type)))this.fail('Optional native parameters require a supported scalar type: '+p.name,context);
        const bound=context.proc.defaultBindings;
        if(p.initial&&!bound?.has(key(p.name)))this.fail('Unbound native optional default: '+p.name,context);
        try {defaults.set(key(p.name),coerce(p.initial?bound.get(key(p.name)):defaultValue(p.type),p.type));}
        catch(error){this.fail('Invalid native optional default for '+p.name+': '+error.message,context);}
      }
      bytes+=nativeParameterBytes(p);
      if(bytes>65532)this.fail('Native procedure argument area exceeds the x86 stdcall return limit',context);
    }
    context.nativeDefaults=defaults;
  },
  nativeCallPlan(target,args) {
    const signature=target.proc||target;
    const plan=planNativeArguments(signature,args,message=>this.fail(message));
    for(const entry of plan.slots) {
      const p=signature.params[entry.index];
      if(entry.omitted) {
        if(!target.nativeDefaults?.has(key(p.name)))this.fail('Native optional default is unavailable: '+p.name);
        entry.node={kind:'literal',value:target.nativeDefaults.get(key(p.name))};
      }
      if(entry.node.kind==='byval'&&(target.proc||!p.byRef||key(p.type)!=='long'||p.bounds!==null&&p.bounds!==undefined))
        this.fail('Call-site ByVal requires an external scalar Long parameter declared ByRef; use parentheses for a project ByRef value');
    }
    return plan;
  },
  nativeReferenceArgument(parameter,node,omitted=false) {
    const forced=omitted||node.kind==='group',variable=this.variable(node);
    if(!forced&&variable) {
      if(variable.nativeArray&&!variable.elementOf||key(variable.type)!==key(parameter.type))
        this.fail('ByRef native argument must be a scalar of the exact declared type');
      if(variable.fixedLength)this.fail('Fixed-length String ByRef copy-back is not yet lowered; parenthesize to pass an isolated value');
      const pin=this.address(variable);return {pin};
    }
    // Both expression arguments and explicitly parenthesized variables bind to a
    // caller-owned typed temporary. Strings have a zeroed BSTR owner even when a
    // later argument fails or the callee changes the BSTR and raises an error.
    const temporary=key(parameter.type)==='string'?this.temporaryString():
      this.arrayWorkspace(['double','currency'].includes(key(parameter.type))?8:4,'byref-value');
    temporary.type=parameter.type;
    this.storageExpression(temporary,node);this.store(temporary);this.rawStorageAddress(temporary);
    return {temporary};
  }
};
