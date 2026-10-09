/** Rich Err metadata has independent process-owned BSTRs. Argument values are
 * staged in the caller before publishing, so nested calls/ByRef mutations cannot
 * replace an earlier value or leave a pointer into a completed statement frame.
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/raise-method
 */
import {planNativeArguments} from './call-plan.js';
import {mem32} from './x86-operands.js';
const E='native:error:',arg=argument=>({argument}),mem=memory=>({memory});
const slot=v=>mem32({base:'ebp',displacement:v.offset});
export const NATIVE_ERROR_TEXT_FIELDS=Object.freeze(['description','source','helpfile']);
export const NATIVE_ERROR_NUMBER_FIELDS=Object.freeze(['number','helpcontext','lastdllerror']);
const names=['number','source','description','helpfile','helpcontext'];
function save(c,name){const value=c.arrayWorkspace(4,name);c.x.mov(slot(value),'eax');return value;}
// Avoid boxing already typed scalars: merely containing an unreachable
// Err.Raise must not make every statement allocate and clear VARIANT owners.
// Text-to-number and non-text-to-String still use Automation coercion.
function argument(c,node,type){
 const actual=c.type(node);
 if(type==='long'&&['byte','integer','long','boolean','single','double','currency','date'].includes(actual))c.numeric(node);
 else if(type==='string'&&actual==='string')c.expression(node);
 else{c.boxVariant(node);c.unboxVariant(type);}
}
function publish(c,name,owner){
 const x=c.x;
 x.api('oleaut32.dll','SysFreeString',[mem(E+name+'-owner')]);
 x.value(arg(owner.offset)).store(E+name+'-owner').store(E+name).mov(slot(owner),0);
}
export const nativeErrorArgumentMethods={
 nativeRaiseCall(node){
  const x=this.x,plan=planNativeArguments({name:'Err.Raise',params:names.map((name,index)=>({name,optional:index!==0}))},node.args,m=>this.fail(m));
  // Compiler-private kernels retain their caller's source/line and avoid rich
  // argument scaffolding for the ordinary one-number internal error operation.
  if(this.context?.module.nativeInternal&&node.args.length===1&&node.args[0].kind!=='named'){
   this.numeric(node.args[0]);x.jump(E+'raise');return;
  }
  const slots=[];
  for(const entry of plan.order){
   if(entry.omitted)continue;
   argument(this,entry.node,entry.index===0||entry.index===4?'long':'string');
   slots[entry.index]=save(this,'error-argument');
  }
  x.value(arg(slots[0].offset)).call(E+'validate-number');
  const owners={};
  for(const name of NATIVE_ERROR_TEXT_FIELDS){
   const index=names.indexOf(name),ready=x.unique();
   if(slots[index])x.value(arg(slots[index].offset));
   else{
    x.value(mem(E+name)).test().branch('ne',ready);
    if(name==='description')x.value(arg(slots[0].offset)).call(E+'description-for');
    else x.value(name==='source'?this.string(this.project.name):0);
    x.label(ready);
   }
   x.push().call('native:string:copy');owners[name]=this.ownString();
  }
  // No allocating operation follows publication. Clear/ordinary run-time errors
  // release these owners separately from caller-local expression snapshots.
  for(const name of NATIVE_ERROR_TEXT_FIELDS)publish(this,name,owners[name]);
  x.value(slots[4]?arg(slots[4].offset):mem(E+'helpcontext')).store(E+'helpcontext');
  x.value(arg(slots[0].offset)).store(E+'number').value(0).store(E+'erl');
  const noFrame=x.unique();x.value(mem(E+'frame')).test().branch('e',noFrame).mov('eax',mem32({base:'eax',displacement:-44})).store(E+'erl').label(noFrame).jump(E+'dispatch');
 },
 nativeErrorAssignment(property,expr){
  if(property==='lastdllerror')this.fail('Native Err.LastDllError is read-only');
  argument(this,expr,NATIVE_ERROR_TEXT_FIELDS.includes(property)?'string':'long');
  const x=this.x;
  if(NATIVE_ERROR_TEXT_FIELDS.includes(property)){
   x.push().call('native:string:copy');publish(this,property,this.ownString());
  }else{
   if(property==='number'){const zero=x.unique();x.test().branch('e',zero).call(E+'validate-number').label(zero);}
   x.store(E+property);
  }
 }
};
