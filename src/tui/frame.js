import {CellGlyphAtlas,EGA} from './cells.js';

/** Sparse, four-strip character frame. Unlike a full transparent canvas this
 * allocates O(perimeter) pixels, and the trailing corners sit at the actual
 * bounds instead of disappearing inside a clipped partial row/column. */
export class FrameCellRenderer {
  constructor(element,{cellWidth=8,cellHeight=16,atlas=null,palette=EGA,maxPixels=4194304}={}){
    if(!element?.ownerDocument||![cellWidth,cellHeight].every(n=>Number.isFinite(n)&&n>=1)||cellWidth>64||cellHeight>128)throw new RangeError('Invalid frame metrics');
    if(!Number.isSafeInteger(maxPixels)||maxPixels<128||maxPixels>16777216)throw new RangeError('Invalid frame pixel budget');
    if(!Array.isArray(palette)||palette.length!==16||palette.some(color=>typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)))throw new TypeError('Palette must contain 16 RGB colors');
    this.canvas=element;this.cellWidth=cellWidth;this.cellHeight=cellHeight;this.palette=Object.freeze([...palette]);
    this.atlas=atlas||new CellGlyphAtlas(element.ownerDocument);this.ownsAtlas=!atlas;this.maxPixels=maxPixels;
    this.strips=Array.from({length:4},()=>{
      const canvas=element.ownerDocument.createElement('canvas');canvas.setAttribute('aria-hidden','true');
      canvas.style.cssText='position:absolute;pointer-events:none;image-rendering:pixelated;';element.append(canvas);return canvas;
    });
    this.extent=null;this.key='';this.disposed=false;
  }
  setExtent(width,height){if(![width,height].every(n=>Number.isFinite(n)&&n>0))throw new RangeError('Invalid frame extent');this.extent={width,height};}
  dimensions(buffer,dpr=1){
    if(!buffer||![buffer.columns,buffer.rows].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=2048))throw new RangeError('Invalid frame grid');
    dpr=Number.isFinite(dpr)?Math.min(4,Math.max(1,dpr)):1;
    const width=Math.max(1,Math.round((this.extent?.width||buffer.columns*this.cellWidth)*dpr));
    const height=Math.max(1,Math.round((this.extent?.height||buffer.rows*this.cellHeight)*dpr));
    const cw=Math.min(width,Math.max(1,Math.round(this.cellWidth*dpr))),ch=Math.min(height,Math.max(1,Math.round(this.cellHeight*dpr)));
    const pixels=2*width*ch+2*(height>2*ch?cw*(height-2*ch):1);
    if(pixels>this.maxPixels)throw new RangeError('Frame exceeds pixel budget');
    return {width,height,cw,ch,pixels,dpr};
  }
  render(buffer,dpr=1){
    if(this.disposed)throw new Error('Frame renderer is disposed');
    const size=this.dimensions(buffer,dpr),{width:w,height:h,cw,ch}=size;
    const color=buffer.colors[0],double=buffer.glyphs[0]==='╔'.codePointAt(0),key=[w,h,cw,ch,color,double].join(':');
    if(key===this.key){buffer.takeDamage();return;}
    // A failure can also damage the formerly valid frame: invalidate its key
    // before starting, then commit the new key only after all strips succeed.
    this.key='';
    const chars=double?['╔','╗','╚','╝','═','║']:['┌','┐','└','┘','─','│'];
    const rects=[[0,0,w,ch],[0,Math.max(0,h-ch),w,ch],[0,ch,cw,Math.max(0,h-2*ch)],[Math.max(0,w-cw),ch,cw,Math.max(0,h-2*ch)]];
    const glyph=(code,width=cw,height=ch)=>this.atlas.glyph(code.codePointAt(0),color,width,height,this.palette,false);
    this.strips.forEach((canvas,index)=>{
      const [left,top,width,height]=rects[index];canvas.width=height>0?Math.max(1,width):1;canvas.height=Math.max(1,height);
      canvas.style.left=left/size.dpr+'px';canvas.style.top=top/size.dpr+'px';
      canvas.style.width=width/size.dpr+'px';canvas.style.height=height/size.dpr+'px';canvas.hidden=!width||!height;
      const g=canvas.getContext('2d');if(!g)throw new Error('Frame Canvas2D context unavailable');g.imageSmoothingEnabled=false;
      if(index<2){
        g.save();
        try {
          g.beginPath();g.rect(cw,0,Math.max(0,width-2*cw),height);g.clip();
          for(let x=cw;x<width-cw;x+=cw)g.drawImage(glyph(chars[4]),x,0);
        } finally {g.restore();}
        g.drawImage(glyph(chars[index===0?0:2]),0,0);
        if(width>cw)g.drawImage(glyph(chars[index===0?1:3]),width-cw,0);
      }else for(let y=0;y<height;y+=ch)g.drawImage(glyph(chars[5]),0,y);
    });
    this.key=key;buffer.takeDamage();
  }
  dispose(){if(this.disposed)return;this.disposed=true;for(const canvas of this.strips){canvas.width=canvas.height=1;canvas.remove();}this.strips=[];if(this.ownsAtlas)this.atlas.clear();}
}
