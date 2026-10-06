import {ARRAY_HEADER_WORDS} from './protocol.js';
/** Bounded per-array slabs give ReDim transactional metadata and stable ByRef addresses.
 * Header flags: bit 0 is dynamic; the upper bits count temporary element locks.
 */
export const ARRAY_WGSL = `
const ARRAY_DATA=${ARRAY_HEADER_WORDS}u;
fn array_charge(count:u32)->bool {
  if(vb_error!=0u || vb_halt) {return false;}
  if(count>params.fuel-vb_steps) {fatal(10001u);return false;}
  vb_steps+=count;return true;
}
fn array_lock(base:u32)->bool {
  if(vb_error!=0u || vb_halt) {return false;}
  mem[base+15u]+=2u;return true;
}
fn array_unlock(base:u32) {mem[base+15u]-=2u;}
fn array_at(base:u32,rank:u32,indices:vec4<i32>)->u32 {
  if(vb_error!=0u) {return 0u;}
  if(mem[base]!=rank || rank==0u) {fail(9u);return 0u;}
  var address=base+ARRAY_DATA;
  for(var d=0u;d<rank;d+=1u) {
    let low=get_i(base+2u+d*3u);let high=get_i(base+3u+d*3u);let index=indices[d];
    if(index<low || index>high) {fail(9u);return 0u;}
    address+=(u32(index)-u32(low))*mem[base+4u+d*3u];
  }
  return address;
}
fn array_bound(base:u32,dimension:i32,upper:bool)->i32 {
  if(dimension<1 || u32(dimension)>mem[base]) {fail(9u);return 0;}
  return get_i(base+2u+u32(dimension-1)*3u+select(0u,1u,upper));
}
fn array_erase(base:u32) {
  if(vb_error!=0u || vb_halt) {return;}
  let dynamic=(mem[base+15u]&1u)!=0u;
  if(dynamic && mem[base+15u]>1u) {fail(10u);return;}
  let length=mem[base+1u];if(!array_charge(length)) {return;}
  for(var i=0u;i<length;i+=1u) {mem[base+ARRAY_DATA+i]=0u;}
  if(dynamic) {for(var i=0u;i<14u;i+=1u) {mem[base+i]=0u;}}
}
fn array_redim(base:u32,rank:u32,lows:vec4<i32>,highs:vec4<i32>,preserve:bool) {
  if(vb_error!=0u || vb_halt) {return;}
  if(mem[base+15u]!=1u) {fail(10u);return;}
  let capacity=mem[base+14u];var length=1u;var strides=vec4<u32>(0u);
  let old_rank=mem[base];let old_length=mem[base+1u];
  if(preserve && old_rank!=0u && old_rank!=rank) {fail(9u);return;}
  // Validate the complete new shape before changing data or descriptors.
  for(var d=0u;d<rank;d+=1u) {
    if(highs[d]<lows[d]) {fail(9u);return;}
    let extent=u32(highs[d])-u32(lows[d])+1u;
    if(extent==0u || extent>capacity/length) {fail(7u);return;}
    strides[d]=length;length*=extent;
    if(preserve && old_rank!=0u) {
      if(lows[d]!=get_i(base+2u+d*3u)) {fail(9u);return;}
      if(d+1u<rank && highs[d]!=get_i(base+3u+d*3u)) {fail(9u);return;}
    }
  }
  let start=select(0u,min(old_length,length),preserve);
  let stop=max(old_length,length);if(!array_charge(stop-start)) {return;}
  for(var i=start;i<stop;i+=1u) {mem[base+ARRAY_DATA+i]=0u;}
  mem[base]=rank;mem[base+1u]=length;
  for(var d=0u;d<4u;d+=1u) {
    let cell=base+2u+d*3u;
    mem[cell]=select(0u,bitcast<u32>(lows[d]),d<rank);
    mem[cell+1u]=select(0u,bitcast<u32>(highs[d]),d<rank);
    mem[cell+2u]=strides[d];
  }
}
`;
