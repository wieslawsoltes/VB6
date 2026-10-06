import {ComputeError,ARRAY_HEADER_WORDS,integer} from './protocol.js';
const MIN=-(1n<<63n),MAX=(1n<<63n)-1n;
/** Decimal source text is rounded as decimal, before it can lose bits in Number. */
export function currencyRaw(value) {
  if(typeof value==='bigint')return value;
  if(value&&typeof value.raw==='bigint')return value.raw;
  if(value&&typeof value.__currency==='string')return BigInt(value.__currency);
  if(typeof value!=='string'&&typeof value!=='number')throw new ComputeError('Currency requires decimal text, raw bigint, or a safe finite number','GPU_VALUE');
  if(typeof value==='number'&&(!Number.isFinite(value)||Math.abs(value)>Number.MAX_SAFE_INTEGER/10000))throw new ComputeError('Use decimal text or raw bigint for full-range Currency input','GPU_VALUE');
  const text=String(value).trim();
  const m=/^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if(!m||!(m[2]||m[3])||text.length>4096)throw new ComputeError('Invalid invariant decimal Currency value','GPU_VALUE');
  const exponent=Number(m[4]||0);if(!Number.isSafeInteger(exponent)||Math.abs(exponent)>4096)throw new ComputeError('Currency exponent out of range','GPU_VALUE');
  const digits=BigInt((m[2]||'0')+(m[3]||''));let raw=digits;const shift=4+exponent-(m[3]?.length||0);
  if(shift>=0){if(shift>24&&digits!==0n)throw new ComputeError('Currency overflow','GPU_VALUE');raw=digits*(10n**BigInt(Math.min(shift,24)));}
  else {const divisor=10n**BigInt(-shift),q=digits/divisor,r=digits%divisor;raw=q+(r*2n>divisor||(r*2n===divisor&&(q&1n))?1n:0n);}
  return m[1]==='-'?-raw:raw;
}
export function encodeCurrency(value) {
  const raw=currencyRaw(value);if(raw<MIN||raw>MAX)throw new ComputeError('Currency overflow','GPU_VALUE');
  const bits=BigInt.asUintN(64,raw);return [Number(bits&0xffffffffn),Number(bits>>32n)];
}
/** A canonical decimal string avoids loss of low Currency bits in JavaScript. */
export function decodeCurrency(low,high) {
  const raw=BigInt.asIntN(64,BigInt(high)*4294967296n+BigInt(low));const n=raw<0n?-raw:raw;
  return (raw<0n?'-':'')+(n/10000n).toString()+'.'+(n%10000n).toString().padStart(4,'0');
}
export const currencyLiteral=value=>`vec2<u32>(${encodeCurrency(value).map(n=>n+'u').join(',')})`;
export function attachCurrency(initial,symbol,value=0) {
  const count=symbol.array?symbol.capacity:1,offset=initial.length;symbol.currencyStorage={offset,stride:2};
  const words=encodeCurrency(value);
  for(let i=0;i<count;i++){initial[symbol.offset+(symbol.array?ARRAY_HEADER_WORDS:0)+i]=initial.length;initial.push(...words);}return symbol;
}
export function validateCurrencyStorage(artifact,symbol) {
  const storage=symbol.currencyStorage,count=symbol.array?symbol.capacity:1;
  if(!storage||storage.stride!==2)throw new ComputeError('Invalid Currency storage','GPU_ABI');
  integer(storage.offset,'Currency storage offset',0,artifact.stateWords-count*2);
  for(let i=0;i<count;i++)if(artifact.initialState[symbol.offset+(symbol.array?ARRAY_HEADER_WORDS:0)+i]!==storage.offset+i*2)throw new ComputeError('Invalid Currency reference','GPU_ABI');
  return [storage.offset,storage.offset+count*2];
}
