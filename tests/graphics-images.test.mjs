import test from 'node:test';import assert from 'node:assert/strict';
import {loadImage} from '../src/graphics/images.js';
import {RetainedGraphics} from '../src/graphics/retained.js';
import {GraphicsSurface} from '../src/graphics/surface.js';
import {GPURasterPresenter} from '../packages/win32-browser/src/gpu-presenter.js';
function documentFixture(){const images=[];class Image {constructor(){images.push(this);this.naturalWidth=2;this.naturalHeight=2;}removeAttribute(){this.src='';}}const context={drawImage(){},getImageData(){return {data:new Uint8Array(4)};}};return {images,document:{defaultView:{Image},createElement(){return {width:0,height:0,getContext(){return context;}};}}};}
const surfaceFixture=()=>{const f=documentFixture(),surface=new RetainedGraphics({ownerDocument:f.document});surface.invalidate=()=>{};surface.width=10;surface.height=10;return {...f,surface};};
test('image loads use owning realm and remove completion handlers',async()=>{const {document,images}=documentFixture(),load=loadImage(document,'https://example.invalid/test.png');assert.equal(images[0].crossOrigin,'anonymous');images[0].onload();assert.ok((await load.promise).canvas);assert.equal(images[0].onload,null);assert.equal(images[0].onerror,null);});
test('load cancellation is idempotent and settles without unhandled rejection',async()=>{const {document,images}=documentFixture(),load=loadImage(document,'data:image/png;base64,AA');load.cancel();load.cancel();assert.deepEqual(await load.promise,{cancelled:true});assert.equal(images[0].onload,null);});
test('A/B/A background requests have distinct identities and stale callbacks cannot win',async()=>{const {images,surface}=surfaceFixture();const a=surface.setPicture('A'),old=images[0].onload,b=surface.setPicture('B'),again=surface.setPicture('A');old();assert.equal(surface.picture,null);images[2].onload();assert.equal(await a,false);assert.equal(await b,false);assert.equal(await again,true);assert.equal(surface.pictureSource,'A');});
test('clearing command images releases tasks, retains background and never resurrects commands',async()=>{const {images,surface}=surfaceFixture();const bg=surface.setPicture('background'),picture=surface.paintPicture('command',1,2);surface.clear();assert.equal(await picture,false);assert.equal(surface.commands.length,0);assert.equal(surface.imageTasks.size,0);images[0].onload();assert.equal(await bg,true);assert.ok(surface.picture);});
test('disposing pending images settles all requests and releases snapshots',async()=>{const {surface}=surfaceFixture();const bg=surface.setPicture('background'),picture=surface.paintPicture('command',1,2);surface.disposed=true;surface.disposeRetained();assert.equal(await bg,false);assert.equal(await picture,false);assert.equal(surface.picture,null);assert.equal(surface.commands.length,0);});
test('oversized decoded images fail before allocating a retained canvas',async()=>{const {document,images}=documentFixture(),load=loadImage(document,'data:image/png;base64,AA');images[0].naturalWidth=65536;images[0].onload();assert.match((await load.promise).error,/width/);});
for(const action of ['clear','dispose','device change'])test('stale GPU raster initialization cannot attach after '+action,async()=>{
 const original=GPURasterPresenter.create;let resolve;GPURasterPresenter.create=()=>new Promise(r=>resolve=r);
 try{
  let disposed=0,invalidated=0;const s=Object.assign(Object.create(GraphicsSurface.prototype),{device:{},gpuFormat:'rgba8unorm',invalidate(){invalidated++;}});
  s.ensureRasterPresenter();const pending=s.rasterPending;
  if(action==='clear')s.releaseRaster();else if(action==='dispose'){s.disposed=true;s.releaseRaster();}else s.device={};
  resolve({dispose(){disposed++;}});assert.equal(await pending,false);assert.equal(disposed,1);assert.equal(invalidated,0);assert.equal(s.rasterPresenter??null,null);
 }finally{GPURasterPresenter.create=original;}
});

test('invalid background input cannot erase or cancel a valid pending picture',async()=>{
 const {images,surface}=surfaceFixture(),ready=surface.setPicture('first');
 for(const input of [{width:0,height:2},'x'.repeat(16*1024*1024+1)])assert.throws(()=>surface.setPicture(input));
 assert.equal(surface.pictureSource,'first');assert.equal(images[0].onload instanceof Function,true);images[0].onload();assert.equal(await ready,true);const old=surface.picture;
 assert.throws(()=>surface.setPicture({width:Infinity,height:1}));assert.equal(surface.picture,old);
});

test('caller canvases are resnapshotted, not incorrectly cached by identity',async()=>{
 const {surface}=surfaceFixture(),source={width:2,height:2};await surface.setPicture(source);const first=surface.picture;await surface.setPicture(source);assert.notEqual(surface.picture,first);
});
