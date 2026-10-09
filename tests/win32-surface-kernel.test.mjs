import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {SURFACE_KERNEL} from '../src/native/surface-kernel.js';
import {compileWin32} from '../src/native/compiler.js';
const project=()=>({...newProject('SurfaceKernel'),startup:'Sub Main',modules:[{id:'service',name:'Service',kind:'module',code:SURFACE_KERNEL+'\nPrivate Sub Main()\nDim surface As Surface\nsurface.hwnd=42\nSurfaceClear surface\nSurfaceRelease surface\nEnd Sub'}]});
for(const optimization of [0,1,2])test(`standalone surface service compiles to deterministic IA-32 at O${optimization}`,()=>{
 const p=project(),before=JSON.stringify(p),a=compileWin32(p,{optimization});
 assert.deepEqual(a.bytes,compileWin32(p,{optimization}).bytes);assert.equal(JSON.stringify(p),before);
 assert.equal(a.report.extraction,false);assert.equal(a.report.target,'win32-aot');
 for(const name of ['CreateDIBSection','BitBlt','SelectObject','DeleteObject','DeleteDC','SaveDC','RestoreDC'])assert.ok(a.report.imports.some(i=>i.symbol===name),name);
 const s=a.report.records.find(r=>r.name==='service.surface');
 assert.deepEqual(s.fields.map(f=>[f.name,f.offset]),[['hwnd',0],['dc',4],['bitmap',8],['original',12],['width',16],['height',20],['redraw',24],['scale',28],['back',32],['fore',36],['x',40],['y',48],['penWidth',56],['penStyle',60],['drawMode',64],['fillColor',68],['fillStyle',72],['pictureSlot',76],['font',80],['epoch',84]]);
});
