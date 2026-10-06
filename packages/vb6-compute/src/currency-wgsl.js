/** Signed 64-bit Currency with a decimal scale of 10,000. Uses wide integer
 * products and one final ties-to-even rounding, never binary floating arithmetic. */
export const CURRENCY_WGSL=`
struct SmallDivision { quotient:vec4<u32>, remainder:u32 }
fn u128_div_small(a:vec4<u32>,divisor:u32)->SmallDivision {
  var r:SmallDivision;
  for(var j=7i;j>=0i;j-=1i) {let i=u32(j);let x=(r.remainder<<16u)|((a[i/2u]>>((i%2u)*16u))&65535u);r.quotient[i/2u]|=(x/divisor)<<((i%2u)*16u);r.remainder=x%divisor;}return r;
}
fn u128_round_shift(a:vec4<u32>,shift:u32)->vec4<u32> {
  if(shift==0u) {return a;}if(shift>128u) {return vec4<u32>(0u);}
  var q=u128_shr(a,shift);let bit=shift-1u;let guard=(a[bit/32u]>>(bit%32u))&1u;
  let sticky=any(u128_shl(u128_shr(a,bit),bit)!=a);
  if(guard!=0u && (sticky || (q.x&1u)!=0u)) {q=u128_add(q,vec4<u32>(1u,0u,0u,0u));}return q;
}
fn cy_mag(a:vec2<u32>)->vec2<u32> {if((a.y>>31u)!=0u) {return u64_sub(vec2<u32>(0u),a);}return a;}
fn cy_signed(m:vec4<u32>,negative:bool)->vec2<u32> {
  let limit=select(vec2<u32>(0xffffffffu,0x7fffffffu),vec2<u32>(0u,0x80000000u),negative);
  if((m.z|m.w)!=0u || u64_less(limit,m.xy)) {fail(6u);return vec2<u32>(0u);}
  if(negative) {return u64_sub(vec2<u32>(0u),m.xy);}return m.xy;
}
fn cy_neg(a:vec2<u32>)->vec2<u32> {
  if(all(a==vec2<u32>(0u,0x80000000u))) {fail(6u);return vec2<u32>(0u);}return u64_sub(vec2<u32>(0u),a);
}
fn cy_abs(a:vec2<u32>)->vec2<u32> {if((a.y>>31u)!=0u) {return cy_neg(a);}return a;}
fn cy_add(a:vec2<u32>,b:vec2<u32>)->vec2<u32> {
  let r=u64_add(a,b);if((((a.y^r.y)&(b.y^r.y))&0x80000000u)!=0u) {fail(6u);return vec2<u32>(0u);}return r;
}
fn cy_sub(a:vec2<u32>,b:vec2<u32>)->vec2<u32> {
  let r=u64_sub(a,b);if((((a.y^b.y)&(a.y^r.y))&0x80000000u)!=0u) {fail(6u);return vec2<u32>(0u);}return r;
}
fn cy_cmp(a:vec2<u32>,b:vec2<u32>)->i32 {
  if(all(a==b)) {return 0i;}if((a.y>>31u)!=(b.y>>31u)) {return select(1i,-1i,(a.y>>31u)!=0u);}return select(1i,-1i,u64_less(a,b));
}
fn cy_mul(a:vec2<u32>,b:vec2<u32>)->vec2<u32> {
  if(!array_charge(72u)) {return vec2<u32>(0u);}
  let p=u64_mul_wide(cy_mag(a),cy_mag(b));let divided=u128_div_small(p,10000u);var q=divided.quotient;
  if(divided.remainder>5000u || (divided.remainder==5000u && (q.x&1u)!=0u)) {q=u128_add(q,vec4<u32>(1u,0u,0u,0u));}
  return cy_signed(q,((a.y^b.y)>>31u)!=0u);
}
fn cy_from_i(a:i32)->vec2<u32> {
  let mag=select(u32(a),0u-u32(a),a<0i);return cy_signed(u64_mul_wide(vec2<u32>(mag,0u),vec2<u32>(10000u,0u)),a<0i);
}
fn cy_from_d(a:vec2<u32>)->vec2<u32> {
  if(!array_charge(72u)) {return vec2<u32>(0u);}if(!d_nonzero(a)) {return vec2<u32>(0u);}
  let exponent=d_exp(a)-1075i;var p=u64_mul_wide(d_mant(a),vec2<u32>(10000u,0u));
  if(exponent>=0i) {
    if(exponent>=128i) {fail(6u);return vec2<u32>(0u);}
    let q=u128_shl(p,u32(exponent));if(any(u128_shr(q,u32(exponent))!=p)) {fail(6u);return vec2<u32>(0u);}p=q;
  }else {p=u128_round_shift(p,u32(-exponent));}
  return cy_signed(p,(a.y>>31u)!=0u);
}
fn cy_to_i(a:vec2<u32>)->i32 {
  let divided=u128_div_small(vec4<u32>(cy_mag(a),0u,0u),10000u);var q=divided.quotient;
  if(divided.remainder>5000u || (divided.remainder==5000u && (q.x&1u)!=0u)) {q=u128_add(q,vec4<u32>(1u,0u,0u,0u));}
  let negative=(a.y>>31u)!=0u;
  if((q.y|q.z|q.w)!=0u || q.x>select(2147483647u,2147483648u,negative)) {fail(6u);return 0i;}
  return bitcast<i32>(select(q.x,0u-q.x,negative));
}
fn cy_to_d(a:vec2<u32>)->vec2<u32> {
  if(!array_charge(12u)) {return vec2<u32>(0u);}let m=cy_mag(a);if(u64_zero(m)) {return vec2<u32>(0u);}
  var e=u64_top(m)-13i;let scale=vec2<u32>(10000u,0u);
  if(e>=0i) {if(u64_less(m,u64_shl(scale,u32(e)))) {e-=1i;}}
  else {if(u64_less(u64_shl(m,u32(-e)),scale)) {e-=1i;}}
  let divided=u128_div_small(u128_shl(vec4<u32>(m,0u,0u),u32(55i-e)),10000u);var bits=divided.quotient.xy;
  if(divided.remainder!=0u) {bits.x|=1u;}return d_round(a.y&0x80000000u,e+1023i,bits);
}
fn cy_fix(a:vec2<u32>)->vec2<u32> {
  let q=u128_div_small(vec4<u32>(cy_mag(a),0u,0u),10000u).quotient.xy;
  return cy_signed(u64_mul_wide(q,vec2<u32>(10000u,0u)),(a.y>>31u)!=0u);
}
fn cy_floor(a:vec2<u32>)->vec2<u32> {let r=cy_fix(a);if((a.y>>31u)!=0u && any(r!=a)) {return cy_sub(r,vec2<u32>(10000u,0u));}return r;}
`;
