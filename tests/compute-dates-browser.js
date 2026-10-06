globalThis.runComputeDateTests=async function({gpu,test,equal,ok}) {
  const {DOUBLE_WGSL}=await import('/packages/vb6-compute/src/double-wgsl.js');
  const {dateWGSL}=await import('/packages/vb6-compute/src/date-wgsl.js');
  const {ComputeKernel,ComputeProgram,compileCompute}=VB6Compute;
  const response=await fetch('/reports/compute/oracle/numeric.json');if(!response.ok)throw new Error('Native calendar reference is required');
  const {dates:cases}=await response.json();
  await test(`Gregorian OLE Date: ${cases.length} native field comparisons`,async()=>{
    const input=gpu.buffer(cases.length*8,128|8),output=gpu.buffer(cases.length*36,128|4);let k;
    try{gpu.device.queue.writeBuffer(input,0,new Uint32Array(cases.flatMap(c=>c.a)));
      const stub=`var<private> vb_error:u32;var<private> vb_halt:bool;var<private> mem:array<u32,4>;fn fail(n:u32){if(vb_error==0u){vb_error=n;}}fn array_charge(n:u32)->bool{return true;}`;
      k=await ComputeKernel.create(gpu,{code:stub+DOUBLE_WGSL+dateWGSL()+`@group(0) @binding(0) var<storage,read> input:array<vec2<u32>>;@group(0) @binding(1) var<storage,read_write> output:array<u32>;@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=${cases.length}u){return;}let a=input[id.x];let d=dt_parts(a);let seconds=dt_seconds(a);let base=id.x*9u;output[base]=u32(d.x);output[base+1u]=u32(d.y);output[base+2u]=u32(d.z);output[base+3u]=u32(dt_weekday(a,1i));output[base+4u]=u32(seconds/3600i);output[base+5u]=u32((seconds/60i)%60i);output[base+6u]=u32(seconds%60i);output[base+7u]=u32(dt_part(3u,a,1i,1i));output[base+8u]=vb_error;}`});
      await k.bind(0,[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]);await k.dispatch(Math.ceil(cases.length/64));const words=new Uint32Array(await gpu.operation(()=>gpu.readBuffer(output)));
      const failures=[];cases.forEach((c,i)=>{const actual=[...words.slice(i*9,i*9+9)],expected=[...c.fields,c.error];if(JSON.stringify(actual)!==JSON.stringify(expected))failures.push({a:c.a,actual,expected});});
      if(failures.length)throw new Error(`${failures.length} native Date mismatches: ${JSON.stringify(failures.slice(0,8))}`);
    }finally{k?.dispose();gpu.release(input);gpu.release(output);}
  });
  const bodies=[
    ['DateSerial leap day','result=DateSerial(2024,2,29)\nn=Year(result)*10000&+Month(result)*100&+Day(result)',20240229],
    ['DateSerial overflow normalization','result=DateSerial(2024,3,0)\nn=Day(result)',29],
    ['DateSerial two digit year','result=DateSerial(30,1,1)\nn=Year(result)',1930],
    ['TimeSerial overflow','result=TimeSerial(25,-60,1)\nn=Day(result)*10000&+Hour(result)*100&+Second(result)',310001],
    ['negative OLE fractions','result=CDate(-1.75#)\nn=Day(result)*100&+Hour(result)',2918],
    ['month end clipping','result=DateAdd("m",1,DateSerial(2024,1,31))\nn=Day(result)',29],
    ['year clipping','result=DateAdd("yyyy",1,DateSerial(2024,2,29))\nn=Day(result)',28],
    ['pre-epoch day addition','result=DateAdd("d",2,CDate(-1.75#))\nn=Day(result)*100&+Hour(result)',3118],
    ['day difference','n=DateDiff("d",DateSerial(2024,2,28),DateSerial(2024,3,1))',2],
    ['week start','n=Weekday(DateSerial(2024,1,1),2)',1],
    ['day of year','n=DatePart("y",DateSerial(2024,12,31))',366]
  ];
  for(const [name,body,want] of bodies)await test('GPU '+name,async()=>{const p=await ComputeProgram.create(gpu,compileCompute(`Public result As Date\nPublic n As Long\nSub Main()\n${body}\nEnd Sub`));try{const [l]=await p.run();equal(l.globals['Module1.n'],want);}finally{await p.dispose();}});
  await test('captured host clock is explicit and stable across GPU lanes',async()=>{
    const p=await ComputeProgram.create(gpu,compileCompute('Public instant As Date\nPublic day As Date\nPublic timeOfDay As Date\nSub Main()\ninstant=Now\nday=Date\ntimeOfDay=Time\nEnd Sub'),{count:4,fuel:10000});
    try{for(const l of await p.run({now:45351.5})){equal(l.globals['Module1.instant'],45351.5);equal(l.globals['Module1.day'],45351);equal(l.globals['Module1.timeOfDay'],0.5);}}finally{await p.dispose();}
  });
  await test('Date range failures preserve assigned values',async()=>{const p=await ComputeProgram.create(gpu,compileCompute('Public a As Date\nPublic n As Long\nSub Main()\na=CDate(42#)\nOn Error Resume Next\na=CDate(3000000#)\nn=Err.Number\nEnd Sub'));try{const [l]=await p.run();equal(l.globals['Module1.a'],42);equal(l.globals['Module1.n'],6);}finally{await p.dispose();}});
};
