/** Native intra-procedure control flow. GoSub uses a bounded per-activation
 * return stack separate from ESP, so error unwinding cannot corrupt returns. */
import {mem32} from './x86-operands.js';
const slot=v=>mem32({base:'ebp',displacement:v.offset});
const memory=slot;
export function nativeGoSubLimit(value=1024) {
  if(!Number.isInteger(value)||value<1||value>65536)throw new Error('maxGoSubDepth must be an integer from 1 to 65536');
  return value;
}
export const nativeFlowMethods={
  prepareNativeFlow(context) {
    context.withBindings=[];
    if(context.proc.code.some(ins=>ins.op==='gosub'||ins.op==='gosubReturn'||ins.op==='computedJump'&&ins.gosub)){
      const depth=this.arrayWorkspace(4,'gosub-depth'),returns=this.arrayWorkspace(this.maxGoSubDepth*4,'gosub-returns');
      context.locals.set(depth.name,depth); // Zero the depth at procedure entry, not every GoSub.
      context.nativeGoSub={depth,returns,limit:this.maxGoSubDepth};
    }
  },
  pushNativeGoSub(context,returnLabel) {
    const {depth,returns,limit}=context.nativeGoSub,x=this.x;
    x.mov('ecx',slot(depth)).cmp('ecx',limit).branch('ae','error:28');
    x.value(returnLabel).mov(mem32({base:'ebp',index:'ecx',scale:4,displacement:returns.offset}),'eax');
    x.add('ecx',1).mov(slot(depth),'ecx'); // EDX is preserved for computed dispatch.
  },
  withGuard(active) {
    if(active)this.x.cmp(memory(active),0).branch('e','error:91');
  },
  nativeWithBinding() {
    const binding=this.context?.withBindings?.at(-1);
    if(!binding)this.fail('Native With member requires an enclosing With block');
    return binding;
  },
  nativeFlowInstruction(ins,context,index) {
    const x=this.x,next=context.label+':'+(index+1);
    if(ins.op==='branch'){
      if(!this.optimizedNativeBranch(ins.test,context.label+':'+ins.target,!!ins.invert)){
        this.truth(ins.test);x.test().branch(ins.invert?'ne':'e',context.label+':'+ins.target);
      }
      return true;
    }
    if(ins.op==='gosub'){
      this.pushNativeGoSub(context,next);x.jump(context.label+':'+ins.target);return true;
    }
    if(ins.op==='gosubReturn'){
      const {depth,returns}=context.nativeGoSub;
      x.mov('ecx',slot(depth)).testOperand('ecx','ecx').branch('e','error:3');
      x.sub('ecx',1).mov(slot(depth),'ecx').jumpIndirect(mem32({base:'ebp',index:'ecx',scale:4,displacement:returns.offset}));
      return true;
    }
    if(ins.op==='computedJump'){
      this.numeric(ins.expr);
      x.compare(0).branch('l','error:5').compare(255).branch('g','error:5');
      x.test().branch('e',next).compare(Math.min(ins.targets.length,255)).branch('g',next);
      if(ins.gosub){x.mov('edx','eax');this.pushNativeGoSub(context,next);x.mov('eax','edx');}
      if(this.optimization===2){
        const table=x.unique('computed-jump');this.ro.align(4).label(table);
        for(const target of ins.targets.slice(0,255))this.ro.reference(context.label+':'+target);
        x.jumpIndirect(mem32({index:'eax',scale:4,label:table,displacement:-4}));
        this.optimizationStats.jumpTables++;
      }else for(let i=0;i<Math.min(ins.targets.length,255);i++)x.compare(i+1).branch('e',context.label+':'+ins.targets[i]);
      return true;
    }
    if(ins.op==='withPush'){
      const active=this.arrayWorkspace(4,'with-active');context.locals.set(active.name,active);
      const record=this.variable(ins.expr);let binding;
      if(record?.nativeRecord&&!record.recordFieldArray){
        const slot=this.arrayWorkspace(4,'with-record');context.locals.set(slot.name,slot);
        this.address(record);x.mov(memory(slot),'eax');
        binding={active,record:{name:slot.name,type:record.type,nativeRecord:record.nativeRecord,offset:slot.offset,parameter:true,byRef:true,nativeWithActive:active}};
      }else{
        const object=this.object(ins.expr);
        if(!object||object.controlArray)this.fail('Native With requires an addressable POD record, form or indexed/scalar intrinsic control');
        this.ensure(object);
        // An indexed control is resolved now, not again at every member access.
        binding={active,object:{...object,...(object.indexed?{indexed:false,boundIndex:true}:{}),nativeWithActive:active}};
      }
      x.mov(memory(active),-1);context.withBindings.push(binding);return true;
    }
    if(ins.op==='withPop'){
      const binding=context.withBindings.pop();if(!binding)this.fail('Unbalanced native With block');x.mov(memory(binding.active),0);return true;
    }
    if(ins.op==='withUnwind'){
      if(!Number.isInteger(ins.count)||ins.count<0||ins.count>context.withBindings.length)this.fail('Invalid native With unwind');
      // A runtime early exit must not pop the compiler's lexical binding stack.
      for(const binding of ins.count?context.withBindings.slice(-ins.count):[])x.mov(memory(binding.active),0);
      return true;
    }
    return false;
  }
};
