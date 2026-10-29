import test from 'node:test';
import assert from 'node:assert/strict';
import {GraphicsSurface} from '../src/graphics/surface.js';
import {RetainedGraphics} from '../src/graphics/retained.js';
import {RasterCache} from '../src/graphics/raster.js';

const gradient = () => ({kind:'LinearGradientBrush',startPoint:[0,0],endPoint:[0,3],mappingMode:'Absolute',spreadMethod:'Pad',opacity:1,relativeTransform:{type:'ScaleTransform',scaleX:1,scaleY:-1,centerX:0,centerY:0.5},gradientStops:[{offset:0.33,color:'#29000000'},{offset:1,color:'#0F000000'}]});

// Observe production cache/paint decisions; real pixel/PNG checks live in
// winui3-graphics-browser.mjs and use independently authored Canvas commands.
function fixture(){
  const calls=[];
  const document={createElement(type){
    assert.equal(type,'canvas');const stack=[],canvas={width:1,height:1};
    const context={canvas,fillStyle:'#000000',globalAlpha:1,globalCompositeOperation:'source-over',
      save(){stack.push({fillStyle:this.fillStyle,globalAlpha:this.globalAlpha,globalCompositeOperation:this.globalCompositeOperation});},
      restore(){Object.assign(this,stack.pop());},setTransform(...values){calls.push({kind:'transform',values});},transform(){},clearRect(){calls.push({kind:'clear'});},setLineDash(){},
      createLinearGradient(...points){const item={kind:'gradient',points,stops:[],addColorStop(offset,color){this.stops.push({offset,color});}};calls.push(item);return item;},
      fillRect(...bounds){calls.push({kind:'fill',style:this.fillStyle,alpha:this.globalAlpha,composite:this.globalCompositeOperation,bounds});},
      drawImage(...args){calls.push({kind:'image',args});},
      getImageData(...bounds){calls.push({kind:'read',bounds});return {data:new Uint8ClampedArray([1,2,3,4])};}
    };
    canvas.getContext=()=>context;canvas.toDataURL=type=>{calls.push({kind:'export',type});return 'data:image/png;base64,cached';};return canvas;
  }};
  const surface=new RetainedGraphics({ownerDocument:document});Object.setPrototypeOf(surface,GraphicsSurface.prototype);
  Object.assign(surface,{width:100,height:80,dpr:2,theme:'classic',_background:0x332211,invalidations:0,onBackend(){},invalidate(){this.invalidations++;},rgba(color){this.lastRGBA=color;return [0,0,0,typeof color==='string'&&color.endsWith('80')?128/255:1];}});
  return {surface,calls,document,cache:new RasterCache(document)};
}

test('presentation brushes are canonical immutable copies and equivalent assignments do not invalidate',()=>{
  const {surface}=fixture(),input=gradient();surface.setPresentationBackground(input);
  const saved=surface.presentationBackground,revision=surface.presentationBackgroundRevision;
  assert.equal(revision,1);assert.equal(surface.invalidations,1);assert.notEqual(saved,input);
  assert.ok(Object.isFrozen(saved));assert.ok(Object.isFrozen(saved.gradientStops[0]));assert.ok(!Object.isFrozen(input.gradientStops));
  input.gradientStops[0].color='#FFFFFFFF';input.relativeTransform.scaleY=2;
  assert.equal(saved.gradientStops[0].color,'#29000000');assert.equal(saved.relativeTransform.scaleY,-1);
  surface.setPresentationBackground({...gradient(),gradientStops:[{color:'#29000000',offset:0.33},{color:'#0f000000',offset:1}]});
  assert.equal(surface.presentationBackground,saved);assert.equal(surface.presentationBackgroundRevision,revision);assert.equal(surface.invalidations,1);
  surface.setPresentationBackground('#F123');assert.equal(surface.presentationBackground,'#FF112233');
  surface.setPresentationBackground('#112233');assert.equal(surface.invalidations,2);
});

test('invalid or disposed presentation assignments cannot erase a valid retained background',()=>{
  const {surface}=fixture();surface.setPresentationBackground('#80102030');const current=surface.presentationBackground,revision=surface.presentationBackgroundRevision;
  for(const invalid of ['linear-gradient(red,blue)','url(https://invalid)',{},undefined,{...gradient(),startPoint:[NaN,0]},{...gradient(),endPoint:[3,3]},{...gradient(),spreadMethod:'Repeat'}])assert.throws(()=>surface.setPresentationBackground(invalid));
  assert.equal(surface.presentationBackground,current);assert.equal(surface.presentationBackgroundRevision,revision);
  surface.disposed=true;assert.throws(()=>surface.setPresentationBackground(null),/disposed/);assert.equal(surface.presentationBackground,current);
});

