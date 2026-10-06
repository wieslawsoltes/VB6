/** Exact pixel readbacks for compute-only decoded RGBA image sampling. */
globalThis.runComputeImageTests=async function({gpu,test,equal,ok}) {
  const {ComputeImage,ComputeScene,ComputeRenderer}=VB6Compute;
  const pixels=new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);
  const image=new ComputeImage(2,2,pixels),at=(bytes,x,y)=>[...bytes.slice((y*16+x)*4,(y*16+x)*4+4)];
  async function render(scene,check){const r=await ComputeRenderer.create(gpu,{width:16,height:16,samples:1});try{await r.render(scene);await check(await r.readPixels());}finally{await r.dispose();}}
  await test('compute nearest image sampling preserves all four RGBA quadrants',async()=>render(new ComputeScene(16,16).image(image,0,0,16,16,{filter:'nearest'}),bytes=>{equal(at(bytes,2,2),[255,0,0,255]);equal(at(bytes,12,2),[0,255,0,255]);equal(at(bytes,2,12),[0,0,255,255]);equal(at(bytes,12,12),[255,255,255,255]);}));
  await test('image source crop clamps filtering at crop boundaries',async()=>render(new ComputeScene(16,16).image(image,0,0,16,16,{source:[1,0,1,1]}),bytes=>{equal(at(bytes,0,0),[0,255,0,255]);equal(at(bytes,15,15),[0,255,0,255]);}));
  await test('image bilinear filtering works in premultiplied space',async()=>{const transparent=new ComputeImage(2,1,new Uint8Array([255,0,0,255,0,255,0,0]));await render(new ComputeScene(16,16).image(transparent,0,0,16,16),bytes=>{const p=at(bytes,7,8);ok(p[0]>120&&p[0]<160);equal(p[1],0);equal(p[2],0);equal(p[0],p[3]);});});
  await test('premultiplied input and opacity are not multiplied twice',async()=>{const premultiplied=new ComputeImage(1,1,new Uint8Array([128,0,0,128]),{premultiplied:true});await render(new ComputeScene(16,16).image(premultiplied,0,0,16,16,{opacity:0.5}),bytes=>equal(at(bytes,8,8),[64,0,0,64]));});
  await test('image paints obey affine mirrors and rectangular clips',async()=>render(new ComputeScene(16,16).image(image,0,0,16,16,{filter:'nearest',transform:[-1,0,0,1,16,0],clip:[4,0,16,16]}),bytes=>{equal(at(bytes,1,1),[0,0,0,0]);equal(at(bytes,5,1),[0,255,0,255]);equal(at(bytes,12,1),[255,0,0,255]);}));
  await test('multiple image resources retain separate pixel offsets',async()=>{const blue=new ComputeImage(1,1,new Uint8Array([0,0,255,255]));await render(new ComputeScene(16,16).image(image,0,0,16,16,{filter:'nearest'}).image(blue,4,4,8,8),bytes=>{equal(at(bytes,1,1),[255,0,0,255]);equal(at(bytes,8,8),[0,0,255,255]);});});
};
