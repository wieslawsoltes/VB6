import {VBError} from './errors.js';
import {tokenize} from './lexer.js';

/** Small cursor shared by variable/parameter/procedure declaration grammars.
 * Balanced parentheses and opaque literal tokens avoid regex backtracking and
 * accidental delimiters in default expressions or escaped names. */
export class DeclarationCursor {
  constructor(text) { this.text=text;this.tokens=tokenize(text);this.index=0; }
  peek(offset=0) { return this.tokens[Math.min(this.index+offset,this.tokens.length-1)]; }
  fail(message) { throw new VBError(message,1002,null,0,this.peek().start+1); }
  match(value) { const t=this.peek();if(t.raw[0]!=='['&&(t.type==='id'||t.type==='op')&&String(t.value).toLowerCase()===value){this.index++;return true;}return false; }
  expect(value) { if(!this.match(value))this.fail('Expected '+value+' in declaration'); }
  name() { const t=this.peek();if(t.type!=='id')this.fail('Expected declaration name');this.index++;return t.value; }
  qualifiedName() { let value=this.name();while(this.match('.'))value+='.'+this.name();return value; }
  group() {
    if(!this.match('('))return null;
    const start=this.tokens[this.index-1].end;let depth=1;
    while(this.peek().type!=='eof') {
      const t=this.tokens[this.index++];
      if(t.type==='op'&&t.value==='(')depth++;
      if(t.type==='op'&&t.value===')'&&!--depth)return this.text.slice(start,t.start);
    }
    this.fail('Expected closing parenthesis in declaration');
  }
  rest() { const text=this.text.slice(this.peek().start);this.index=this.tokens.length-1;return text; }
  end() { if(this.peek().type!=='eof')this.fail('Unexpected token in declaration: '+this.peek().raw); }
}

