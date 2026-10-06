/** Array-returning intrinsics lower directly into typed dynamic-array assignment.
 * Other array expressions are diagnosed instead of inventing Variant semantics. */
export function lowerStringArrayAssignment(target,node,{expr,nodeSymbol,out,strings,error,convert}) {
  const name=node?.kind==='call'&&node.callee?.kind==='id'?node.callee.name.toLowerCase():'';
  if(!['split','filter'].includes(name))return false;
  if(target.type!=='string'||!target.array||target.dynamic===false)error('Split/Filter destination must be a dynamic String array','GPU_TYPE');
  const args=node.args,required=name==='split'?1:2;
  if(args.length<required||args.length>4||args.some(a=>a.kind==='named')||args.slice(0,required).some(a=>a.kind==='missing'))error('Invalid '+name+' arguments','GPU_ARGUMENT');
  if(args[3]?.kind==='literal'&&![0,-1].includes(args[3].value))error('Only binary String array comparison is implemented','GPU_STRING_COMPARE');
  const optional=i=>args[i]&&args[i].kind!=='missing'?expr(args[i]):null;
  if(name==='split') {
    const source=strings.requireString(expr(args[0])),delimiter=optional(1),limit=optional(2),compare=optional(3);
    out(`str_split(${target.address},${source},${delimiter?strings.requireString(delimiter):strings.space()},${limit?strings.requireInteger(limit):'-1i'},${strings.compareMode(compare)});`);
  }else {
    const source=nodeSymbol(args[0]);if(!source?.array||source.type!=='string')error('Filter source must be a String array','GPU_TYPE');
    const needle=strings.requireString(expr(args[1])),include=optional(2),compare=optional(3);
    out(`str_filter(${target.address},${source.address},${needle},${include?'('+convert(include,'boolean')+'!=0i)':'true'},${strings.compareMode(compare)});`);
  }
  return true;
}
