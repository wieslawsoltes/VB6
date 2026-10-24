import {paintTuiGlyph} from './raster.js';
// Finite aggregate device-pixel budget, including overlapping modal/editor layers.
export const TUI_SURFACE_PIXEL_BUDGET=16777216;
/** Character-cell presentation primitives. No dependency on the DOM or VB6. */
export const EGA = Object.freeze(['#000000','#0000aa','#00aa00','#00aaaa','#aa0000','#aa00aa','#aa5500','#aaaaaa','#555555','#5555ff','#55ff55','#55ffff','#ff5555','#ff55ff','#ffff55','#ffffff']);
export const TUI_PROFILES = Object.freeze({
  turbo: Object.freeze({name:'Borland / Turbo Vision',foreground:0,background:7,desktop:1,accent:14,selection:3,border:15,button:2}),
  commander: Object.freeze({name:'Norton-style Commander',foreground:14,background:1,desktop:1,accent:15,selection:3,border:11,button:3}),
  win31: Object.freeze({name:'Windows 3.1-inspired TUI',foreground:0,background:7,desktop:3,accent:15,selection:1,border:0,button:7}),
  monochrome: Object.freeze({name:'Monochrome',foreground:7,background:0,desktop:0,accent:15,selection:7,border:7,button:0})
});
export const DOS_SETTINGS_KEY = 'vb6-studio-web.dos-workspace.v1';
export function normalizeDOSSettings(value = {}) {
  return {mode:value?.mode === 'dos' ? 'dos' : 'classic',profile:Object.hasOwn(TUI_PROFILES,value?.profile) ? value.profile : 'turbo',cellWidth:[8,9,10,12].includes(value?.cellWidth) ? value.cellWidth : 8,cellHeight:[14,16,18,20,24].includes(value?.cellHeight) ? value.cellHeight : 16,
    ...(['authored','readable'].includes(value?.formLayout)?{formLayout:value.formLayout}:{}),
    ...(['project','cells'].includes(value?.designerGrid)?{designerGrid:value.designerGrid}:{}),
    ...(['blocks','braille','native'].includes(value?.graphics)?{graphics:value.graphics}:{}),
    ...(['cells','native'].includes(value?.editing)?{editing:value.editing}:{})};
}
export function loadDOSSettings(storage) {
  try {const text=storage?.getItem(DOS_SETTINGS_KEY);return normalizeDOSSettings(text && text.length<4096 ? JSON.parse(text) : {});} catch {return normalizeDOSSettings();}
}
const integer = (n, name) => {if (!Number.isSafeInteger(n)) throw new TypeError(`${name} must be an integer`);return n;};
const paletteIndex = n => {if(!Number.isInteger(n)||n<0||n>15)throw new RangeError('EGA color must be in [0, 15]');return n;};
export function cellRect(rect, width=8, height=16) {
  if(![rect.x,rect.y,rect.width,rect.height,width,height].every(Number.isFinite)||width<=0||height<=0||rect.width<0||rect.height<0)throw new RangeError('Invalid cell geometry');
  const x=Math.floor(rect.x/width),y=Math.floor(rect.y/height);
  return {x,y,width:Math.ceil((rect.x+rect.width)/width)-x,height:Math.ceil((rect.y+rect.height)/height)-y};
}
export function mnemonic(text) {
  const chars=[],hotkeys=[];text=String(text??'');
  for(let i=0;i<text.length;) {const c=String.fromCodePoint(text.codePointAt(i));i+=c.length;if(c==='&'&&i<text.length){const next=String.fromCodePoint(text.codePointAt(i));i+=next.length;if(next!=='&')hotkeys.push(chars.length);chars.push(next);}else chars.push(c);}
  return {text:chars.join(''),hotkeys};
}
/** Bounded dense buffers; damage is tracked as one span per row. */
export class CellBuffer {
  constructor(columns,rows,{foreground=7,background=0}={}) {
    integer(columns,'columns');integer(rows,'rows');
    if(columns<1||rows<1||columns>2048||rows>2048||columns*rows>1048576)throw new RangeError('Cell buffer exceeds its budget');
    this.columns=columns;this.rows=rows;this.foreground=paletteIndex(foreground);this.background=paletteIndex(background);
    this.styles=new Uint8Array(columns*rows);
    this.glyphs=new Uint32Array(columns*rows).fill(32);this.colors=new Uint8Array(columns*rows).fill(foreground|(background<<4));
    this.damageLeft=new Int32Array(rows).fill(0);this.damageRight=new Int32Array(rows).fill(columns);
    this.clips=[{x:0,y:0,width:columns,height:rows}];
  }
  pushClip(x,y,width,height) {
    [x,y,width,height].forEach(n=>integer(n,'clip'));if(width<0||height<0)throw new RangeError('Negative clip');
    const p=this.clips.at(-1),left=Math.max(x,p.x),top=Math.max(y,p.y);
    this.clips.push({x:left,y:top,width:Math.max(0,Math.min(x+width,p.x+p.width)-left),height:Math.max(0,Math.min(y+height,p.y+p.height)-top)});return this;
  }
  popClip() {if(this.clips.length===1)throw new Error('Cannot remove the root clip');this.clips.pop();return this;}
  put(x,y,glyph,foreground=this.foreground,background=this.background,style=0) {
    integer(x,'x');integer(y,'y');if(!Number.isInteger(style)||style<0||style>15)throw new RangeError('Invalid cell style');const c=this.clips.at(-1);
    if(x<c.x||y<c.y||x>=c.x+c.width||y>=c.y+c.height)return this;
    let code=typeof glyph==='number'?glyph:String(glyph??' ').codePointAt(0)??32;
    if(!Number.isInteger(code)||code<32||code>0x10ffff||(code>=0xd800&&code<=0xdfff)||(code>=127&&code<160))code=32;
    const color=paletteIndex(foreground)|(paletteIndex(background)<<4),i=y*this.columns+x;
    if(this.glyphs[i]!==code||this.colors[i]!==color||this.styles[i]!==style){this.glyphs[i]=code;this.colors[i]=color;this.styles[i]=style;this.damageLeft[y]=Math.min(this.damageLeft[y],x);this.damageRight[y]=Math.max(this.damageRight[y],x+1);}return this;
  }
  fill(x,y,width,height,glyph=' ',foreground=this.foreground,background=this.background) {
    [x,y,width,height].forEach(n=>integer(n,'fill'));if(width<0||height<0)throw new RangeError('Negative fill');
    const c=this.clips.at(-1),right=Math.min(x+width,c.x+c.width),bottom=Math.min(y+height,c.y+c.height);
    for(let row=Math.max(y,c.y);row<bottom;row++)for(let col=Math.max(x,c.x);col<right;col++)this.put(col,row,glyph,foreground,background);return this;
  }
  text(x,y,text,{foreground=this.foreground,background=this.background,width=this.columns-x,hotkey=foreground,mnemonics=false,style=0}={}) {
    integer(width,'text width');if(width<=0)return this;
    const value=mnemonics?mnemonic(text):{text:String(text??''),hotkeys:[]},keys=new Set(value.hotkeys);let col=0,index=0;
    for(const ch of value.text){if(ch==='\n'||ch==='\r'||col>=width)break;this.put(x+col++,y,ch,keys.has(index++)?hotkey:foreground,background,style);}return this;
  }
  frame(x,y,width,height,{double=false,foreground=this.foreground,background=this.background,title=''}={}) {
    if(width<1||height<1)return this;
    const [tl,tr,bl,br,h,v]=double?['╔','╗','╚','╝','═','║']:['┌','┐','└','┘','─','│'];
    this.fill(x,y,width,1,h,foreground,background);if(height>1)this.fill(x,y+height-1,width,1,h,foreground,background);
    this.fill(x,y,1,height,v,foreground,background);if(width>1)this.fill(x+width-1,y,1,height,v,foreground,background);
    this.put(x,y,tl,foreground,background);if(width>1)this.put(x+width-1,y,tr,foreground,background);
    if(height>1){this.put(x,y+height-1,bl,foreground,background);if(width>1)this.put(x+width-1,y+height-1,br,foreground,background);}
    if(title&&width>4)this.text(x+2,y,title,{width:width-4,foreground,background,mnemonics:true});return this;
  }
  blit(source,dx,dy) {
    integer(dx,'dx');integer(dy,'dy');const glyphs=source===this?source.glyphs.slice():source.glyphs,colors=source===this?source.colors.slice():source.colors,styles=source===this?source.styles.slice():source.styles;
    for(let y=0;y<source.rows;y++)for(let x=0;x<source.columns;x++){const i=y*source.columns+x;this.put(x+dx,y+dy,glyphs[i],colors[i]&15,colors[i]>>4,styles?.[i]||0);}return this;
  }
  takeDamage() {const result=[];for(let y=0;y<this.rows;y++){if(this.damageRight[y]>this.damageLeft[y])result.push({y,x:this.damageLeft[y],width:this.damageRight[y]-this.damageLeft[y]});this.damageLeft[y]=this.columns;this.damageRight[y]=0;}return result;}
  invalidate() {this.damageLeft.fill(0);this.damageRight.fill(this.columns);}
  toText() {const lines=[];for(let y=0;y<this.rows;y++){let line='';for(let x=0;x<this.columns;x++)line+=String.fromCodePoint(this.glyphs[y*this.columns+x]);lines.push(line);}return lines.join('\n');}
  snapshot() {return {columns:this.columns,rows:this.rows,glyphs:Array.from(this.glyphs),colors:Array.from(this.colors),...(this.styles.some(Boolean)?{styles:Array.from(this.styles)}:{})};}
}
/** Shared, bounded LRU glyph tiles for one presentation root. Device dimensions
 * and actual palette values are part of the key, so fractional-DPR tiles and
 * concurrent palettes cannot collide. Eviction releases the backing canvas. */
