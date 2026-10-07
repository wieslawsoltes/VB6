/** VB-aware front-end to the native optimizer. Checked arithmetic stays checked. */
import {foldNativeInteger} from './optimizer.js';
import {propagateNativeConstants} from './dataflow.js';
const integerTypes=new Set(['byte','integer','long','boolean']);
const conditions={'=':['e','ne'],'<>':['ne','e'],'<':['l','ge'],'<=':['le','g'],'>':['g','le'],'>=':['ge','l']};
export const nativeOptimizationMethods={
  optimizedNativeProcedure(context) {
    if(this.optimization<2)return context.proc.code;
    const result=propagateNativeConstants(context.proc.code,context.locals,node=>this.nativeConstant(node));
    this.optimizationStats.constantsPropagated+=result.stats.constantsPropagated;return result.code;
  },
  optimizedNativeBranch(node,target,whenTrue=false) {
    if(this.optimization<2)return false;
    const resolve=node=>this.nativeConstant(node),folded=foldNativeInteger(node,resolve);
    if(folded){if((folded.value!==0)===whenTrue)this.x.jump(target);this.optimizationStats.constantBranches++;return true;}
    while(node.kind==='group')node=node.expr;
    // Not is bitwise in VB; inversion is valid only for an actual Boolean comparison.
    if(node.kind==='unary'&&String(node.op).toLowerCase()==='not'){
      let inner=node.expr;while(inner.kind==='group')inner=inner.expr;
      if(inner.kind!=='binary'||!Object.hasOwn(conditions,inner.op))return false;
      node=inner;whenTrue=!whenTrue;
    }
    if(node.kind!=='binary'||!Object.hasOwn(conditions,node.op)||!integerTypes.has(this.type(node.left))||!integerTypes.has(this.type(node.right)))return false;
    const right=foldNativeInteger(node.right,resolve),x=this.x;
    this.numeric(node.left);
    if(right)x.cmp('eax',right.value);
    else{x.push();this.numeric(node.right);x.emit(0x89,0xc1,0x58).cmp('eax','ecx');}
    x.branch(conditions[node.op][whenTrue?0:1],target);this.optimizationStats.directBranches++;return true;
  },
  optimizedIntegerExpression(node) {
    if(this.optimization<2||!['binary','unary'].includes(node.kind)||!integerTypes.has(this.type(node)))return false;
    const resolve=node=>this.nativeConstant(node),folded=foldNativeInteger(node,resolve);
    if(folded){this.x.value(folded.value);this.optimizationStats.constantsFolded++;return true;}
    if(node.kind!=='binary'||!integerTypes.has(this.type(node.left))||!integerTypes.has(this.type(node.right)))return false;
    const right=foldNativeInteger(node.right,resolve),op=String(node.op).toLowerCase();
    if(!right||!['+','-','*','and','or','xor','=','<>','<','<=','>','>='].includes(op))return false;
    this.numeric(node.left);
    const x=this.x,operation={'+':'add','-':'sub','*':'imul','and':'and','or':'or','xor':'xor'}[op];
    if(operation){if(operation==='imul')x.imul('eax','eax',right.value);else x[operation]('eax',right.value);if(['+','-','*'].includes(op))x.branch('o','error:6');const type=this.type(node);if(type==='byte'||type==='integer')this.check(type);}
    else{x.cmp('eax',right.value);this.boolean(op);}
    this.optimizationStats.immediateOperations++;return true;
  }
};