test('raster backing preserves the native absolute ramp, vertical reflection and stop order',()=>{
  const {surface,calls,cache}=fixture();surface.setPresentationBackground(gradient());cache.render(surface,2);
  const painted=calls.find(call=>call.kind==='gradient');
  assert.deepEqual(painted.points,[0,80,0,77]);
  assert.deepEqual(painted.stops,[{offset:0.33,color:'#00000029'},{offset:1,color:'#0000000f'}]);
  assert.deepEqual(calls.find(call=>call.kind==='fill').bounds,[0,0,100,80]);
  assert.equal(calls.find(call=>call.kind==='fill').style,painted);
  assert.ok(calls.some(call=>call.kind==='transform'&&call.values[0]===2));
  const same=gradient();same.gradientStops=[{offset:1,color:'#00FFFFFF'},{offset:1,color:'#FF000000'}];surface.setPresentationBackground(same);calls.length=0;cache.render(surface);
  assert.deepEqual(calls.find(call=>call.kind==='gradient').stops,[{offset:1,color:'#ffffff00'},{offset:1,color:'#000000ff'}]);
});

test('relative brush geometry follows resize and alpha never paints an opaque legacy layer',()=>{
  const {surface,calls,cache}=fixture();surface.setPresentationBackground({...gradient(),mappingMode:'RelativeToBoundingBox',endPoint:[1,0],relativeTransform:null,opacity:0.5,gradientStops:[{offset:0,color:'#80FF0000'},{offset:1,color:'#FF0000FF'}]});
  cache.render(surface);const paint=calls.find(call=>call.kind==='gradient');
  assert.deepEqual(paint.points,[0,0,100,0]);
  assert.deepEqual(paint.stops,[{offset:0,color:'#ff000080'},{offset:1,color:'#0000ffff'}]);
  assert.equal(calls.filter(call=>call.kind==='fill').length,1);assert.equal(calls.find(call=>call.kind==='fill').alpha,0.5);
  surface.width=200;calls.length=0;cache.render(surface);assert.deepEqual(calls.find(call=>call.kind==='gradient').points,[0,0,200,0]);
});

test('resolved theme changes rebuild once, preserve commands, and clearing restores ordinary BackColor',()=>{
  const {surface,calls,cache}=fixture();surface.setPresentationBackground('#80102030');surface.add('pixel',[2,3],255);cache.render(surface);
  const commands=surface.commands,command=commands[0],revision=cache.revision,rebuilds=cache.rebuilds;
  calls.length=0;surface.setPresentationBackground('#80102030');cache.render(surface);assert.deepEqual(calls.filter(call=>call.kind==='fill'),[]);assert.equal(cache.revision,revision);
  surface.setPresentationBackground('#FFABCDEF');cache.render(surface);assert.equal(cache.rebuilds,rebuilds+1);assert.equal(surface.commands,commands);assert.equal(surface.commands[0],command);
  surface.setPresentationBackground(null);calls.length=0;cache.render(surface);assert.equal(surface.presentationBackground,null);assert.equal(surface.background,0x332211);assert.equal(calls.find(call=>call.kind==='fill').style,'#112233');
});

test('gradient and alpha brushes leave the triangle path and opaque solids use the actual presentation color',()=>{
  const {surface}=fixture();surface.dpr=1;
  surface.setPresentationBackground(gradient());assert.equal(surface.canUseTriangles(),false);
  surface.setPresentationBackground('#80102030');assert.equal(surface.canUseTriangles(),false);assert.equal(surface.lastRGBA,'#10203080');
  surface.setPresentationBackground('#FF102030');assert.equal(surface.canUseTriangles(),true);assert.equal(surface.lastRGBA,'#102030ff');
  surface.setPresentationBackground(null);assert.equal(surface.canUseTriangles(),true);assert.equal(surface.lastRGBA,0x332211);
});

test('translucent WinUI backing bypasses the opaque GPU texture presenter',()=>{
  const {surface,document}=fixture();surface.setPresentationBackground(gradient());
  const canvas=document.createElement('canvas');canvas.width=200;canvas.height=160;
  Object.assign(surface,{canvas,context:canvas.getContext('2d'),backend:'webgpu',gpuCanvas:{hidden:false},canUseTriangles(){assert.fail('Translucent brushes cannot enter an opaque GPU path');},ensureRasterPresenter(){assert.fail('Opaque GPU texture presenter cannot preserve alpha');}});
  surface.render();assert.equal(surface.gpuCanvas.hidden,true);assert.equal(surface.renderError,null);assert.equal(surface.renderingBackend,'Canvas2D');
});

test('readPixels and PNG export use the same presentation-aware logical cache',()=>{
  const {surface,calls}=fixture();surface.setPresentationBackground(gradient());
  assert.deepEqual([...surface.readPixels(1,2,1,1).data],[1,2,3,4]);const cache=surface.logicalCache,revision=cache.revision;
  assert.equal(surface.toDataURL(),'data:image/png;base64,cached');assert.equal(surface.logicalCache,cache);assert.equal(cache.revision,revision);
  assert.equal(calls.filter(call=>call.kind==='gradient').length,1);assert.deepEqual(calls.find(call=>call.kind==='read').bounds,[1,2,1,1]);assert.equal(calls.find(call=>call.kind==='export').type,'image/png');
});
