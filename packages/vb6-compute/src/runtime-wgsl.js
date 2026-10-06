import {COMMAND_WGSL} from './protocol.js';
/** Helpers deliberately use explicit error cells: WGSL has no exceptions. */
export function runtimeWGSL(words) {
  return `${COMMAND_WGSL}
struct RunParams { count:u32, fuel:u32, capacity:u32, width:u32, height:u32, time:f32, shared_words:u32, pad1:u32 }
@group(0) @binding(0) var<storage,read_write> state:array<u32>;
@group(0) @binding(1) var<storage,read_write> draws:array<DrawCommand>;
@group(0) @binding(2) var<uniform> params:RunParams;
@group(0) @binding(3) var<storage,read_write> shared_data:array<atomic<u32>>;
var<private> mem:array<u32,${Math.max(1,words)}>;
var<private> vb_error:u32;
var<private> vb_line:u32;
var<private> vb_error_line:u32;
var<private> vb_source:u32;
var<private> vb_error_source:u32;
var<private> vb_steps:u32;
var<private> vb_lane:u32;
var<private> vb_draws:u32;
var<private> vb_last_error:u32;
var<private> vb_halt:bool;
fn fail(n:u32) { if(vb_error==0u) { vb_error=n; vb_error_line=vb_line; vb_error_source=vb_source; } }
fn raise_error(n:i32) {if(n<1i || n>65535i) {fail(5u);return;}fail(u32(n));}
fn tick(line:u32,source:u32)->bool {
  vb_line=line; vb_source=source;
  if(vb_steps>=params.fuel) { fail(10001u); return false; }
  vb_steps+=1u; return true;
}
fn get_i(a:u32)->i32 { return bitcast<i32>(mem[a]); }
fn get_f(a:u32)->f32 { return bitcast<f32>(mem[a]); }
fn put_i(a:u32,v:i32) { if(vb_error==0u && !vb_halt) { mem[a]=bitcast<u32>(v); } }
fn put_f(a:u32,v:f32) { if(vb_error==0u && !vb_halt) { mem[a]=bitcast<u32>(v); } }
fn checked_f(v:f32)->f32 {
  if((bitcast<u32>(v)&0x7f800000u)==0x7f800000u) { fail(6u); return 0.0; } return v;
}
fn narrow(v:i32,lo:i32,hi:i32)->i32 { if(v<lo || v>hi) { fail(6u); return 0; } return v; }
fn round_even(v:f32)->f32 {
  let f=floor(v); let r=v-f;
  if(r<0.5) {return f;} if(r>0.5) {return f+1.0;}
  return select(f,f+1.0,(f%2.0)!=0.0);
}
fn to_i(v:f32)->i32 {
  let n=round_even(v);
  if(!(n>=-2147483648.0 && n<2147483648.0)) {fail(6u);return 0;}
  return i32(n);
}
fn add_i(a:i32,b:i32)->i32 {
  let r=a+b; if(((a^r)&(b^r))<0) {fail(6u);return 0;} return r;
}
fn sub_i(a:i32,b:i32)->i32 {
  let r=a-b; if(((a^b)&(a^r))<0) {fail(6u);return 0;} return r;
}
fn mul_i(a:i32,b:i32)->i32 {
  let neg=(a<0)!=(b<0); let ua=select(bitcast<u32>(a),0u-bitcast<u32>(a),a<0);
  let ub=select(bitcast<u32>(b),0u-bitcast<u32>(b),b<0);
  let limit=select(2147483647u,2147483648u,neg);
  if(ub!=0u) { if(ua>limit/ub) {fail(6u);return 0;} }
  let p=ua*ub; return bitcast<i32>(select(p,0u-p,neg));
}
fn div_i(a:i32,b:i32)->i32 {
  if(b==0) {fail(11u);return 0;}
  if(a==(-2147483647i-1i) && b==(-1i)) {fail(6u);return 0;}
  return a/b;
}
fn mod_i(a:i32,b:i32)->i32 {if(b==0) {fail(11u);return 0;}if(a==(-2147483647i-1i) && b==(-1i)) {return 0;}return a%b;}
fn div_f(a:f32,b:f32)->f32 {
  if(b==0.0) {fail(select(11u,6u,a==0.0));return 0.0;} return checked_f(a/b);
}
fn shared_index(index:i32)->u32 {
  if(index<0i || u32(index)>=params.shared_words) {fail(9u);return 0u;}return u32(index);
}
fn shared_load(index:i32)->u32 {let i=shared_index(index);if(vb_error!=0u) {return 0u;}return atomicLoad(&shared_data[i]);}
fn shared_store(index:i32,value:u32) {let i=shared_index(index);if(vb_error==0u && !vb_halt) {atomicStore(&shared_data[i],value);}}
fn shared_atomic(index:i32,value:u32,op:u32)->u32 {
  let i=shared_index(index);if(vb_error!=0u || vb_halt) {return 0u;}
  switch op {
    case 0u: {return atomicAdd(&shared_data[i],value);}
    case 1u: {return atomicSub(&shared_data[i],value);}
    case 2u: {return atomicExchange(&shared_data[i],value);}
    case 3u: {return atomicAnd(&shared_data[i],value);}
    case 4u: {return atomicOr(&shared_data[i],value);}
    default: {return atomicXor(&shared_data[i],value);}
  }
}
fn shared_cas(index:i32,compare:u32,value:u32)->u32 {
  let i=shared_index(index);if(vb_error!=0u || vb_halt) {return 0u;}
  loop {
    if(!tick(vb_line,vb_source)) {return 0u;}
    let result=atomicCompareExchangeWeak(&shared_data[i],compare,value);
    if(result.exchanged || result.old_value!=compare) {return result.old_value;}
  }
}
fn array_at(base:u32,rank:u32,indices:vec4<i32>)->u32 {
  if(mem[base]!=rank) {fail(9u);return 0u;}
  var address=base+14u;
  for(var d=0u;d<rank;d+=1u) {
    let low=get_i(base+2u+d*3u); let high=get_i(base+3u+d*3u); let index=indices[d];
    if(index<low || index>high) {fail(9u);return 0u;}
    address+=u32(index-low)*mem[base+4u+d*3u];
  }
  return address;
}
fn array_bound(base:u32,dimension:i32,upper:bool)->i32 {
  if(dimension<1 || u32(dimension)>mem[base]) {fail(9u);return 0;}
  return get_i(base+2u+u32(dimension-1)*3u+select(0u,1u,upper));
}
fn rgb(r:i32,g:i32,b:i32)->i32 {
  if(r<0 || g<0 || b<0) {fail(5u);return 0;}
  return min(r,255)|(min(g,255)<<8u)|(min(b,255)<<16u);
}
fn ole_color(v:i32)->vec4<f32> {
  // Negative OLE system colors need the host theme, not a guessed RGB value.
  if(v<0) {fail(5u);return vec4<f32>(0.0);}
  let c=bitcast<u32>(v);return vec4<f32>(f32(c&255u),f32((c>>8u)&255u),f32((c>>16u)&255u),255.0)/255.0;
}
fn draw_shape(kind:u32,a:vec4<f32>,b:vec4<f32>,color:i32,fill:bool) {
  if(vb_error!=0u || vb_halt) {return;}
  if((kind==4u && a.z<0.0) || b.x<0.0) {fail(5u);return;}
  if(vb_draws>=params.capacity) {fail(10002u);return;}
  let rgba=ole_color(color); if(vb_error!=0u) {return;}
  var c:DrawCommand; c.tags=vec4<u32>(kind,select(0u,1u,fill),0u,0u);
  c.a=a;c.b=b;c.color=rgba;c.color2=rgba;c.matrix=vec4<f32>(1.0,0.0,0.0,1.0);
  c.clip=vec4<f32>(0.0,0.0,f32(params.width),f32(params.height));
  if(kind==1u) {c.bounds=c.clip;}
  if(kind==2u) {let pad=select(b.x*0.5,0.0,fill);c.bounds=vec4<f32>(min(a.xy,a.zw)-vec2<f32>(pad),max(a.xy,a.zw)+vec2<f32>(pad));}
  if(kind==3u) {c.bounds=vec4<f32>(min(a.xy,a.zw)-vec2<f32>(b.x),max(a.xy,a.zw)+vec2<f32>(b.x));}
  if(kind==4u) {c.bounds=vec4<f32>(a.xy-vec2<f32>(a.z+b.x),a.xy+vec2<f32>(a.z+b.x));}
  draws[vb_lane*params.capacity+vb_draws]=c;vb_draws+=1u;
}
`;
}
