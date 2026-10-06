/** Gregorian civil calendar on integer days and binary64 OLE DATE fractions.
 * No timezone/DST conversion occurs inside shaders. The host clock is explicit. */
export function dateWGSL({twoDigitYearMax=2029}={}) {return `
fn dt_valid(a:vec2<u32>)->vec2<u32> {
  if(d_cmp(a,d_from_i(-657435i))<=0i || d_cmp(a,d_from_i(2958466i))>=0i) {fail(6u);return vec2<u32>(0u);}return a;
}
fn dt_put(cell:u32,a:vec2<u32>) {let value=dt_valid(a);put_d(cell,value);}
fn dt_floor_div(a:i32,b:i32)->i32 {return a/b-select(0i,1i,a<0i && a%b!=0i);}
fn dt_mod(a:i32,b:i32)->i32 {return a-b*dt_floor_div(a,b);}
fn dt_leap(year:i32)->bool {return year%4i==0i && (year%100i!=0i || year%400i==0i);}
fn dt_month_days(year:i32,month:i32)->i32 {
  if(month==2i) {return select(28i,29i,dt_leap(year));}
  return select(31i,30i,month==4i || month==6i || month==9i || month==11i);
}
fn dt_year_start(year:i32)->i32 {let y=year-1i;return 365i*y+y/4i-y/100i+y/400i-693593i;}
fn dt_ordinal(year:i32,month:i32,day:i32)->i32 {
  var n=dt_year_start(year)+day-1i;
  for(var m=1i;m<month;m+=1i) {n+=dt_month_days(year,m);}return n;
}
fn dt_day(a:vec2<u32>)->i32 {return d_to_i(d_fix(a));}
fn dt_fraction(a:vec2<u32>)->vec2<u32> {return d_abs(d_sub(a,d_fix(a)));}
// Windows VarUdateFromDate rounds the absolute OLE value by adding half a
// second before splitting days/fractions. Adding to the fraction alone changes
// boundary rounding. The final representable day deliberately stays truncated.
// Raw dt_day/dt_fraction and stored DATE words are never normalized by this view.
fn dt_field_value(a:vec2<u32>)->vec2<u32> {
  let value=d_abs(dt_valid(a));
  if(dt_day(a)==2958465i) {return value;}
  return d_add(value,vec2<u32>(2697875753u,1054361032u));
}
fn dt_field_day(a:vec2<u32>)->i32 {
  return dt_day(a)+dt_day(dt_field_value(a))-dt_day(d_abs(a));
}
fn dt_parts(a:vec2<u32>)->vec3<i32> {
  let day=dt_field_day(a);var low=100i;var high=10000i;
  loop {if(low+1i>=high) {break;}let middle=(low+high)/2i;if(dt_year_start(middle)<=day) {low=middle;}else {high=middle;}}
  var remaining=day-dt_year_start(low);var month=1i;
  loop {let n=dt_month_days(low,month);if(remaining<n || month==12i) {break;}remaining-=n;month+=1i;}
  return vec3<i32>(low,month,remaining+1i);
}
fn dt_seconds(a:vec2<u32>)->i32 {return min(86399i,d_to_i(d_floor(d_mul(dt_fraction(dt_field_value(a)),d_from_i(86400i)))));}
fn dt_compose(day:i32,fraction:vec2<u32>)->vec2<u32> {
  if(day<(-657434i) || day>2958465i) {fail(5u);return vec2<u32>(0u);}
  if(day<0i) {return dt_valid(d_sub(d_from_i(day),fraction));}return dt_valid(d_add(d_from_i(day),fraction));
}
fn dt_serial(year:i32,month:i32,day:i32)->vec2<u32> {
  if(year<(-32768i) || year>32767i || month<(-32768i) || month>32767i || day<(-32768i) || day>32767i) {fail(6u);return vec2<u32>(0u);}
  var y=year;if(y>=0i && y<100i) {y+=${Math.floor(twoDigitYearMax/100)*100}i;if(y>${twoDigitYearMax}i) {y-=100i;}}
  let total=y*12i+month-1i;y=dt_floor_div(total,12i);let m=dt_mod(total,12i)+1i;
  if(y<100i || y>9999i) {fail(5u);return vec2<u32>(0u);}
  let ordinal=dt_ordinal(y,m,1i)+day-1i;return dt_compose(ordinal,vec2<u32>(0u));
}
fn dt_time_serial(hour:i32,minute:i32,second:i32)->vec2<u32> {
  if(hour<(-32768i) || hour>32767i || minute<(-32768i) || minute>32767i || second<(-32768i) || second>32767i) {fail(6u);return vec2<u32>(0u);}
  let total=hour*3600i+minute*60i+second;let days=dt_floor_div(total,86400i);let seconds=dt_mod(total,86400i);
  return dt_compose(days,d_div(d_from_i(seconds),d_from_i(86400i)));
}
fn dt_weekday(a:vec2<u32>,first:i32)->i32 {
  if(first<0i || first>7i) {fail(5u);return 0i;}return dt_mod(dt_field_day(a)+6i-(max(1i,first)-1i),7i)+1i;
}
fn dt_week_start(day:i32,first:i32)->i32 {return day-dt_mod(day+6i-first,7i);}
fn dt_first_week(year:i32,first:i32,rule:i32)->i32 {
  let jan=dt_year_start(year);let start=dt_week_start(jan,first);
  if(rule==1i) {return start;}if(rule==2i) {return select(start+7i,start,jan-start<=3i);}return select(start+7i,start,jan==start);
}
fn dt_part(part:u32,value:vec2<u32>,first:i32,week:i32)->i32 {
  if(first<0i || first>7i || week<0i || week>3i) {fail(5u);return 0i;}
  let d=dt_parts(value);let ordinal=dt_field_day(value);
  switch part {
    case 0u: {return d.x;}case 1u: {return (d.y-1i)/3i+1i;}case 2u: {return d.y;}
    case 3u: {return ordinal-dt_year_start(d.x)+1i;}case 4u: {return d.z;}
    case 5u: {return dt_weekday(value,first);}
    case 6u: {var start=dt_first_week(d.x,max(1i,first)-1i,max(1i,week));if(ordinal<start) {start=dt_first_week(d.x-1i,max(1i,first)-1i,max(1i,week));}return (ordinal-start)/7i+1i;}
    case 7u: {return dt_seconds(value)/3600i;}case 8u: {return (dt_seconds(value)/60i)%60i;}default: {return dt_seconds(value)%60i;}
  }
}
fn dt_add(part:u32,count:i32,value:vec2<u32>)->vec2<u32> {
  let a=dt_valid(value);if(vb_error!=0u) {return vec2<u32>(0u);}
  if(part<=2u) {
    if(count<(-120000i) || count>120000i) {fail(5u);return vec2<u32>(0u);}
    let d=dt_parts(a);var multiplier=1i;if(part==0u) {multiplier=12i;}if(part==1u) {multiplier=3i;}
    let month=d.x*12i+d.y-1i+count*multiplier;let y=dt_floor_div(month,12i);let m=dt_mod(month,12i)+1i;
    if(y<100i || y>9999i) {fail(5u);return vec2<u32>(0u);}
    return dt_compose(dt_ordinal(y,m,min(d.z,dt_month_days(y,m))),dt_fraction(a));
  }
  if(part<=6u) {
    if(count<(-4000000i) || count>4000000i) {fail(5u);return vec2<u32>(0u);}
    return dt_compose(dt_day(a)+count*select(1i,7i,part==6u),dt_fraction(a));
  }
  var unit=1i;if(part==7u) {unit=3600i;}if(part==8u) {unit=60i;}
  let linear=d_add(d_from_i(dt_day(a)),dt_fraction(a));
  let next=d_add(linear,d_div(d_mul(d_from_i(count),d_from_i(unit)),d_from_i(86400i)));
  if(d_cmp(next,d_from_i(-657434i))<0i || d_cmp(next,d_from_i(2958466i))>=0i) {fail(5u);return vec2<u32>(0u);}
  let whole=d_floor(next);return dt_compose(d_to_i(whole),d_sub(next,whole));
}
fn dt_diff(part:u32,a:vec2<u32>,b:vec2<u32>,first:i32,week:i32)->i32 {
  if(first<0i || first>7i || week<0i || week>3i) {fail(5u);return 0i;}
  let x=dt_parts(a);let y=dt_parts(b);let ad=dt_field_day(a);let bd=dt_field_day(b);
  switch part {
    case 0u: {return y.x-x.x;}case 1u: {return (y.x-x.x)*4i+(y.y-1i)/3i-(x.y-1i)/3i;}case 2u: {return (y.x-x.x)*12i+y.y-x.y;}
    case 3u,4u: {return bd-ad;}case 5u: {return (bd-ad)/7i;}
    case 6u: {return (dt_week_start(bd,max(1i,first)-1i)-dt_week_start(ad,max(1i,first)-1i))/7i;}
    default: {var unit=1i;if(part==7u) {unit=3600i;}if(part==8u) {unit=60i;}
      let left=d_add(d_mul(d_from_i(ad),d_from_i(86400i/unit)),d_from_i(dt_seconds(a)/unit));
      let right=d_add(d_mul(d_from_i(bd),d_from_i(86400i/unit)),d_from_i(dt_seconds(b)/unit));return d_to_i(d_sub(right,left));}
  }
}
`;}