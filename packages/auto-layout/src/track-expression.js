/** Bounded data-only length expressions. No eval/Function/CSS/DOM dependency.
 * Percentages use the arranged content extent. Scalars are logical lengths;
 * multiplication/division accept a finite unitless scalar on the right. */
const LIMIT=4096,MAX_DEPTH=16,MAX_NODES=256;
const cache=new Map();let cacheBytes=0;
export function parseLength(value) {
  if(typeof value==='number'){if(!Number.isFinite(value))throw new RangeError('Track length must be finite');return {op:'number',value};}
  if(typeof value!=='string'||value.length>LIMIT)throw new RangeError('Invalid track length expression');
  const hit=cache.get(value);if(hit){cache.delete(value);cache.set(value,hit);return hit;}
  const text=value.trim();let at=0,nodes=0;
  const space=()=>{while(/\s/.test(text[at]||'')&&at<text.length)at++;};
  const node=(op,props)=>{if(++nodes>MAX_NODES)throw new RangeError('Track expression node budget exceeded');return Object.freeze({op,...props});};
  function primary(depth){
    if(depth>MAX_DEPTH)throw new RangeError('Track expression nesting limit exceeded');space();
    const sign=text[at];if(sign==='+'||sign==='-'){at++;const arg=primary(depth+1);return sign==='+'?arg:node('neg',{arg});}
    const m=text.slice(at).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    if(m){at+=m[0].length;const n=Number(m[0]);if(!Number.isFinite(n))throw new RangeError('Track length must be finite');let unit='';if(text[at]==='%'){at++;unit='%';}else if(text.slice(at,at+2).toLowerCase()==='px'){at+=2;unit='px';}return node('number',{value:n,unit});}
    if(text[at]==='('){at++;const n=sum(depth+1);space();if(text[at++]!==')')throw new RangeError('Unbalanced track expression');return n;}
    const fn=text.slice(at).match(/^(calc|min|max|clamp|var)\s*\(/i);if(!fn)throw new RangeError('Invalid track expression at '+at);
    at+=fn[0].length;const name=fn[1].toLowerCase();
    if(name==='var'){
      space();const id=text.slice(at).match(/^--[A-Za-z_][\w-]*/);if(!id)throw new RangeError('Expected a --layout-variable name');at+=id[0].length;space();let fallback;
      if(text[at]===','){at++;fallback=sum(depth+1);space();}if(text[at++]!==')')throw new RangeError('Invalid variable fallback');return node('var',{name:id[0],fallback});
    }
    const args=[];for(;;){args.push(sum(depth+1));space();if(text[at]!==',')break;at++;if(args.length>=32)throw new RangeError('Too many expression arguments');}
    if(text[at++]!==')')throw new RangeError('Unbalanced track expression');
    if((name==='calc'&&args.length!==1)||(name==='clamp'&&args.length!==3)||!args.length)throw new RangeError('Invalid '+name+' arguments');
    return node(name,{args:Object.freeze(args)});
  }
  function product(depth){let left=primary(depth);for(;;){space();const op=text[at];if(op!=='*'&&op!=='/')return left;at++;left=node(op,{left,right:primary(depth)});}}
  function sum(depth){let left=product(depth);for(;;){space();const op=text[at];if(op!=='+'&&op!=='-')return left;at++;left=node(op,{left,right:product(depth)});}}
  const out=sum(0);space();if(at!==text.length)throw new RangeError('Unexpected track expression text at '+at);
  while(cache.size>=512||cacheBytes+value.length*2>131072){const first=cache.keys().next().value;if(first===undefined)break;cacheBytes-=first.length*2;cache.delete(first);}
  cache.set(value,out);cacheBytes+=value.length*2;return out;
}
export function normalizeLength(value,{minimum=0,infinity=false}={}){
  if(infinity&&value===Infinity)return Infinity;
  parseLength(value);
  if(typeof value==='string'&&/^(?:\d+(?:\.\d*)?|\.\d+)(?:px)?$/i.test(value.trim()))value=parseFloat(value);
  // Fully constant expressions are validated immediately; percentages and vars
  // are validated against the arranged extent rather than guessed at zero.
  if(typeof value==='number'){if(value<minimum)throw new RangeError('Negative track length');}
  else if(!/%|var\(/i.test(value)){const n=evaluateLength(value,0);if(n<minimum)throw new RangeError('Negative track length');}
  return value;
}
export function normalizeVariables(value={}){
  if(typeof value==='string'){if(value.length>8192)throw new RangeError('Layout variable budget exceeded');value=value.trim()?JSON.parse(value):{};}
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length>128)throw new TypeError('Expected at most 128 layout variables');
  const result=Object.create(null);let cost=0;
  for(const [key,v]of Object.entries(value)){if(!/^--[A-Za-z_][\w-]{0,63}$/.test(key))throw new RangeError('Invalid layout variable name');if(typeof v!=='number'&&typeof v!=='string')throw new TypeError('Layout variables must be lengths');parseLength(v);cost+=key.length+String(v).length;if(cost>8192)throw new RangeError('Layout variable budget exceeded');result[key]=v;}
  return result;
}
export function evaluateLength(value,extent,variables={},chain=[]){
  if(value===Infinity)return Infinity;
  if(!Number.isFinite(extent)||extent<0)throw new RangeError('Invalid track reference extent');
  const ast=parseLength(value);let budget=0;
  function visit(n){
    if(++budget>4096)throw new RangeError('Track expression work budget exceeded');
    if(n.op==='number')return {value:n.value*(n.unit==='%'?extent/100:1),scalar:!n.unit};
    if(n.op==='var'){
      if(!Object.hasOwn(variables,n.name)){if(n.fallback)return visit(n.fallback);throw new RangeError('Unknown layout variable: '+n.name);}
      if(chain.includes(n.name)||chain.length>=16)throw new RangeError('Cyclic or excessive layout variable reference: '+n.name);
      // Carry the same evaluation budget through variable expansion.
      chain.push(n.name);try{return visit(parseLength(variables[n.name]));}finally{chain.pop();}
    }
    if(n.op==='neg'){const a=visit(n.arg);return {value:-a.value,scalar:a.scalar};}
    if(n.args){const args=n.args.map(visit),values=args.map(a=>a.value);return {value:n.op==='calc'?values[0]:n.op==='min'?Math.min(...values):n.op==='max'?Math.max(...values):Math.max(values[0],Math.min(values[2],values[1])),scalar:args.every(a=>a.scalar)};}
    const a=visit(n.left),b=visit(n.right);
    if((n.op==='*'||n.op==='/')&&!b.scalar)throw new RangeError('Track multiplication/division requires a unitless right operand');
    if(n.op==='/'&&b.value===0)throw new RangeError('Track division by zero');
    return {value:n.op==='+'?a.value+b.value:n.op==='-'?a.value-b.value:n.op==='*'?a.value*b.value:a.value/b.value,scalar:a.scalar&&b.scalar};
  }
  const result=visit(ast).value;if(!Number.isFinite(result))throw new RangeError('Nonfinite resolved track length');return result;
}
