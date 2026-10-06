/** Compare GPU words to Windows Automation, not a second approximate JS engine. */
globalThis.runComputeCurrencyTests=async function({gpu,test,equal,ok}) {
  const {DOUBLE_WGSL}=await import('/packages/vb6-compute/src/double-wgsl.js');
  const {CURRENCY_WGSL}=await import('/packages/vb6-compute/src/currency-wgsl.js');
  const {compileCompute,ComputeProgram,ComputeKernel}=VB6Compute;
  const response=await fetch('/reports/compute/oracle/numeric.json');
  if(!response.ok)throw new Error('Native Automation reference is required');
  const oracle=await response.json(),groups=new Map();for(const c of oracle.cases){if(!groups.has(c.op))groups.set(c.op,[]);groups.get(c.op).push(c);}
  for(const [op,cases] of groups)await test(`Windows Automation ${op}: ${cases.length} GPU word/error comparisons`,async()=>{
    const input=gpu.buffer(cases.length*16,128|8),output=gpu.buffer(cases.length*16,128|4);let kernel;
    try{gpu.device.queue.writeBuffer(input,0,new Uint32Array(cases.flatMap(c=>[...c.a,...c.b])));
      const call={'cy-add':'cy_add(a,b)','cy-sub':'cy_sub(a,b)','cy-mul':'cy_mul(a,b)','cy-neg':'cy_neg(a)','cy-abs':'cy_abs(a)','cy-fix':'cy_fix(a)','cy-floor':'cy_floor(a)','cy-to-double':'cy_to_d(a)','cy-to-long':'vec2<u32>(bitcast<u32>(cy_to_i(a)),0u)','double-to-cy':'cy_from_d(a)'}[op];
      ok(call,'Unknown native reference operation '+op);
      const stub=`var<private> vb_error:u32;var<private> vb_halt:bool;var<private> mem:array<u32,4>;fn fail(n:u32){if(vb_error==0u){vb_error=n;}}fn array_charge(n:u32)->bool{return true;}`;
      kernel=await ComputeKernel.create(gpu,{code:stub+DOUBLE_WGSL+CURRENCY_WGSL+`@group(0) @binding(0) var<storage,read> inputs:array<vec4<u32>>;@group(0) @binding(1) var<storage,read_write> outputs:array<vec4<u32>>;@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=${cases.length}u){return;}let a=inputs[id.x].xy;let b=inputs[id.x].zw;vb_error=0u;let r=${call};outputs[id.x]=vec4<u32>(r,vb_error,0u);}`});
      await kernel.bind(0,[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]);await kernel.dispatch(Math.ceil(cases.length/64));const words=new Uint32Array(await gpu.operation(()=>gpu.readBuffer(output)));
      const failures=[];cases.forEach((c,i)=>{const actual=[...words.slice(i*4,i*4+3)],expected=[...c.result,c.error];if(JSON.stringify(actual)!==JSON.stringify(expected))failures.push({a:c.a,b:c.b,actual,expected});});
      if(failures.length)throw new Error(`${failures.length} native ${op} mismatches: ${JSON.stringify(failures.slice(0,5))}`);
    }finally{kernel?.dispose();gpu.release(input);gpu.release(output);}
  });
  for(const [name,body,expected] of [
    ['one ten-thousandth at maximum','result=922337203685477.5806@+0.0001@','922337203685477.5807'],
    ['Currency multiplication tie','result=0.0001@*1.5@','0.0002'],
    ['negative minimum literal','result=-922337203685477.5808@','-922337203685477.5808'],
    ['Currency narrowing','result=CCur(1.2345#)','1.2345'],
    ['Currency loop','Dim i As Currency\nFor i=1@ To 6@\nresult=result+i\nNext','21.0000']
  ])await test('VB Currency '+name,async()=>{const p=await ComputeProgram.create(gpu,compileCompute(`Public result As Currency\nSub Main()\n${body}\nEnd Sub`));try{equal((await p.run())[0].globals['Module1.result'],expected);}finally{await p.dispose();}});
  await test('Currency host arrays and recursive call preserve low bits',async()=>{
    const source='Public a() As Currency\nPublic result As Currency\nSub Main()\nReDim Preserve a(1 To 3)\nresult=Increment(a(1),3&)\na(3)=result\nEnd Sub\nFunction Increment(ByVal x As Currency,ByVal n As Long) As Currency\nIf n=0& Then\nIncrement=x\nElse\nIncrement=Increment(x+0.0001@,n-1&)\nEnd If\nEnd Function';
    const p=await ComputeProgram.create(gpu,compileCompute(source,{maxCallDepth:5}));try{await p.initializeArray('a',[[1,2]],['900000000000000.0001','0.0002']);const [l]=await p.run();equal(l.globals['Module1.result'],'900000000000000.0004');equal(l.globals['Module1.a'],['900000000000000.0001','0.0002','900000000000000.0004']);}finally{await p.dispose();}
  });
};
