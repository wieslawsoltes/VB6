/** Bounded UTF-16 String operations. All per-character work consumes the same
 * dispatch fuel as VB instructions. No host interpreter, locale or native BSTR. */
export function stringsWGSL(arrays) {
  return `
fn str_len(s:i32)->u32 {if(vb_error!=0u || vb_halt) {return 0u;}return mem[u32(s)];}
fn str_unit(s:i32,i:u32)->u32 {return mem[u32(s)+3u+i];}
fn str_room(dst:i32,length:u32)->bool {
  if(vb_error!=0u || vb_halt) {return false;}
  if(length>mem[u32(dst)+1u]) {fail(14u);return false;}return true;
}
fn str_copy(dst:i32,src:i32)->i32 {
  let length=str_len(src);if(!str_room(dst,length) || !array_charge(length+1u)) {return dst;}
  for(var i=0u;i<length;i+=1u) {mem[u32(dst)+3u+i]=str_unit(src,i);}mem[u32(dst)]=length;return dst;
}
fn str_reset_unchecked(dst:u32) {
  let fixed_length=mem[dst+2u];for(var i=0u;i<fixed_length;i+=1u) {mem[dst+3u+i]=32u;}mem[dst]=fixed_length;
}
fn str_reset(cell:u32) {
  if(vb_error!=0u || vb_halt) {return;}let dst=mem[cell];
  if(array_charge(mem[dst+2u]+1u)) {str_reset_unchecked(dst);}
}
fn put_s(cell:u32,value:i32) {
  if(vb_error!=0u || vb_halt) {return;}
  let dst=mem[cell];let fixed_length=mem[dst+2u];let length=select(str_len(value),fixed_length,fixed_length!=0u);
  if(!str_room(i32(dst),length) || !array_charge(length+1u)) {return;}
  let count=min(length,str_len(value));
  for(var i=0u;i<count;i+=1u) {mem[dst+3u+i]=str_unit(value,i);}
  for(var i=count;i<length;i+=1u) {mem[dst+3u+i]=32u;}mem[dst]=length;
}
fn array_clear(base:u32,start:u32,stop:u32)->bool {
  ${arrays.map(s=>`if(base==${s.offset}u) {
    if(!array_charge((stop-start)*${s.stringStorage.fixedLength+1}u)) {return false;}
    for(var i=start;i<stop;i+=1u) {str_reset_unchecked(${s.stringStorage.offset}u+i*${s.stringStorage.stride}u);}return true;
  }`).join('\n')}
  if(!array_charge(stop-start)) {return false;}
  for(var i=start;i<stop;i+=1u) {mem[base+ARRAY_DATA+i]=0u;}return true;
}
fn str_concat(dst:i32,a:i32,b:i32)->i32 {
  let na=str_len(a);let nb=str_len(b);let length=na+nb;
  if(!str_room(dst,length) || !array_charge(length+1u)) {return dst;}
  for(var i=0u;i<na;i+=1u) {mem[u32(dst)+3u+i]=str_unit(a,i);}
  for(var i=0u;i<nb;i+=1u) {mem[u32(dst)+3u+na+i]=str_unit(b,i);}mem[u32(dst)]=length;return dst;
}
fn str_slice(dst:i32,s:i32,start:i32,count:i32)->i32 {
  if(start<1i || count<0i) {fail(5u);return dst;}
  let n=str_len(s);let first=min(u32(start-1i),n);let length=min(u32(count),n-first);
  if(!str_room(dst,length) || !array_charge(length+1u)) {return dst;}
  for(var i=0u;i<length;i+=1u) {mem[u32(dst)+3u+i]=str_unit(s,first+i);}mem[u32(dst)]=length;return dst;
}
fn str_right(dst:i32,s:i32,count:i32)->i32 {
  if(count<0i) {fail(5u);return dst;}return str_slice(dst,s,i32(str_len(s)-min(str_len(s),u32(count)))+1i,count);
}
fn str_trim(dst:i32,s:i32,left:bool,right:bool)->i32 {
  var start=0u;var stop=str_len(s);
  if(!array_charge(stop)) {return dst;}
  if(left) {loop {if(start>=stop) {break;}if(str_unit(s,start)!=32u) {break;}start+=1u;}}
  if(right) {loop {if(stop<=start) {break;}if(str_unit(s,stop-1u)!=32u) {break;}stop-=1u;}}
  return str_slice(dst,s,i32(start)+1i,i32(stop-start));
}
fn str_reverse(dst:i32,s:i32)->i32 {
  let n=str_len(s);if(!str_room(dst,n) || !array_charge(n+1u)) {return dst;}
  for(var i=0u;i<n;i+=1u) {mem[u32(dst)+3u+i]=str_unit(s,n-i-1u);}mem[u32(dst)]=n;return dst;
}
fn str_chr(dst:i32,code:i32)->i32 {
  if(code<(-32768i) || code>65535i) {fail(5u);return dst;}
  if(str_room(dst,1u) && array_charge(2u)) {mem[u32(dst)]=1u;mem[u32(dst)+3u]=u32(code)&65535u;}return dst;
}
fn str_asc(s:i32)->i32 {
  if(str_len(s)==0u) {fail(5u);return 0i;}let unit=str_unit(s,0u);return select(i32(unit),i32(unit)-65536i,unit>=32768u);
}
fn str_repeat(dst:i32,count:i32,code:u32)->i32 {
  if(count<0i) {fail(5u);return dst;}
  if(!str_room(dst,u32(count)) || !array_charge(u32(count)+1u)) {return dst;}
  for(var i=0u;i<u32(count);i+=1u) {mem[u32(dst)+3u+i]=code;}mem[u32(dst)]=u32(count);return dst;
}
fn str_first(s:i32)->u32 {if(str_len(s)==0u) {fail(5u);return 0u;}return str_unit(s,0u);}
fn str_explicit_binary(mode:i32)->i32 {if(mode!=0i) {fail(5u);}return 0i;}
fn str_compare(a:i32,b:i32,mode:i32)->i32 {
  if(mode!=0i && mode!=(-1i)) {fail(5u);return 0i;}
  let na=str_len(a);let nb=str_len(b);let count=min(na,nb);
  if(!array_charge(count+1u)) {return 0i;}
  for(var i=0u;i<count;i+=1u) {let x=str_unit(a,i);let y=str_unit(b,i);if(x!=y) {return select(-1i,1i,x>y);}}
  return select(select(0i,-1i,na<nb),1i,na>nb);
}
fn str_match(s:i32,needle:i32,start:u32)->bool {
  let length=str_len(needle);if(length>str_len(s)-min(start,str_len(s))) {return false;}
  if(!array_charge(length+1u)) {return false;}
  for(var i=0u;i<length;i+=1u) {if(str_unit(s,start+i)!=str_unit(needle,i)) {return false;}}return true;
}
fn str_find(s:i32,needle:i32,start:i32,mode:i32,reverse:bool)->i32 {
  if((mode!=0i && mode!=(-1i)) || start==0i || start<(-1i) || (!reverse && start<1i)) {fail(5u);return 0i;}
  let length=str_len(s);let n=str_len(needle);
  if(length==0u) {return 0i;}
  var search_start=start;if(reverse && search_start==(-1i)) {search_start=i32(length);}
  if(!reverse && n==0u) {return search_start;}
  if(u32(search_start)>length) {return 0i;}
  if(n==0u) {return search_start;}
  if(reverse) {
    if(n>u32(search_start)) {return 0i;}var i=u32(search_start)-n;
    loop {if(str_match(s,needle,i)) {return i32(i)+1i;}if(vb_error!=0u || i==0u) {break;}i-=1u;}
  } else {
    var i=u32(search_start-1i);
    loop {if(n>length-i) {break;}if(str_match(s,needle,i)) {return i32(i)+1i;}if(vb_error!=0u) {break;}i+=1u;}
  }return 0i;
}
fn str_replace(dst:i32,s:i32,needle:i32,replacement:i32,start:i32,count:i32,mode:i32)->i32 {
  if(start<1i || count<(-1i) || (mode!=0i && mode!=(-1i))) {fail(5u);return dst;}
  let length=str_len(s);let find_length=str_len(needle);let replacement_length=str_len(replacement);
  var i=min(u32(start-1i),length);var written=0u;var replaced=0i;
  loop {
    if(i>=length || vb_error!=0u || vb_halt) {break;}
    let matched=find_length!=0u && count!=0i && (count==(-1i) || replaced<count) && str_match(s,needle,i);
    if(matched) {
      if(!str_room(dst,written+replacement_length) || !array_charge(replacement_length+1u)) {return dst;}
      for(var j=0u;j<replacement_length;j+=1u) {mem[u32(dst)+3u+written+j]=str_unit(replacement,j);}written+=replacement_length;i+=find_length;replaced+=1i;
    } else {
      if(!str_room(dst,written+1u) || !array_charge(1u)) {return dst;}
      mem[u32(dst)+3u+written]=str_unit(s,i);written+=1u;i+=1u;
    }
  }
  if(vb_error==0u && !vb_halt) {mem[u32(dst)]=written;}return dst;
}
fn str_mid_assign(cell:u32,start:i32,count:i32,s:i32) {
  if(vb_error!=0u || vb_halt) {return;}
  let dst=i32(mem[cell]);let length=str_len(dst);
  if(start<1i || u32(start)>length || count<0i) {fail(5u);return;}
  let first=u32(start-1i);let n=min(min(u32(count),str_len(s)),length-first);
  if(!array_charge(n)) {return;}
  for(var i=0u;i<n;i+=1u) {mem[u32(dst)+3u+first+i]=str_unit(s,i);}
}
fn str_align(cell:u32,s:i32,right:bool) {
  if(vb_error!=0u || vb_halt) {return;}
  let dst=mem[cell];let length=mem[dst];let n=min(length,str_len(s));let first=select(0u,length-n,right);
  if(!array_charge(length)) {return;}
  for(var i=0u;i<length;i+=1u) {
    var unit=32u;if(i>=first && i<first+n) {unit=str_unit(s,i-first);}mem[dst+3u+i]=unit;
  }
}
fn str_integer(dst:i32,value:i32,leading:bool)->i32 {
  var digits:array<u32,10>;var n=select(u32(value),0u-u32(value),value<0i);var count=0u;
  loop {digits[count]=48u+n%10u;count+=1u;n/=10u;if(n==0u) {break;}}
  let prefix=select(0u,1u,value<0i || leading);let length=count+prefix;
  if(!str_room(dst,length) || !array_charge(length+1u)) {return dst;}
  if(prefix!=0u) {mem[u32(dst)+3u]=select(32u,45u,value<0i);}
  for(var i=0u;i<count;i+=1u) {mem[u32(dst)+3u+prefix+i]=digits[count-i-1u];}mem[u32(dst)]=length;return dst;
}
fn str_join(dst:i32,base:u32,delimiter:i32)->i32 {
  if(vb_error!=0u || vb_halt) {return dst;}
  if(mem[base]!=1u) {fail(5u);return dst;}
  let count=mem[base+1u];let separator=str_len(delimiter);var length=0u;
  for(var i=0u;i<count;i+=1u) {
    if(!array_charge(1u)) {return dst;}length+=str_len(i32(mem[base+ARRAY_DATA+i]));if(i>0u) {length+=separator;}
    if(!str_room(dst,length)) {return dst;}
  }
  if(!array_charge(length+1u)) {return dst;}var cursor=0u;
  for(var i=0u;i<count;i+=1u) {
    if(i>0u) {for(var j=0u;j<separator;j+=1u) {mem[u32(dst)+3u+cursor]=str_unit(delimiter,j);cursor+=1u;}}
    let s=i32(mem[base+ARRAY_DATA+i]);for(var j=0u;j<str_len(s);j+=1u) {mem[u32(dst)+3u+cursor]=str_unit(s,j);cursor+=1u;}
  }mem[u32(dst)]=length;return dst;
}
`;
}
