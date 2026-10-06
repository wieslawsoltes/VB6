/** Compile known calendar operations; unsupported locale parsing fails closed. */
export function createDateLowering({expr,convert,bind,error,enable}) {
  const intervals=['yyyy','q','m','y','d','w','ww','h','n','s'];
  const literalInterval=node=>{if(node?.kind!=='literal'||typeof node.value!=='string')error('Calendar intervals must currently be string literals','GPU_DATE_INTERVAL');const id=intervals.indexOf(node.value.toLowerCase());if(id<0)error('Unknown calendar interval','GPU_DATE_INTERVAL');return id;};
  function call(name,args){
    const names=['date','time','now','timer','dateserial','timeserial','year','month','day','hour','minute','second','weekday','datevalue','timevalue','dateadd','datediff','datepart'];
    if(!names.includes(name))return null;enable();
    const expect=(lo,hi=lo)=>{if(args.length<lo||args.length>hi||args.some(a=>a.kind==='named'||a.kind==='missing'))error('Invalid calendar argument list for '+name,'GPU_ARGUMENT');};
    const value=node=>convert(expr(node),'date');const number=node=>convert(expr(node),'long');
    if(['now','date','time','timer'].includes(name)){
      expect(0);const now='vec2<u32>(params.now_lo,params.now_hi)';
      if(name==='now')return bind(now,'date');if(name==='date')return bind(`d_fix(${now})`,'date');if(name==='time')return bind(`dt_fraction(${now})`,'date');
      return bind(`d_to_f(d_mul(dt_fraction(${now}),d_from_i(86400i)))`,'single');
    }
    if(name==='dateserial'||name==='timeserial'){expect(3);const a=args.map(number);return bind(`${name==='dateserial'?'dt_serial':'dt_time_serial'}(${a.join(',')})`,'date');}
    if(name==='datevalue'||name==='timevalue'){expect(1);return bind(`${name==='datevalue'?'d_fix':'dt_fraction'}(${value(args[0])})`,'date');}
    if(name==='weekday'){expect(1,2);const d=value(args[0]),first=args[1]?number(args[1]):'1i';return bind(`dt_weekday(${d},${first})`,'integer');}
    const parts={year:0,month:2,day:4,hour:7,minute:8,second:9};
    if(Object.hasOwn(parts,name)){expect(1);return bind(`dt_part(${parts[name]}u,${value(args[0])},1i,1i)`,'integer');}
    if(name==='dateadd'){expect(3);const part=literalInterval(args[0]),count=number(args[1]),d=value(args[2]);return bind(`dt_add(${part}u,${count},${d})`,'date');}
    if(name==='datepart'){expect(2,4);const part=literalInterval(args[0]),d=value(args[1]),first=args[2]?number(args[2]):'1i',week=args[3]?number(args[3]):'1i';return bind(`dt_part(${part}u,${d},${first},${week})`,'integer');}
    if(name==='datediff'){expect(3,5);const part=literalInterval(args[0]),a=value(args[1]),b=value(args[2]),first=args[3]?number(args[3]):'1i',week=args[4]?number(args[4]):'1i';return bind(`dt_diff(${part}u,${a},${b},${first},${week})`,'long');}
  }
  return {call};
}
