/** Finite IEEE-754 binary64 implemented with integer words, never f32 pairs.
 * Round-to-nearest/ties-to-even, gradual underflow and signed zero. Overflow,
 * invalid conversion and division by zero report VB errors. No host arithmetic.
 * The pure word helpers are also reusable by Currency and other boxed values.
 */
export const DOUBLE_WGSL = `
fn u64_zero(a:vec2<u32>)->bool {return (a.x|a.y)==0u;}
fn u64_less(a:vec2<u32>,b:vec2<u32>)->bool {return a.y<b.y || (a.y==b.y && a.x<b.x);}
fn u64_add(a:vec2<u32>,b:vec2<u32>)->vec2<u32> {let x=a.x+b.x;return vec2<u32>(x,a.y+b.y+select(0u,1u,x<a.x));}
fn u64_sub(a:vec2<u32>,b:vec2<u32>)->vec2<u32> {return vec2<u32>(a.x-b.x,a.y-b.y-select(0u,1u,a.x<b.x));}
fn u64_shl(a:vec2<u32>,n:u32)->vec2<u32> {
  if(n==0u) {return a;}if(n>=64u) {return vec2<u32>(0u);}
  if(n>=32u) {return vec2<u32>(0u,a.x<<(n-32u));}
  return vec2<u32>(a.x<<n,(a.y<<n)|(a.x>>(32u-n)));
}
fn u64_shr(a:vec2<u32>,n:u32)->vec2<u32> {
  if(n==0u) {return a;}if(n>=64u) {return vec2<u32>(0u);}
  if(n>=32u) {return vec2<u32>(a.y>>(n-32u),0u);}
  return vec2<u32>((a.x>>n)|(a.y<<(32u-n)),a.y>>n);
}
fn u64_jam(a:vec2<u32>,n:u32)->vec2<u32> {
  let r=u64_shr(a,n);let lost=any(u64_shl(r,n)!=a);return vec2<u32>(r.x|select(0u,1u,lost),r.y);
}
fn u64_top(a:vec2<u32>)->i32 {if(a.y!=0u) {return 63i-i32(countLeadingZeros(a.y));}return 31i-i32(countLeadingZeros(a.x));}
fn u128_add(a:vec4<u32>,b:vec4<u32>)->vec4<u32> {
  var r=vec4<u32>(0u);var carry=0u;
  for(var i=0u;i<4u;i+=1u) {let x=a[i]+b[i];let y=x+carry;r[i]=y;carry=select(0u,1u,x<a[i] || y<x);}return r;
}
fn u128_shl(a:vec4<u32>,n:u32)->vec4<u32> {
  var r=vec4<u32>(0u);if(n>=128u) {return r;}let w=n/32u;let s=n%32u;
  for(var i=w;i<4u;i+=1u) {r[i]=a[i-w]<<s;if(s!=0u && i>w) {r[i]|=a[i-w-1u]>>(32u-s);}}return r;
}
fn u128_shr(a:vec4<u32>,n:u32)->vec4<u32> {
  var r=vec4<u32>(0u);if(n>=128u) {return r;}let w=n/32u;let s=n%32u;
  for(var i=0u;i+w<4u;i+=1u) {r[i]=a[i+w]>>s;if(s!=0u && i+w+1u<4u) {r[i]|=a[i+w+1u]<<(32u-s);}}return r;
}
fn u128_jam64(a:vec4<u32>,n:u32)->vec2<u32> {
  let r=u128_shr(a,n);let lost=any(u128_shl(r,n)!=a);return vec2<u32>(r.x|select(0u,1u,lost),r.y);
}
fn u64_mul_wide(a:vec2<u32>,b:vec2<u32>)->vec4<u32> {
  var r=vec4<u32>(0u);let wide=vec4<u32>(a,0u,0u);
  for(var i=0u;i<64u;i+=1u) {if((b[i/32u]&(1u<<(i%32u)))!=0u) {r=u128_add(r,u128_shl(wide,i));}}return r;
}
fn d_abs(a:vec2<u32>)->vec2<u32> {return vec2<u32>(a.x,a.y&0x7fffffffu);}
fn d_neg(a:vec2<u32>)->vec2<u32> {return vec2<u32>(a.x,a.y^0x80000000u);}
fn d_nonzero(a:vec2<u32>)->bool {return !u64_zero(d_abs(a));}
fn d_mant(a:vec2<u32>)->vec2<u32> {return vec2<u32>(a.x,(a.y&0xfffffu)|select(0u,0x100000u,(a.y&0x7ff00000u)!=0u));}
fn d_exp(a:vec2<u32>)->i32 {return max(1i,i32((a.y>>20u)&2047u));}
// significand carries three guard/round/sticky bits, normalized at bit 55.
fn d_round(sign:u32,exponent:i32,mantissa:vec2<u32>)->vec2<u32> {
  var e=exponent;var m=mantissa;
  if(e<1i) {m=u64_jam(m,u32(1i-e));e=1i;}
  let rem=m.x&7u;var n=u64_shr(m,3u);
  if(rem>4u || (rem==4u && (n.x&1u)!=0u)) {n=u64_add(n,vec2<u32>(1u,0u));}
  if((n.y&0x200000u)!=0u) {n=u64_shr(n,1u);e+=1i;}
  if(e>=2047i) {fail(6u);return vec2<u32>(0u);}
  if((n.y&0x100000u)==0u) {e=0i;}
  return vec2<u32>(n.x,(n.y&0xfffffu)|(u32(e)<<20u)|sign);
}
fn d_cmp(a:vec2<u32>,b:vec2<u32>)->i32 {
  if(all(a==b) || (!d_nonzero(a) && !d_nonzero(b))) {return 0i;}
  let sa=a.y>>31u;let sb=b.y>>31u;if(sa!=sb) {return select(1i,-1i,sa!=0u);}
  return select(1i,-1i,u64_less(a,b)!=(sa!=0u));
}
fn d_add(a:vec2<u32>,b:vec2<u32>)->vec2<u32> {
  if(!array_charge(4u)) {return vec2<u32>(0u);}
  var x=a;var y=b;if(u64_less(d_abs(x),d_abs(y))) {x=b;y=a;}
  let sign=x.y&0x80000000u;var e=d_exp(x);
  let mx=u64_shl(d_mant(x),3u);let my=u64_jam(u64_shl(d_mant(y),3u),u32(e-d_exp(y)));var m=vec2<u32>(0u);
  if(((x.y^y.y)&0x80000000u)==0u) {
    m=u64_add(mx,my);if((m.y&0x1000000u)!=0u) {m=u64_jam(m,1u);e+=1i;}
  } else {
    m=u64_sub(mx,my);if(u64_zero(m)) {return vec2<u32>(0u);}
    let shift=min(55i-u64_top(m),e-1i);m=u64_shl(m,u32(shift));e-=shift;
  }
  return d_round(sign,e,m);
}
fn d_sub(a:vec2<u32>,b:vec2<u32>)->vec2<u32> {return d_add(a,d_neg(b));}
fn d_mul(a:vec2<u32>,b:vec2<u32>)->vec2<u32> {
  if(!array_charge(64u)) {return vec2<u32>(0u);}
  let sign=(a.y^b.y)&0x80000000u;
  if(!d_nonzero(a) || !d_nonzero(b)) {return vec2<u32>(0u,sign);}
  let am=d_mant(a);let bm=d_mant(b);let ash=52i-u64_top(am);let bsh=52i-u64_top(bm);
  let p=u64_mul_wide(u64_shl(am,u32(ash)),u64_shl(bm,u32(bsh)));
  let high=select(104i,105i,(p.w&512u)!=0u);
  let e=d_exp(a)-ash+d_exp(b)-bsh-1023i+high-104i;
  return d_round(sign,e,u128_jam64(p,u32(high-55i)));
}
fn d_div(a:vec2<u32>,b:vec2<u32>)->vec2<u32> {
  if(!array_charge(56u)) {return vec2<u32>(0u);}
  if(!d_nonzero(b)) {fail(select(6u,11u,d_nonzero(a)));return vec2<u32>(0u);}
  let sign=(a.y^b.y)&0x80000000u;if(!d_nonzero(a)) {return vec2<u32>(0u,sign);}
  let am=d_mant(a);let bm=d_mant(b);let ash=52i-u64_top(am);let bsh=52i-u64_top(bm);
  var rem=u64_shl(am,u32(ash));let divisor=u64_shl(bm,u32(bsh));var e=d_exp(a)-ash-d_exp(b)+bsh+1023i;
  if(u64_less(rem,divisor)) {rem=u64_shl(rem,1u);e-=1i;}
  var q=vec2<u32>(0u);
  for(var k=55i;k>=0i;k-=1i) {
    if(!u64_less(rem,divisor)) {rem=u64_sub(rem,divisor);q[u32(k)/32u]|=1u<<(u32(k)%32u);}
    if(k!=0i) {rem=u64_shl(rem,1u);}
  }
  if(!u64_zero(rem)) {q.x|=1u;}return d_round(sign,e,q);
}
fn d_from_i(a:i32)->vec2<u32> {
  if(a==0i) {return vec2<u32>(0u);}
  let sign=select(0u,0x80000000u,a<0i);let mag=select(u32(a),0u-u32(a),a<0i);let top=31u-countLeadingZeros(mag);
  let m=u64_shl(vec2<u32>(mag,0u),52u-top);return vec2<u32>(m.x,(m.y&0xfffffu)|((top+1023u)<<20u)|sign);
}
fn d_from_f(a:f32)->vec2<u32> {
  let bits=bitcast<u32>(a);let sign=bits&0x80000000u;let raw=(bits>>23u)&255u;let fraction=bits&0x7fffffu;
  if(raw==255u) {fail(6u);return vec2<u32>(0u);}if(raw==0u && fraction==0u) {return vec2<u32>(0u,sign);}
  let mag=fraction|select(0u,0x800000u,raw!=0u);let shift=23u-(31u-countLeadingZeros(mag));
  let m=u64_shl(vec2<u32>(mag,0u),29u+shift);let e=max(1u,raw)+896u-shift;
  return vec2<u32>(m.x,(m.y&0xfffffu)|(e<<20u)|sign);
}
fn d_to_i(a:vec2<u32>)->i32 {
  let e=d_exp(a)-1023i;let sign=(a.y&0x80000000u)!=0u;var mag=0u;
  if(e>31i) {fail(6u);return 0i;}
  if(e>=(-1i)) {
    let m=d_mant(a);let n=u64_jam(u64_shl(m,3u),u32(52i-e));let rem=n.x&7u;let whole=u64_shr(n,3u);
    var rounded=whole;if(rem>4u || (rem==4u && (whole.x&1u)!=0u)) {rounded=u64_add(whole,vec2<u32>(1u,0u));}
    if(rounded.y!=0u) {fail(6u);return 0i;}mag=rounded.x;
  }
  if(mag>select(2147483647u,2147483648u,sign)) {fail(6u);return 0i;}
  return bitcast<i32>(select(mag,0u-mag,sign));
}
fn d_to_f(a:vec2<u32>)->f32 {
  let sign=a.y&0x80000000u;if(!d_nonzero(a)) {return bitcast<f32>(sign);}
  let mant=d_mant(a);let sh=52i-u64_top(mant);var e=d_exp(a)-sh-896i;
  var m=u64_jam(u64_shl(mant,u32(sh)),26u).x;
  if(e<1i) {m=u64_jam(vec2<u32>(m,0u),u32(1i-e)).x;e=1i;}
  let rem=m&7u;var n=m>>3u;if(rem>4u || (rem==4u && (n&1u)!=0u)) {n+=1u;}
  if((n&0x1000000u)!=0u) {n>>=1u;e+=1i;}if(e>=255i) {fail(6u);return 0.0f;}
  if((n&0x800000u)==0u) {e=0i;}return bitcast<f32>(sign|(u32(e)<<23u)|(n&0x7fffffu));
}
fn d_fix(a:vec2<u32>)->vec2<u32> {
  let e=d_exp(a)-1023i;if(e>=52i) {return a;}if(e<0i) {return vec2<u32>(0u,a.y&0x80000000u);}
  let mask=u64_shl(vec2<u32>(0xffffffffu),u32(52i-e));return a&mask;
}
fn d_floor(a:vec2<u32>)->vec2<u32> {let r=d_fix(a);if((a.y>>31u)!=0u && any(r!=a)) {return d_sub(r,d_from_i(1i));}return r;}
// Restoring base-four square root of a 112-bit integer yields 56 rounding bits.
fn d_sqrt(a:vec2<u32>)->vec2<u32> {
  if(!array_charge(56u)) {return vec2<u32>(0u);}if(!d_nonzero(a)) {return a;}
  if((a.y>>31u)!=0u) {fail(5u);return vec2<u32>(0u);}
  let mant=d_mant(a);let sh=52i-u64_top(mant);let e=d_exp(a)-sh-1023i;let odd=u32(e)&1u;
  let wide=u128_shl(vec4<u32>(u64_shl(mant,u32(sh)),0u,0u),58u+odd);var rem=vec2<u32>(0u);var root=vec2<u32>(0u);
  for(var k=55i;k>=0i;k-=1i) {
    rem=u64_shl(rem,2u);rem.x|=(wide[u32(k)/16u]>>((u32(k)%16u)*2u))&3u;
    let trial=u64_add(u64_shl(root,2u),vec2<u32>(1u,0u));root=u64_shl(root,1u);
    if(!u64_less(rem,trial)) {rem=u64_sub(rem,trial);root.x|=1u;}
  }
  if(!u64_zero(rem)) {root.x|=1u;}return d_round(0u,(e-i32(odd))/2i+1023i,root);
}
fn get_d(cell:u32)->vec2<u32> {let p=mem[cell];return vec2<u32>(mem[p],mem[p+1u]);}
fn put_d(cell:u32,value:vec2<u32>) {if(vb_error!=0u || vb_halt) {return;}let p=mem[cell];mem[p]=value.x;mem[p+1u]=value.y;}
`;
