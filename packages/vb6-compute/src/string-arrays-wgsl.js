/** Transactional bounded String-array results. The caller supplies an expression
 * snapshot; commit occurs only after all source reads, size checks and fuel. */
export function stringArraysWGSL(maxLength, maxArrayCapacity) {return `
fn string_array_commit(base:u32,count:u32) {
  let old=mem[base+1u];
  for(var i=count;i<old;i+=1u) {str_reset_unchecked(mem[base+ARRAY_DATA+i]);}
  for(var i=0u;i<14u;i+=1u) {mem[base+i]=0u;}
  // Empty Split/Filter results are allocated, zero-based rank-one arrays.
  mem[base]=1u;mem[base+1u]=count;mem[base+3u]=count-1u;mem[base+4u]=1u;
}
fn str_split(base:u32,value:i32,delimiter:i32,limit:i32,mode:i32) {
  if(vb_error!=0u || vb_halt) {return;}
  if(mem[base+15u]!=1u) {fail(10u);return;}
  if(limit<(-1i) || (mode!=0i && mode!=(-1i))) {fail(5u);return;}
  let n=str_len(value);let m=str_len(delimiter);
  var starts:array<u32,${maxLength+1}>;var lengths:array<u32,${maxLength+1}>;
  var count=0u;var start=0u;
  if(n!=0u && limit!=0i) {
    var i=0u;
    loop {
      if(i>n || vb_error!=0u) {break;}
      let last=i==n;var matched=false;
      if(!last && m!=0u && (limit==(-1i) || count+1u<u32(limit))) {matched=str_match(value,delimiter,i);}
      if(last || matched) {
        if(count>=mem[base+14u] || count>=${maxLength+1}u) {fail(7u);return;}
        starts[count]=start;lengths[count]=i-start;
        if(!str_room(i32(mem[base+ARRAY_DATA+count]),i-start)) {return;}
        count+=1u;i+=select(1u,m,matched);start=i;
      }else {i+=1u;}
    }
  }
  if(vb_error!=0u || !array_charge(n+count+mem[base+1u]+14u)) {return;}
  for(var i=0u;i<count;i+=1u) {
    let dst=mem[base+ARRAY_DATA+i];let length=lengths[i];
    for(var j=0u;j<length;j+=1u) {mem[dst+3u+j]=str_unit(value,starts[i]+j);}mem[dst]=length;
  }
  string_array_commit(base,count);
}
fn str_filter(base:u32,source:u32,needle:i32,include:bool,mode:i32) {
  if(vb_error!=0u || vb_halt) {return;}
  if(mem[base+15u]!=1u) {fail(10u);return;}
  if(mem[source]!=1u) {fail(13u);return;}
  if(mode!=0i && mode!=(-1i)) {fail(5u);return;}
  let size=mem[source+1u];var selected:array<u32,${maxArrayCapacity}>;var count=0u;var work=mem[base+1u]+14u;
  for(var i=0u;i<size;i+=1u) {
    let s=i32(mem[source+ARRAY_DATA+i]);let matched=str_len(needle)==0u || str_find(s,needle,1i,mode,false)!=0i;
    if(vb_error!=0u) {return;}
    if(matched==include) {
      if(count>=mem[base+14u] || count>=${maxArrayCapacity}u) {fail(7u);return;}
      let length=str_len(s);if(!str_room(i32(mem[base+ARRAY_DATA+count]),length)) {return;}
      selected[count]=i;count+=1u;work+=length+1u;
    }
  }
  if(!array_charge(work)) {return;}
  // In-place Filter compacts forward; a destination never overwrites unread data.
  for(var i=0u;i<count;i+=1u) {
    let src=i32(mem[source+ARRAY_DATA+selected[i]]);let dst=mem[base+ARRAY_DATA+i];let length=str_len(src);
    for(var j=0u;j<length;j+=1u) {mem[dst+3u+j]=str_unit(src,j);}mem[dst]=length;
  }
  string_array_commit(base,count);
}
`;}
