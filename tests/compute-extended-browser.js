/** Real GPU assertions for ABI 2, dynamic arrays, bounded calls and subroutines. */
globalThis.runComputeExtendedTests=async function({gpu,test,equal,ok}) {
  const {compileCompute,ComputeProgram}=VB6Compute;
  const source=body=>`Option Explicit\nPublic a() As Long\nPublic result As Long\nSub Main()\n${body}\nEnd Sub`;
  const plain=body=>`Public result As Long\nSub Main()\n${body}\nEnd Sub`;
  async function run(code,{compile={},program={},execution={}}={}){
    const p=await ComputeProgram.create(gpu,compileCompute(code,compile),program);
    try{return await p.run(execution);}finally{await p.dispose();}
  }
  const result=lanes=>lanes[0].globals['Module1.result'];
  for(const [name,body,expected] of [
    ['dynamic ReDim and indexing','ReDim a(1 To 2)\na(1)=10&\na(2)=32&\nresult=a(1)+a(2)',42],
    ['multidimensional Preserve growth','ReDim a(-1 To 1,4 To 5)\na(0,5)=42&\nReDim Preserve a(-1 To 1,4 To 6)\nresult=a(0,5)+a(1,6)',42],
    ['Preserve shrink then grow zeros discarded cells','ReDim a(3)\na(0)=42&\na(3)=99&\nReDim Preserve a(1)\nReDim Preserve a(3)\nresult=a(0)+a(3)',42],
    ['failed lower-bound change preserves old data','ReDim a(2)\na(0)=33&\nOn Error Resume Next\nReDim Preserve a(1 To 4)\nresult=a(0)+Err.Number',42],
    ['non-final dimension Preserve change fails','ReDim a(1 To 2,1 To 2)\nOn Error Resume Next\nReDim Preserve a(1 To 3,1 To 2)\nresult=Err.Number',9],
    ['Preserve rank change fails','ReDim a(1 To 2)\nOn Error Resume Next\nReDim Preserve a(1 To 2,1 To 2)\nresult=Err.Number',9],
    ['ReDim without Preserve changes rank and clears data','ReDim a(2)\na(0)=99&\nReDim a(1 To 2,4 To 5)\nresult=a(1,4)+37&+UBound(a,2)',42],
    ['Erase dynamic arrays returns them to unallocated state','ReDim a(2)\nErase a\nresult=33&\nOn Error Resume Next\nresult=LBound(a)\nresult=result+Err.Number',42],
    ['full signed lower-bound range is usable','ReDim a(-2147483648& To -2147483646&)\na(-2147483647&)=42&\nresult=a(-2147483647&)',42],
  ])await test(name,async()=>equal(result(await run(source(body))),expected));
  await test('dynamic capacity failure is recoverable and transactional',async()=>{
    equal(result(await run(source('ReDim a(7)\na(0)=35&\nOn Error Resume Next\nReDim a(100)\nresult=a(0)+Err.Number'),{compile:{dynamicArrayCapacity:8}})),42);
  });
  await test('fixed Erase retains bounds and zeros values',async()=>{
    equal(result(await run('Public a(1 To 2) As Long\nPublic result As Long\nSub Main()\na(1)=99&\nErase a\nresult=a(1)+LBound(a)+41&\nEnd Sub')),42);
  });
  await test('ByRef whole dynamic arrays can be resized',async()=>{
    equal(result(await run(source('Resize a\nresult=a(4)')+'\nSub Resize(ByRef values() As Long)\nReDim values(1 To 4)\nvalues(4)=42&\nEnd Sub')),42);
  });
  await test('ByRef fixed arrays cannot be resized',async()=>{
    const code='Public a(2) As Long\nPublic result As Long\nSub Main()\nOn Error Resume Next\nResize a\nresult=Err.Number\nEnd Sub\nSub Resize(ByRef values() As Long)\nReDim values(4)\nEnd Sub';
    equal(result(await run(code)),10);
  });
  await test('ByRef elements lock dynamic array shape for the duration of a call',async()=>{
    const code=source('ReDim a(1)\na(0)=32&\nMutate a(0)\nresult=result+a(0)')+'\nSub Mutate(ByRef x As Long)\nOn Error Resume Next\nReDim a(5)\nresult=Err.Number\nEnd Sub';
    equal(result(await run(code)),42);
  });
  await test('error unwinding releases ByRef element locks',async()=>{
    const code=source('ReDim a(1)\nOn Error Resume Next\nMutate a(0)\nReDim a(4)\nresult=UBound(a)+38&')+'\nSub Mutate(ByRef x As Long)\nError 5\nEnd Sub';
    equal(result(await run(code)),42);
  });
  await test('dynamic array memory operations obey the fuel budget',async()=>{
    const lanes=await run(source('On Error Resume Next\nReDim a(127)'),{program:{fuel:20},execution:{throwOnError:false}});
    equal(lanes[0].error,10001);equal(lanes[0].arrays['Module1.a'].allocated,false);
  });
  await test('host initialization and writes honor runtime array bounds',async()=>{
    const p=await ComputeProgram.create(gpu,compileCompute(source('result=a(1)+a(2)')));
    try{
      await p.initializeArray('a',[[1,2]],[10,32]);equal(result(await p.run()),42);
      const values=[21,21],write=p.writeGlobal('a',values);values[0]=99;await write;equal(result(await p.run()),42);
      let rejected=false;try{await p.writeGlobal('a',[1]);}catch(e){rejected=e.code==='GPU_VALUE';}ok(rejected);
      equal((await p.readState())[0].arrays['Module1.a'].bounds,[[1,2]]);
    }finally{await p.dispose();}
  });
  await test('automatic dynamic locals are unallocated on each call',async()=>{
    const p=await ComputeProgram.create(gpu,compileCompute(plain('Dim values() As Long\nOn Error Resume Next\nresult=LBound(values)\nresult=Err.Number\nReDim values(2)')));
    try{equal(result(await p.run()),9);equal(result(await p.run()),9);}finally{await p.dispose();}
  });
  await test('static dynamic arrays retain their data across dispatches',async()=>{
    const p=await ComputeProgram.create(gpu,compileCompute(plain('Static values() As Long\nIf result=0& Then ReDim values(2)\nvalues(0)=values(0)+1&\nresult=values(0)')));
    try{equal(result(await p.run()),1);equal(result(await p.run()),2);}finally{await p.dispose();}
  });
  for(const [name,body,expected] of [
    ['nested GoSub returns in order','GoSub first\nExit Sub\nfirst:\nresult=result+20&\nGoSub second\nReturn\nsecond:\nresult=result+22&\nReturn',42],
    ['computed GoTo selects the correct destination','On 2 GoTo first,second\nExit Sub\nfirst:\nresult=1&\nExit Sub\nsecond:\nresult=42&',42],
    ['computed GoSub uses ties-to-even conversion','On 1.5! GoSub first,second\nExit Sub\nfirst:\nresult=1&\nReturn\nsecond:\nresult=42&\nReturn',42],
    ['negative computed branch raises error 5','On Error Resume Next\nOn -1 GoTo first\nresult=Err.Number\nExit Sub\nfirst:\nresult=99&',5],
    ['out-of-list computed branch falls through','On 255 GoTo first\nresult=42&\nExit Sub\nfirst:\nresult=99&',42],
    ['Return without GoSub raises error 3','On Error Resume Next\nReturn\nresult=Err.Number',3],
    ['user-raised high error codes remain catchable','On Error Resume Next\nError 50000\nresult=Err.Number',50000],
  ])await test(name,async()=>equal(result(await run(plain(body))),expected));
  await test('GoSub stack depth is enforced',async()=>{
    const lanes=await run(plain('GoSub again\nExit Sub\nagain:\nGoSub again\nReturn'),{compile:{gosubStackDepth:3},execution:{throwOnError:false}});equal(lanes[0].error,28);
  });
  await test('recursive Function computes factorial on GPU',async()=>{
    const code=plain('result=Fact(6&)')+'\nFunction Fact(ByVal n As Long) As Long\nIf n<2& Then\nFact=1&\nElse\nFact=n*Fact(n-1&)\nEnd If\nEnd Function';equal(result(await run(code)),720);
  });
  await test('multiple recursive calls preserve automatic frames',async()=>{
    const code=plain('result=Fib(8&)')+'\nFunction Fib(ByVal n As Long) As Long\nIf n<2& Then\nFib=n\nElse\nFib=Fib(n-1&)+Fib(n-2&)\nEnd If\nEnd Function';equal(result(await run(code,{compile:{maxCallDepth:10}})),21);
  });
  await test('mutually recursive procedures form a bounded WGSL DAG',async()=>{
    const code=plain('result=CLng(EvenNumber(8&))')+'\nFunction EvenNumber(ByVal n As Long) As Boolean\nIf n=0& Then\nEvenNumber=True\nElse\nEvenNumber=OddNumber(n-1&)\nEnd If\nEnd Function\nFunction OddNumber(ByVal n As Long) As Boolean\nIf n=0& Then\nOddNumber=False\nElse\nOddNumber=EvenNumber(n-1&)\nEnd If\nEnd Function';equal(result(await run(code,{compile:{maxCallDepth:10}})),-1);
  });
  await test('recursive Static locals are shared across frames',async()=>equal(result(await run(plain('Static n As Long\nn=n+1&\nIf n<3& Then Main\nresult=n'),{compile:{maxCallDepth:4}})),3));
  await test('call depth exhaustion reports error 28 instead of invalid WGSL',async()=>{
    const lanes=await run(plain('Main'),{compile:{maxCallDepth:4},execution:{throwOnError:false}});equal(lanes[0].error,28);
  });
  await test('caller error handler catches recursive stack exhaustion',async()=>{
    const code=plain('On Error Resume Next\nInfinite\nresult=Err.Number')+'\nSub Infinite()\nInfinite\nEnd Sub';equal(result(await run(code,{compile:{maxCallDepth:4}})),28);
  });
};
