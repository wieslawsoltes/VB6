import {newProject} from '../src/project/model.js';
/** Real browser/Canvas/GPU acceptance. Expected pixels are literal colors,
 * independent truth-table evaluation or separately authored Canvas commands.
 * No production oracle, tolerances or native-pixel certification are used. */
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const equal=(actual,expected,message)=>assert(JSON.stringify(actual)===JSON.stringify(expected),message+': '+JSON.stringify(actual)+' != '+JSON.stringify(expected));
const throws=(fn,message)=>{let did=false;try{fn();}catch{did=true;}assert(did,message);};
const rgb=v=>[v&255,v>>>8&255,v>>>16&255,255];
const truthByte=(truth,values)=>{let value=0;for(let bit=0;bit<8;bit++){let index=0;for(const channel of values)index=index*2+(channel>>bit&1);value|=(truth>>index&1)<<bit;}return value;};
export async function runGraphicsTests(api,backend='canvas2d'){
  const results=[],{GraphicsSurface}=api;let totalAssertions=0;
  const check=(condition,message)=>{totalAssertions++;assert(condition,message);};
  const test=async(name,body)=>{
    const node=document.createElement('div');node.style='position:relative;width:128px;height:96px';document.body.append(node);
    const surface=new GraphicsSurface(node,{backend,background:0xffffff});const gpuErrors=[];let device,handler;
    try{
      if(backend==='webgpu'){await surface.gpuReady;assert(surface.backend==='webgpu',surface.gpuError||'Required WebGPU unavailable');device=surface.device;handler=e=>gpuErrors.push(e.error.message);device.addEventListener('uncapturederror',handler);}
      await body(surface,node);await surface.flush();check(!surface.renderError,surface.renderError);if(backend==='webgpu')check(surface.renderingBackend.startsWith('WebGPU'),JSON.stringify(surface.statistics));
      if(device)await device.queue.onSubmittedWorkDone();equal(gpuErrors,[],'uncaptured GPU errors');results.push({name,passed:true,backend:surface.renderingBackend,stats:surface.statistics});
    }finally{if(device)device.removeEventListener('uncapturederror',handler);surface.dispose();surface.dispose();node.remove();}
  };
  await test('ordered text and vector replay',s=>{
    s.text('COVERED',0,0,0,'30px sans-serif');s.add('rect',[0,0,128,50],0x0000ff,true);
    const data=s.readPixels(0,0,128,50).data;for(let i=0;i<data.length;i+=4)check(data[i]===255&&data[i+1]===0&&data[i+2]===0&&data[i+3]===255,'later rectangle must cover earlier text');
    s.text('VISIBLE',0,50,0,'24px sans-serif');check(s.readPixels(0,50,110,35).data.some((v,i)=>i%4!==3&&v===0),'later text must remain visible');
  });
  await test('all 16 DrawModes with literal independent truth tables',s=>{
    const source=[0x35,0x96,0xa7],destination=[0xc3,0x5a,0xf0];
    for(let mode=1;mode<=16;mode++){s.clear();s.background=0xf05ac3;s.add('pixel',[7,8],0xa79635,false,1,{drawMode:mode});equal([...s.readPixels(7,8,1,1).data],[...source.map((v,i)=>truthByte(mode-1,[v,destination[i]])),255],'DrawMode '+mode);}
  });
  await test('XOR exact round trip including curved antialiased coverage',s=>{
    s.background=0x795321;const before=[...s.readPixels(0,0,128,96).data];
    s.add('ellipse',[50,40,28,21],0xabf032,false,3,{drawMode:7});check(s.readPixels(0,0,128,96).data.some((v,i)=>v!==before[i]),'first XOR must draw');
    s.add('ellipse',[50,40,28,21],0xabf032,false,3,{drawMode:7});equal([...s.readPixels(0,0,128,96).data],before,'second XOR restores every pixel');
  });
  await test('all eight globally phased hatch fills',s=>{
    for(let style=0;style<8;style++){
      s.clear();s.add('rect',[3,5,48,48],0,false,1,{fillStyle:style,fillColor:0x563412,drawStyle:5});
      for(let y=10;y<26;y++)for(let x=10;x<26;x++){
        const xx=x%8,yy=y%8,filled=[true,false,yy===0,xx===0,(xx+yy)%8===0,xx===yy,xx===0||yy===0,xx===yy||(xx+yy)%8===0][style];
        equal(s.point(x,y),filled?0x563412:0xffffff,'hatch '+style+' at '+x+','+y);
      }
    }
  });
  await test('line dash, wide pen, invisible and inside strokes',s=>{
    for(let style=0;style<7;style++){s.add('line',[5,8+style*10,100,8+style*10],0,false,1,{drawStyle:style});}
    check(s.point(7,8)===0,'solid pen');check(s.point(10,18)===0xffffff,'dash gap');check(s.point(7,58)===0xffffff,'invisible pen');
    s.add('line',[5,80,100,80],0x0000ff,false,3,{drawStyle:2});equal(s.point(10,80),0x0000ff,'wide dashed pen is solid');
    s.add('rect',[108,4,120,40],0,false,4,{drawStyle:6});equal(s.point(106,10),0xffffff,'inside stroke does not extend outside');equal(s.point(109,10),0,'inside stroke occupies inside edge');
  });
  await test('arc direction, independent radius lines, open versus closed filling',s=>{
    s.add('arc',[40,40,25,20,0,Math.PI/2],0,false,1,{fillStyle:0,fillColor:255});equal(s.point(45,35),0xffffff,'open arc is not filled');
    s.add('arc',[90,40,25,20,.00000001,Math.PI/2],0,false,1,{fillStyle:0,fillColor:255,radialStart:true,radialEnd:true});
    equal(s.point(96,34),255,'closed upper-right pie fills counterclockwise');equal(s.point(96,46),0xffffff,'lower-right quadrant stays clear');
  });
  await test('paths, curves, polygons, rounded rectangles and even-odd holes',s=>{
    s.path([['M',4,4],['L',44,4],['L',44,44],['L',4,44],['Z'],['M',14,14],['L',34,14],['L',34,34],['L',14,34],['Z']],255,true,1,{fillRule:'evenodd'});
    equal(s.point(8,8),255,'path exterior');equal(s.point(20,20),0xffffff,'even-odd hole');
    s.path([['M',55,20],['Q',65,0,75,20],['C',85,40,95,0,105,20]],0,false,2);
    s.add('polygon',[4,60,24,50,44,60,24,85],0xff0000,true);equal(s.point(24,65),0xff0000,'polygon fill');
    s.add('polyline',[50,60,60,80,70,60],0,false,1);s.add('roundrect',[80,55,120,85,8,6],0x00ff00,true);equal(s.point(100,70),0x00ff00,'rounded fill');equal(s.point(80,55),0xffffff,'rounded corner');
  });
  await test('saved transform and intersecting clip are immutable and ordered',s=>{
    s.save().setClip(10,10,30,30).clip(20,0,30,40).transform(1,0,0,1,15,15);
    s.add('rect',[0,0,30,30],0x0000ff,true);s.restore();s.add('pixel',[2,2],0xff0000);
    equal(s.point(22,22),0x0000ff,'transformed fill inside clip');equal(s.point(18,22),0xffffff,'intersection clips away left strip');equal(s.point(42,22),0xffffff,'clip is in surface coordinates');equal(s.point(2,2),0xff0000,'restore resets transform and clip');
  });
  await test('copy-in input arrays, readback snapshots and atomic invalid inputs',s=>{
    const coords=[1,1,6,6],style={clip:[0,0,10,10],transform:[1,0,0,1,0,0]};s.add('rect',coords,255,true,1,style);coords[0]=99;style.clip[0]=99;style.transform[4]=99;equal(s.point(3,3),255,'caller mutations must not change retained command');
    const data=s.readPixels(3,3,1,1);data.data.fill(0);equal(s.point(3,3),255,'readback is a copy');
    const length=s.commands.length;for(const f of [()=>s.add('line',[NaN,0,1,1]),()=>s.add('circle',[0,0,-1]),()=>s.setGrid(-1),()=>s.setGrid(.1),()=>s.readPixels(0,0,8192,8192),()=>s.writePixels(0,0,{width:1,height:1,data:new Uint32Array(4)}),()=>s.restore(),()=>s.text('x',0,0,0,'12px serif',{lineHeight:0})])throws(f,'invalid input must throw');equal(s.commands.length,length,'invalid input must be atomic');equal(s.point(-1,0),-1,'outside Point sentinel');
  });
  await test('all 256 PaintPicture raster truth tables',async s=>{
    const image={width:1,height:1,data:new Uint8Array([0x96,0x3c,0xa5,255])},pattern=[0xc3,0xf0,0x5a],destination=[0x12,0x34,0x56];
    for(let truth=0;truth<256;truth++){
      s.clear();s.background=0x563412;await s.paintPicture(image,5,5,2,2,0,0,1,1,{opcode:truth<<16,patternColor:0x5af0c3});
      equal([...s.readPixels(5,5,1,1).data],[...destination.map((v,i)=>truthByte(truth,[pattern[i],image.data[i],v])),255],'ROP3 '+truth);
    }
  });
  await test('image crop, horizontal/vertical mirror, snapshots and alpha',async s=>{
    const image={width:2,height:2,data:new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,0,255])};
    await s.paintPicture(image,10,10,20,20);await s.paintPicture(image,50,10,-20,20);await s.paintPicture(image,60,30,20,-20);await s.paintPicture(image,90,10,20,20,1,1,1,1);image.data.fill(0);
    equal(s.point(12,12),255,'image owns original bytes');equal(s.point(32,12),65280,'negative destination width mirrors');equal(s.point(62,12),16711680,'negative destination height mirrors');equal(s.point(92,12),65535,'source crop');
    await s.paintPicture({width:1,height:1,data:new Uint8Array([0,0,0,0])},0,0);equal(s.point(0,0),0xffffff,'transparent source preserves background');
  });
  await test('async images preserve insertion order and failed loads settle',async s=>{
    const source=document.createElement('canvas');source.width=8;source.height=8;source.getContext('2d').fillRect(0,0,8,8);const url=source.toDataURL();
    const ready=s.paintPicture(url,2,2,16,16);s.add('rect',[0,0,20,20],255,true);assert(await ready,'real PNG decode');equal(s.point(4,4),255,'later command still covers earlier decoded image');
    const bad=s.paintPicture('data:image/png;base64,AA',30,30);equal(await bad,false,'decode failure result');check(!!s.pictureError,'decode failure is observable');
    const cancelled=s.paintPicture(url,60,60);s.clear();equal(await cancelled,false,'clear cancels command-owned images');equal(s.commands.length,0,'cancelled decode does not resurrect commands');
    const picture=s.setPicture(url);assert(await picture,'background picture decode');s.add('pixel',[0,0],255);s.clear();equal(s.point(1,1),0,'Cls retains the Picture property');
  });
  await test('GDI full-frame and same-rectangle replacement are bounded and opaque',s=>{
    const image={width:128,height:96,data:new Uint8Array(128*96*4)};for(let i=0;i<image.data.length;i+=4)image.data[i]=255;
    for(let i=0;i<10;i++)s.writePixels(0,0,image);equal(s.commands.length,1,'full-frame repaint replaces commands');equal(s.rasterBytes,128*96*4,'bounded raster retention');equal([...s.readPixels(0,0,1,1).data],[255,0,0,255],'GDI ignores supplied alpha');
    const small={width:2,height:2,data:new Uint8Array(16)};for(let i=0;i<8;i++)s.writePixels(5,5,small);equal(s.commands.length,2,'same subrectangle replaces tail');
  });
  await test('append-only cache avoids repainting unchanged retained commands',s=>{
    s.add('ellipse',[30,30,20,10],255,true);s.rasterize();const painter=s.logicalCache.painter,count=painter.painted,rebuilds=s.logicalCache.rebuilds;
    for(let i=0;i<10;i++){s.invalidate();s.rasterize();}equal(painter.painted,count,'unchanged raster cache must not replay');equal(s.logicalCache.rebuilds,rebuilds,'unchanged base');
    s.add('pixel',[1,1],0);s.rasterize();equal(painter.painted,count+1,'append paints only one new command');s.background=0; s.rasterize();equal(s.logicalCache.rebuilds,rebuilds+1,'background invalidates replay');
  });
  await test('multiline styled text metrics, clipping and large line counts',s=>{
    const font='italic bold 16px sans-serif',one=s.measureText('Hello',font),two=s.measureText('Hello\r\nworld',font);check(one.width>0,'font width');equal(two.height,one.height*2,'multiline height');
    s.text('Hello\nworld',2,2,0,font,{underline:true,strikeThrough:true,opaque:true,background:0x00ffff,maxWidth:70});
    check(s.readPixels(0,0,90,60).data.some((v,i)=>i%4!==3&&v!==255),'styled text paints');check(s.measureText('\n'.repeat(150000),'10px serif').height>100000,'many lines must not overflow the JS argument stack');
  });
  await test('batching, quotas, export and disposal contracts',async s=>{
    s.batch(surface=>{for(let i=0;i<1000;i++)surface.add('pixel',[i%128,Math.floor(i/128)],i);});equal(s.commands.length,1000,'batch retains every operation');
    const snapshot=s.toDataURL();check(snapshot.startsWith('data:image/png;base64,'),'PNG export');const blob=await s.toBlob();equal(blob.type,'image/png','Blob export');
    const old=s.commands.length;throws(()=>s.batch(()=>{s.add('pixel',[3,3],0);throw new Error('test');}),'batch propagates caller failure');equal(s.commands.length,old+1,'batch is scheduling, not a rollback transaction');
  });
  await test('owning-document transfer preserves pixels and cache invalidation',async(s,node)=>{
    s.add('pixel',[5,5],255);s.rasterize();const frame=document.createElement('iframe');document.body.append(frame);const target=frame.contentDocument;
    try{target.body.append(node);s.transferDocument();await s.flush();equal(s.point(5,5),255,'adopted surface keeps retained pixels');assert(s.themeDocument===target,'owner document updated');}
    finally{document.body.append(node);s.transferDocument();frame.remove();}
  });
  await test('hidden startup dimensions, dense grid and invalid color atomicity',async(s,node)=>{
    node.hidden=true;s.resize();equal([s.width,s.height],[128,96],'hidden dimensions use authored CSS sizes');s.add('pixel',[20,30],255);node.hidden=false;await s.flush();equal(s.point(20,30),255,'startup pixels survive becoming visible');
    s.clear();s.setGrid(1);equal(s.point(100,80),0x808080,'dense tiled grid');const cache=s.logicalCache;check(!!cache.gridTile&&cache.gridTile.width===1,'dense grid uses a bounded tile');
    s.setGrid(1.25);check(!s.canUseTriangles(),'fractional grid never takes inaccurate triangle coverage');
    const count=s.commands.length;throws(()=>s.add('pixel',[5,5],{valueOf:()=>255}),'mutable colors rejected');equal(s.commands.length,count,'invalid color does not retain a command');
  });
  await test('actual VM drawing, source order, scale and picture integration',async(s,node)=>{
    const project=newProject('GraphicsAcceptance'),form=project.modules[0];project.settings.renderer=backend;
    Object.assign(form.form.properties,{ClientWidth:1920,ClientHeight:1440,BorderStyle:0,StartUpPosition:0,BackColor:0xffffff});
    const image=document.createElement('canvas');image.width=image.height=2;const context=image.getContext('2d');context.fillStyle='#ff00ff';context.fillRect(0,0,2,2);project.assets={'tile.png':{encoding:'base64',data:image.toDataURL().split(',')[1]}};
    form.code=`Option Explicit
Public Trace As String
Private Function Receiver() As Object
  Trace = Trace & "R"
  Set Receiver = Me
End Function
Private Function Operand(ByVal value As Integer) As Integer
  Trace = Trace & CStr(value)
  Operand = value
End Function
Private Sub Form_Load()
  ScaleMode = vbPixels
  ForeColor = vbRed
  DrawWidth = 3
  PSet (10, 10)
  DrawWidth = 1
  PSet Step(5, 5), vbBlack
  Line -(25, 15), vbBlue
  Receiver().Line (Operand(1), Operand(2))-(Operand(3), Operand(4)), Operand(5)
  Circle (60, 40), 20, , 0, 1.5707963267948966, 0.5
  PaintPicture LoadPicture("tile.png"), 90, 60, 20, 20
  Scale (0, 100)-(100, 0)
  PSet (10, 20), vbGreen
  Tag = Trace
End Sub`;
    equal(api.compileProject(project).diagnostics,[],'real source compiles');const events=[];
    const host=new api.ApplicationHost(project,node,{rendering:false,persist:false,onMessage:e=>events.push(e)});
    try{
      await host.start();equal(events.filter(e=>e.type==='error'),[],'real host errors');equal(host.vm.lastError,null,'VM last error');
      const control=host.forms[0],surface=control.ensureSurface();await surface.flush();
      equal(control.Tag,'R12345','receiver and operands evaluate once, left to right');equal(surface.commands[0].color,255,'omitted color uses ForeColor');equal(surface.commands[0].width,3,'DrawWidth reaches PSet');
      equal(surface.commands[1].coords,[15,15],'relative PSet');equal(surface.commands[1].color,0,'explicit zero color is not omission');equal(surface.commands[2].coords,[15,15,25,15],'implicit Line begins at current point');
      equal(surface.commands[4].kind,'arc','Circle optional operands reach surface');equal(surface.commands[4].coords,[60,40,20,10,0,Math.PI/2],'arc aspect and angles');
      equal(surface.point(9,9),255,'wide point is centered');equal(surface.point(100,70),0xff00ff,'VM PaintPicture waits for actual asset decode');equal(control.Point(10,20),0x00ff00,'custom reversed Scale used by Point and PSet');
      equal([control.CurrentX,control.CurrentY],[10,20],'cursor is expressed in custom units');check(control.ScaleX(96,3,5)===1,'ScaleX pixels to inches');check(control.ScaleY(96,3,5)===1,'ScaleY pixels to inches');
      const height=control.TextHeight('A\nB'),width=control.TextWidth('width');check(height<0&&width>0,'text measurements honor reversed vertical scale');
      const before=control.currentY;control.Print('line');check(control.currentY<before,'Print advances in the direction of the vertical scale');equal(control.currentX,0,'Print returns to ScaleLeft');check(control.Image.startsWith('data:image/png;base64,'),'read-only Image snapshot is available');
    }finally{host.dispose();}
  });
  if(backend==='webgpu')await test('actual GPU readback matches ordered CPU backing pixels at this DPR',async s=>{
    s.add('rect',[0,0,128,96],0x214365,true);s.text('GPU',2,2,0,'24px sans-serif');s.add('rect',[0,0,30,30],255,true);s.add('ellipse',[70,55,25,17],0x00ff00,true);await s.flush();s.render();
    const width=s.gpuCanvas.width,height=s.gpuCanvas.height,stride=Math.ceil(width*4/256)*256,device=s.device,buffer=device.createBuffer({size:stride*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{
      const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:s.gpuContext.getCurrentTexture()},{buffer,bytesPerRow:stride},[width,height]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
      const actual=new Uint8Array(buffer.getMappedRange()),expected=s.displayCache.context.getImageData(0,0,width,height).data,bgra=s.gpuFormat.startsWith('bgra');
      for(let y=0;y<height;y++)for(let x=0;x<width;x++)for(let c=0;c<4;c++){const source=y*stride+x*4+(bgra&&c<3?2-c:c),dest=(y*width+x)*4+c;check(actual[source]===expected[dest],'GPU/CPU pixel disagreement at '+x+','+y+' channel '+c);}
    }finally{buffer.destroy();}
  });
  await new Promise(requestAnimationFrame);return {cases:results,assertions:totalAssertions,dpr:devicePixelRatio,nativePixelCertification:false};
}