export class CellGlyphAtlas {
  constructor(document,{maxGlyphs=2048,maxPixels=1048576}={}) {
    if(!Number.isSafeInteger(maxGlyphs)||maxGlyphs<1||maxGlyphs>4096||!Number.isSafeInteger(maxPixels)||maxPixels<128||maxPixels>16777216)throw new RangeError('Invalid glyph atlas budget');
    this.document=document;this.maxGlyphs=maxGlyphs;this.maxPixels=maxPixels;this.pixels=0;this.cache=new Map();
    this.metrics={hits:0,misses:0,evictions:0};
  }
  glyph(code,color,width,height,palette,opaque=true,style=0) {
    // Public atlas calls must satisfy the same bounds as renderer-owned tiles.
    // Validate before cache mutation, eviction, DOM allocation or canvas resize.
    if(!Number.isInteger(code)||code<32||code>0x10ffff||code>=127&&code<160||code>=0xd800&&code<=0xdfff)throw new RangeError('Invalid display scalar');
    if(!Number.isInteger(color)||color<0||color>255||!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||width>256||height>512)throw new RangeError('Invalid glyph geometry or attribute');
    if(!Array.isArray(palette)||palette.length!==16)throw new TypeError('Invalid glyph palette');
    if(!Number.isInteger(style)||style<0||style>15)throw new RangeError('Invalid glyph style');
    const key=`${style}:${opaque?1:0}:${width}:${height}:${code}:${palette[color&15]}:${palette[color>>4]}`;
    let entry=this.cache.get(key);
    if(entry){this.metrics.hits++;this.cache.delete(key);this.cache.set(key,entry);return entry.canvas;}
    if(![palette[color&15],palette[color>>4]].every(value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)))throw new TypeError('Invalid glyph RGB color');
    const pixels=width*height;
    if(pixels>this.maxPixels)throw new RangeError('Glyph exceeds atlas pixel budget');
    while(this.cache.size>=this.maxGlyphs||this.pixels+pixels>this.maxPixels)this.evict();
    const canvas=this.document.createElement('canvas');canvas.width=width;canvas.height=height;
    const g=canvas.getContext('2d');if(!g)throw new Error('Canvas2D glyph context unavailable');
    if(opaque){g.fillStyle=palette[color>>4];g.fillRect(0,0,width,height);}g.fillStyle=palette[color&15];
    if(!paintTuiGlyph(g,code,width,height,style)&&code!==32){
      g.font=`${style&1?'bold ':''}${style&2?'italic ':''}${Math.round(height*.88)}px monospace`;g.textBaseline='middle';g.textAlign='center';
      g.fillText(String.fromCodePoint(code),width/2,height/2,width);
    }
    if(style&4)g.fillRect(0,Math.max(0,height-2),width,1);if(style&8)g.fillRect(0,Math.floor(height*.5),width,1);
    this.metrics.misses++;this.cache.set(key,{canvas,pixels});this.pixels+=pixels;return canvas;
  }
  evict() {
    const key=this.cache.keys().next().value,entry=this.cache.get(key);if(!entry)return;
    this.cache.delete(key);this.pixels-=entry.pixels;entry.canvas.width=entry.canvas.height=1;this.metrics.evictions++;
  }
  clear(){for(const entry of this.cache.values())entry.canvas.width=entry.canvas.height=1;this.cache.clear();this.pixels=0;}
}

