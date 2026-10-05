/* Browser contracts use real Canvas shaping and pixels, never a mocked font. */
globalThis.runWin32BoundaryProbe=async function(library){
  const w=library.createWin32(),m=w.memory,results=[];
  const call=(dll,name,...args)=>w.invoke(dll,name,args),g=(name,...args)=>call('gdi32',name,...args),u=(name,...args)=>call('user32',name,...args);
  const check=(ok,message)=>{if(!ok)throw new Error(message+'; LastError='+w.lastError);};
  const p=m.alloc(256),out=m.alloc(128),dc=g('CreateCompatibleDC',0),bitmap=g('CreateBitmap',160,80,1,32,0),oldBitmap=g('SelectObject',dc,bitmap);
  const run=async(name,fn)=>{await fn();results.push({case:name,passed:true});};
  const size=()=>{check(g('GetTextExtentPoint32W',dc,p,5,out)===1,'text measurement');return [m.readI32(out),m.readI32(out+4)];};
  const clear=()=>{g('SelectClipRgn',dc,0);g('ModifyWorldTransform',dc,0,1);g('SetTextAlign',dc,0);g('SetBkMode',dc,1);g('SelectObject',dc,g('GetStockObject',0));g('PatBlt',dc,0,0,160,80,0x00f00021);};
  const pixels=()=>{const b=w.handles.get(bitmap,'bitmap');return m.bytes(b.ptr,b.size);};
  const dark=()=>{const bytes=pixels();let count=0;for(let i=0;i<bytes.length;i+=4)if(bytes[i]+bytes[i+1]+bytes[i+2]<600)count++;return count;};
  try{
    check(dc&&bitmap&&oldBitmap,'memory bitmap allocation');g('SetGraphicsMode',dc,2);clear();m.putString(p,'Hello',64,true);
    await run('memory-dc-real-unicode-font',()=>{
      const font=g('CreateFontW',-24,0,0,0,700,0,0,0,1,0,0,0,0,'Arial');check(font,'font');const old=g('SelectObject',dc,font);
      const measured=size();check(measured[0]>20&&measured[1]>10,'actual metrics');check(g('TextOutW',dc,4,4,p,5)===1,'memory text');check(dark()>50,'glyph pixels were drawn');
      check(g('GetTextMetricsW',dc,out)===1&&m.readI32(out)>0,'TEXTMETRIC');check(g('GetObjectW',font,92,out)===92&&m.readI32(out)===-24,'LOGFONT');
      g('SelectObject',dc,old);check(g('DeleteObject',font)===1,'font cleanup');
    });
    await run('text-clipping-and-opaque-rectangle',()=>{
      clear();const rect=m.alloc(16);[0,0,60,30].forEach((n,i)=>m.writeI32(rect+i*4,n));g('SetBkColor',dc,0x0000ff);
      check(g('ExtTextOutW',dc,4,4,6,rect,p,5,0)===1,'opaque clipped text');check(g('GetPixel',dc,59,29)===255,'opaque rectangle');check(g('GetPixel',dc,61,29)===0xffffff,'outside rectangle unchanged');m.free(rect);
    });
    await run('clipped-text-updates-current-position',()=>{
      clear();g('SetTextAlign',dc,1);g('MoveToEx',dc,3,4,0);const r=g('CreateRectRgn',0,0,0,0);g('SelectClipRgn',dc,r);g('DeleteObject',r);
      check(g('TextOutW',dc,0,0,p,5)===1,'fully clipped text succeeds');g('GetCurrentPositionEx',dc,out);check(m.readI32(out)>3,'TA_UPDATECP even outside clip');
      g('SelectClipRgn',dc,0);check(dark()===0,'fully clipped pixels unchanged');
    });
    await run('unicode-shaping-and-cumulative-extents',()=>{
      clear();const text='Zażółć Ω العربية 😀';m.putString(p,text,100,true);const count=text.length;
      check(g('TextOutW',dc,2,2,p,count)===1&&dark()>30,'unicode browser shaping');
      const cumulative=m.alloc(count*4);check(g('GetTextExtentExPointW',dc,p,count,10000,out,cumulative,out+8)===1,'extended extents');check(m.readI32(out)===count&&m.readI32(out+8)>0,'fit count');m.free(cumulative);
    });
    await run('affine-text-and-explicit-advances',()=>{
      clear();m.putString(p,'Hello',64,true);const xf=m.alloc(24);[0,1,-1,0,90,4].forEach((n,i)=>m.view(xf,24).setFloat32(i*4,n,true));check(g('SetWorldTransform',dc,xf)===1,'rotated text matrix');
      const dx=m.alloc(40);for(let i=0;i<5;i++){m.writeI32(dx+i*8,12);m.writeI32(dx+i*8+4,1);}
      check(g('ExtTextOutW',dc,0,0,8192,0,p,5,dx)===1&&dark()>15,'rotated dx/dy text');m.free(dx);m.free(xf);g('ModifyWorldTransform',dc,0,1);
    });
    await run('drawtext-layout-and-rejected-glyph-indices',()=>{
      clear();const rect=m.alloc(16);[2,2,48,80].forEach((n,i)=>m.writeI32(rect+i*4,n));const text='Hello world wrap';m.putString(p,text,100,true);
      const height=u('DrawTextW',dc,p,text.length,rect,16|1024);check(height>20&&m.readI32(rect+12)>22,'DrawText wrapping CALCRECT');check(u('DrawTextW',dc,p,text.length,rect,16)>0&&dark()>20,'DrawText glyph pixels');
      const before=Array.from(pixels());check(g('ExtTextOutW',dc,0,0,16,0,p,2,0)===0&&w.lastError===50,'glyph-index unsupported explicit');check(JSON.stringify(before)===JSON.stringify(Array.from(pixels())),'failed draw untouched');m.free(rect);
    });
    await run('dom-window-region-presentation-and-hit-test',()=>{
      const host=document.createElement('div'),node=document.createElement('canvas');host.style.cssText='position:fixed;left:0;top:0;width:100px;height:100px;background:yellow;z-index:20000';node.width=node.height=64;node.style.cssText='position:absolute;left:0;top:0;width:64px;height:64px;background:blue';host.append(node);document.body.append(host);
      const id=w.registerWindow({node,context:node.getContext('2d'),getRect:()=>node.getBoundingClientRect(),clientOrigin:()=>[0,0],getClientRect:()=>({width:64,height:64})});
      try{const r=g('CreateRectRgn',0,0,64,64),hole=g('CreateRectRgn',16,16,48,48);g('CombineRgn',r,r,hole,4);g('DeleteObject',hole);check(u('SetWindowRgn',id,r,0)===1,'SetWindowRgn DOM');
        check(document.elementFromPoint(5,5)===node,'outer shape hit');check(document.elementFromPoint(32,32)!==node,'hole excluded from hit testing');check(g('DeleteObject',r)===0&&w.lastError===5,'owned region');
        check(u('SetWindowRgn',id,0,0)===1&&document.elementFromPoint(32,32)===node,'shape removed');check(!w.handles.has(r),'owned region freed');
      }finally{w.unregisterWindow(id);host.remove();}
    });
    await run('window-paint-region-lifecycle-and-background',async()=>{
      const node=document.createElement('canvas');node.width=node.height=64;const ps=m.alloc(64),rect=m.alloc(16),ctx=node.getContext('2d');let events=0,nonclient=0;
      const descriptor={node,context:ctx,getClientRect:()=>({width:64,height:64}),getBackgroundColor:()=>0x0000ff,requestNonClientPaint:()=>{nonclient++;}};
      const id=w.registerWindow(descriptor);descriptor.requestPaint=()=>{events++;const paint=u('BeginPaint',id,ps);check(paint,'BeginPaint');check(g('SetPixel',paint,4,4,0x00ff00)===0x00ff00,'paint pixel');check(u('EndPaint',id,ps)===1,'EndPaint');};
      try{[2,2,20,20].forEach((n,i)=>m.writeI32(rect+i*4,n));check(u('InvalidateRect',id,rect,1)===1,'invalidated');await u('UpdateWindow',id);check(events===1&&u('GetUpdateRect',id,0,0)===0,'update consumed');
        check(Array.from(ctx.getImageData(3,3,1,1).data).slice(0,3).join(',')==='255,0,0','background erase');check(Array.from(ctx.getImageData(4,4,1,1).data).slice(0,3).join(',')==='0,255,0','paint content');
        check(await u('RedrawWindow',id,0,0,1|4|256|1024)===1&&nonclient===1&&events===2,'nonclient + immediate paint adapter');
      }finally{w.unregisterWindow(id);m.free(ps);m.free(rect);}
    });
    g('SelectObject',dc,oldBitmap);check(g('DeleteObject',bitmap)===1,'bitmap cleanup');check(g('DeleteDC',dc)===1,'dc cleanup');m.free(p);m.free(out);
    check(m.used===0,'no transient memory');check([...w.handles.entries.values()].every(e=>e.value.stock),'only stock handles retained');
    return {results,memory:m.used,exports:w.manifest().length};
  }finally{w.dispose();}
};
