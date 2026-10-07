/** Native POD records for 32-bit VB/Win32 ABI. Managed fields and SAFEARRAY(VT_RECORD)
 * are rejected: a byte copy must never masquerade as COM record ownership.
 * Fields use natural scalar widths with a maximum four-byte alignment.
 */
import {foldNativeInteger} from './optimizer.js';
const key=v=>String(v).toLowerCase();
const align=(n,a)=>Math.ceil(n/a)*a;
const scalarBytes={byte:1,integer:2,boolean:2,long:4,single:4,double:8,currency:8,date:8};
const LIMIT=512*1024;
function fail(message){throw new Error(message);}
export class NativeRecordLayouts {
  constructor(program, reject=fail) {
    this.reject=reject;this.definitions=new Map();this.layouts=new Map();this.active=new Set();
    for(const module of program.modules.values())for(const [name,fields]of Object.entries(module.types)) {
      const header=module.source.split(/\r?\n/).find(line=>new RegExp('^\\s*(?:(?:Public|Private)\\s+)?Type\\s+'+name+'(?:\\s|$)','i').test(line));
      const definition={id:key(module.name)+'.'+key(name),name,module,fields,private:/^\s*Private\b/i.test(header||'')};
      this.definitions.set(definition.id,definition);
    }
  }
  resolve(name,module) {
    const type=key(name),local=this.definitions.get(key(module.name)+'.'+type);
    if(local)return this.layout(local);
    const qualified=this.definitions.get(type);
    if(qualified){if(qualified.private&&qualified.module!==module)this.reject('Private native record is not accessible: '+name);return this.layout(qualified);}
    const candidates=[...this.definitions.values()].filter(d=>key(d.name)===type&&!d.private&&d.module.kind==='module');
    if(candidates.length>1)this.reject('Ambiguous native record type: '+name);
    return candidates.length?this.layout(candidates[0]):null;
  }
  bound(node,module) {
    if(node===null)return module.optionBase||0;
    const value=foldNativeInteger(node,n=>{
      if(n.kind!=='id')return null;
      for(const map of [module.constantBindings,module.importedConstantBindings,module.globalEnumMembers])if(map?.has(key(n.name)))return {type:'long',value:map.get(key(n.name))};
      return null;
    });
    if(!value)this.reject('Native record array bounds require signed integral constants');
    return value.value;
  }
  layout(definition) {
    if(this.layouts.has(definition.id))return this.layouts.get(definition.id);
    if(this.active.has(definition.id))this.reject('Recursive native record layout: '+definition.name);
    this.active.add(definition.id);
    try {
      let size=0,fileSize=0,alignment=1;const fields=new Map();
      for(const field of definition.fields) {
        if(fields.has(key(field.name)))this.reject('Duplicate native record field: '+field.name);
        const type=key(field.storageType||field.type),bytes=Object.hasOwn(scalarBytes,type)?scalarBytes[type]:0;
        const nested=bytes?null:this.resolve(field.type,definition.module);
        if(!bytes&&!nested||field.autoNew||field.withEvents||field.fixedLength!=null)this.reject('Native POD records do not support managed or fixed String fields: '+field.name+' As '+field.type);
        const elementBytes=bytes||nested.size,fieldAlignment=bytes?Math.min(bytes,4):nested.alignment;
        let count=1;const bounds=[];
        if(field.bounds!=null){
          if(!field.bounds.length||field.bounds.length>60)this.reject('Native record fields require fixed-size arrays of at most 60 dimensions');
          for(const [low,high]of field.bounds){const lower=this.bound(low,definition.module),upper=this.bound(high,definition.module),stride=count*elementBytes;
            if(upper<lower)this.reject('Invalid native record array bounds: '+field.name);
            count*=upper-lower+1;if(!Number.isSafeInteger(count)||count*elementBytes>LIMIT)this.reject('Native record exceeds 512 KiB');bounds.push({lower,upper,stride});}
        }
        size=align(size,fieldAlignment);alignment=Math.max(alignment,fieldAlignment);
        fields.set(key(field.name),{...field,type:field.storageType||field.type,nativeRecord:nested,recordOffset:size,inlineBounds:bounds,recordFieldArray:bounds.length>0,nativeElementBytes:elementBytes,nativeCount:count,nativeBytes:elementBytes*count});
        size+=elementBytes*count;fileSize+=(bytes||nested.fileSize)*count;
        if(size>LIMIT)this.reject('Native record exceeds 512 KiB');
      }
      if(!fields.size)this.reject('Native record must have at least one field: '+definition.name);
      const result={id:definition.id,name:definition.name,size:align(size,alignment),fileSize,alignment,fields};
      this.layouts.set(definition.id,result);return result;
    } finally {this.active.delete(definition.id);}
  }
}