/** Device-scaled cells. Fractional scale is applied to every cell EDGE rather
 * than rounding a cell once and accumulating a whole-screen positioning drift. */
export class CanvasCellRenderer {
  constructor(canvas,{cellWidth=8,cellHeight=16,palette=EGA,maxGlyphs=2048,maxPixels=4194304,atlas=null,opaque=true}={}) {
    if(!Number.isFinite(cellWidth)||!Number.isFinite(cellHeight)||cellWidth<1||cellHeight<1||cellWidth>64||cellHeight>128)throw new RangeError('Invalid cell metrics');
    if(!Array.isArray(palette)||palette.length!==16||palette.some(color=>typeof color!=='string'||!/^#[0-9a-f]{6}$/i.test(color)))throw new TypeError('Palette must contain 16 RGB colors');
    if(!Number.isSafeInteger(maxPixels)||maxPixels<128||maxPixels>16777216)throw new RangeError('Invalid cell surface budget');
    this.canvas=canvas;this.context=canvas.getContext('2d',{alpha:true});if(!this.context)throw new Error('Canvas2D unavailable');
    this.opaque=opaque!==false;this.cellWidth=cellWidth;this.cellHeight=cellHeight;this.palette=Object.freeze([...palette]);this.maxPixels=maxPixels;
    this.atlas=atlas||new CellGlyphAtlas(canvas.ownerDocument,{maxGlyphs});this.ownsAtlas=!atlas;
    this.cache=this.atlas.cache;this.key='';this.extent=null;this.disposed=false;
  }
  /** Clip the backing bitmap to a display viewport without stretching the last
   * cell. A CSS clip-path alone still lets the oversized canvas create scroll
   * overflow, changing the native scrollport underneath a read-only painter. */
  setExtent(width,height) {
    if(![width,height].every(n=>Number.isFinite(n)&&n>0))throw new RangeError('Invalid cell surface extent');
    this.extent={width,height};
  }
  dimensions(buffer,dpr=1) {
    if(!Number.isSafeInteger(buffer?.columns)||!Number.isSafeInteger(buffer?.rows)||buffer.columns<1||buffer.rows<1||buffer.columns>2048||buffer.rows>2048||buffer.columns*buffer.rows>1048576)throw new RangeError('Invalid cell surface dimensions');
    dpr=Number.isFinite(dpr)?Math.min(4,Math.max(1,dpr)):1;
    const logicalWidth=Math.min(this.cellWidth*buffer.columns,this.extent?.width??Infinity);
    const logicalHeight=Math.min(this.cellHeight*buffer.rows,this.extent?.height??Infinity);
    const width=Math.max(1,Math.round(logicalWidth*dpr)),height=Math.max(1,Math.round(logicalHeight*dpr));
    if(width*height>this.maxPixels)throw new RangeError('Cell surface exceeds its pixel budget');
    return {width,height,dpr};
  }
  render(buffer,dpr=1) {
    if(this.disposed)throw new Error('Cell renderer is disposed');
    const size=this.dimensions(buffer,dpr);dpr=size.dpr;
    const key=[size.width,size.height,buffer.columns,buffer.rows,dpr].join(':');
    try {
      // Changing either bitmap dimension resets the context and pixels. Do not
      // publish the retained key until every damaged cell has been submitted.
      if(key!==this.key){this.canvas.width=size.width;this.canvas.height=size.height;buffer.invalidate();}
      const ctx=this.context;ctx.imageSmoothingEnabled=false;
      for(const span of buffer.takeDamage())for(let x=span.x;x<span.x+span.width;x++){
        const i=span.y*buffer.columns+x,left=Math.round(x*this.cellWidth*dpr),top=Math.round(span.y*this.cellHeight*dpr);
        const width=Math.round((x+1)*this.cellWidth*dpr)-left,height=Math.round((span.y+1)*this.cellHeight*dpr)-top;
        const glyph=this.atlas.glyph(buffer.glyphs[i],buffer.colors[i],width,height,this.palette,this.opaque,buffer.styles?.[i]||0);
        if(!this.opaque)ctx.clearRect(left,top,width,height);
        ctx.drawImage(glyph,left,top);
      }
      this.key=key;
    } catch(error) {
      // Some cells may have reached the bitmap. Repaint from canonical buffer
      // contents on retry; never regard partially submitted damage as clean.
      this.key='';buffer.invalidate();throw error;
    }
  }
  dispose(){if(this.disposed)return;this.disposed=true;if(this.ownsAtlas)this.atlas.clear();this.canvas.width=this.canvas.height=1;}
}
