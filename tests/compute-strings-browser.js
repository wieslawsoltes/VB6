/** Production WGSL execution and host IO tests on an actual WebGPU adapter. */
globalThis.runComputeStringTests=async function({gpu,test,equal,ok}) {
  const {STRING_CASES}=await import('/tests/compute-string-cases.js');
  const {compileCompute,ComputeProgram}=VB6Compute;
  for(const c of STRING_CASES)await test('String GPU: '+c.name,async()=>{
    const p=await ComputeProgram.create(gpu,compileCompute(c.source,c.options));
    try{const [lane]=await p.run();for(const [name,value] of Object.entries(c.expected))equal(lane.globals['Module1.'+name],value);}finally{await p.dispose();}
  });
  await test('String host writes and reset preserve lane isolation',async()=>{
    const a=compileCompute('Public s As String\nSub Main()\ns=s & "!"\nEnd Sub');const p=await ComputeProgram.create(gpu,a,{count:2,fuel:10000});
    try{await p.writeGlobal('s','A\0😀',0);await p.writeGlobal('s','B',1);const lanes=await p.run();equal(lanes.map(l=>l.globals['Module1.s']),['A\0😀!','B!']);await p.reset();equal((await p.readState()).map(l=>l.globals['Module1.s']),['','']);}finally{await p.dispose();}
  });
  await test('dynamic String array initialization and writes preserve descriptors',async()=>{
    const a=compileCompute('Public a() As String\nSub Main()\na(2)=a(2) & "!"\nEnd Sub');const p=await ComputeProgram.create(gpu,a);
    try{await p.initializeArray('a',[[1,2]],['one','two']);equal((await p.run())[0].globals['Module1.a'],['one','two!']);await p.writeGlobal('a',['A','B']);equal((await p.run())[0].globals['Module1.a'],['A','B!']);await p.initializeArray('a',[[0,0]]);equal((await p.readState())[0].globals['Module1.a'],['']);}finally{await p.dispose();}
  });
  await test('invalid String host array writes are transactional',async()=>{
    const p=await ComputeProgram.create(gpu,compileCompute('Public a() As String\nSub Main()\nEnd Sub',{maxStringLength:4}));
    try{await p.initializeArray('a',[[1,2]],['one','two']);let failed=false;try{await p.writeGlobal('a',['ok','12345']);}catch{failed=true;}ok(failed);equal((await p.readState())[0].globals['Module1.a'],['one','two']);failed=false;try{await p.initializeArray('a',[[1,2]],['new',42]);}catch{failed=true;}ok(failed);equal((await p.readState())[0].globals['Module1.a'],['one','two']);}finally{await p.dispose();}
  });
  await test('String array element ByRef lock survives error unwinding',async()=>{
    const source='Public a() As String\nPublic n As Long\nSub Main()\nReDim a(1)\na(0)="keep"\nOn Error Resume Next\nResize a(0)\nn=Err.Number\nReDim Preserve a(2)\nEnd Sub\nSub Resize(ByRef s As String)\nReDim a(4)\nEnd Sub';
    const p=await ComputeProgram.create(gpu,compileCompute(source));try{const [l]=await p.run();equal(l.globals['Module1.n'],10);equal(l.globals['Module1.a'],['keep','','']);}finally{await p.dispose();}
  });
  await test('string search exhaustion cannot be swallowed by On Error',async()=>{
    const source='Public s As String\nPublic n As Long\nSub Main()\ns="keep"\nOn Error Resume Next\nn=InStr("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","aaaaaaab")\ns="lost"\nEnd Sub';
    const p=await ComputeProgram.create(gpu,compileCompute(source),{fuel:30});try{const [l]=await p.run({throwOnError:false});equal(l.error,10001);equal(l.fatal,true);equal(l.globals['Module1.s'],'keep');}finally{await p.dispose();}
  });
  await test('String per-run slabs have no accumulating allocation',async()=>{
    const a=compileCompute('Public s As String\nSub Main()\ns=Left$(s & "x",4)\nEnd Sub',{maxStringLength:8});const p=await ComputeProgram.create(gpu,a);
    try{for(let i=0;i<12;i++)await p.run();equal((await p.readState())[0].globals['Module1.s'],'xxxx');equal(p.state.size,a.stateStride*4);}finally{await p.dispose();}
  });
};
