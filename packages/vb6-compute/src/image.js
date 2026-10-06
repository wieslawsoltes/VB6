import {ComputeError,integer} from './protocol.js';
/** Immutable, decoded RGBA8 image. File decoding remains an explicit host task. */
export class ComputeImage {
  #pixels;
  constructor(width,height,pixels,{premultiplied=false}={}) {
    this.width=integer(width,'image width',1,8192);this.height=integer(height,'image height',1,8192);
    if(width*height>16777216)throw new ComputeError('Image exceeds the 64 MiB pixel limit','GPU_LIMIT');
    if(!(pixels instanceof Uint8Array)&&!(pixels instanceof Uint8ClampedArray))throw new ComputeError('Image pixels must be RGBA8 bytes','GPU_IMAGE');
    if(pixels.length!==width*height*4)throw new ComputeError('RGBA byte count does not match image dimensions','GPU_IMAGE');
    if(typeof premultiplied!=='boolean')throw new ComputeError('premultiplied must be Boolean','GPU_IMAGE');
    this.premultiplied=premultiplied;this.#pixels=new Uint8Array(pixels);
    if(premultiplied)for(let i=0;i<pixels.length;i+=4)if(pixels[i]>pixels[i+3]||pixels[i+1]>pixels[i+3]||pixels[i+2]>pixels[i+3])throw new ComputeError('Premultiplied RGB exceeds alpha','GPU_IMAGE');
    Object.freeze(this);
  }
  copyPixels(){return this.#pixels.slice();}
}
