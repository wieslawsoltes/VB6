import {nativeStatementTemporary} from './statement-temporaries.js';
/** Owned Automation VARIANT lowering for the native PE32 target.
 * Expression results are pointers to statement-owned 16-byte snapshots. Project
 * calls pass Variant addresses; a ByVal callee copies into its own frame and a
 * Variant function writes to a caller-owned hidden result slot. No frame pointer
 * or borrowed BSTR escapes its owner. See WIN32-VARIANTS.md for the ABI contract.
 */
import {mem8,mem16,mem32} from './x86-operands.js';
import {NATIVE_VARIANT_TYPES} from './variant-types.js';
export {NATIVE_VARIANT_TYPES};
import {nativeVariantArrayMethods} from './variant-arrays.js';
const P='native:variant:',key=v=>String(v).toLowerCase(),at=(r,n=0)=>mem32({base:r,displacement:n});
const binary={'+':'add','-':'subtract','*':'multiply','/':'divide','\\':'idiv',mod:'mod','^':'pow',and:'and',or:'or',xor:'xor',eqv:'eqv',imp:'imp','&':'cat'};
const masks={'<':1,'=':2,'>':4,'<=':3,'>=':6,'<>':5};
const conversions={cbyte:'byte',cint:'integer',clng:'long',csng:'single',cdbl:'double',ccur:'currency',cdate:'date',cbool:'boolean',cstr:'string',cdec:'decimal'};
const predicates={isempty:0,isnull:1,iserror:10};
export const nativeVariantMethods={
  ...nativeVariantArrayMethods,
  useVariant(name='copy') {
    (this.nativeVariantsUsed ||= new Set()).add(name);
    if(name==='condition'||name==='assign')this.nativeVariantsUsed.add('change');
  },
  temporaryVariant() {
    this.useVariant();return nativeStatementTemporary(this.context,'variant',()=>{
    const v=this.arrayWorkspace(16,'variant-temp');v.type='Variant';
    if(this.context?.proc?.name)(this.context.variantTemps ||= []).push(v);
    else (this.globalVariantTemps ||= []).push(v);
    return v;
    });
  },
  clearVariantStorage(v) {this.useVariant();this.rawStorageAddress(v);this.x.push().call(P+'clear');},
  variantSeed(tag,value=0) {
    const x=this.x,v=this.temporaryVariant();this.clearVariantStorage(v);this.zeroStorage(v);this.rawStorageAddress(v);
    x.mov(at('eax'),tag).mov(at('eax',8),value);return v;
  },
  variantType(node) {
    if(this.variantArrayType(node))return 'variant';
    if(node.kind==='nativeVariant'||node.kind==='empty'||node.kind==='literal'&&node.value===null)return 'variant';
    if(node.kind==='binary'&&(binary[key(node.op)]||masks[key(node.op)]!==undefined)&&[this.type(node.left),this.type(node.right)].includes('variant'))return 'variant';
    if(node.kind==='unary'&&['+','-','not'].includes(key(node.op))&&this.type(node.expr)==='variant')return 'variant';
    if(node.kind!=='call'||node.callee.kind!=='id'||this.resolveProcedure(node.callee))return null;
    const name=key(node.callee.name).replace(/\$$/,'');
    if(['cvar','cverr','cdec'].includes(name))return 'variant';
    if(['len','lenb'].includes(name)&&node.args.length===1&&this.type(node.args[0])==='variant')return 'variant';
    if(Object.hasOwn(predicates,name)||['ismissing','isnumeric','isdate','isarray','isobject'].includes(name))return 'boolean';
    if(name==='vartype')return 'integer';if(name==='typename')return 'string';
    if(['abs','fix','int'].includes(name)&&node.args.length===1&&this.type(node.args[0])==='variant')return 'variant';
    return null;
  },
  /** Snapshot a value before evaluating any later operand or actual argument. */
  boxVariant(node) {
    const type=this.type(node),x=this.x;
    const array=this.variable(node);
    if(array?.nativeArray&&!array.elementOf){this.boxNativeArray(array);return;}
    if(type==='variant'){this.expression(node);return;}
    const tag=NATIVE_VARIANT_TYPES[type];if(tag===undefined)this.fail('Native Variant cannot box '+type+' expression');
    this.expression(node);x.push();
    const view=this.arrayWorkspace(16,'variant-view');this.zeroStorage(view);this.rawStorageAddress(view);x.popOperand('edx').mov(at('eax'),tag);
    if(type==='single')x.emit(0xdd,0x02,0xd9,0x58,8); // immutable R8 snapshot -> VT_R4 payload
    else if(['double','currency','date'].includes(type))x.mov('ecx',at('edx')).mov(at('eax',8),'ecx').mov('ecx',at('edx',4)).mov(at('eax',12),'ecx');
    else x.mov(at('eax',8),'edx');
    this.copyVariantPointer();
  },
  copyVariantPointer() {
    const x=this.x,out=this.temporaryVariant();x.push();this.rawStorageAddress(out);x.push().call(P+'copy');
  },
  loadVariant(v) {const pin=this.address(v);this.copyVariantPointer();this.releaseArrayPin(pin);},
  storeVariant(v) {this.useVariant('assign');const x=this.x;x.push();const pin=this.address(v);x.push().call(P+'assign');this.releaseArrayPin(pin);},
  /** EAX contains a Variant pointer; conversion returns the ordinary scalar ABI. */
  unboxVariant(type,explicit=false) {
    const tag=NATIVE_VARIANT_TYPES[type];if(tag===undefined)this.fail('Unsupported native Variant conversion: '+type);
    let done;
    if(type==='string'&&explicit){
      const ordinary=this.x.unique();done=this.x.unique();
      this.x.cmp(mem16({base:'eax'}),10).branch('ne',ordinary).mov('eax',at('eax',8)).compare(0x80020004).branch('e','error:449').push().call('native:string:from-int');this.ownString();
      this.x.push().push(this.string('Error ')).call('native:string:concat');this.ownString();this.x.jump(done).label(ordinary);
    }
    this.useVariant('change');const x=this.x,out=this.temporaryVariant();x.mov('edx','eax').push(explicit?1:0).push(tag).pushOperand('edx');this.rawStorageAddress(out);x.push().call(P+'change');
    if(['double','currency','date'].includes(type)){x.add('eax',8);if(type==='date')x.call('native:date:validate');}
    else if(type==='single'){x.add('eax',8).push();const f=this.floatWorkspace();this.rawStorageAddress(f);x.popOperand('ecx').pushOperand('eax').pushOperand('ecx').call('native:number:load-single');}
    else if(type==='decimal'){/* VT_DECIMAL overlays the complete VARIANT; retain ownership. */}
    // https://learn.microsoft.com/windows/win32/api/oaidl/ns-oaidl-variant
    // Only bVal is defined for VT_UI1. OleAut32 may leave/copy arbitrary
    // adjacent union padding; a DWORD load fabricates a value above 255.
    else if(type==='byte')x.movzx('eax',mem8({base:'eax',displacement:8}));
    else if(['integer','boolean'].includes(type))x.movsx('eax',mem16({base:'eax',displacement:8}));
    else x.mov('eax',at('eax',8));
    if(done)x.label(done);
  },
  variantOperation(node) {
    const x=this.x;
    if(node.kind==='nativeVariant'){this.variantSeed(node.tag,node.value||0);return true;}
    if(node.kind==='empty'||node.kind==='literal'&&node.value===null){this.variantSeed(node.kind==='empty'?0:1);return true;}
    if(node.kind==='unary'&&this.type(node)==='variant'){
      this.boxVariant(node.expr);if(node.op==='+')return true;
      const op=key(node.op)==='not'?'not':'negate';this.useVariant(op);x.push();const out=this.temporaryVariant();this.rawStorageAddress(out);x.push().call(P+op);return true;
    }
    if(node.kind!=='binary'||this.type(node)!=='variant')return false;
    const op=key(node.op),helper=binary[op]||'compare',out=this.temporaryVariant();
    this.boxVariant(node.left);x.push();this.boxVariant(node.right);x.mov('edx','eax').popOperand('ecx');this.useVariant(helper);
    if(helper==='compare')x.push(this.context?.module.module.optionCompare==='text'?1:0).push(masks[op]);
    x.pushOperand('edx').pushOperand('ecx');this.rawStorageAddress(out);x.push().call(P+helper);return true;
  },
  variantBuiltin(node,name) {
    if(this.variantArrayBuiltin(node,name))return true;
    if(!name||this.resolveProcedure(node.callee))return false;
    // Inspect RichEdit's mixed-format mask before a scalar or Variant coercion.
    if(this.nativeRichFormatNull(node,name))return true;
    const x=this.x,args=node.args;
    const one=()=>{if(args.length!==1||['missing','named'].includes(args[0]?.kind))this.fail(name+' expects one positional argument');};
    if(['len','lenb'].includes(name)&&args.length===1&&this.type(args[0])==='variant'){
      // Variant Len is the displayed String length, not the VARIANT storage
      // width. Null propagates rather than raising an implicit conversion error.
      // https://learn.microsoft.com/office/vba/language/reference/user-interface-help/len-function
      one();this.boxVariant(args[0]);const nil=x.unique(),done=x.unique();
      x.cmp(mem16({base:'eax'}),1).branch('e',nil);this.unboxVariant('string');
      x.push().invoke('oleaut32.dll','SysStringLen');if(name==='lenb')x.shift('shl','eax',1);
      x.push();this.variantSeed(3);x.popOperand('edx').mov(at('eax',8),'edx').jump(done);
      x.label(nil);this.variantSeed(1);x.label(done);return true;
    }
    if(name==='cvar'){one();this.boxVariant(args[0]);return true;}
    if(name==='cverr'){
      one();this.numeric(args[0]);x.compare(0).branch('l','error:5').compare(65535).branch('g','error:5').push();
      this.variantSeed(10);x.popOperand('edx').mov(at('eax',8),'edx');return true;
    }
    if(name==='cdec'||conversions[name]&&args.length===1&&this.type(args[0])==='variant'){
      one();this.boxVariant(args[0]);this.unboxVariant(conversions[name],true);return true;
    }
    if(['abs','fix','int'].includes(name)&&args.length===1&&this.type(args[0])==='variant'){
      this.boxVariant(args[0]);x.push();this.useVariant(name);const out=this.temporaryVariant();this.rawStorageAddress(out);x.push().call(P+name);return true;
    }
    if(Object.hasOwn(predicates,name)||['ismissing','isnumeric','isdate','isarray','isobject','vartype','typename'].includes(name)){
      one();const v=this.variable(args[0]);
      if(v?.nativeArray&&!v.elementOf){
        if(name==='vartype'){x.value(8192+NATIVE_VARIANT_TYPES[key(v.type)]);return true;}
        if(name==='typename'){x.value(this.string(v.type+'()'));return true;}
        if(name==='isarray'){x.value(-1);return true;}
        if(name==='ismissing'&&v.paramArray){x.value(0);return true;}
        this.fail(name+' does not accept a whole typed native array');
      }
      this.boxVariant(args[0]);
      if(name==='vartype'){x.movzx('eax',mem16({base:'eax'}));return true;}
      if(name==='typename'){
        const done=x.unique();x.movzx('edx',mem16({base:'eax'}));
        for(const [tag,text]of [[0,'Empty'],[1,'Null'],[2,'Integer'],[3,'Long'],[4,'Single'],[5,'Double'],[6,'Currency'],[7,'Date'],[8,'String'],[9,'Object'],[10,'Error'],[11,'Boolean'],[14,'Decimal'],[17,'Byte'],...[['Integer',2],['Long',3],['Single',4],['Double',5],['Currency',6],['Date',7],['String',8],['Boolean',11],['Variant',12],['Byte',17]].map(([n,t])=>[8192+t,n+'()'])]){
          const next=x.unique();x.cmp('edx',tag).branch('ne',next).value(this.string(text)).jump(done).label(next);
        }
        x.value(this.string('Unknown')).label(done);return true;
      }
      if(Object.hasOwn(predicates,name)){x.cmp(mem16({base:'eax'}),predicates[name]).setcc('e','al').movzx('eax','al').neg('eax');return true;}
      if(name==='ismissing'){
        const no=x.unique(),done=x.unique();x.cmp(mem16({base:'eax'}),10).branch('ne',no).cmp(at('eax',8),0x80020004).setcc('e','al').movzx('eax','al').neg('eax').jump(done).label(no).value(0).label(done);return true;
      }
      if(name==='isarray'){x.testOperand(mem16({base:'eax'}),8192).setcc('ne','al').movzx('eax','al').neg('eax');return true;}
      if(name==='isobject'){
        const yes=x.unique(),done=x.unique();x.cmp(mem16({base:'eax'}),9).branch('e',yes).cmp(mem16({base:'eax'}),13).branch('e',yes).value(0).jump(done).label(yes).value(-1).label(done);return true;
      }
      // Predicates must not raise/coerce the caller's Err state. Use a distinct
      // owned output, test HRESULT directly, then release it at the checkpoint.
      const no=x.unique(),done=x.unique(),out=this.temporaryVariant();
      x.cmp(mem16({base:'eax'}),1).branch('e',no).cmp(mem16({base:'eax'}),10).branch('e',no);
      if(name==='isnumeric')x.cmp(mem16({base:'eax'}),7).branch('e',no);
      x.mov('edx','eax').push(name==='isdate'?7:5).push(2).push(0x400).pushOperand('edx');this.rawStorageAddress(out);x.push().invoke('oleaut32.dll','VariantChangeTypeEx').test().setcc('ns','al').movzx('eax','al').neg('eax').jump(done).label(no).value(0).label(done);return true;
    }
    return false;
  }
};
