/** Binary Like matcher. Dynamic programming bounds work by source × pattern;
 * adversarial * patterns do not cause exponential backtracking. */
export function stringPatternWGSL(maxLength) {return `
fn like_close(pattern:i32,start:u32)->u32 {
  let length=str_len(pattern);var end=start;
  loop {if(end>=length) {fail(93u);return length;}if(!array_charge(1u)) {return length;}if(str_unit(pattern,end)==93u) {break;}end+=1u;}
  var i=start;if(i<end && str_unit(pattern,i)==33u) {i+=1u;}
  loop {if(i>=end) {break;}
    if(i+2u<end && str_unit(pattern,i+1u)==45u) {
      if(str_unit(pattern,i)>str_unit(pattern,i+2u)) {fail(93u);return length;}i+=3u;
    }else {i+=1u;}
  }return end;
}
fn like_class(pattern:i32,start:u32,end:u32,unit:u32)->bool {
  var i=start;var negate=false;var matched=false;
  if(i<end && str_unit(pattern,i)==33u) {negate=true;i+=1u;}
  loop {if(i>=end) {break;}if(!array_charge(1u)) {return false;}
    let first=str_unit(pattern,i);
    if(i+2u<end && str_unit(pattern,i+1u)==45u) {matched=matched || (unit>=first && unit<=str_unit(pattern,i+2u));i+=3u;}
    else {matched=matched || unit==first;i+=1u;}
  }return matched!=negate;
}
fn str_like(value:i32,pattern:i32,mode:i32)->i32 {
  if(mode!=0i && mode!=(-1i)) {fail(5u);return 0i;}
  let n=str_len(value);let m=str_len(pattern);
  if(n>${maxLength}u || m>${maxLength}u) {fail(14u);return 0i;}
  var row:array<u32,${maxLength+1}>;row[0]=1u;var next:array<u32,${maxLength+1}>;
  var p=0u;
  loop {if(p>=m || vb_error!=0u) {break;}
    let unit=str_unit(pattern,p);var end=p+1u;
    if(unit==91u) {end=like_close(pattern,p+1u);if(vb_error!=0u) {return 0i;}if(end==p+1u) {p=end+1u;continue;}}
    if(!array_charge(n+1u)) {return 0i;}
    next[0]=select(0u,row[0],unit==42u);
    for(var i=1u;i<=n;i+=1u) {
      if(unit==42u) {next[i]=row[i]|next[i-1u];continue;}
      let character=str_unit(value,i-1u);var matched=unit==character;
      if(unit==63u) {matched=true;}
      if(unit==35u) {matched=character>=48u && character<=57u;}
      if(unit==91u) {matched=like_class(pattern,p+1u,end,character);}
      next[i]=select(0u,row[i-1u],matched);
    }
    if(!array_charge(n+1u)) {return 0i;}
    for(var i=0u;i<=n;i+=1u) {row[i]=next[i];}
    p=select(p+1u,end+1u,unit==91u);
  }
  if(vb_error!=0u) {return 0i;}return select(0i,-1i,row[n]!=0u);
}
`;}
