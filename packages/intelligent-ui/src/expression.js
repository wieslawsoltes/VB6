import {UIError, LIMITS, safeKey, boundedData, budget} from './safety.js';

/** A small expression language, NOT JavaScript execution. ASTs have no access to globals. */
const precedence = {'??': 1, '||': 1, '&&': 2, '==': 3, '!=': 3, '===': 3, '!==': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6, '**': 7};
const blocked = new Set(['window','document','globalThis','self','parent','top','Function','eval','fetch','XMLHttpRequest','WebSocket','import','new','this','class','function','async','await','while','for']);
export function parseExpression(source) {
  if (typeof source !== 'string' || source.length > 10000) throw new UIError('expression_limit', 'Expression exceeds 10,000 characters.');
  const tokens = []; let offset = 0, depth = 0;
  while (offset < source.length) {
    if (/\s/.test(source[offset])) { offset++; continue; }
    const at = offset, char = source[offset];
    if (char === '"' || char === "'") {
      let value = '', closed = false; offset++;
      while (offset < source.length) {
        const ch = source[offset++]; if (ch === char) { closed = true; break; }
        if (ch === '\\') { const escape = source[offset++]; if (escape === 'u') { const code = source.slice(offset, offset + 4); if (!/^[\da-f]{4}$/i.test(code)) throw new UIError('expression', 'Invalid Unicode escape.', offset); value += String.fromCharCode(parseInt(code, 16)); offset += 4; }
          else { const escapes = {n:'\n', r:'\r', t:'\t', b:'\b', f:'\f', '\\':'\\', '"':'"', "'":"'"}; if (!Object.hasOwn(escapes, escape)) throw new UIError('expression', 'Unsupported string escape.', offset); value += escapes[escape]; }
        } else { if (ch === '\n' || ch === '\r') throw new UIError('expression', 'Unterminated string.', offset); value += ch; }
      }
      if (!closed) throw new UIError('expression', 'Unterminated string.', at); tokens.push({type:'literal', value, at}); continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
    if (number) { const value = Number(number[0]); if (!Number.isFinite(value)) throw new UIError('expression', 'Nonfinite number.', at); tokens.push({type:'literal', value, at}); offset += number[0].length; continue; }
    const name = /^[A-Za-z_$][\w$]*/.exec(source.slice(offset));
    if (name) { safeKey(name[0]); if (blocked.has(name[0])) throw new UIError('forbidden_expression', 'Host JavaScript is not available: ' + name[0], at); tokens.push({type:'name', value:name[0], at}); offset += name[0].length; continue; }
    const operator = /^(?:===|!==|=>|\?\.|\?\?|&&|\|\||==|!=|<=|>=|\*\*|[+\-*/%<>!?:.,()[\]{}])/.exec(source.slice(offset));
    if (!operator) throw new UIError('expression', 'Unsupported expression token.', at);
    tokens.push({type:'op', value:operator[0], at}); offset += operator[0].length;
  }
  tokens.push({type:'end', value:'<end>', at:offset}); let index = 0;
  const peek = () => tokens[index], take = value => peek().value === value ? (index++, true) : false;
  const need = value => { if (!take(value)) throw new UIError('expression', 'Expected ' + value + '.', peek().at); };
  function expr(min = 0) {
    if (++depth > LIMITS.depth) throw new UIError('expression_limit', 'Expression nesting exceeds limit.');
    let node; const token = tokens[index++];
    if (token.type === 'literal') node = {t:'literal', v:token.value};
    else if (['!', '+', '-'].includes(token.value)) node = {t:'unary', op:token.value, a:expr(8)};
    else if (token.type === 'name') {
      if (['true','false','null','undefined'].includes(token.value)) node = {t:'literal', v: token.value === 'true' ? true : token.value === 'false' ? false : null};
      else if (take('=>')) node = {t:'lambda', names:[token.value], body:expr()};
      else node = {t:'name', name:token.value};
    } else if (token.value === '(') {
      const saved = index, names = [];
      while (peek().type === 'name') { names.push(tokens[index++].value); if (!take(',')) break; }
      if (take(')') && take('=>')) { if (new Set(names).size !== names.length) throw new UIError('expression','Duplicate callback argument.'); node = {t:'lambda', names, body:expr()}; }
      else { index = saved; node = expr(); need(')'); }
    } else if (token.value === '[') {
      const items = []; if (!take(']')) { do { items.push(expr()); } while (take(',') && peek().value !== ']'); need(']'); } node = {t:'array', items};
    } else if (token.value === '{') {
      const entries = [];
      if (!take('}')) { do { const key = tokens[index++]; if (!['name','literal'].includes(key.type) || typeof key.value !== 'string') throw new UIError('expression','Invalid object key.',key.at); safeKey(key.value); const value = take(':') ? expr() : {t:'name',name:key.value}; entries.push([key.value,value]); } while (take(',') && peek().value !== '}'); need('}'); }
      node = {t:'object',entries};
    } else throw new UIError('expression', 'Expected an expression.', token.at);
    for (;;) {
      if (take('.') || take('?.')) { const key = tokens[index++]; if (key.type !== 'name') throw new UIError('expression','Expected property name.',key.at); safeKey(key.value); node = {t:'member',a:node,key:{t:'literal',v:key.value}}; }
      else if (take('[')) { const key = expr(); need(']'); node = {t:'member',a:node,key}; }
      else if (take('(')) { const args=[]; if (!take(')')) { do { args.push(expr()); } while (take(',')); need(')'); } node={t:'call',a:node,args}; }
      else if (min === 0 && take('?')) { const yes = expr(); need(':'); node = {t:'condition',test:node,yes,no:expr()}; }
      else { const op = peek().value, p = precedence[op]; if (!p || p < min) break; index++; node = {t:'binary',op,a:node,b:expr(op === '**' ? p : p + 1)}; }
    }
    depth--; return node;
  }
  const ast = expr(); if (peek().type !== 'end') throw new UIError('expression','Unexpected trailing expression.',peek().at); return ast;
}
// Only values wrapped here are callable. Data can never manufacture this class.
export class Callable { constructor(run) { this.run = run; } }
export function evaluate(ast, scope, work = budget()) {
  work.tick(); if (++work.depth > LIMITS.depth) { work.depth--; throw new UIError('budget','Evaluation nesting limit.'); }
  const ev = node => evaluate(node, scope, work);
  try {
    let result;
    switch (ast.t) {
      case 'literal': return ast.v;
      case 'name': { safeKey(ast.name); if (!Object.hasOwn(scope, ast.name)) throw new UIError('unbound','Unknown binding: ' + ast.name); return scope[ast.name]; }
      case 'array': return ast.items.map(ev);
      case 'object': { const value = Object.create(null); for (const [key,node] of ast.entries) value[safeKey(key)] = ev(node); return value; }
      case 'lambda': return new Callable((args, nextWork = work) => { const local = Object.assign(Object.create(null), scope); ast.names.forEach((name,i) => { local[name] = args[i]; }); return evaluate(ast.body, local, nextWork); });
      case 'member': { const value = ev(ast.a), key = safeKey(String(ev(ast.key))); if (value == null) return null; if ((Array.isArray(value) || typeof value === 'string') && key === 'length') return value.length;
        if ((typeof value === 'object' || typeof value === 'string') && Object.hasOwn(value,key)) return value[key]; return null; }
      case 'call': {
        const args = ast.args.map(ev);
        if (ast.a.t === 'member') { const receiver = ev(ast.a.a), key = safeKey(String(ev(ast.a.key))); result = method(receiver,key,args,work); }
        else { const fn = ev(ast.a); if (!(fn instanceof Callable)) throw new UIError('call','Only declared callbacks and safe functions can be called.'); result = fn.run(args, work); }
        break;
      }
      case 'unary': { const a=ev(ast.a); if (ast.op==='!') return !a; numeric(a); result=ast.op==='-' ? -a : +a; break; }
      case 'condition': return ev(ast.test) ? ev(ast.yes) : ev(ast.no);
      case 'binary': {
        const a=ev(ast.a); if (ast.op==='&&') return a && ev(ast.b); if(ast.op==='||') return a || ev(ast.b); if(ast.op==='??') return a ?? ev(ast.b); const b=ev(ast.b);
        if (ast.op==='===' || ast.op==='==') return a === b; if(ast.op==='!==' || ast.op==='!=') return a !== b;
        if (['<','>','<=','>='].includes(ast.op)) { if (!['string','number'].includes(typeof a) || !['string','number'].includes(typeof b)) throw new UIError('type','Comparison requires primitive values.'); return ast.op==='<' ? a<b : ast.op==='>' ? a>b : ast.op==='<=' ? a<=b : a>=b; }
        if(ast.op==='+' && (typeof a==='string' || typeof b==='string')) { primitive(a); primitive(b); result=String(a)+String(b); break; }
        numeric(a); numeric(b); result=ast.op==='+' ? a+b : ast.op==='-' ? a-b : ast.op==='*' ? a*b : ast.op==='/' ? a/b : ast.op==='%' ? a%b : a**b; break;
      }
      default: throw new UIError('ast','Invalid expression program.');
    }
    if (typeof result === 'number' && !Number.isFinite(result)) throw new UIError('number','Expression produced a nonfinite number.');
    if (typeof result === 'string' && result.length > LIMITS.text || Array.isArray(result) && result.length > LIMITS.items) throw new UIError('budget','Expression result exceeds limit.');
    return result;
  } finally { work.depth--; }
}
function primitive(value) { if (value !== null && !['string','number','boolean','undefined'].includes(typeof value)) throw new UIError('type','Expected a primitive value.'); return value; }
function numeric(value) { if (typeof value !== 'number' || !Number.isFinite(value)) throw new UIError('type','Expected a finite number.'); return value; }
function method(value, key, args, work) {
  work.tick(Array.isArray(value) || typeof value==='string' ? value.length : 1);
  if (value && Object.hasOwn(value,key) && value[key] instanceof Callable) return value[key].run(args, work);
  if (Array.isArray(value)) {
    const fn = args[0], callback = (v,i) => { work.tick(); if (!(fn instanceof Callable)) throw new UIError('call','Expected a callback.'); return fn.run([v,i], work); };
    if (key==='map') return value.map(callback); if(key==='filter')return value.filter(callback); if(key==='some')return value.some(callback); if(key==='every')return value.every(callback);
    if(key==='reduce') { if (!(fn instanceof Callable) || args.length!==2) throw new UIError('call','reduce requires a callback and initial value.'); return value.reduce((a,v,i)=>{work.tick();return fn.run([a,v,i], work);},args[1]); }
    if(key==='slice')return value.slice(integer(args[0]??0), args[1]==null?undefined:integer(args[1]));
    if(key==='includes')return value.includes(args[0]); if(key==='indexOf')return value.indexOf(args[0]);
    if(key==='join') { value.forEach(primitive); const separator=String(primitive(args[0]??',')); if (value.length*separator.length+value.reduce((n,v)=>n+String(v).length,0)>LIMITS.text) throw new UIError('budget','Joined text too large.'); return value.join(separator); }
  }
  if (typeof value==='string') {
    if(key==='toUpperCase')return value.toUpperCase(); if(key==='toLowerCase')return value.toLowerCase(); if(key==='trim')return value.trim();
    if(key==='includes')return value.includes(String(primitive(args[0]))); if(key==='startsWith')return value.startsWith(String(primitive(args[0]))); if(key==='endsWith')return value.endsWith(String(primitive(args[0])));
    if(key==='slice')return value.slice(integer(args[0]??0),args[1]==null?undefined:integer(args[1]));
    if(key==='split')return value.split(String(primitive(args[0])),Math.min(LIMITS.items,integer(args[1]??LIMITS.items)));
    if(key==='replace')return value.replace(String(primitive(args[0])),String(primitive(args[1])));
  }
  if(typeof value==='number' && key==='toFixed') { const digits=integer(args[0]??0); if(digits<0||digits>20)throw new UIError('type','toFixed digits must be 0–20.');return value.toFixed(digits); }
  throw new UIError('call','Method is not available: ' + key);
}
function integer(value) { numeric(value); if (!Number.isSafeInteger(value)) throw new UIError('type','Expected a safe integer.'); return value; }
export function baseScope() {
  const scope = Object.create(null), math = Object.create(null);
  for (const name of ['abs','ceil','floor','round','sqrt','sin','cos','tan','log','exp','pow','min','max','trunc']) math[name] = new Callable(args=>{if(args.length>1000)throw new UIError('budget','Too many arguments.');return Math[name](...args.map(numeric));});
  math.PI=Math.PI; math.E=Math.E; scope.Math=math;
  scope.Number=new Callable(args=>Number(primitive(args[0]))); scope.String=new Callable(args=>String(primitive(args[0]))); scope.Boolean=new Callable(args=>Boolean(args[0]));
  scope.JSON={stringify:new Callable(args=>JSON.stringify(boundedData(args[0])))}; return scope;
}
