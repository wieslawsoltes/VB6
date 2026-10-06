/** Real WebGPU event runtime tests; no host interpreter substitutes for VB. */
globalThis.runComputeApplicationTests=async function({gpu,test,equal,ok}) {
  const {compileComputeApplication,ComputeApplication}=VB6Compute;
  const code=`Option Explicit
Public result As Long
Public frames As Long
Sub Main()
  result=10&
  ComputeClear RGB(12,24,36)
  ComputeRect 8!,8!,20!,20!,RGB(255,0,0)
End Sub
Sub OnPointer()
  result=result+CLng(ComputeInput.PointerX)
End Sub
Sub OnKey()
  result=ComputeInput.Character+ComputeInput.Modifiers
End Sub
Sub OnWheel()
  result=CLng(ComputeInput.WheelY)+ComputeInput.WheelMode
End Sub
Sub OnFrame()
  frames=frames+1&
End Sub
Sub OnTimer()
  result=result+1&
End Sub`;
  const descriptor=compileComputeApplication(code,{events:{load:'Main',pointerDown:'OnPointer',keyDown:'OnKey',wheel:'OnWheel',frame:'OnFrame',timer:'OnTimer'}});
  const value=async app=>(await app.program.readState())[0].globals['Module1.result'];
  const create=async options=>ComputeApplication.create(descriptor,{gpu,programOptions:{width:64,height:64},...options});
  await test('application events share persistent GPU globals',async()=>{const app=await create();try{equal(await value(app),10);await app.dispatch('pointerDown',{PointerX:32});equal(await value(app),42);}finally{await app.dispose();}});
  await test('concurrent events execute with immutable ordered inputs',async()=>{const app=await create();try{await Promise.all([app.dispatch('pointerDown',{PointerX:12}),app.dispatch('pointerDown',{PointerX:20})]);equal(await value(app),42);}finally{await app.dispose();}});
  await test('application reset reruns the GPU load handler',async()=>{const app=await create();try{await app.dispatch('pointerDown',{PointerX:100});await app.reset();equal(await value(app),10);}finally{await app.dispose();}});
  await test('DOM pointer coordinates scale into the compute surface',async()=>{const canvas=document.createElement('canvas');canvas.style.width='128px';canvas.style.height='128px';canvas.style.border='4px solid black';canvas.style.padding='2px';document.body.append(canvas);let app;try{app=await create({canvas});const r=canvas.getBoundingClientRect();canvas.dispatchEvent(new PointerEvent('pointerdown',{clientX:r.left+38,clientY:r.top+38,buttons:1}));await app.tail;equal(await value(app),26);equal((await app.program.readState())[0].globals['ComputeInput.PointerX'],16);ok(canvas.hasAttribute('tabindex'));await app.dispose();ok(!canvas.hasAttribute('tabindex'));equal(app.listeners.length,0);}finally{await app?.dispose();canvas.remove();}});
  await test('DOM keyboard Unicode and modifiers enter GPU handlers',async()=>{const canvas=document.createElement('canvas');let app;try{app=await create({canvas});canvas.dispatchEvent(new KeyboardEvent('keydown',{key:'A',shiftKey:true}));await app.tail;equal(await value(app),66);}finally{await app?.dispose();}});
  await test('wheel delta and deltaMode are explicit GPU inputs',async()=>{const canvas=document.createElement('canvas');let app;try{app=await create({canvas});canvas.dispatchEvent(new WheelEvent('wheel',{deltaY:40,deltaMode:2}));await app.tail;equal(await value(app),42);}finally{await app?.dispose();}});
  await test('non-drawing events preserve previously rendered pixels',async()=>{const canvas=document.createElement('canvas');const app=await create({canvas});try{const before=await app.renderer.readPixels();await app.dispatch('pointerDown',{PointerX:32});equal([...await app.renderer.readPixels()],[...before]);equal([...before.slice((16*64+16)*4,(16*64+16)*4+4)],[255,0,0,255]);}finally{await app.dispose();}});
  await test('animation scheduling is backpressured and stops cleanly',async()=>{const oldRequest=globalThis.requestAnimationFrame,oldCancel=globalThis.cancelAnimationFrame;const callbacks=[];let app;globalThis.requestAnimationFrame=fn=>{callbacks.push(fn);return callbacks.length};globalThis.cancelAnimationFrame=()=>{};try{app=await create({timerInterval:0.01});app.start();equal(callbacks.length,1);await callbacks.shift()(0);equal(callbacks.length,1);await callbacks.shift()(20);equal((await app.program.readState())[0].globals['Module1.frames'],2);equal(await value(app),11);app.stop();await callbacks.shift()(40);equal((await app.program.readState())[0].globals['Module1.frames'],2);}finally{await app?.dispose();globalThis.requestAnimationFrame=oldRequest;globalThis.cancelAnimationFrame=oldCancel;}});
  await test('event failures report VB source errors without losing device ownership',async()=>{const app=await ComputeApplication.create(compileComputeApplication('Public result As Long\nSub Bad()\nresult=1& \\ 0&\nEnd Sub',{events:{pointerDown:'Bad'}}),{gpu});try{let failed=false;try{await app.dispatch('pointerDown')}catch(e){failed=e.code==='GPU_VB_RUNTIME'&&e.error===11}ok(failed);ok(!gpu.closed);}finally{await app.dispose();}});
};
globalThis.runComputeApplicationBrowserTests=async function() {
  const gpu=await VB6Compute.ComputeDevice.request(),tests=[];
  const equal=(a,b)=>{if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);};
  const ok=(value,message='Assertion failed')=>{if(!value)throw new Error(message);};
  const test=async(name,fn)=>{console.log('COMPUTE_PROGRESS:'+JSON.stringify({name,status:'started'}));try{await fn();tests.push({name,passed:true});}catch(error){tests.push({name,passed:false,error:error.message,code:error.code});}console.log('COMPUTE_PROGRESS:'+JSON.stringify(tests.at(-1)));};
  try{await runComputeApplicationTests({gpu,test,equal,ok});await runComputeImageTests({gpu,test,equal,ok});return {tests,passed:tests.filter(t=>t.passed).length,failed:tests.filter(t=>!t.passed).length,resourcesAfterTests:gpu.resources.size};}finally{await gpu.dispose();}
};
