/** Explicit single-byte Windows mappings. Unicode values are factual mapping
 * data; all 256 decode/encode roundtrips are checked against Windows NLS in CI.
 * Undefined CP125x C1 positions retain their code units as Windows does.
 * Unrepresentable Unicode is rejected, never best-fit substituted. */
import {ComputeError} from './protocol.js';
export const CODE_PAGES=Object.freeze({
  1250:Object.freeze([8364,129,8218,131,8222,8230,8224,8225,136,8240,352,8249,346,356,381,377,144,8216,8217,8220,8221,8226,8211,8212,152,8482,353,8250,347,357,382,378,160,711,728,321,164,260,166,167,168,169,350,171,172,173,174,379,176,177,731,322,180,181,182,183,184,261,351,187,317,733,318,380,340,193,194,258,196,313,262,199,268,201,280,203,282,205,206,270,272,323,327,211,212,336,214,215,344,366,218,368,220,221,354,223,341,225,226,259,228,314,263,231,269,233,281,235,283,237,238,271,273,324,328,243,244,337,246,247,345,367,250,369,252,253,355,729]),
  1252:Object.freeze([8364,129,8218,402,8222,8230,8224,8225,710,8240,352,8249,338,141,381,143,144,8216,8217,8220,8221,8226,8211,8212,732,8482,353,8250,339,157,382,376,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255]),
});
export function codePageWGSL(codePage) {
  const high=CODE_PAGES[codePage];
  if(!high)throw new ComputeError('Only explicit code pages 1250 and 1252 are implemented','GPU_CODEPAGE');
  return `
const cp_high=array<u32,128>(${high.map(n=>n+'u').join(',')});
fn str_cp_unit(code:i32)->u32 {
  if(code<0i || code>255i) {fail(5u);return 0u;}
  if(code<128i) {return u32(code);}return cp_high[u32(code)-128u];
}
fn str_cp_repeat(code:i32)->u32 {
  if(code<0i) {fail(5u);return 0u;}return str_cp_unit(code&255i);
}
fn str_cp_asc(value:i32)->i32 {
  let code=str_first(value);if(vb_error!=0u) {return 0i;}
  if(code<128u) {return i32(code);}
  for(var i=0u;i<128u;i+=1u) {
    if(!array_charge(1u)) {return 0i;}
    if(cp_high[i]==code) {return i32(i+128u);}
  }
  fail(5u);return 0i;
}
`;
}
