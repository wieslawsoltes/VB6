import {VBError} from './errors.js';
import {tokenize,splitTop} from './lexer.js';
import {findKeyword} from './source-scanner.js';
import {parseExpression} from './expression.js';
import {defaultIdentifierType} from './default-types.js';

const INTRINSIC = new Set(['byte','boolean','integer','long','single','double','currency','date','string','variant','object','decimal']);
const SUFFIX = /[$%&!#@]$/;

/** Small cursor shared by variable/parameter/procedure declaration grammars.
 * Balanced parentheses and opaque literal tokens avoid regex backtracking and
 * accidental delimiters in default expressions or escaped names. */
class DeclarationCursor {
  constructor(text) { this.text=text;this.tokens=tokenize(text);this.index=0; }
  peek() { return this.tokens[Math.min(this.index,this.tokens.length-1)]; }
  fail(message) { throw new VBError(message,1002,null,0,this.peek().start+1); }
  match(value) { const t=this.peek();if(t.raw[0]!=='['&&(t.type==='id'||t.type==='op')&&String(t.value).toLowerCase()===value){this.index++;return true;}return false; }
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

function checkType(name,type,explicit) {
  if(type.toLowerCase()==='decimal')throw new VBError('Decimal is a Variant subtype; use CDec instead of As Decimal',1002);
  if(explicit&&SUFFIX.test(name)&&defaultIdentifierType(name).toLowerCase()!==type.toLowerCase())throw new VBError('Type-declaration character does not match declared data type',1002);
}

export function parseDeclarations(text,isConst=false,defaultTypes={}) {
  return splitTop(text).map(part=>{
    const p=new DeclarationCursor(part),withEvents=p.match('withevents'),name=p.name(),dimensions=p.group();
    const explicit=p.match('as'),autoNew=explicit&&p.match('new'),type=explicit?p.qualifiedName():defaultIdentifierType(name,defaultTypes);
    checkType(name,type,explicit);
    let fixedLength=null,fixedLengthExpression=null;
    if(p.match('*')) {
      if(type.toLowerCase()!=='string')p.fail('Only String declarations can specify a fixed length');
      const token=p.peek(),next=p.tokens[p.index+1];
      if(token.type==='number'&&/^\d+$/.test(token.raw)&&(next.type==='eof'||next.value==='=')){
        if(!Number.isSafeInteger(token.value)||token.value<1||token.value>65535)p.fail('Fixed string length must be an integer from 1 to 65535');
        fixedLength=token.value;p.index++;
      }else fixedLengthExpression=parseExpression(p.rest());
    }
    const initial=p.match('=')?parseExpression(p.rest()):null;p.end();
    const bounds=dimensions===null?null:dimensions.trim()===''?[]:splitTop(dimensions).map(bound=>{
      const to=findKeyword(bound,'to');return to?[parseExpression(bound.slice(0,to.start)),parseExpression(bound.slice(to.end))]:[null,parseExpression(bound)];
    });
    if(bounds?.length>60)p.fail('An array cannot have more than 60 dimensions');
    if(isConst&&(!initial||bounds!==null||autoNew||fixedLength!==null||fixedLengthExpression))p.fail('Constant expression required');
    if(withEvents&&(bounds!==null||autoNew||isConst||INTRINSIC.has(type.toLowerCase())&&type.toLowerCase()!=='object'))p.fail('WithEvents requires an object and cannot be combined with arrays, New, or Const');
    if(autoNew&&INTRINSIC.has(type.toLowerCase()))p.fail('As New requires a creatable object type');
    return {withEvents,name,type,explicitType:explicit||SUFFIX.test(name),autoNew,fixedLength,bounds,constant:isConst,initial,...(fixedLengthExpression?{fixedLengthExpression}:{})};
  });
}

export function parseParameters(text,defaultTypes={}) {
  if(!text.trim())return [];
  const params=splitTop(text).map(part=>{
    const p=new DeclarationCursor(part),modifiers=new Set();
    while(['optional','byval','byref','paramarray'].some(value=>{
      if(!p.match(value))return false;
      if(modifiers.has(value)||value==='byval'&&modifiers.has('byref')||value==='byref'&&modifiers.has('byval'))p.fail('Invalid parameter modifier');
      modifiers.add(value);return true;
    })) { /* consume the next modifier */ }
    const paramArray=modifiers.has('paramarray');
    if(paramArray&&modifiers.size!==1)p.fail('ParamArray cannot be combined with Optional, ByVal, or ByRef');
    const decl=parseDeclarations(p.rest(),false,defaultTypes)[0];
    if(paramArray&&!decl.explicitType)decl.type='Variant';
    return {...decl,optional:modifiers.has('optional'),byRef:!paramArray&&!modifiers.has('byval'),paramArray};
  });
  let optionalSeen=false;const names=new Set();
  for(let i=0;i<params.length;i++) {
    const p=params[i],key=p.name.toLowerCase();
    if(names.has(key))throw new VBError('Duplicate parameter: '+p.name,1002);names.add(key);
    if(p.paramArray) {
      if(i!==params.length-1||optionalSeen||p.bounds?.length!==0||p.type.toLowerCase()!=='variant'||p.initial)throw new VBError('ParamArray must be the final Variant array parameter, without Optional parameters',1002);
    } else if(optionalSeen&&!p.optional)throw new VBError('Required parameter cannot follow Optional parameter',1002);
    if(p.initial&&!p.optional)throw new VBError('Default value requires Optional',1002);
    if(p.autoNew||p.fixedLength!==null||p.fixedLengthExpression||p.withEvents||p.bounds?.length)throw new VBError('Invalid procedure parameter declaration',1002);
    optionalSeen ||= p.optional;
  }
  return params;
}

export function parseProcedureHeader(text,defaultTypes={}) {
  if(!/^(?:(?:Public|Private|Friend)\s+)?(?:Static\s+)?(?:Sub|Function|Property)\b/i.test(text))return null;
  const p=new DeclarationCursor(text);
  const scope=p.match('private')?'private':p.match('friend')?'friend':(p.match('public'),'public');
  const isStatic=p.match('static');
  const kind=p.match('sub')?'sub':p.match('function')?'function':p.match('property')?'property':null;
  let accessor;
  if(kind==='property'){accessor=p.match('get')?'get':p.match('let')?'let':p.match('set')?'set':null;if(!accessor)p.fail('Expected Property Get, Let, or Set');}
  const name=p.name(),args=p.group(),explicit=p.match('as'),returnType=explicit?p.qualifiedName():defaultIdentifierType(name,defaultTypes);p.end();
  checkType(name,returnType,explicit);
  if((kind==='sub'||kind==='property'&&accessor!=='get')&&(explicit||SUFFIX.test(name)))p.fail('Sub and Property Let/Set cannot specify a return type');
  return {name,kind,accessor,scope,static:isStatic,params:parseParameters(args||'',defaultTypes),returnType};
}
