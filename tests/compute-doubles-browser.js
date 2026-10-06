/** Two complementary checks: bulk integer-word arithmetic vs IEEE host oracles,
 * and actual VB modules through compiler, persistent state and error handlers. */
globalThis.runComputeDoubleTests=async function({gpu,test,equal,ok}) {
  const {DOUBLE_WGSL}=await import('/packages/vb6-compute/src/double-wgsl.js');
  const {encodeDouble}=await import('/packages/vb6-compute/src/double-layout.js');
  const {compileCompute,ComputeProgram,ComputeKernel}=VB6Compute;
  const values=[0,-0,Number.MIN_VALUE,-Number.MIN_VALUE,2**-1022,-(2**-1022),Number.MAX_VALUE,-Number.MAX_VALUE,1,-1,0.5,-0.5,1+2**-52,1-2**-53,2**53,2147483647,2147483647.5,2147483648,4294967295.75,-2147483648.5,-2147483648.75,2.5,3.5,Math.PI,1e-300,1e300];
  let seed=0x14f32a1;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
  for(let i=0;i<256;i++) {const view=new DataView(new ArrayBuffer(8));view.setUint32(0,random(),true);view.setUint32(4,random()&0xffefffff,true);values.push(view.getFloat64(0,true));}
  const pairs=[];for(const x of values.slice(0,26))for(const y of values.slice(0,26))pairs.push([x,y]);
  for(let i=0;i<2048;i++)pairs.push([values[random()%values.length],values[random()%values.length]]);
  const words=new Uint32Array(pairs.flatMap(([a,b])=>[...encodeDouble(a),...encodeDouble(b)]));
  const input=gpu.buffer(words.byteLength,128|8),output=gpu.buffer(pairs.length*16,128|4);
  gpu.device.queue.writeBuffer(input,0,words);
  const stub=`var<private> vb_error:u32;var<private> vb_halt:bool;var<private> mem:array<u32,4>;fn fail(n:u32){if(vb_error==0u){vb_error=n;}}fn array_charge(n:u32)->bool{return true;}`;
  try {
    for(const [name,call,oracle] of [
      ['add','d_add(a,b)',(a,b)=>a+b],['subtract','d_sub(a,b)',(a,b)=>a-b],['multiply','d_mul(a,b)',(a,b)=>a*b],['divide','d_div(a,b)',(a,b)=>a/b],['sqrt','d_sqrt(a)',a=>Math.sqrt(a)],['truncate','d_fix(a)',a=>Math.trunc(a)],['floor','d_floor(a)',a=>Math.floor(a)]
    ])await test(`binary64 ${name}: ${pairs.length} exact bit/error comparisons`,async()=>{
      const kernel=await ComputeKernel.create(gpu,{code:stub+DOUBLE_WGSL+`@group(0) @binding(0) var<storage,read> inputs:array<vec4<u32>>;@group(0) @binding(1) var<storage,read_write> outputs:array<vec4<u32>>;@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){if(id.x>=${pairs.length}u){return;}let a=inputs[id.x].xy;let b=inputs[id.x].zw;vb_error=0u;let r=${call};outputs[id.x]=vec4<u32>(r,vb_error,0u);}`});
      try{await kernel.bind(0,[{binding:0,resource:{buffer:input}},{binding:1,resource:{buffer:output}}]);await kernel.dispatch(Math.ceil(pairs.length/64));const got=new Uint32Array(await gpu.operation(()=>gpu.readBuffer(output)));
        pairs.forEach(([a,b],i)=>{const n=oracle(a,b);const error=Number.isFinite(n)?0:name==='sqrt'&&a<0?5:name==='divide'&&b===0&&a!==0?11:6;const actual=[...got.slice(i*4,i*4+3)];const expected=error?[0,0,error]:[...encodeDouble(n),0];if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error(`${name}(${a},${b}): got ${actual}, expected ${expected}`);});
      }finally{kernel.dispose();}
    });
    await test('binary64 round-to-Long at overflow/tie boundaries',async()=>{
      const source='Public a As Double\nPublic n As Long\nSub Main()\nn=CLng(a)\nEnd Sub';const p=await ComputeProgram.create(gpu,compileCompute(source));
      try{for(const a of [-2147483648.75,-2147483648.5,-2147483647.5,-2.5,-0.5,0.5,1.5,2.5,2147483646.5,2147483647.5,4294967295.75]){await p.writeGlobal('a',a);const [lane]=await p.run({throwOnError:false});const f=Math.floor(a),rounded=a-f===0.5?(f%2===0?f:f+1):Math.round(a);if(rounded < -2147483648||rounded>2147483647)equal(lane.error,6);else {equal(lane.error,0);equal(lane.globals['Module1.n'],rounded);}}}finally{await p.dispose();}
    });
    await test('Double host writes, arrays, ReDim Preserve, calls and reset',async()=>{
      const source='Public a() As Double\nPublic result As Double\nSub Main()\nReDim Preserve a(1 To 3)\nresult=Twice(a(1))\na(3)=result\nEnd Sub\nFunction Twice(ByVal n As Double) As Double\nTwice=n*2#\nEnd Function';
      const p=await ComputeProgram.create(gpu,compileCompute(source),{fuel:10000});
      try{await p.initializeArray('a',[[1,2]],[Math.PI,Number.MIN_VALUE]);const [lane]=await p.run();equal(lane.globals['Module1.result'],Math.PI*2);equal(lane.globals['Module1.a'],[Math.PI,Number.MIN_VALUE,Math.PI*2]);await p.reset();equal((await p.readState())[0].globals['Module1.a'],[]);}finally{await p.dispose();}
    });
    await test('Double ByRef aliases and For/Select control flow',async()=>{
      const source='Public result As Double\nSub Main()\nDim i As Double\nFor i=1# To 3#\nresult=result+i\nNext i\nBump result\nSelect Case result\nCase 6# To 8#\nresult=result+35#\nEnd Select\nEnd Sub\nSub Bump(ByRef n As Double)\nn=n+1#\nEnd Sub';
      const p=await ComputeProgram.create(gpu,compileCompute(source));try{equal((await p.run())[0].globals['Module1.result'],42);}finally{await p.dispose();}
    });
    await test('Double-to-Single uses IEEE nearest rounding',async()=>{
      const source='Public a As Double\nPublic f As Single\nPublic back As Double\nSub Main()\nf=CSng(a)\nback=CDbl(f)\nEnd Sub';const p=await ComputeProgram.create(gpu,compileCompute(source));
      try{for(const a of [Math.PI,1+2**-24,1+3*2**-24,-0,1e-30,-1e-30,3e38]){await p.writeGlobal('a',a);const [l]=await p.run();ok(Object.is(l.globals['Module1.f'],Math.fround(a)));ok(Object.is(l.globals['Module1.back'],Math.fround(a)));}}finally{await p.dispose();}
    });
    await test('failed Double arithmetic preserves the old destination',async()=>{
      const p=await ComputeProgram.create(gpu,compileCompute('Public a As Double\nPublic n As Long\nSub Main()\na=42#\nOn Error Resume Next\na=1# / 0#\nn=Err.Number\nEnd Sub'));try{const [l]=await p.run();equal(l.globals['Module1.a'],42);equal(l.globals['Module1.n'],11);}finally{await p.dispose();}
    });
  }finally{gpu.release(input);gpu.release(output);}
};
