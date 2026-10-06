import {VBError} from '../language/errors.js';
import {VBScalar,VBArray,VBErrorValue,MISSING,unbox,scalarType,tagScalar,storageScalar,SCALAR_TYPES,scalarUnary,numeric,truth,vbString,bankersRound,coerce} from './values.js';

// These signatures describe VB expression results, not JavaScript implementation
// return types. Host consumers may continue calling the original raw functions.
const RESULTS=Object.freeze({
 cbyte:'byte',cint:'integer',clng:'long',csng:'single',cdbl:'double',ccur:'currency',cdate:'date',cvdate:'date',cstr:'string',cbool:'boolean',cdec:'decimal',cverr:'error',
 vartype:'integer',typename:'string',iserror:'boolean',isarray:'boolean',isempty:'boolean',isnull:'boolean',isnumeric:'boolean',isdate:'boolean',isobject:'boolean',ismissing:'boolean',
 len:'long',lenb:'long',instr:'long',instrrev:'long',strcomp:'integer',asc:'integer',ascw:'integer',sgn:'integer',lbound:'long',ubound:'long',erl:'long',freefile:'integer',lof:'long',loc:'long',seek:'long',eof:'boolean',
 year:'integer',month:'integer',day:'integer',hour:'integer',minute:'integer',second:'integer',weekday:'integer',datepart:'integer',datediff:'long',timer:'single',rnd:'single',
 now:'date',date:'date',time:'date',dateserial:'date',timeserial:'date',datevalue:'date',timevalue:'date',dateadd:'date',
 sqr:'double',exp:'double',log:'double',sin:'double',cos:'double',tan:'double',atn:'double',val:'double',
 fv:'double',pv:'double',pmt:'double',ipmt:'double',ppmt:'double',nper:'double',rate:'double',npv:'double',irr:'double',mirr:'double',sln:'double',syd:'double',ddb:'double',
 msgbox:'integer',doevents:'integer',rgb:'long',qbcolor:'long',filelen:'long',loadresstring:'string'
});
const LENGTHS=Object.freeze({byte:1,integer:2,boolean:2,long:4,single:4,double:8,currency:8,date:8,decimal:16,error:16});
const VARIANT_STRINGS=new Set(['left','right','mid','trim','ltrim','rtrim','ucase','lcase','space','string','chr','chrw','str','hex','oct','format','error']);
const TITLE=Object.freeze({empty:'Empty',null:'Null',integer:'Integer',long:'Long',single:'Single',double:'Double',currency:'Currency',date:'Date',string:'String',boolean:'Boolean',decimal:'Decimal',error:'Error',byte:'Byte'});
export function installScalarLibrary(map,vm){
 for(const [key,original] of map){
  if(typeof original!=='function')continue;
  // Shared implementation aliases (notably CDate/CVDate) have different VB
  // declarations. Never attach per-alias/per-VM metadata to the shared function.
  const fn=Object.assign(function(...args){return original.apply(this,args);},original);
  map.set(key,fn);
  fn.vbScalarInvoke=(args,frame)=>{
   const raw=args.map(unbox),name=key.replace(/\$$/,''),input=args[0];
   if(name==='vartype'&&scalarType(input))return tagScalar(SCALAR_TYPES[scalarType(input)],'integer');
   if(name==='typename'&&scalarType(input))return tagScalar(TITLE[scalarType(input)],'string');
   if(name==='callbyname')return vm.callByName(raw[0],vbString(args[1]),coerce(args[2],'long'),args.slice(3),frame,true).then(value=>storageScalar(value,'Variant'));
   if(name==='cstr'&&unbox(input) instanceof VBErrorValue)return tagScalar(unbox(input).toString(),'string');
   if(['cbyte','cint','clng','csng','cdbl','ccur','cdate','cvdate','cstr','cbool','cdec'].includes(name)){const type=RESULTS[name];if(type==='date'&&unbox(input) instanceof VBErrorValue)throw new VBError('Type mismatch',13);return tagScalar(coerce(name==='cstr'?input:unbox(input) instanceof VBErrorValue?unbox(input).number:input,type),type,name==='cdec'||name==='cvdate');}
   if(name==='cvar')return storageScalar(input,'Variant');
   if(name==='array')return fn(...args);
   if(name==='iif')return storageScalar(truth(input)?args[1]:args[2],'Variant');
   if(name==='choose'){const index=bankersRound(numeric(input));return storageScalar(index>0&&index<args.length?args[index]:null,'Variant');}
   if(name==='switch'){for(let i=0;i<args.length;i+=2)if(truth(args[i]))return storageScalar(args[i+1],'Variant');return tagScalar(null,'null',true);}
   if(name==='len'||name==='lenb'){if(raw[0]===null)return tagScalar(null,'null',true);if(input instanceof VBScalar&&input.variant)return tagScalar(vbString(input).length*(name==='lenb'?2:1),'long',true);if(LENGTHS[scalarType(input)])return tagScalar(LENGTHS[scalarType(input)],'long',true);}
   if(['abs','int','fix','round'].includes(name)){
    if(raw[0]===null)return tagScalar(null,'null',true);
    let type=scalarType(input),variant=input instanceof VBScalar?input.variant:true;
    if(name==='abs'&&numeric(input)<0)return scalarUnary('-',input);
    if(type==='empty'||type==='boolean')type='integer';if(type==='string')type='double';
    const result=fn(...raw);return tagScalar(result,type||scalarType(result),variant);
   }
   const result=fn.vbInvoke?fn.vbInvoke(raw,frame):fn(...raw);
   const wrap=value=>{
    if(value===null||value===undefined||value===MISSING)return value;
    const type=RESULTS[name]||scalarType(value);
    if(!type)return value;
    if(typeof value==='number'&&!Number.isFinite(value))throw new VBError('Overflow',6);
    if(['single','byte','integer','long','double','boolean'].includes(type))value=coerce(value,type);
    return tagScalar(value,type,name==='cdec'||name==='cverr'||VARIANT_STRINGS.has(name)&&!key.endsWith('$'));
   };
   return result&&typeof result.then==='function'?result.then(wrap):wrap(result);
  };
 }
 return map;
}
