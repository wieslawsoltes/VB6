/** Executed in a real Chromium WebGPU context by tools/compute-browser-tests.py. */
globalThis.runComputeBrowserTests=async function() {
  const {compileCompute,ComputeDevice,ComputeProgram,ComputeScene,ComputePath,ComputeRenderer,ComputeKernel}=VB6Compute;
  const tests=[];let gpu;
  const equal=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);};
  const ok=(value,message='Assertion failed')=>{if(!value)throw new Error(message);};
  const test=async(name,fn)=>{
    console.log('COMPUTE_PROGRESS:'+JSON.stringify({phase:'start',name}));
    const start=performance.now();
    try{await fn();tests.push({name,passed:true,ms:performance.now()-start});}
    catch(error){tests.push({name,passed:false,error:error.message,code:error.code,stack:error.stack});}
    console.log('COMPUTE_PROGRESS:'+JSON.stringify({phase:'finish',...tests.at(-1)}));
  };
  const make=body=>`Option Explicit\nPublic result As Long\nSub Main()\n${body}\nEnd Sub`;
  const run=async(code,options={},runOptions={})=>{const p=await ComputeProgram.create(gpu,compileCompute(code),options);try{return await p.run(runOptions);}finally{await p.dispose();}};
  const value=lanes=>lanes[0].globals['Module1.result'];
  const pixel=(bytes,x,y,w=64)=>[...bytes.slice((y*w+x)*4,(y*w+x)*4+4)];
  const near=(a,b,tolerance=1)=>a.forEach((v,i)=>ok(Math.abs(v-b[i])<=tolerance,`Channel ${i}: ${v} != ${b[i]}`));
  const rendered=async(scene,fn,options={})=>{const r=await ComputeRenderer.create(gpu,{width:scene.width,height:scene.height,...options});try{await r.render(scene);await fn(await r.readPixels(),r);}finally{await r.dispose();}};
  try{gpu=await ComputeDevice.request();}catch(error){return {available:false,error:error.message,tests};}
  const info=gpu.device.adapterInfo||{};
  await test('parameterless empty Sub emits valid WGSL',async()=>{const a=await run('Sub Main()\nEnd Sub');equal(a[0].error,0);});
  await test('Long arithmetic executes on GPU',async()=>equal(value(await run(make('result = 6& * 7&'))),42));
  for(const [name,expr,expected] of [
    ['addition overflow','2147483647& + 1&',6],['subtraction overflow','-2147483648& - 1&',6],
    ['multiplication overflow','50000& * 50000&',6],['divide by zero','42& \\ 0&',11],['division overflow','-2147483648& \\ -1&',6]
  ])await test(name,async()=>{const a=await run(make('result = '+expr),{},{throwOnError:false});equal(a[0].error,expected);equal(a[0].line,4);});
  await test('minimum Long remainder is zero',async()=>equal(value(await run(make('result = -2147483648& Mod -1&'))),0));
  await test('VB True is -1 in arithmetic',async()=>equal(value(await run(make('result = CLng(True)'))),-1));
  await test('Single-to-Integer uses ties-to-even rounding',async()=>equal(value(await run(make('result = CInt(42.5!) + CInt(0.5!)'))),42));
  await test('ByVal function call returns typed result',async()=>equal(value(await run(make('result=Twice(21&)')+'\nFunction Twice(ByVal x As Long) As Long\nTwice=x*2&\nEnd Function')),42));
  await test('ByRef aliases refer to the same cell',async()=>equal(value(await run(make('Bump result, result')+'\nSub Bump(ByRef a As Long, ByRef b As Long)\na=1&\nb=b+41&\nEnd Sub')),42));
  await test('ByRef parenthesized argument is an isolated temporary',async()=>equal(value(await run(make('result=42&\nBump (result)')+'\nSub Bump(ByRef n As Integer)\nn=7\nEnd Sub')),42));
  await test('Optional and named arguments',async()=>equal(value(await run(make('result=Sum(b:=2&)')+'\nFunction Sum(Optional ByVal a As Long=40, Optional ByVal b As Long=1) As Long\nSum=a+b\nEnd Function')),42));
  await test('For loop evaluates bounds once',async()=>equal(value(await run(make('Dim i As Long\nFor i=1& To 6&\nresult=result+7&\nNext i'))),42));
  await test('descending For and Exit For',async()=>equal(value(await run(make('Dim i As Long\nFor i=10& To 1& Step -1&\nresult=result+i\nIf i=6& Then Exit For\nNext\nresult=result+2&'))),42));
  await test('Do Loop and While branch control',async()=>equal(value(await run(make('Do While result<20&\nresult=result+1&\nLoop\nWhile result<42&\nresult=result+1&\nWend'))),42));
  await test('Select Case range',async()=>equal(value(await run(make('result=5&\nSelect Case result\nCase 1& To 9&\nresult=42&\nCase Else\nresult=0&\nEnd Select'))),42));
  await test('fixed multidimensional arrays and ByRef array parameter',async()=>equal(value(await run('Public result As Long\nPublic a(-2 To 2,3 To 4) As Long\nSub Main()\na(0,4)=42&\nReadArray a\nEnd Sub\nSub ReadArray(ByRef values() As Long)\nresult=values(0,4)\nEnd Sub')),42));
  await test('array bounds violations report VB error 9',async()=>{const a=await run(make('Dim a(1 To 3) As Long\nresult=a(4)'),{},{throwOnError:false});equal(a[0].error,9);});
  await test('On Error Resume Next preserves failed assignment',async()=>equal(value(await run(make('result=31&\nOn Error Resume Next\nresult=1& \\ 0&\nresult=result+Err.Number'))),42));
  await test('On Error GoTo and Resume Next',async()=>equal(value(await run(make('On Error GoTo handler\nresult=1& \\ 0&\nresult=result+31&\nExit Sub\nhandler:\nresult=Err.Number\nResume Next'))),42));
  await test('instruction budget is fatal even with an error handler',async()=>{const a=await run(make('On Error Resume Next\nDo\nresult=result+1&\nLoop'),{fuel:20},{throwOnError:false});equal(a[0].error,10001);});
  await test('draw-buffer overflow is diagnosed',async()=>{const a=await run(make('ComputeClear 0&\nComputeClear 0&'),{capacity:1},{throwOnError:false});equal(a[0].error,10002);});
  await test('math domain errors are checked',async()=>{const a=await run(make('result=CLng(ComputeSqrt(-1!))'),{},{throwOnError:false});equal(a[0].error,5);});
  await test('static locals survive serialized concurrent invocations',async()=>{
    const p=await ComputeProgram.create(gpu,compileCompute(make('Static n As Long\nn=n+1&\nresult=n')));
    try{const [a,b]=await Promise.all([p.run(),p.run()]);equal([value(a),value(b)],[1,2]);await p.reset();equal(value(await p.run()),1);}finally{await p.dispose();}
  });
  await test('parallel lane-private state and shared atomics',async()=>{
    const p=await ComputeProgram.create(gpu,compileCompute(make('result=ComputeIndex()+10&\nComputeAtomicAdd 0&,1&')),{count:64,fuel:1000});
    try{const a=await p.run();equal(a.map(x=>x.globals['Module1.result']),Array.from({length:64},(_,i)=>i+10));equal([...await p.readShared()],[64]);}finally{await p.dispose();}
  });
  await test('GPU-resident shared buffer chains two VB kernels',async()=>{
    const shared=gpu.buffer(4,128|4|8);let a,b;
    try{a=await ComputeProgram.create(gpu,compileCompute(make('ComputeAtomicAdd 0&,1&')),{count:16,fuel:1000,sharedBuffer:shared});b=await ComputeProgram.create(gpu,compileCompute(make('result=ComputeLoadLong(0&)')),{sharedBuffer:shared});await a.run({readback:false});await b.reset();equal(value(await b.run()),16);}finally{await a?.dispose();await b?.dispose();gpu.release(shared);}
  });
  await test('raw WGSL workgroup barriers and indirect dispatch',async()=>{
    const data=gpu.buffer(8,128|4|8),indirect=gpu.buffer(12,256|8);let kernel;
    try{gpu.device.queue.writeBuffer(indirect,0,new Uint32Array([2,1,1]));kernel=await ComputeKernel.create(gpu,{code:`@group(0) @binding(0) var<storage,read_write> data:array<u32>;var<workgroup> values:array<u32,16>;@compute @workgroup_size(16) fn main(@builtin(local_invocation_index) i:u32,@builtin(workgroup_id) group:vec3<u32>){values[i]=1u;workgroupBarrier();if(i==0u){var total=0u;for(var j=0u;j<16u;j+=1u){total+=values[j];}data[group.x]=total;}}`});await kernel.bind(0,[{binding:0,resource:{buffer:data}}]);await kernel.dispatchIndirect(indirect);const result=await gpu.operation(()=>gpu.readBuffer(data));equal([...new Uint32Array(result)],[16,16]);}finally{kernel?.dispose();gpu.release(data);gpu.release(indirect);}
  });
  await test('program-generated draw commands render without CPU command readback',async()=>{
    const p=await ComputeProgram.create(gpu,compileCompute(make('ComputeClear RGB(12,24,36)\nComputeRect 8!,8!,20!,20!,RGB(255,0,0)\nComputeCircle 44!,44!,8!,RGB(0,255,0)')),{width:64,height:64});let r;
    try{await p.run({readback:false});r=await ComputeRenderer.create(gpu,{width:64,height:64});await r.render(p);const pixels=await r.readPixels();equal(pixel(pixels,0,0),[12,24,36,255]);equal(pixel(pixels,16,16),[255,0,0,255]);equal(pixel(pixels,44,44),[0,255,0,255]);}finally{await r?.dispose();await p.dispose();}
  });
  await test('empty scenes produce transparent output',async()=>rendered(new ComputeScene(64,64),bytes=>equal(pixel(bytes,10,10),[0,0,0,0])));
  await test('alpha compositing is premultiplied',async()=>rendered(new ComputeScene(64,64).rect(0,0,64,64,[1,0,0,0.5]),bytes=>near(pixel(bytes,10,10),[128,0,0,128])));
  await test('gradients are evaluated in compute',async()=>rendered(new ComputeScene(64,64).rect(0,0,64,64,{from:[1,0,0,1],to:[0,0,1,1],line:[0,0,64,0]}),bytes=>{ok(pixel(bytes,4,30)[0]>230);ok(pixel(bytes,60,30)[2]>230);}));
  await test('affine transforms and device-space clips',async()=>rendered(new ComputeScene(64,64).rect(0,0,20,20,[1,0,0,1],{transform:[1,0,0,1,10,10],clip:[15,15,64,64]}),bytes=>{equal(pixel(bytes,12,12),[0,0,0,0]);equal(pixel(bytes,20,20),[255,0,0,255]);}));
  await test('singular transforms do not render invalid geometry',async()=>rendered(new ComputeScene(64,64).rect(0,0,50,50,[1,0,0,1],{transform:[0,0,0,0,10,10]}),bytes=>equal(pixel(bytes,10,10),[0,0,0,0])));
  await test('quadratic and cubic path flattening and winding fill',async()=>{
    const path=new ComputePath().moveTo(8,8).quadraticCurveTo(32,0,56,8).lineTo(56,48).bezierCurveTo(40,60,24,60,8,48).closePath();
    await rendered(new ComputeScene(64,64).path(path,[1,0,0,1]),bytes=>{equal(pixel(bytes,32,32),[255,0,0,255]);equal(pixel(bytes,0,0),[0,0,0,0]);});
  });
  await test('even-odd fill rule creates holes across contours',async()=>{
    const p=new ComputePath().moveTo(4,4).lineTo(60,4).lineTo(60,60).lineTo(4,60).closePath().moveTo(20,20).lineTo(44,20).lineTo(44,44).lineTo(20,44).closePath();
    await rendered(new ComputeScene(64,64).path(p,[1,1,1,1],{fillRule:'evenodd'}),bytes=>{equal(pixel(bytes,10,10),[255,255,255,255]);equal(pixel(bytes,32,32),[0,0,0,0]);});
  });
  await test('separate open stroke contours are not implicitly closed',async()=>{
    const p=new ComputePath().moveTo(4,4).lineTo(28,4).lineTo(28,28).moveTo(36,36).lineTo(56,36);
    await rendered(new ComputeScene(64,64).path(p,[1,1,1,1],{fill:false,strokeWidth:2}),bytes=>equal(pixel(bytes,16,16),[0,0,0,0]));
  });
  await test('tile overflow uses ordered fallback, not dropped draws',async()=>{
    const scene=new ComputeScene(64,64).clear([0,0,0,1]);for(let i=0;i<8;i++)scene.rect(0,0,32,32,[i/7,1,0,1]);
    await rendered(scene,bytes=>equal(pixel(bytes,10,10),[255,255,0,255]),{tileCapacity:1});
  });
  await test('failed shader compilation releases buffers',async()=>{
    const before=gpu.resources.size,a=compileCompute(make(''));a.wgsl='not WGSL';let failed=false;
    try{await ComputeProgram.create(gpu,a);}catch(e){failed=e.code==='GPU_WGSL';}ok(failed);equal(gpu.resources.size,before);
  });
  await test('disposing a program rejects further execution',async()=>{const p=await ComputeProgram.create(gpu,compileCompute(make('')));await p.dispose();let rejected=false;try{p.run();}catch(e){rejected=e.code==='GPU_DISPOSED';}ok(rejected);});
  await runComputeExtendedTests({gpu,test,equal,ok});
  await runComputeStringTests({gpu,test,equal,ok});
  await runComputeDoubleTests({gpu,test,equal,ok});
  const resources=gpu.resources.size;
  await gpu.dispose();
  return {available:true,adapter:{vendor:info.vendor,architecture:info.architecture,device:info.device,description:info.description},tests,passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,resourcesAfterTests:resources};
};
