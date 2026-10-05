import {Win32Error,integer,unsigned} from './core.js';
import {BitmapStore,GDI_CONSTANTS,coord,intersect,rgbBytes,rgbValue,ropInfo} from './gdi-bitmap.js';
export function colorRef(value){const n=unsigned(value);return '#'+[n&255,n>>>8&255,n>>>16&255].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function installGDI(w){
  const h=w.handles,m=w.memory,bitmaps=new BitmapStore(w);
  const add=(name,arity,fn,options={})=>w.register('gdi32',name,fn,{arity,mode:'emulated',...options});
  const stocks=new Map(),stock=(index,type,value)=>stocks.set(index,h.add(type,{...value,stock:true}));
  stock(0,'brush',{color:0xffffff});stock(4,'brush',{color:0});stock(5,'brush',{null:true});stock(6,'pen',{color:0xffffff,width:1});stock(7,'pen',{color:0,width:1});stock(8,'pen',{null:true,width:1});
  const dc=handle=>h.get(handle,'dc');
  const newState=()=>({pen:stocks.get(7),brush:stocks.get(0),bitmap:0,x:0,y:0,viewportX:0,viewportY:0,clip:null,saved:[],stretchMode:1,textColor:0,backgroundColor:0xffffff,backgroundMode:2});
  const states=()=>[...h.entries.values()].filter(e=>e.type==='dc').flatMap(e=>[e.value,...e.value.saved]);
  const selected=object=>states().some(s=>s.pen===Number(object)||s.brush===Number(object)||s.bitmap===Number(object));
  const style=state=>({pen:h.get(state.pen,'pen'),brush:h.get(state.brush,'brush'),textColor:state.textColor,backgroundColor:state.backgroundColor,backgroundMode:state.backgroundMode});
  const draw=(state,operation,args)=>{
    if(state.bitmap){if(operation==='pixel'){bitmaps.pixel(state,args[0],args[1],args[2]);return;}return bitmaps.primitive(state,operation,args,style(state));}
    // Hosts with a raster adapter also receive correct clipping. Legacy draw-only
    // descriptors continue to work for the original unclipped drawing surface.
    if(state.clip){if(operation==='pixel'){bitmaps.pixel(state,args[0],args[1],args[2]);return;}return bitmaps.primitive(state,operation,args,style(state));}
    args=[...args];args[0]+=state.viewportX;args[1]+=state.viewportY;if(['line','rect','ellipse'].includes(operation)){args[2]+=state.viewportX;args[3]+=state.viewportY;}
    const s=style(state);if(state.window.draw)return state.window.draw(operation,args,s);
    const ctx=bitmaps.context(state);ctx.save();try{
      ctx.strokeStyle=colorRef(s.pen.color||0);ctx.lineWidth=s.pen.width||1;ctx.fillStyle=colorRef(s.brush.color||0);
      switch(operation){
        case 'line':ctx.beginPath();ctx.moveTo(args[0],args[1]);ctx.lineTo(args[2],args[3]);if(!s.pen.null)ctx.stroke();break;
        case 'rect':if(!s.brush.null)ctx.fillRect(args[0],args[1],args[2]-args[0],args[3]-args[1]);if(!s.pen.null)ctx.strokeRect(args[0],args[1],args[2]-args[0],args[3]-args[1]);break;
        case 'ellipse':ctx.beginPath();ctx.ellipse((args[0]+args[2])/2,(args[1]+args[3])/2,Math.abs(args[2]-args[0])/2,Math.abs(args[3]-args[1])/2,0,0,Math.PI*2);if(!s.brush.null)ctx.fill();if(!s.pen.null)ctx.stroke();break;
        case 'pixel':ctx.fillStyle=colorRef(args[2]);ctx.fillRect(args[0],args[1],1,1);break;
        case 'text':ctx.font='12px Arial';ctx.textBaseline='top';if(s.backgroundMode===2){ctx.fillStyle=colorRef(s.backgroundColor);ctx.fillRect(args[0],args[1],ctx.measureText(args[2]).width,14);}ctx.fillStyle=colorRef(s.textColor);ctx.fillText(args[2],args[0],args[1]);break;
        default:throw new Win32Error('Unsupported drawing operation',50);
      }
    }finally{ctx.restore();}
  };
  add('GetStockObject',1,index=>{if(!stocks.has(Number(index)))throw new Win32Error('Stock object is not implemented',50);return stocks.get(Number(index));});
  add('CreateSolidBrush',1,color=>h.add('brush',{color:unsigned(color)&0xffffff}));
  add('CreatePen',3,(style,width,color)=>{if(![0,5].includes(Number(style)))throw new Win32Error('Only solid and null pens are supported',50);return h.add('pen',{null:Number(style)===5,width:Math.max(1,integer(width,0,4096)),color:unsigned(color)&0xffffff});});
  w.register('user32','GetDC',handle=>{const window=h.get(handle,'window');if(!window.draw&&!window.context&&!window.node?.getContext&&!window.writePixels)throw new Win32Error('No drawing adapter',50);return h.add('dc',{...newState(),window,handle:Number(handle)});},{arity:1,mode:'browser'});
  w.register('user32','ReleaseDC',(handle,hdc)=>{const state=dc(hdc);if(state.memory||state.handle!==Number(handle))throw new Win32Error('DC does not belong to window',6);h.close(hdc,'dc');return 1;},{arity:2,mode:'browser'});
  add('CreateCompatibleDC',1,handle=>{if(handle)dc(handle);if(h.entries.size+2>h.limit)throw new Win32Error('Handle quota exceeded',8);const bitmap=bitmaps.create(1,1,1,{stock:true});try{const id=h.add('dc',{...newState(),memory:true,bitmap,defaultBitmap:bitmap});bitmaps.get(bitmap).defaultFor=id;return id;}catch(error){m.free(bitmaps.get(bitmap).ptr);h.close(bitmap,'bitmap');throw error;}});
  const deleteDC=handle=>{const state=dc(handle);if(!state.memory)throw new Win32Error('Use ReleaseDC for a window DC',6);m.free(bitmaps.get(state.defaultBitmap).ptr);h.close(state.defaultBitmap,'bitmap');h.close(handle,'dc');return 1;};
  add('DeleteDC',1,deleteDC);
  add('SelectObject',2,(handle,object)=>{const state=dc(handle),entry=h.entries.get(Number(object));if(!entry||!['pen','brush','bitmap'].includes(entry.type))throw new Win32Error('Invalid GDI object',6);if(entry.type==='bitmap'){
      if(!state.memory||entry.value.defaultFor&&entry.value.defaultFor!==Number(handle))throw new Win32Error('Bitmap cannot be selected into this DC',87);
      for(const [id,e]of h.entries)if(e.type==='dc'&&id!==Number(handle)&&[e.value,...e.value.saved].some(s=>s.bitmap===Number(object)))throw new Win32Error('Bitmap is selected into another DC',87);
    }const old=state[entry.type];state[entry.type]=Number(object);return old;});
  add('DeleteObject',1,object=>{const entry=h.entries.get(Number(object));if(entry?.type==='dc')return deleteDC(object);if(!entry||!['pen','brush','bitmap'].includes(entry.type))throw new Win32Error('Invalid GDI object',6);if(entry.value.stock)return 1;if(selected(object))return 0;if(entry.type==='bitmap')m.free(entry.value.ptr);h.close(object,entry.type);return 1;});
  add('GetCurrentObject',2,(handle,type)=>{const state=dc(handle),field={1:'pen',2:'brush',7:'bitmap'}[Number(type)];if(!field)throw new Win32Error('Object type is not implemented',50);return state[field]||0;});
  add('GetObjectType',1,handle=>{const e=h.entries.get(Number(handle));if(!e)throw new Win32Error('Invalid GDI handle',6);return e.type==='dc'?(e.value.memory?10:3):({pen:1,brush:2,bitmap:7})[e.type]||0;});
  const bitmapInfo=(b,p)=>{const v=m.view(p,40);v.setUint32(0,40,true);v.setInt32(4,b.width,true);v.setInt32(8,b.topDown?-b.height:b.height,true);v.setUint16(12,1,true);v.setUint16(14,b.bpp,true);v.setUint32(16,0,true);v.setUint32(20,Math.ceil(b.width*b.bpp/32)*4*b.height,true);for(let o=24;o<40;o+=4)v.setUint32(o,0,true);};
  for(const suffix of ['A','W'])add('GetObject'+suffix,3,(object,count,out)=>{const e=h.entries.get(Number(object));if(!e||!['pen','brush','bitmap'].includes(e.type))throw new Win32Error('Unsupported GDI object',6);const b=e.value,size=e.type==='pen'?16:e.type==='brush'?12:24;if(!out)return size;count=integer(count,0,0x7fffffff);const n=e.type==='bitmap'&&b.dib&&count>=84?84:size;if(count<n||unsigned(out)%4)throw new Win32Error('Invalid GDI object buffer');const v=m.view(out,n);m.bytes(out,n).fill(0);
    if(e.type==='pen'){v.setUint32(0,b.null?5:0,true);v.setInt32(4,b.width||1,true);v.setUint32(12,b.color||0,true);}
    else if(e.type==='brush'){v.setUint32(0,b.null?1:0,true);v.setUint32(4,b.color||0,true);}
    else{v.setInt32(4,b.width,true);v.setInt32(8,b.height,true);v.setInt32(12,b.stride,true);v.setUint16(16,1,true);v.setUint16(18,b.bpp,true);v.setUint32(20,b.dib?b.ptr:0,true);if(n===84)bitmapInfo(b,out+24);}return n;
  });
  add('CreateBitmap',5,(width,height,planes,bpp,bits)=>{if(integer(planes,1,0xffff)!==1)throw new Win32Error('Multiple bitmap planes are not supported',50);width=integer(width,0,32767);height=integer(height,0,32767);return !width||!height?bitmaps.create(1,1,1):bitmaps.create(width,height,Number(bpp),{bits});});
  add('CreateCompatibleBitmap',3,(handle,width,height)=>{const state=dc(handle);width=integer(width,0,32767);height=integer(height,0,32767);if(!width||!height)return bitmaps.create(1,1,1);const source=state.bitmap?bitmaps.get(state.bitmap):null;return bitmaps.create(width,height,source?.bpp||32,{dib:!!source?.dib,topDown:source?.topDown??true});});
  add('CreateDIBSection',6,(handle,info,usage,out,section,offset)=>{m.writeU32(out,0);if(handle)dc(handle);if(section)throw new Win32Error('File-mapped DIB sections are not supported',50);unsigned(offset);const b=bitmaps.header(info,usage),id=bitmaps.create(b.width,b.height,b.bpp,{dib:true,topDown:b.topDown});m.writeU32(out,bitmaps.get(id).ptr);return id;});
  // Get/SetBitmapBits expose top-down WORD-aligned DDB rows, including for DIBs.
  const rawLayout=b=>({...b,...bitmaps.geometry(b.width,b.height,b.bpp,false),topDown:true});
  add('GetBitmapBits',3,(object,count,out)=>{const b=bitmaps.get(object),raw=rawLayout(b);count=integer(count,0,0x7fffffff);if(!out)return raw.size;const n=Math.min(count,raw.size);if(!n)return 0;const bytes=new Uint8Array(raw.size),src=bitmaps.data(b);for(let y=0;y<b.height;y++)bytes.set(src.subarray((b.topDown?y:b.height-1-y)*b.stride,(b.topDown?y:b.height-1-y)*b.stride+Math.min(raw.stride,b.stride)),y*raw.stride);m.bytes(out,n).set(bytes.subarray(0,n));return n;});
  add('SetBitmapBits',3,(object,count,input)=>{const b=bitmaps.get(object),raw=rawLayout(b);count=integer(count,0,0x7fffffff);const n=Math.min(count,raw.size);if(!n)return 0;const bytes=m.bytes(input,n).slice(),dst=bitmaps.data(b);for(let pos=0;pos<n;pos++){const y=Math.floor(pos/raw.stride),x=pos%raw.stride;dst[(b.topDown?y:b.height-1-y)*b.stride+x]=bytes[pos];}return n;});
  const pair=(p,a,b)=>{const v=m.view(p,8);v.setInt32(0,a,true);v.setInt32(4,b,true);};
  add('GetBitmapDimensionEx',2,(object,out)=>{const b=bitmaps.get(object);pair(out,b.dimensionX,b.dimensionY);return 1;});
  add('SetBitmapDimensionEx',4,(object,x,y,out)=>{const b=bitmaps.get(object);x=coord(x);y=coord(y);if(out)pair(out,b.dimensionX,b.dimensionY);b.dimensionX=x;b.dimensionY=y;return 1;});
  const requireUnselected=object=>{if(selected(object))throw new Win32Error('DIB transfer requires an unselected bitmap',87);};
  add('GetDIBits',7,(handle,object,start,lines,out,info,usage)=>{
    dc(handle);const b=bitmaps.get(object);requireUnselected(object);integer(start,0,0xffffffff);integer(lines,0,0xffffffff);if(unsigned(usage)!==0)throw new Win32Error('Logical palettes are not supported',50);
    const v=m.view(info,40);if(v.getUint32(0,true)!==40)throw new Win32Error('Only BITMAPINFOHEADER is supported',50);
    if(!out&&!v.getUint16(14,true)){bitmapInfo({...b,topDown:false},info);return 1;}
    const format=bitmaps.header(info,usage);if(format.width!==b.width||format.height!==b.height)throw new Win32Error('DIB transfer dimensions must match bitmap',50);
    if(!out){bitmapInfo(format,info);return 1;}const n=Math.min(Number(lines),Math.max(0,b.height-Number(start)));if(!n)return 0;
    const dest=m.bytes(out,n*format.stride),temp=new Uint8Array(dest.length),source=bitmaps.readBitmap(b,[0,format.topDown?Number(start):b.height-Number(start)-n,b.width,format.topDown?Number(start)+n:b.height-Number(start)]);
    for(let y=0;y<n;y++)for(let x=0;x<b.width;x++){const i=((format.topDown?y:n-1-y)*b.width+x)*4,p=y*format.stride+x*format.bpp/8;temp[p]=source.data[i+2];temp[p+1]=source.data[i+1];temp[p+2]=source.data[i];if(format.bpp===32)temp[p+3]=source.data[i+3];}dest.set(temp);bitmapInfo(format,info);return n;
  });
  add('SetDIBits',7,(handle,object,start,lines,input,info,usage)=>{
    dc(handle);const b=bitmaps.get(object);requireUnselected(object);start=integer(start,0,0xffffffff);lines=integer(lines,0,0xffffffff);const f=bitmaps.header(info,usage);if(f.width!==b.width||f.height!==b.height)throw new Win32Error('DIB transfer dimensions must match bitmap',50);const n=Math.min(lines,Math.max(0,b.height-start));if(!n)return 0;const src=m.bytes(input,n*f.stride).slice(),image=bitmaps.bytesFor([0,0,b.width,n]);
    for(let y=0;y<n;y++)for(let x=0;x<b.width;x++){const i=((f.topDown?y:n-1-y)*b.width+x)*4,p=y*f.stride+x*f.bpp/8;image.data[i]=src[p+2];image.data[i+1]=src[p+1];image.data[i+2]=src[p];image.data[i+3]=f.bpp===32?src[p+3]:0;}const top=f.topDown?start:b.height-start-n;bitmaps.writeBitmap(b,[0,top,b.width,top+n],image);return n;
  });
  add('BitBlt',9,(dest,x,y,width,height,source,sx,sy,rop)=>{integer(width,0,0x7fffffff);integer(height,0,0x7fffffff);const r=ropInfo(rop);return bitmaps.blit(dc(dest),x,y,width,height,r.source?dc(source):null,sx,sy,width,height,rop);});
  add('StretchBlt',11,(dest,x,y,width,height,source,sx,sy,sw,sh,rop)=>{const r=ropInfo(rop);return bitmaps.blit(dc(dest),x,y,width,height,r.source?dc(source):null,sx,sy,sw,sh,rop);});
  add('PatBlt',6,(dest,x,y,width,height,rop)=>{if(ropInfo(rop).source)throw new Win32Error('PatBlt does not accept source-dependent ROPs',50);return bitmaps.blit(dc(dest),x,y,width,height,null,0,0,width,height,rop);});
  for(const [name,operation]of [['TransparentBlt','transparent'],['AlphaBlend','alpha']]){
    const fn=(dest,x,y,width,height,source,sx,sy,sw,sh,extra)=>bitmaps.blit(dc(dest),x,y,width,height,dc(source),sx,sy,sw,sh,operation,extra);
    w.register('msimg32',name,fn,{arity:11,notes:name==='AlphaBlend'?'Packed BLENDFUNCTION; premultiplied 32-bit source alpha.':'Color-key transfer; positive extents only.'});
    add('Gdi'+name,11,fn);
  }
  add('GdiFlush',0,()=>1,{notes:'Memory operations and host pixel transfers are synchronous. Browser presentation is independently scheduled.'});
  add('GetPixel',3,(handle,x,y)=>bitmaps.pixel(dc(handle),x,y),{failure:0xffffffff});
  add('SetPixel',4,(handle,x,y,color)=>{const state=dc(handle);color=unsigned(color)&0xffffff;if(state.bitmap||state.clip)return bitmaps.pixel(state,x,y,color);draw(state,'pixel',[coord(x),coord(y),color]);return color;},{failure:0xffffffff});
  add('SetPixelV',4,(handle,x,y,color)=>{const result=w.invoke('gdi32','SetPixel',[handle,x,y,color]);return result===0xffffffff?0:1;});
  add('MoveToEx',4,(handle,x,y,old)=>{const state=dc(handle);x=coord(x);y=coord(y);if(old)pair(old,state.x,state.y);state.x=x;state.y=y;return 1;});
  add('GetCurrentPositionEx',2,(handle,out)=>{const s=dc(handle);pair(out,s.x,s.y);return 1;});
  add('LineTo',3,(handle,x,y)=>{const state=dc(handle);x=coord(x);y=coord(y);draw(state,'line',[state.x,state.y,x,y]);state.x=x;state.y=y;return 1;});
  for(const [name,operation]of [['Rectangle','rect'],['Ellipse','ellipse']])add(name,5,(handle,l,t,r,b)=>{draw(dc(handle),operation,[l,t,r,b].map(coord));return 1;});
  for(const [name,field]of [['TextColor','textColor'],['BkColor','backgroundColor']]){
    add('Set'+name,2,(handle,color)=>{const state=dc(handle),old=state[field];state[field]=unsigned(color)&0xffffff;return old;},{failure:0xffffffff});
    add('Get'+name,1,handle=>dc(handle)[field],{failure:0xffffffff});
  }
  add('SetBkMode',2,(handle,mode)=>{integer(mode,1,2);const state=dc(handle),old=state.backgroundMode;state.backgroundMode=Number(mode);return old;});
  add('GetBkMode',1,handle=>dc(handle).backgroundMode);
  for(const wide of [false,true])add('TextOut'+(wide?'W':'A'),5,(handle,x,y,p,n)=>{n=integer(n,0,m.maxBytes/(wide?2:1));const text=typeof p==='string'?p.slice(0,n):m.decode(m.bytes(p,n*(wide?2:1)),wide);draw(dc(handle),'text',[coord(x),coord(y),text]);return 1;},{mode:'browser',notes:'Canvas/host font metrics; software memory DC text is not implemented.'});
  add('SaveDC',1,handle=>{const state=dc(handle);if(state.saved.length>=256)throw new Win32Error('Saved DC stack exceeds 256',8);const {saved,...snapshot}=state;state.saved.push({...snapshot,clip:state.clip?.slice()||null});return state.saved.length;});
  add('RestoreDC',2,(handle,level)=>{const state=dc(handle);level=coord(level);const index=level<0?state.saved.length+level:level-1;if(!level||index<0||index>=state.saved.length)throw new Win32Error('Invalid saved DC level');const snapshot=state.saved[index];state.saved.splice(index);Object.assign(state,snapshot);return 1;});
  add('SetViewportOrgEx',4,(handle,x,y,old)=>{const state=dc(handle);x=coord(x);y=coord(y);if(old)pair(old,state.viewportX,state.viewportY);state.viewportX=x;state.viewportY=y;return 1;});
  add('OffsetViewportOrgEx',4,(handle,x,y,old)=>{const state=dc(handle);return w.invoke('gdi32','SetViewportOrgEx',[handle,coord(state.viewportX+coord(x)),coord(state.viewportY+coord(y)),old]);});
  add('GetViewportOrgEx',2,(handle,out)=>{const s=dc(handle);pair(out,s.viewportX,s.viewportY);return 1;});
  add('GetMapMode',1,handle=>{dc(handle);return 1;});
  add('SetMapMode',2,(handle,mode)=>{dc(handle);if(Number(mode)!==1)throw new Win32Error('Only MM_TEXT is supported',50);return 1;});
  add('SetStretchBltMode',2,(handle,mode)=>{const state=dc(handle);if(Number(mode)!==3)throw new Win32Error('Only COLORONCOLOR scaling is supported',50);const old=state.stretchMode;state.stretchMode=3;return old;});
  add('GetStretchBltMode',1,handle=>dc(handle).stretchMode);
  add('IntersectClipRect',5,(handle,l,t,r,b)=>{const s=dc(handle);const next=[coord(l)+s.viewportX,coord(t)+s.viewportY,coord(r)+s.viewportX,coord(b)+s.viewportY];s.clip=intersect(s.clip||[-0x80000000,-0x80000000,0x7fffffff,0x7fffffff],next);return s.clip[2]>s.clip[0]?2:1;});
  add('GetClipBox',2,(handle,out)=>{const s=dc(handle),r=bitmaps.clip(s,bitmaps.bounds(s)),v=m.view(out,16);r.forEach((n,i)=>v.setInt32(i*4,n-(i%2?s.viewportY:s.viewportX),true));return r[2]>r[0]?2:1;});
  add('PtVisible',3,(handle,x,y)=>{const s=dc(handle);x=coord(x)+s.viewportX;y=coord(y)+s.viewportY;const r=bitmaps.clip(s,[x,y,x+1,y+1]);return r[2]>r[0]?1:0;});
  add('GetDeviceCaps',2,(handle,index)=>{const s=dc(handle),r=bitmaps.bounds(s);const values={2:1,8:r[2],10:r[3],12:32,14:1,88:96,90:96};if(!(index in values))throw new Win32Error('Device capability not implemented',50);return values[index];});
}
