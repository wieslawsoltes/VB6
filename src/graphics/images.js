import {GRAPHICS_LIMITS,dimensions} from './contract.js';
import {canvas2D} from './raster.js';
/** A retained image owns its pixels, not the caller's mutable canvas. Snapshot
 * before committing a command, and reject tainted or unreasonably large images. */
export function snapshotImage(document,source){
  const width=source?.naturalWidth??source?.videoWidth??source?.width,height=source?.naturalHeight??source?.videoHeight??source?.height;
  dimensions(width,height,GRAPHICS_LIMITS.imagePixels);
  const {canvas,context}=canvas2D(document,width,height);
  if(source.data!==undefined){
    if(!ArrayBuffer.isView(source.data)||source.data.BYTES_PER_ELEMENT!==1||source.data.length!==width*height*4)throw new TypeError('Image pixels must be RGBA bytes');
    const image=context.createImageData(width,height);image.data.set(source.data);context.putImageData(image,0,0);
  }else{context.drawImage(source,0,0);context.getImageData(0,0,1,1);}
  return canvas;
}
/** Loading is cancellable without rejected promises or dangling handlers. Each
 * request has its own identity, including repeated A/B/A source changes. */
export function loadImage(document,source){
  if(typeof source!=='string'||!source||source.length>16*1024*1024)throw new TypeError('Invalid graphics image source');
  const image=new document.defaultView.Image();let settle,finished=false;
  const finish=result=>{if(finished)return;finished=true;image.onload=image.onerror=null;settle(result);};
  const promise=new Promise(resolve=>{settle=resolve;});
  image.onload=()=>{try{finish({canvas:snapshotImage(document,image)});}catch(error){finish({error:error.message||String(error)});}};
  image.onerror=()=>finish({error:'Image decoding failed'});
  if(!/^(?:data:|blob:)/i.test(source))image.crossOrigin='anonymous';
  image.src=source;
  return {promise,cancel(){finish({cancelled:true});image.removeAttribute?.('src');}};
}
