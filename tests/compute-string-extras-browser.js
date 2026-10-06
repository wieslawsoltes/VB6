/** Production WGSL only. Expected arrays/booleans are fixed independent fixtures. */
globalThis.runComputeStringExtrasTests=async function({gpu,test,equal,ok}) {
  const {EXTRA_STRING_CASES}=await import('/tests/compute-string-extras-cases.js');
  const {compileCompute,ComputeProgram}=VB6Compute;
  async function execute(source,check,options={},runOptions={}) {
    const p=await ComputeProgram.create(gpu,compileCompute(source,{maxStringLength:64,...options}));
    try{const [lane]=await p.run(runOptions);await check(lane,p);}finally{await p.dispose();}
  }
  for(const c of EXTRA_STRING_CASES)await test('String extras GPU: '+c.name,()=>execute(c.source,l=>{
    for(const [name,value] of Object.entries(c.expected))equal(l.globals['Module1.'+name],value);
    if(c.expected.a)equal(l.arrays['Module1.a'].bounds,[[0,c.expected.a.length-1]]);
  }));
  for(const pattern of ['[','[abc','[z-a]','[!z-a]'])await test('Like malformed pattern '+pattern,()=>execute(`Public result As Long\nSub Main()\nresult=42&\nOn Error Resume Next\nresult=CLng("x" Like "${pattern}")\nresult=result+Err.Number\nEnd Sub`,l=>equal(l.globals['Module1.result'],135)));
  await test('Like worst-case work is bounded by fatal fuel',()=>execute('Public result As Long\nSub Main()\nOn Error Resume Next\nresult=CLng("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" Like "*a*a*a*a*a*a*a*a*a*a*a*b")\nEnd Sub',l=>{equal(l.error,10001);ok(l.fatal);},{},{fuel:100,throwOnError:false}));
  await test('Split capacity failure preserves complete old array',()=>execute('Public a() As String\nPublic n As Long\nSub Main()\nReDim a(0)\na(0)="keep"\nOn Error Resume Next\na=Split("a,b,c",",")\nn=Err.Number\nEnd Sub',l=>{equal(l.globals['Module1.a'],['keep']);equal(l.globals['Module1.n'],7);},{dynamicArrayCapacity:2}));
  await test('invalid Split limit preserves complete old array',()=>execute('Public a() As String\nPublic n As Long\nSub Main()\na=Split("keep")\nOn Error Resume Next\na=Split("a b"," ",-2)\nn=Err.Number\nEnd Sub',l=>{equal(l.globals['Module1.a'],['keep']);equal(l.globals['Module1.n'],5);}));
  await test('Filter fixed source and dynamic destination',()=>execute('Public source(4 To 6) As String\nPublic a() As String\nSub Main()\nsource(4)="A"\nsource(5)="B"\nsource(6)="AA"\na=Filter(source,"A")\nEnd Sub',l=>{equal(l.globals['Module1.a'],['A','AA']);equal(l.globals['Module1.source'],['A','B','AA']);}));
  await test('Filter rejects unallocated source without changing destination',()=>execute('Public source() As String\nPublic a() As String\nPublic n As Long\nSub Main()\na=Split("keep")\nOn Error Resume Next\na=Filter(source,"a")\nn=Err.Number\nEnd Sub',l=>{equal(l.globals['Module1.a'],['keep']);equal(l.globals['Module1.n'],13);}));
  await test('Split respects live ByRef element shape locks',()=>execute('Public a() As String\nPublic n As Long\nSub Main()\na=Split("keep")\nOn Error Resume Next\nChange a(0)\nn=Err.Number\nEnd Sub\nSub Change(ByRef x As String)\na=Split("new")\nEnd Sub',l=>{equal(l.globals['Module1.a'],['keep']);equal(l.globals['Module1.n'],10);}));
  await test('host empty result read/write/reset retains canonical metadata',()=>execute('Public a() As String\nSub Main()\na=Split("")\nEnd Sub',async(l,p)=>{equal(l.globals['Module1.a'],[]);await p.writeGlobal('a',[]);equal((await p.readState())[0].arrays['Module1.a'].bounds,[[0,-1]]);await p.initializeArray('a',[[0,-1]],[]);equal((await p.readState())[0].globals['Module1.a'],[]);await p.reset();equal((await p.readState())[0].arrays['Module1.a'].allocated,false);}));
};
