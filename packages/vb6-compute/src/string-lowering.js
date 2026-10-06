/** String intrinsics are kept separate from numeric/control-flow lowering. */
export function createStringLowering({arena,expr,bind,out,error,module,nodeSymbol}) {
  const raw=(code,type)=>bind(code,type,false);
  const temporary=make=>raw(make(arena.scratch()),'string');
  const requireString=value=>{if(value.type!=='string')error('Expected String value; implicit locale-sensitive conversion is unavailable','GPU_CONVERSION');return value.code;};
  const requireInteger=value=>{
    if(value.type==='string'||value.type==='void')error('Expected numeric argument','GPU_TYPE');
    return value.type==='currency'?`cy_to_i(${value.code})`:['double','date'].includes(value.type)?`d_to_i(${value.code})`:value.type==='single'?`to_i(${value.code})`:value.code;
  };
  function compareMode(value){
    if(module.optionCompare&&module.optionCompare!=='binary'){
      if(!value)error('GPU string comparisons currently require Option Compare Binary or explicit binary mode','GPU_COMPARE');
      return `str_explicit_binary(${requireInteger(value)})`;
    }
    return value?requireInteger(value):'0i';
  }
  function toString(value,{leading=false}={}) {
    if(value.type==='string')return value;
    if(value.type==='date'||value.type==='currency'||value.type==='double'||value.type==='single'||value.type==='void')error('GPU string conversion currently accepts String, Boolean and integer types; floating-point/locale formatting is not implemented','GPU_CONVERSION');
    if(value.type==='boolean'&&!leading){const yes=arena.literal('True'),no=arena.literal('False');return raw(`select(${no},${yes},${value.code}!=0i)`,'string');}
    return temporary(dst=>`str_integer(${dst},${value.code},${leading})`);
  }
  function call(name,args){
    const supported=['len','lenb','left','right','mid','trim','ltrim','rtrim','strreverse','space','string','chrw','ascw','strcomp','instr','instrrev','replace','cstr','str','join'];
    if(!supported.includes(name))return null;
    const arities={len:[1,1],lenb:[1,1],left:[2,2],right:[2,2],mid:[2,3],trim:[1,1],ltrim:[1,1],rtrim:[1,1],strreverse:[1,1],space:[1,1],string:[2,2],chrw:[1,1],ascw:[1,1],strcomp:[2,3],instr:[2,4],instrrev:[2,4],replace:[3,6],cstr:[1,1],str:[1,1],join:[1,2]};
    const [min,max]=arities[name];
    if(args.length<min||args.length>max||args.some(a=>a.kind==='named'))error(`${name} expects ${min===max?min:min+'–'+max} positional arguments`,'GPU_ARGUMENT');
    // Only optional slots may be omitted. Required argument holes are never defaults.
    const required=name==='instr'?args.length===2?2:3:min;
    if(args.slice(0,required).some(a=>a.kind==='missing'))error('Required string argument omitted','GPU_ARGUMENT');
    if(name==='join'){
      const s=nodeSymbol(args[0]);if(!s?.array||s.type!=='string')error('Join requires a String array','GPU_TYPE');
      const delimiter=args[1]&&args[1].kind!=='missing'?requireString(expr(args[1])):arena.literal(' ');
      return temporary(dst=>`str_join(${dst},${s.address},${delimiter})`);
    }
    const values=args.map(a=>a.kind==='missing'?null:expr(a));
    const s=i=>requireString(values[i]),n=(i,defaultValue)=>values[i]?requireInteger(values[i]):defaultValue;
    switch(name){
      case 'cstr':return toString(values[0]);
      case 'str':if(values[0].type==='string')error('Str requires a numeric value','GPU_TYPE');return toString(values[0],{leading:true});
      case 'len':return raw(`i32(str_len(${s(0)}))`,'long');
      case 'lenb':return raw(`i32(str_len(${s(0)})*2u)`,'long');
      case 'left':return temporary(dst=>`str_slice(${dst},${s(0)},1i,${n(1)})`);
      case 'right':return temporary(dst=>`str_right(${dst},${s(0)},${n(1)})`);
      case 'mid':return temporary(dst=>`str_slice(${dst},${s(0)},${n(1)},${n(2,'2147483647i')})`);
      case 'trim':case 'ltrim':case 'rtrim':return temporary(dst=>`str_trim(${dst},${s(0)},${name!=='rtrim'},${name!=='ltrim'})`);
      case 'strreverse':return temporary(dst=>`str_reverse(${dst},${s(0)})`);
      case 'space':return temporary(dst=>`str_repeat(${dst},${n(0)},32u)`);
      case 'string':if(values[1].type!=='string')error('Numeric String character codes depend on a Windows code page; pass ChrW(code) instead','GPU_CODEPAGE');return temporary(dst=>`str_repeat(${dst},${n(0)},str_first(${s(1)}))`);
      case 'chrw':return temporary(dst=>`str_chr(${dst},${n(0)})`);
      case 'ascw':return raw(`str_asc(${s(0)})`,'integer');
      case 'strcomp':return raw(`str_compare(${s(0)},${s(1)},${compareMode(values[2])})`,'integer');
      case 'instr':return args.length===2?raw(`str_find(${s(0)},${s(1)},1i,${compareMode()},false)`,'long'):raw(`str_find(${s(1)},${s(2)},${n(0)},${compareMode(values[3])},false)`,'long');
      case 'instrrev':return raw(`str_find(${s(0)},${s(1)},${n(2,'-1i')},${compareMode(values[3])},true)`,'long');
      case 'replace':return temporary(dst=>`str_replace(${dst},${s(0)},${s(1)},${s(2)},${n(3,'1i')},${n(4,'-1i')},${compareMode(values[5])})`);
    }
  }
  return {call,toString,requireString,requireInteger,compareMode,temporary,raw};
}
