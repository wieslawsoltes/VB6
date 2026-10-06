import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createWin32} from '../packages/win32-browser/src/index.js';
const file=process.argv[2];if(!file)throw new Error('Usage: node tools/win32-geometry-contracts.mjs native.json');
const native=JSON.parse(readFileSync(file,'utf8').replace(/^\ufeff/,'')),w=createWin32(),report={polygons:[],curves:[],scope:'Polygon cases are exact contract gates. Analytic curve raster differences are recorded explicitly, not certified as identical to Windows.'};
try{
 for(const e of native){
  let handle,p=0;
  if(e.name==='polygon'){
   p=w.memory.alloc(e.points.length*8);const v=w.memory.view(p,e.points.length*8);e.points.forEach(([x,y],i)=>{v.setInt32(i*8,x,true);v.setInt32(i*8+4,y,true);});
   handle=w.invoke('gdi32','CreatePolygonRgn',[p,e.points.length,e.mode]);
  }else handle=w.invoke('gdi32',e.name==='ellipse'?'CreateEllipticRgn':'CreateRoundRectRgn',e.args);
  assert.ok(handle,'region constructor failed');const shape=w.handles.get(handle,'region').shape,rectangles=[];
  for(const band of shape.bands)for(let i=0;i<band.spans.length;i+=2)rectangles.push([band.spans[i],band.top,band.spans[i+1],band.bottom]);
  const exact=JSON.stringify(rectangles)===JSON.stringify(e.rectangles),record={...e,observed:rectangles,exact};
  report[e.name==='polygon'?'polygons':'curves'].push(record);
  if(e.name==='polygon')assert.deepEqual(rectangles,e.rectangles,'Windows polygon edge mismatch');
  w.invoke('gdi32','DeleteObject',[handle]);if(p)w.memory.free(p);
 }
 assert.equal(report.polygons.length,10);assert.equal(report.curves.length,22);
 report.exactPolygons=report.polygons.filter(e=>e.exact).length;report.exactCurves=report.curves.filter(e=>e.exact).length;
 report.curveRasterDifferences=report.curves.length-report.exactCurves;
 console.log(`Exact Windows polygon cases: ${report.exactPolygons}/${report.polygons.length}. Curved cases equal: ${report.exactCurves}/${report.curves.length}; ${report.curveRasterDifferences} documented raster differences.`);
}finally{writeFileSync(file.replace(/native\.json$/,'comparison.json'),JSON.stringify(report,null,2)+'\n');w.dispose();}
