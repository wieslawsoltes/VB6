/** Fixed-width VB scalar integers. Register width is not expression type.
 * Untagged synthetic nodes retain Long semantics; authored literal metadata,
 * Byte/Integer operands and explicit type characters keep their VB widths.
 */
export const NATIVE_INTEGER_TYPES=new Set(['byte','integer','long','boolean']);
const limits={byte:[0,255],integer:[-32768,32767],long:[-2147483648,2147483647],boolean:[-1,0]};
const bitwise=new Set(['and','or','xor','eqv','imp']);
const comparisons=new Set(['=','<>','<','<=','>','>=']);
export function nativeIntegerFits(value,type='long') {
  const range=limits[type];return !!range&&Number.isInteger(value)&&value>=range[0]&&value<=range[1];
}
export function nativeIntegerLiteral(node) {
  if(node?.kind!=='literal')return null;
  const value=typeof node.value==='boolean'?(node.value?-1:0):node.value;
  const type=node.valueType||(typeof node.value==='boolean'?'boolean':'long');
  return NATIVE_INTEGER_TYPES.has(type)&&typeof value==='number'?{value,type}:null;
}
export function nativeSignedIntegerLiteral(node) {
  if(node?.kind!=='unary'||node.op!=='-'||node.expr?.kind!=='literal'||typeof node.expr.value!=='number'||node.expr.valueType==='boolean')return null;
  const n=node.expr,value=-n.value;
  let type=n.valueType||'long';
  if(n.numberSuffix===null&&n.valueType){
    if(type==='long'&&nativeIntegerFits(value,'integer'))type='integer';
    if(type==='double'&&value===-2147483648)type='long';
  }
  return NATIVE_INTEGER_TYPES.has(type)&&nativeIntegerFits(value,type)?{value,type}:null;
}
export function nativeIntegerUnaryType(op,type) {
  if(!NATIVE_INTEGER_TYPES.has(type))return null;
  return op==='not'?type:['+','-'].includes(op)?(['byte','boolean'].includes(type)?'integer':type):null;
}
export function nativeIntegerBinaryType(op,a,b) {
  if(!NATIVE_INTEGER_TYPES.has(a)||!NATIVE_INTEGER_TYPES.has(b))return null;
  if(comparisons.has(op))return 'boolean';
  if(!['+','-','*','\\','mod'].includes(op)&&!bitwise.has(op))return null;
  if(bitwise.has(op)&&a==='boolean'&&b==='boolean')return 'boolean';
  if(a==='long'||b==='long')return 'long';
  return a==='byte'&&b==='byte'?'byte':'integer';
}
export const nativeIntegerMethods={
  integerType(node) {
    const signed=nativeSignedIntegerLiteral(node);if(signed)return signed.type;
    const literal=nativeIntegerLiteral(node);if(literal)return literal.type;
    if(node.kind==='unary')return nativeIntegerUnaryType(String(node.op).toLowerCase(),this.type(node.expr));
    if(node.kind==='binary')return nativeIntegerBinaryType(String(node.op).toLowerCase(),this.type(node.left),this.type(node.right));
    return null;
  },
  emitIntegerDivision(op) {
    const x=this.x,safe=x.unique(),done=x.unique();
    x.testOperand('ecx','ecx').branch('e','error:11').compare(-2147483648).branch('ne',safe).cmp('ecx',-1).branch('ne',safe);
    if(op==='mod')x.mov('eax',0).jump(done);else x.jump('error:6');
    x.label(safe).cdq().idiv('ecx');if(op==='mod')x.mov('eax','edx');x.label(done);
  },
  integerExpression(node) {
    const x=this.x,signed=nativeSignedIntegerLiteral(node),literal=nativeIntegerLiteral(node);
    if(signed){x.value(signed.value);return true;}
    if(literal){
      // Type suffix overflow is an expression error, not permission to widen it.
      if(!nativeIntegerFits(literal.value,literal.type))x.jump('error:6');else x.value(literal.value);
      return true;
    }
    const op=String(node.op).toLowerCase(),type=this.integerType(node);
    if(!type)return false;
    if(this.optimizedIntegerExpression(node))return true;
    if(node.kind==='unary'){
      this.numeric(node.expr);
      if(op==='-')x.neg('eax').branch('o','error:6');
      else if(op==='not'){x.not('eax');if(type==='byte')x.and('eax',255);}
    }else if(node.kind==='binary'){
      this.numeric(node.left);x.push();this.numeric(node.right);x.mov('ecx','eax').popOperand('eax');
      if(op==='+')x.add('eax','ecx').branch('o','error:6');
      else if(op==='-')x.sub('eax','ecx').branch('o','error:6');
      else if(op==='*')x.imul('eax','ecx').branch('o','error:6');
      else if(op==='\\'||op==='mod'){
        this.emitIntegerDivision(op);
      }else if(['and','or','xor'].includes(op))x[op]('eax','ecx');
      else if(op==='eqv'){x.xor('eax','ecx').not('eax');if(type==='byte')x.and('eax',255);}
      else if(op==='imp'){x.not('eax').or('eax','ecx');if(type==='byte')x.and('eax',255);}
      else if(comparisons.has(op)){x.cmp('eax','ecx');this.boolean(op);return true;}
      else return false;
    }else return false;
    if(type==='byte'||type==='integer')this.check(type);
    return true;
  }
};
