export function clippingEdges(createWin32){
 const w=createWin32(),m=w.memory,g=(n,...a)=>w.invoke('gdi32',n,a),output=[];
 try{
  const dc=g('CreateCompatibleDC',0),bitmap=g('CreateBitmap',8,8,1,32,0);g('SelectObject',dc,bitmap);
  const copy=g('CreateRectRgn',0,0,0,0),p=m.alloc(1024);
  const data=h=>{const size=g('GetRegionData',h,1024,p);if(size<32)throw new Error('Region read failed');return Array.from({length:size/4},(_,i)=>m.readI32(p+i*4));};
  for(const rect of [[0,0,0,0],[20,20,30,30],[2,2,6,6],[-2,-2,10,10]]){
   const r=g('CreateRectRgn',...rect);
   for(const op of ['select','intersect','exclude','offset','and','or','xor','diff','copy']){
    g('SelectClipRgn',dc,0);let value=0;
    if(op==='select')value=g('SelectClipRgn',dc,r);
    if(op==='intersect')value=g('IntersectClipRect',dc,...rect);
    if(op==='exclude')value=g('ExcludeClipRect',dc,...rect);
    if(op==='offset'){g('SelectClipRgn',dc,r);value=g('OffsetClipRgn',dc,20,20);}
    const mode=['and','or','xor','diff','copy'].indexOf(op)+1;if(mode)value=g('ExtSelectClipRgn',dc,r,mode);
    const boxType=g('GetClipBox',dc,p),box=Array.from({length:4},(_,i)=>m.readI32(p+i*4)),has=g('GetClipRgn',dc,copy);
    output.push({rect,op,value,boxType,box,has,data:has===1?data(copy):[]});
   }
   g('DeleteObject',r);
  }
  w.lastError=0;const value=g('GetRegionData',copy,16,p);output.push({op:'small-buffer',value,error:w.lastError});return output;
 }finally{w.dispose();}
}
