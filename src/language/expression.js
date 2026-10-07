import { tokenize, VBError } from './lexer.js';
const PRECEDENCE = Object.freeze({imp:1,eqv:2,xor:3,or:4,and:5,'=':7,'<>':7,'<':7,'>':7,'<=':7,'>=':7,is:7,like:7,'&':8,'+':9,'-':9,mod:10,'\\':11,'*':12,'/':12,'^':14});
export const MAX_EXPRESSION_NESTING = 256;
export const MAX_EXPRESSION_NODES = 100000;

/** Iterative validation also bounds left-associated operators and postfix chains,
 * which consume little parser recursion but otherwise overflow recursive users.
 * Only large token streams take this path; ordinary expressions need no walk. */
function checkExpressionTree(root,column) {
  const stack=[root,1];let count=0;
  while(stack.length){
    const depth=stack.pop(),node=stack.pop();
    if(depth>MAX_EXPRESSION_NESTING)throw new VBError('Expression tree depth limit exceeded',1002,null,0,column);
    if(++count>MAX_EXPRESSION_NODES)throw new VBError('Expression node count limit exceeded',1002,null,0,column);
    const child=value=>stack.push(value,depth+1);
    switch(node.kind){
      case 'binary':child(node.left);child(node.right);break;
      case 'member':child(node.object);break;
      case 'call':child(node.callee);for(const arg of node.args)child(arg);break;
      case 'group':case 'unary':case 'named':case 'byval':case 'typeof':child(node.expr);break;
    }
  }
  return root;
}
function sameCallee(left,right) {
  while(left.kind==='member'&&right.kind==='member'){
    if(left.name!==right.name)return false;left=left.object;right=right.object;
  }
  return left.kind===right.kind&&(left.kind==='with'||left.kind==='id'&&left.name===right.name);
}
export class ExpressionParser {
  constructor(text) { this.text=text; this.tokens=tokenize(text); this.i=0; this.depth=0; }
  peek() { return this.tokens[Math.min(this.i,this.tokens.length-1)]; }
  take() { const token=this.peek();if(token.type!=='eof')this.i++;return token; }
  match(v) { if(this.peek().raw[0]!=='['&&['op','id'].includes(this.peek().type)&&String(this.peek().value).toLowerCase()===v.toLowerCase()) { this.i++; return true; } return false; }
  expect(v) { if(!this.match(v)) throw new VBError(`Expected '${v}' in ${this.text}`,1002,null,0,this.peek().start+1); }
  // Argument nodes preserve omitted values and source evaluation order. Named
  // arguments are rebound to declaration slots only after target resolution.
  argument() {
    if(this.peek().type==='eof'||this.peek().type==='op'&&[',',')'].includes(this.peek().value))return {kind:'missing'};
    if(this.peek().type==='id'&&this.tokens[this.i+1]?.value===':='){
      const name=this.take().value;this.take();return {kind:'named',name,expr:this.expression()};
    }
    if(this.match('byval'))return {kind:'byval',expr:this.expression()};
    return this.expression();
  }
  qualifiedName() {
    const first=this.take();if(first.type!=='id')throw new VBError('Expected type name',1002);
    let name=first.value;while(this.match('.')){const part=this.take();if(part.type!=='id')throw new VBError('Expected type name',1002);name+='.'+part.value;}return name;
  }
  memberName() {
    const token=this.take();
    if(token.type!=='id')throw new VBError('Expected property or method name',1002,null,0,token.start+1);
    return token.value;
  }
  expression(min=0) {
    if(this.depth>=MAX_EXPRESSION_NESTING)throw new VBError('Expression nesting limit exceeded',1002,null,0,this.peek().start+1);
    this.depth++;
    try{return this.parseExpressionAt(min);}finally{this.depth--;}
  }
  parseExpressionAt(min) {
    let node; const t=this.take(); const value=t.raw[0]==='['?'':String(t.value).toLowerCase();
    if(t.type==='number'&&t.raw.endsWith('@'))node={kind:'currency',value:t.raw.slice(0,-1)};
    else if(t.type==='number') node={kind:'literal',value:numericLiteralValue(t),valueType:numericLiteralType(t),numberSuffix:/[%&!#]$/.test(t.raw)?t.raw.at(-1):null};
    else if(t.type==='string') node={kind:'literal',value:t.value,valueType:'string'};
    else if(t.type==='date') node={kind:'date',value:t.value};
    else if(value==='('){node=this.expression();this.expect(')');node={kind:'group',expr:node};}
    else if(value==='+'||value==='-'||value==='not') node={kind:'unary',op:value,expr:this.expression(value==='not'?6:13)};
    else if(value==='addressof')node={kind:'addressOf',name:this.qualifiedName()};
    else if(value==='new')node={kind:'new',name:this.qualifiedName()};
    else if(value==='typeof'){const expr=this.expression(8);this.expect('is');node={kind:'typeof',expr,name:this.qualifiedName()};}
    else if(value==='.') node={kind:'member',object:{kind:'with'},name:this.memberName()};
    else if(value==='!') node={kind:'call',callee:{kind:'with'},args:[{kind:'literal',value:this.memberName(),valueType:'string'}]};
    else if(t.type==='id') {
      if(value==='true')node={kind:'literal',value:-1,valueType:'boolean'};
      else if(value==='false')node={kind:'literal',value:0,valueType:'boolean'};
      else if(value==='null')node={kind:'literal',value:null};
      else if(value==='nothing')node={kind:'nothing'};
      else if(value==='empty')node={kind:'empty'};
      else node={kind:'id',name:t.value};
    } else throw new VBError(`Expected expression, found '${t.raw || t.value}'`,1002,null,0,t.start+1);
    while(true) {
      if(this.match('.')){node={kind:'member',object:node,name:this.memberName()};continue;}
      if(this.match('!')){node={kind:'call',callee:node,args:[{kind:'literal',value:this.memberName(),valueType:'string'}]};continue;}
      if(this.match('(')) {
        const args=[];
        if(!this.match(')')) { do{args.push(this.argument());}while(this.match(',')); this.expect(')'); }
        node={kind:'call',callee:node,args}; continue;
      }
      const op=String(this.peek().value).toLowerCase(), prec=this.peek().raw[0]!=='['&&['op','id'].includes(this.peek().type)&&Object.hasOwn(PRECEDENCE,op)?PRECEDENCE[op]:undefined;
      if(prec===undefined||prec<min)break;
      this.take(); node={kind:'binary',op,left:node,right:this.expression(prec+1)};
    }
    return node;
  }
  finish(node) { return this.tokens.length>MAX_EXPRESSION_NESTING?checkExpressionTree(node,this.peek().start+1):node; }
  parse() { const node=this.expression();if(this.peek().type!=='eof')throw new VBError(`Unexpected '${this.peek().raw}' in expression`,1002,null,0,this.peek().start+1);return this.finish(node); }
}
export const parseExpression = text => new ExpressionParser(text.trim()).parse();
export function parseCall(text,{explicit=false}={}) {
  const p=new ExpressionParser(text); let callee=p.take(); let node;
  if(callee.type==='op'&&callee.value==='.') node={kind:'member',object:{kind:'with'},name:p.memberName()};
  else if(callee.type==='id') node={kind:'id',name:callee.value};
  else throw new VBError('Expected procedure name',1002);
  while(p.match('.'))node={kind:'member',object:node,name:p.memberName()};
  if(p.peek().type==='eof') return p.finish({kind:'call',callee:node,args:[]});
  const rest=text.slice(p.peek().start).trim();
  if(rest.startsWith('(')) {
    const argumentStart=p.i;let expression;
    try{p.i=0;expression=p.parse();}catch(error){if(explicit)throw error;p.i=argumentStart;}
    if(expression){
      // Without Call the parentheses around a single argument are an
      // expression grouping, forcing a temporary even for a ByRef formal.
      if(!explicit&&expression.kind==='call'&&expression.args.length===1&&sameCallee(expression.callee,node))expression.args[0]={kind:'group',expr:expression.args[0]};
      return p.finish(expression);
    }
  }
  const args=[];do{args.push(p.argument());}while(p.match(','));
  if(p.peek().type!=='eof')throw new VBError(`Unexpected '${p.peek().raw}' in argument list`,1002);
  return p.finish({kind:'call',callee:node,args});
}

function numericLiteralType(token){
  const suffix=token.raw.at(-1),explicit={'%':'integer','&':'long','!':'single','#':'double'}[suffix];
  if(explicit)return explicit;
  if(/^[&][ho]/i.test(token.raw))return parseInt(token.raw.slice(2),/^&h/i.test(token.raw)?16:8)<=65535?'integer':'long';
  if(/[.eEdD]/.test(token.raw))return 'double';
  return token.value>=-32768&&token.value<=32767?'integer':token.value>=-2147483648&&token.value<=2147483647?'long':'double';
}

function numericLiteralValue(token){
  if(/^&[ho]/i.test(token.raw)){
    const n=parseInt(token.raw.slice(2),/^&h/i.test(token.raw)?16:8);
    if(n>4294967295)throw new VBError('Overflow in numeric literal',6);
    return n>2147483647?n-4294967296:n>=32768&&n<=65535&&!token.raw.endsWith('&')?n-65536:n;
  }
  return token.value;
}
