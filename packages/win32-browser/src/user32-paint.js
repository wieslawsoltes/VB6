import {Win32Error,integer,unsigned} from './core.js';

export const PAINT_CONSTANTS=Object.freeze({WM_PAINT:15,WM_ERASEBKGND:20,RDW_INVALIDATE:1,RDW_INTERNALPAINT:2,RDW_ERASE:4,RDW_VALIDATE:8,RDW_NOINTERNALPAINT:16,RDW_NOERASE:32,RDW_NOCHILDREN:64,RDW_ALLCHILDREN:128,RDW_UPDATENOW:256,RDW_ERASENOW:512,RDW_FRAME:1024,RDW_NOFRAME:2048,DCX_WINDOW:1,DCX_CACHE:2,DCX_INTERSECTRGN:128,DCX_EXCLUDERGN:64});
/** Window-owned HRGNs and independent pending/active update regions. All state is
 * process-local and is destroyed with its registered application window. */
export function installPainting(w,{dc,bitmaps,regions}){
  const h=w.handles,m=w.memory,tasks=new Map(),add=(name,arity,fn,options={})=>w.register('user32',name,fn,{arity,mode:'browser',...options});
  const win=id=>{if(!h.has(id,'window'))throw new Win32Error('Invalid window handle',1400);return h.get(id,'window');};
  const empty=()=>regions.rectangle(0,0,0,0);
  const full=e=>{const r=e.getClientRect?.(),node=e.context?.canvas||e.node;return regions.rectangle(0,0,Math.round(r?.width??node?.clientWidth??node?.width??0),Math.round(r?.height??node?.clientHeight??node?.height??0));};
  const state=e=>e.gdiPaint||(e.gdiPaint={update:empty(),erase:false,active:null,internal:false,nonclient:false,notifying:false});
  const region=id=>{const r=h.get(id,'region');if(r.windowOwner)throw new Win32Error('Region ownership belongs to a window',5);return r;};
  const rect=p=>{const v=m.view(p,16);return [0,4,8,12].map(o=>v.getInt32(o,true));};
  const writeRect=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));};
  const request=id=>{
    if(tasks.has(id)||w.disposed)return;const e=win(id);if(!e.requestPaint&&!e.message&&!e.requestNonClientPaint)return;
    tasks.set(id,setTimeout(()=>{
      tasks.delete(id);
      if(!w.disposed&&h.has(id,'window'))notify(id).catch(error=>w.options.onError?.(error));
    },0));
  };
  const eraseBackground=(e,handle)=>{
    if(e.eraseBackground)return e.eraseBackground(handle)!==false;
    if(e.getBackgroundColor&&handle){
      const d=dc(handle),r=bitmaps.effective(d),color=unsigned(e.getBackgroundColor())&0xffffff;
      if(r.count){const image=bitmaps.read(d,r.bounds);for(const band of r.bands)for(let y=band.top;y<band.bottom;y++)for(let j=0;j<band.spans.length;j+=2)for(let x=band.spans[j];x<band.spans[j+1];x++){
        const i=((y-r.bounds[1])*image.width+x-r.bounds[0])*4;image.data.set([color&255,color>>>8&255,color>>>16&255,0],i);
      }bitmaps.write(d,r.bounds,image);}return true;
    }
    return false;
  };
  const notify=async(id,force=false,eraseOnly=false)=>{
    const e=win(id),s=state(e);if(s.notifying)return 1;
    if(!(force||s.update.count||s.internal||s.nonclient))return 1;
    if(tasks.has(id)){clearTimeout(tasks.get(id));tasks.delete(id);}
    s.notifying=true;
    try{
      if(s.nonclient){if(e.requestNonClientPaint)await e.requestNonClientPaint();else if(e.message)await e.message(133,1,0,false);else throw new Win32Error('No nonclient repaint adapter',50);s.nonclient=false;}
      if(eraseOnly){if(s.erase){const handle=getDC(id);try{dc(handle).paintClip=s.update;if(eraseBackground(e,handle))s.erase=false;}finally{release(id,handle);}}return 1;}
      if(force||s.update.count||s.internal){s.internal=false;if(e.requestPaint)await e.requestPaint();else if(e.message)await e.message(15,0,0,false);else throw new Win32Error('No WM_PAINT adapter for this window',50);}
      return 1;
    }finally{s.notifying=false;}
  };
  const change=(id,shape,invalidate,erase)=>{const e=win(id),s=state(e),clip=regions.combine(shape||full(e),full(e),1),next=regions.combine(s.update,clip,invalidate?2:4);s.update=next;if(invalidate)s.erase=s.erase||!!erase;else if(!next.count)s.erase=false;if(invalidate)request(id);return 1;};
  add('InvalidateRect',3,(id,p,erase)=>change(id,p?regions.rectangle(...rect(p)):null,true,erase));
  add('ValidateRect',2,(id,p)=>change(id,p?regions.rectangle(...rect(p)):null,false,false));
  add('InvalidateRgn',3,(id,r,erase)=>change(id,r?region(r).shape:null,true,erase));
  add('ValidateRgn',2,(id,r)=>change(id,r?region(r).shape:null,false,false));
  const erasePending=e=>{const s=state(e);if(!s.erase)return;const id=e.gdiWindowHandle;if(!id)return;const handle=getDC(id);try{dc(handle).paintClip=s.update;if(eraseBackground(e,handle))s.erase=false;}finally{release(id,handle);}};
  add('GetUpdateRect',3,(id,p,erase)=>{const e=win(id),s=state(e);if(p)writeRect(p,s.update.bounds);if(erase&&s.erase){e.gdiWindowHandle=Number(id);erasePending(e);}return s.update.count?1:0;});
  add('GetUpdateRgn',3,(id,r,erase)=>{const e=win(id),s=state(e),dest=region(r);if(erase&&s.erase){e.gdiWindowHandle=Number(id);erasePending(e);}dest.shape=s.update;return dest.shape.type;});
  add('SetWindowRgn',3,(id,r,redraw)=>{
    const e=win(id),s=state(e),object=r?region(r):null,shape=object?.shape??null;
    const wr=e.getRect?.(),origin=e.clientOrigin?.(),dx=origin&&wr?Math.round(origin[0]-wr.left):0,dy=origin&&wr?Math.round(origin[1]-wr.top):0;
    const clientShape=shape?regions.offset(shape,-dx,-dy):null;
    if(e.setRegion)e.setRegion(shape?regions.rectangles(shape):null);
    else if(e.node?.style){const path=shape?regions.rectangles(shape).map(([l,t,right,b])=>`M${l} ${t}H${right}V${b}H${l}Z`).join(' '):null;e.node.style.clipPath=path===null?'':path?`path('${path}')`:'inset(100%)';}
    else if(!e.allowVirtualRegion)throw new Win32Error('Window shape requires a DOM or explicit region adapter',50);
    const old=s.shapeHandle;if(object)object.windowOwner=Number(id);s.shapeHandle=Number(r)||0;e.gdiWindowShape=shape;e.gdiClientShape=clientShape;
    if(old&&old!==Number(r)&&h.has(old,'region'))h.close(old,'region');if(redraw)change(id,null,true,true);return 1;
  });
  add('GetWindowRgn',2,(id,r)=>{const e=win(id),dest=region(r);if(!e.gdiWindowShape)return 0;dest.shape=e.gdiWindowShape;return dest.shape.type;});
  add('GetWindowRgnBox',2,(id,p)=>{const shape=win(id).gdiWindowShape;writeRect(p,shape?.bounds||[0,0,0,0]);return shape?.type||0;});
  const getDC=w.resolve('user32','GetDC').fn,release=w.resolve('user32','ReleaseDC').fn;
  add('BeginPaint',2,(id,p)=>{
    const e=win(id),s=state(e),v=m.view(p,64);if(s.active)throw new Win32Error('BeginPaint already active for this window');
    const handle=getDC(id),d=dc(handle),snapshot=s.update,erase=s.erase;
    s.active={handle,region:snapshot};s.update=empty();s.erase=false;s.internal=false;
    try{d.paintClip=snapshot;d.paintOwner=Number(id);const erased=erase&&eraseBackground(e,handle);m.bytes(p,64).fill(0);v.setUint32(0,handle,true);v.setInt32(4,erase&&!erased?1:0,true);writeRect(p+8,snapshot.bounds);}
    catch(error){s.update=regions.combine(s.update,snapshot,2);s.erase=s.erase||erase;s.active=null;release(id,handle);throw error;}
    return handle;
  });
  add('EndPaint',2,(id,p)=>{const e=win(id),s=state(e),handle=m.readU32(p);m.view(p,64);if(!s.active||handle!==s.active.handle)throw new Win32Error('PAINTSTRUCT does not match the active paint');release(id,handle);s.active=null;if(s.update.count||s.internal)request(id);return 1;});
  add('ReleaseDC',2,(id,handle)=>{if(dc(handle).paintOwner)throw new Win32Error('Use EndPaint for a paint DC');return release(id,handle);},{replace:true});
  add('UpdateWindow',1,id=>notify(id));
  add('RedrawWindow',4,async(id,p,r,flags)=>{
    flags=unsigned(flags);
    if(flags&~4095||(flags&1)&&(flags&8)||(flags&64)&&(flags&128))throw new Win32Error('Invalid redraw flags');
    const e=win(id),shape=r?region(r).shape:p?regions.rectangle(...rect(p)):full(e),targets=[[Number(id),shape]],visited=new Set([Number(id)]);
    // All affected geometry is validated before any pending region is changed.
    for(let i=0;i<targets.length;i++){
      const [parent,parentShape]=targets[i],pe=win(parent);
      if(flags&64||(!(flags&128)&&((Number(typeof pe.style==='function'?pe.style():pe.style||0)&0x2000000)!==0)))continue;
      for(const [child,item]of h.entries)if(item.type==='window'&&Number(typeof item.value.parent==='function'?item.value.parent():item.value.parent)===parent&&!visited.has(child)){
        visited.add(child);const origin=pe.clientOrigin?.()||[0,0],co=item.value.clientOrigin?.()||[0,0];
        targets.push([child,regions.combine(regions.offset(parentShape,Math.round(origin[0]-co[0]),Math.round(origin[1]-co[1])),full(item.value),1)]);
      }
    }
    const plans=targets.map(([handle,shape])=>{const e=win(handle),s=state(e);if(flags&1024&&flags&1&&!e.requestNonClientPaint&&!e.message)throw new Win32Error('Nonclient repaint requires an adapter',50);return {handle,e,s,next:flags&9?regions.combine(s.update,regions.combine(shape,full(e),1),flags&1?2:4):s.update};});
    for(const {handle,e,s,next}of plans){s.update=next;if(flags&1&&flags&4)s.erase=true;if(flags&8&&!next.count)s.erase=false;if(flags&2)s.internal=true;if(flags&16)s.internal=false;if(flags&32)s.erase=false;if(flags&1024&&flags&1)s.nonclient=true;if(flags&2048&&flags&8)s.nonclient=false;}
    for(const {handle,s}of plans){if(flags&256)await notify(handle);else if(flags&512)await notify(handle,false,true);if(s.update.count||s.internal||s.nonclient)request(handle);}
    return 1;
  });
  add('GetDCEx',3,(id,r,flags)=>{flags=unsigned(flags);if(flags&~(2|64|128)||flags&64&&flags&128)throw new Win32Error('Unsupported DCX flags',50);const e=win(id),shape=flags&192?region(r).shape:null,clip=flags&64?regions.combine(full(e),shape,4):shape,handle=getDC(id);if(clip)dc(handle).clip=clip;if(r&&flags&192)h.close(r,'region');return handle;});
  for(const wide of [false,true]){
    const name='SendMessage'+(wide?'W':'A'),old=w.resolve('user32',name);add(name,4,(id,msg,wp,lp)=>Number(msg)===15?notify(id,true):old.fn(id,msg,wp,lp),{replace:true});
  }
  w.releaseWindowGDI=id=>{const e=win(id),s=e.gdiPaint;if(tasks.has(id)){clearTimeout(tasks.get(id));tasks.delete(id);}if(s?.shapeHandle&&h.has(s.shapeHandle,'region'))h.close(s.shapeHandle,'region');e.gdiPaint=null;e.gdiWindowShape=e.gdiClientShape=null;if(e.node?.style)e.node.style.clipPath='';};
  w.disposeWindowGDI=()=>{for(const id of [...tasks.keys()]){clearTimeout(tasks.get(id));tasks.delete(id);}for(const [id,e]of h.entries)if(e.type==='window')w.releaseWindowGDI(id);};
}
