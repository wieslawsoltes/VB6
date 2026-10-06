/** Emits a non-recursive GPU continuation dispatcher. Each VB frame has private
 * control/temporary storage; calls yield to main instead of nesting WGSL calls.
 * This prevents shader-backend inlining from exponentially duplicating Fib-like
 * call graphs. Only compiler-generated names/statements enter this emitter.
 */
export function emitCallFrame({id,params,resultType,reset=[],declarations=[],blocks=[],result='0i',limit=false}) {
  const fields=new Map([['pc','u32'],['caller','u32'],['done','bool'],['error_mode','u32'],['handler','u32'],['handler_active','bool'],['error_pc','u32'],['statement_pc','u32']]);
  for(const p of params){const [name,type]=p.split(':');fields.set(name,type);}
  if(resultType!=='void')fields.set('result',resultType==='double'?'vec2<u32>':resultType==='single'?'f32':'i32');
  const init=[];
  for(const declaration of declarations){
    const re=/var\s+(\w+)(?::([^;=]+))?(?:=([^;]+))?;/g;let m;
    while((m=re.exec(declaration))){fields.set(m[1],m[2]||(/u$/.test(m[3])?'u32':'bool'));if(m[3])init.push(`${m[1]}=${m[3]};`);}
  }
  // Values computed before a yield must survive until the caller resumes.
  function lift(code){return code.replace(/\blet (\w+)(?::(i32|f32|vec2<u32>))?=/g,(_,name,type)=>{
    if(!type)type=name.startsWith('lock')?'bool':'u32';fields.set(name,type);return name+'=';
  });}
  const cases=[];let continuation=blocks.length;
  const leave=resultType==='void'?'':`frame_${id}.result=${resultType==='double'?'vec2<u32>(0u)':resultType==='single'?'0.0f':'0i'};`;
  const abort=`${leave}vb_current=frame_${id}.caller;return;`;
  for(const block of blocks){
    let label=block.pc,code=`statement_pc=${block.pc}u;\nif(!tick(${block.line}u,${id}u)) {${abort}}\n`;
    for(const operation of block.operations){
      if(typeof operation==='string'){code+=lift(operation)+'\n';continue;}
      const resume=continuation++,callee=operation.callee;
      code+=operation.args.map((arg,i)=>`frame_${callee}.arg${i}=${arg};`).join('\n')+'\n';
      code+=`frame_${callee}.caller=${id}u;frame_${callee}.pc=0xffffffffu;pc=${resume}u;vb_current=${callee}u;return;`;
      cases.push({label,code});label=resume;code='';
    }
    cases.push({label,code:code+block.next});
  }
  const rewrite=code=>code.replace(/\b\w+\b/g,(name,offset,text)=>fields.has(name)&&text[offset-1]!=='.'?`frame_${id}.${name}`:name);
  const schema=`struct Frame_${id} {${[...fields].map(([n,t])=>`${n}:${t},`).join('')}}\nvar<private> frame_${id}:Frame_${id};`;
  if(limit)return schema+`\nfn step_${id}() {if(!vb_halt) {fail(28u);}${abort}}`;
  const finish=resultType==='void'?'':`frame_${id}.result=${rewrite(result)};`;
  return schema+`\nfn step_${id}() {
    if(frame_${id}.pc==0xffffffffu) {
      if(vb_error!=0u || vb_halt) {${abort}}
      ${rewrite('pc=0u;done=false;error_mode=0u;handler=0u;handler_active=false;error_pc=0u;statement_pc=0u;')}
      ${rewrite(init.join('\n'))}
      ${rewrite(reset.join('\n'))}
      if(vb_error!=0u) {${abort}}
    }
    switch frame_${id}.pc {
      ${cases.map(({label,code})=>`case ${label}u: {${rewrite(code)}}`).join('\n')}
      default: {frame_${id}.done=true;}
    }
    if(vb_error!=0u) {
      ${rewrite(`if(error_mode==0u || handler_active || vb_fatal) {${abort}}
      vb_last_error=vb_error;vb_error=0u;error_pc=statement_pc;done=false;
      if(error_mode==1u) {pc=statement_pc+1u;} else {handler_active=true;pc=handler;}`)}
    }
    if(vb_halt) {${abort}}
    if(frame_${id}.done) {${finish}vb_current=frame_${id}.caller;}
  }`;
}

export function emitDispatcher(ids,entry) {
  return `frame_${entry}.caller=0u;frame_${entry}.pc=0xffffffffu;vb_current=${entry}u;
  loop {
    if(vb_current==0u) {break;}
    switch vb_current {
      ${ids.map(id=>`case ${id}u: {step_${id}();}`).join('\n')}
      default: {fatal(10004u);vb_current=0u;}
    }
  }`;
}
