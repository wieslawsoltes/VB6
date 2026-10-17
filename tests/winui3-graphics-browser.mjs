import {GraphicsSurface} from '../src/graphics/surface.js';

/** Actual Canvas2D, retained-command and PNG acceptance. Expected backing
 * pixels come from independent literal Canvas commands, without using the
 * production color/gradient conversion helpers. Invoke in a browser module:
 * await import('/tests/winui3-graphics-browser.mjs').then(m=>m.runWinUI3GraphicsTests()).
 */
export async function runWinUI3GraphicsTests(){
  let assertions=0;const cases=[];
  const assert=(condition,message)=>{assertions++;if(!condition)throw new Error(message);};
  const equal=(a,b,message)=>assert(a.length===b.length&&a.every((value,index)=>value===b[index]),message);
  const test=async(name,run)=>{
    const node=document.createElement('div');node.style.cssText='position:relative;width:20px;height:12px';document.body.append(node);
    const surface=new GraphicsSurface(node,{backend:'canvas2d',background:0xffffff});
    const oracle=document.createElement('canvas');oracle.width=20;oracle.height=12;const context=oracle.getContext('2d');
    try{await run(surface,context,oracle);assert(!surface.renderError,surface.renderError||name);cases.push(name);}finally{surface.dispose();node.remove();}
  };
  const pixels=canvas=>[...canvas.getContext('2d').getImageData(0,0,20,12).data];
  const actual=surface=>[...surface.readPixels(0,0,20,12).data];
  await test('canonical ARGB solid alpha belongs to both readback and exported PNG',async(s,c)=>{
    s.setPresentationBackground('#80102030');c.fillStyle='#10203080';c.fillRect(0,0,20,12);
    equal(actual(s),[...c.getImageData(0,0,20,12).data],'solid ARGB conversion or alpha');
    assert(s.readPixels(0,0,1,1).data[3]===128,'transparent background must not cover opaque BackColor');
    const image=new Image();image.src=s.toDataURL();await image.decode();
    const png=document.createElement('canvas');png.width=20;png.height=12;png.getContext('2d').drawImage(image,0,0);
    equal(pixels(png),actual(s),'PNG includes the retained presentation background');
    await s.flush();assert(!s.renderError,'display retains valid alpha background');
  });
  await test('native absolute three-DIP ramp reflects around the entire control height',async(s,c)=>{
    s.setPresentationBackground({kind:'LinearGradientBrush',startPoint:[0,0],endPoint:[0,3],mappingMode:'Absolute',spreadMethod:'Pad',opacity:1,relativeTransform:{type:'ScaleTransform',scaleX:1,scaleY:-1,centerX:0,centerY:0.5},gradientStops:[{offset:0.33,color:'#29000000'},{offset:1,color:'#0F000000'}]});
    const edge=c.createLinearGradient(0,12,0,9);edge.addColorStop(0.33,'#00000029');edge.addColorStop(1,'#0000000f');c.fillStyle=edge;c.fillRect(0,0,20,12);
    equal(actual(s),[...c.getImageData(0,0,20,12).data],'native reflected gradient coordinates');
    assert(!s.canUseTriangles(),'a gradient cannot enter the uniform-background triangle path');
    await s.flush();
  });
  await test('relative horizontal gradient opacity combines with native alpha',async(s,c)=>{
    s.setPresentationBackground({kind:'LinearGradientBrush',startPoint:[0,0],endPoint:[1,0],mappingMode:'RelativeToBoundingBox',spreadMethod:'Pad',opacity:0.5,relativeTransform:null,gradientStops:[{offset:0,color:'#80FF0000'},{offset:1,color:'#FF0000FF'}]});
    const fill=c.createLinearGradient(0,0,20,0);fill.addColorStop(0,'#ff000080');fill.addColorStop(1,'#0000ffff');c.fillStyle=fill;c.globalAlpha=0.5;c.fillRect(0,0,20,12);
    equal(actual(s),[...c.getImageData(0,0,20,12).data],'native brush opacity applies to the gradient');
  });
  await test('duplicate stops retain their sharp edge and authored order',async(s,c)=>{
    s.setPresentationBackground({kind:'LinearGradientBrush',startPoint:[0,0],endPoint:[1,0],mappingMode:'RelativeToBoundingBox',spreadMethod:'Pad',opacity:1,relativeTransform:null,gradientStops:[{offset:0.5,color:'#00FFFFFF'},{offset:0.5,color:'#FF000000'}]});
    const edge=c.createLinearGradient(0,0,20,0);edge.addColorStop(0.5,'#ffffff00');edge.addColorStop(0.5,'#000000ff');c.fillStyle=edge;c.fillRect(0,0,20,12);
    equal(actual(s),[...c.getImageData(0,0,20,12).data],'repeated gradient stops');
  });
  await test('theme brush replacement replays retained commands and GDI writes remain opaque',async(s,c)=>{
    s.setPresentationBackground('#80102030');s.add('pixel',[2,3],255);actual(s);const command=s.commands[0],revision=s.logicalCache.revision;
    s.setPresentationBackground('#80102030');actual(s);assert(s.logicalCache.revision===revision,'equivalent brush does not rebuild logical cache');
    s.setPresentationBackground('#FFABCDEF');c.fillStyle='#abcdef';c.fillRect(0,0,20,12);c.fillStyle='#ff0000';c.fillRect(2,3,1,1);
    equal(actual(s),[...c.getImageData(0,0,20,12).data],'theme replacement replays original pixels');assert(s.commands[0]===command,'theme does not mutate retained drawing commands');
    s.setPresentationBackground('#80102030');s.writePixels(4,5,{width:1,height:1,data:new Uint8Array([10,20,30,0])});
    equal([...s.readPixels(4,5,1,1).data],[10,20,30,255],'GDI pixel replacement remains opaque');
    s.setPresentationBackground(null);assert(s.readPixels(0,0,1,1).data.every(value=>value===255),'clearing presentation restores ordinary white BackColor');
  });
  return {passed:true,cases,assertions,devicePixelRatio:window.devicePixelRatio};
}
