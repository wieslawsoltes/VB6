/** Canvas host for trusted portable windowless controls, not a native OCX DLL loader. */
import {ocxTransformCoords} from './ocx-ambient.js';
const rect=value=>{if(!value||!['left','top','width','height'].every(k=>Number.isFinite(value[k]))||value.width<0||value.height<0)throw new RangeError('Invalid windowless rectangle');return {...value};};
const overlaps=(a,b)=>a.left<b.left+b.width&&a.top<b.top+b.height&&a.left+a.width>b.left&&a.top+a.height>b.top;
function union(a,b){if(!a)return {...b};const left=Math.min(a.left,b.left),top=Math.min(a.top,b.top);return {left,top,width:Math.max(a.left+a.width,b.left+b.width)-left,height:Math.max(a.top+a.height,b.top+b.height)-top};}
export class OcxWindowlessSurface {
  #container;#canvas;#context;#dirty=null;#frame=null;#capture=null;#closed=false;#unwatch;#handlers=[];#schedule;#cancel;#scale=1;
  constructor(container,canvas,{schedule=callback=>requestAnimationFrame(callback),cancel=handle=>cancelAnimationFrame(handle),onError=error=>console.error(error)}={}){
    if(!container||typeof container.onInvalidate!=='function'||!canvas?.getContext)throw TypeError('A portable container and canvas are required');
    const context=canvas.getContext('2d');if(!context)throw Error('Canvas2D is unavailable');
    this.#container=container;this.#canvas=canvas;this.#context=context;this.#schedule=schedule;this.#cancel=cancel;this.onError=onError;
    this.#unwatch=container.onInvalidate(bounds=>{if(this.#capture&&(this.#capture.site.State==='closed'||!container.Sites.includes(this.#capture.site)))this.releaseCapture();this.invalidate(bounds?this.#pixels(bounds):null);});
    for(const [event,name] of [['pointerdown','MouseDown'],['pointermove','MouseMove'],['pointerup','MouseUp'],['pointercancel',null],['lostpointercapture',null]]){
      const handler=e=>{try{if(!name){if(!this.#capture||e.pointerId===this.#capture.pointerId)this.releaseCapture();return;}this.#pointer(e,name);}catch(error){this.onError(error);}};canvas.addEventListener?.(event,handler);this.#handlers.push([event,handler]);
    }
  }
  #pixels(bounds){const position=ocxTransformCoords({x:bounds.left,y:bounds.top},{from:'twips'}),size=ocxTransformCoords({x:bounds.width,y:bounds.height},{from:'twips'});return {left:position.x,top:position.y,width:size.x,height:size.y};}
  resize(width,height,scale=1){
    if(this.#closed)throw Error('Windowless surface is closed');if(![width,height,scale].every(Number.isFinite)||width<=0||height<=0||scale<=0||scale>8||width*scale>16384||height*scale>16384||width*height*scale*scale>64*1024*1024)throw RangeError('Windowless surface exceeds limits');
    this.width=width;this.height=height;this.#scale=scale;this.#canvas.width=Math.ceil(width*scale);this.#canvas.height=Math.ceil(height*scale);if(this.#canvas.style)Object.assign(this.#canvas.style,{width:width+'px',height:height+'px'});this.invalidate();
  }
  invalidate(value=null){if(this.#closed)return;const r=value?rect(value):{left:0,top:0,width:this.width||0,height:this.height||0};this.#dirty=union(this.#dirty,r);if(this.#frame===null)this.#frame=this.#schedule(()=>{this.#frame=null;try{this.flush();}catch(error){this.onError(error);}});}
  flush(){
    if(this.#closed||!this.#dirty)return;const dirty=this.#dirty;this.#dirty=null;const context=this.#context,errors=[];
    context.save();try{
      context.setTransform(this.#scale,0,0,this.#scale,0,0);context.beginPath();context.rect(dirty.left,dirty.top,dirty.width,dirty.height);context.clip();context.clearRect(dirty.left,dirty.top,dirty.width,dirty.height);
      for(const site of this.#container.Sites){if(site.State==='closed'||!site.Visible)continue;const bounds=this.#pixels(site.Bounds);if(!overlaps(bounds,dirty))continue;
        context.save();try{context.beginPath();context.rect(bounds.left,bounds.top,bounds.width,bounds.height);context.clip();context.translate(bounds.left,bounds.top);site.paint(context,{left:Math.max(0,dirty.left-bounds.left),top:Math.max(0,dirty.top-bounds.top),width:Math.max(0,Math.min(bounds.left+bounds.width,dirty.left+dirty.width)-Math.max(bounds.left,dirty.left)),height:Math.max(0,Math.min(bounds.top+bounds.height,dirty.top+dirty.height)-Math.max(bounds.top,dirty.top))});}catch(error){errors.push(error);}finally{context.restore();}
      }
    }finally{context.restore();}if(errors.length)throw new AggregateError(errors,'Windowless OCX paint failed');
  }
  setCapture(site,pointerId){if(this.#closed||!this.#container.Sites.includes(site)||site.State==='closed'||!Number.isInteger(pointerId))throw TypeError('Invalid windowless capture');this.releaseCapture();this.#canvas.setPointerCapture?.(pointerId);this.#capture={site,pointerId};}
  releaseCapture(){const capture=this.#capture;this.#capture=null;if(capture)try{this.#canvas.releasePointerCapture?.(capture.pointerId);}catch{}}
  #pointer(event,name){
    if(this.#closed||event.isPrimary===false)return;const box=this.#canvas.getBoundingClientRect();if(!box.width||!box.height)return;const x=(event.clientX-box.left)*(this.width||box.width)/box.width,y=(event.clientY-box.top)*(this.height||box.height)/box.height;
    if(this.#capture&&event.pointerId!==this.#capture.pointerId)return;
    const site=this.#capture?.site||this.#container.hitTest(x*15,y*15);if(!site||site.State==='closed'){this.releaseCapture();return;}
    if(name==='MouseDown'){if(!this.#container.activate(site))return;this.setCapture(site,event.pointerId);}
    const bounds=site.Bounds,buttons=name==='MouseMove'?((event.buttons&1)?1:0)|((event.buttons&2)?2:0)|((event.buttons&4)?4:0):event.button===0?1:event.button===2?2:event.button===1?4:0;
    const shift=(event.shiftKey?1:0)|(event.ctrlKey?2:0)|(event.altKey?4:0);
    Promise.resolve(site.RaiseEvent(name,[buttons,shift,x*15-bounds.left,y*15-bounds.top])).catch(this.onError);
    if(name==='MouseUp')this.releaseCapture();event.preventDefault?.();
  }
  close(){if(this.#closed)return;this.#closed=true;this.releaseCapture();if(this.#frame!==null)this.#cancel(this.#frame);this.#frame=null;this.#dirty=null;this.#unwatch();for(const [name,handler]of this.#handlers)this.#canvas.removeEventListener?.(name,handler);this.#handlers=[];}
}
