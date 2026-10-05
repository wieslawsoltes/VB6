import { tokenize, VBError } from './lexer.js';
const PRECEDENCE = {imp:1,eqv:2,xor:3,or:4,and:5,'=':7,'<>':7,'<':7,'>':7,'<=':7,'>=':7,is:7,like:7,'&':8,'+':9,'-':9,mod:10,'\\':11,'*':12,'/':12,'^':14};
export class ExpressionParser {
  constructor(text) { this.text=text; this.tokens=tokenize(text); this.i=0; }
  peek() { return this.tokens[this.i]; }
  take() { return this.tokens[this.i++]; }
  match(v) { if(['op','id'].includes(this.peek().type)&&String(this.peek().value).toLowerCase()===v.toLowerCase()) { this.i++; return true; } return false; }
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
  expression(min=0) {
    let node; const t=this.take(); const value=String(t.value).toLowerCase();
    if(t.type==='number'&&t.raw.endsWith('@'))node={kind:'currency',value:t.raw.slice(0,-1)};
    else if(t.type==='number'||t.type==='string') node={kind:'literal',value:t.value};
    else if(t.type==='date') node={kind:'date',value:t.value};
    else if(value==='('){node=this.expression();this.expect(')');node={kind:'group',expr:node};}
    else if(value==='+'||value==='-'||value==='not') node={kind:'unary',op:value,expr:this.expression(value==='not'?6:13)};
    else if(value==='addressof')node={kind:'addressOf',name:this.qualifiedName()};
    else if(value==='new')node={kind:'new',name:this.qualifiedName()};
    else if(value==='typeof'){const expr=this.expression(8);this.expect('is');node={kind:'typeof',expr,name:this.qualifiedName()};}
    else if(value==='.') { const name=this.take();if(name.type!=='id')throw new VBError('Expected member name',1002);node={kind:'member',object:{kind:'with'},name:name.value}; }
    else if(t.type==='id') {
      if(value==='true')node={kind:'literal',value:-1};
      else if(value==='false')node={kind:'literal',value:0};
      else if(value==='null')node={kind:'literal',value:null};
      else if(value==='nothing')node={kind:'nothing'};
      else if(value==='empty')node={kind:'empty'};
      else node={kind:'id',name:t.value};
    } else throw new VBError(`Expected expression, found '${t.raw || t.value}'`,1002,null,0,t.start+1);
    while(true) {
      if(this.match('.')){const name=this.take();if(name.type!=='id')throw new VBError('Expected property or method name',1002); node={kind:'member',object:node,name:name.value};continue;}
      if(this.match('!')){const name=this.take(); node={kind:'call',callee:node,args:[{kind:'literal',value:name.value}]};continue;}
      if(this.match('(')) {
        const args=[];
        if(!this.match(')')) { do{args.push(this.argument());}while(this.match(',')); this.expect(')'); }
        node={kind:'call',callee:node,args}; continue;
      }
      const op=String(this.peek().value).toLowerCase(), prec=['op','id'].includes(this.peek().type)?PRECEDENCE[op]:undefined;
      if(prec===undefined||prec<min)break;
      this.take(); node={kind:'binary',op,left:node,right:this.expression(op==='^'?prec:prec+1)};
    }
    return node;
  }
  parse() { const node=this.expression();if(this.peek().type!=='eof')throw new VBError(`Unexpected '${this.peek().raw}' in expression`,1002,null,0,this.peek().start+1);return node; }
}
export const parseExpression = text => new ExpressionParser(text.trim()).parse();
export function parseCall(text) {
  const p=new ExpressionParser(text); let callee=p.take(); let node;
  if(callee.value==='.') { const name=p.take();node={kind:'member',object:{kind:'with'},name:name.value}; }
  else if(callee.type==='id') node={kind:'id',name:callee.value};
  else throw new VBError('Expected procedure name',1002);
  while(p.match('.')){const name=p.take();node={kind:'member',object:node,name:name.value};}
  if(p.peek().type==='eof') return {kind:'call',callee:node,args:[]};
  const rest=text.slice(p.peek().start).trim();
  if(rest.startsWith('(')) return parseExpression(text);
  const args=[];do{args.push(p.argument());}while(p.match(','));
  if(p.peek().type!=='eof')throw new VBError(`Unexpected '${p.peek().raw}' in argument list`,1002);
  return {kind:'call',callee:node,args};
}