export const nativeRecordMethods={
  recordStorage(decl,module) {
    const layout=this.recordLayouts.resolve(decl.type,module);
    if(!layout)return null;
    if(decl.bounds!=null)this.fail('Native arrays of records require SAFEARRAY record ownership and are not yet lowered',module);
    if(decl.autoNew||decl.withEvents)this.fail('Native POD records cannot use New or WithEvents',module);
    if(decl.parameter&&!decl.byRef)this.fail('Native record parameters must be ByRef',module);
    return Object.assign(decl,{nativeRecord:layout,nativeElementBytes:layout.size,nativeBytes:align(layout.size,4),nativeCount:1});
  },
  recordMember(node,context) {
    if(node.kind==='member'){
      const parent=this.variable(node.object,context);
      if(!parent?.nativeRecord)return null;
      if(parent.recordFieldArray)this.fail('Native record array field requires indices');
      const field=parent.nativeRecord.fields.get(key(node.name));
      if(!field)this.fail('Unknown native record field: '+node.name);
      return {...field,recordOf:parent};
    }
    if(node.kind==='call'){
      const array=this.variable(node.callee,context);
      if(!array?.recordFieldArray)return null;
      if(node.args.length!==array.inlineBounds.length)this.fail('Native record field array rank mismatch');
      return {...array,recordFieldArray:false,recordIndices:node.args,nativeCount:1,nativeBytes:array.nativeElementBytes};
    }
    return null;
  },
  recordAddress(variable) {
    const x=this.x;this.address(variable.recordOf);
    if(variable.recordOffset)x.add('eax',variable.recordOffset);
    if(variable.recordIndices){
      x.push();
      variable.recordIndices.forEach((node,i)=>{
        const bound=variable.inlineBounds[i];this.numeric(node);
        x.compare(bound.lower).branch('l','error:9').compare(bound.upper).branch('g','error:9');
        if(bound.lower)x.sub('eax',bound.lower);
        if(bound.stride!==1)x.imul('eax','eax',bound.stride);
        x.emit(0x01,0x04,0x24); // add [esp],eax; checked layout bounds prove no offset overflow.
      });x.emit(0x58);
    }
    return null;
  },
  copyRecordTo(variable) {
    // EAX is the immutable source snapshot. The destination can evaluate indices.
    const x=this.x;x.push();this.address(variable);x.emit(0x89,0xc7,0x5e).mov('ecx',variable.nativeRecord.size).cld().repMove(8);
  },
  recordExpression(variable,node) {
    const source=this.variable(node);
    if(!source?.nativeRecord||source.nativeRecord.id!==variable.nativeRecord.id||source.recordFieldArray)this.fail('Native record assignment requires the exact declared record type');
    // Materialize before evaluating the destination, like scalar expression values.
    const temp=this.arrayWorkspace(align(variable.nativeRecord.size,4),'record-snapshot');temp.nativeRecord=variable.nativeRecord;
    this.address(source);this.copyRecordTo(temp);this.rawStorageAddress(temp);
  },
  recordReferenceArgument(parameter,node,forced) {
    const variable=this.variable(node);
    if(!variable?.nativeRecord||variable.nativeRecord.id!==parameter.nativeRecord.id||variable.recordFieldArray)this.fail('ByRef native record argument requires the exact declared record type');
    if(!forced){this.address(variable);return {};}
    const temporary=this.arrayWorkspace(align(variable.nativeRecord.size,4),'byref-record');Object.assign(temporary,{type:parameter.type,nativeRecord:variable.nativeRecord});
    this.address(variable);this.copyRecordTo(temporary);this.rawStorageAddress(temporary);return {temporary};
  },
  anyReferenceArgument(node) {
    const variable=this.variable(node);
    if(!variable||node.kind==='group'||variable.recordFieldArray||variable.nativeArray&&!variable.elementOf||key(variable.type)==='string')this.fail('Declare As Any requires addressable numeric/record storage or explicit ByVal pointer; use typed String marshaling for text');
    return {pin:this.address(variable)};
  },
  recordBuiltin(node,name) {
    if(!['len','lenb','varptr'].includes(name))return false;
    if(node.args.length!==1)this.fail(name+' expects one argument');
    const variable=this.variable(node.args[0]);
    if(name==='varptr'){
      if(!variable||variable.recordFieldArray||variable.nativeArray&&!variable.elementOf)this.fail('VarPtr requires an addressable scalar, record or indexed element');
      this.address(variable);return true; // Array pins live through statement cleanup.
    }
    if(!variable||key(variable.type)==='string')return false;
    if(variable.nativeArray||variable.recordFieldArray)this.fail(name+' requires a scalar or record, not a whole array');
    const size=variable.nativeRecord?(name==='lenb'?variable.nativeRecord.size:variable.nativeRecord.fileSize):scalarBytes[key(variable.type)];
    if(!size)return false;
    if(variable.recordOf||variable.elementOf||variable.nativeWithActive||variable.owner?.form){const pin=this.address(variable);this.releaseArrayPin(pin);}
    this.x.value(size);return true;
  }
};
