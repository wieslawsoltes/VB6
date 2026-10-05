import {Win32Error,integer,unsigned} from './core.js';
import {mapping,multiply,mapPoint,mapBounds} from './gdi-transform.js';

export const TEXT_CONSTANTS=Object.freeze({OBJ_FONT:6,FW_NORMAL:400,FW_BOLD:700,ANSI_CHARSET:0,DEFAULT_CHARSET:1,TRANSPARENT:1,OPAQUE:2,TA_NOUPDATECP:0,TA_UPDATECP:1,TA_LEFT:0,TA_RIGHT:2,TA_CENTER:6,TA_TOP:0,TA_BOTTOM:8,TA_BASELINE:24,TA_RTLREADING:256,ETO_OPAQUE:2,ETO_CLIPPED:4,ETO_RTLREADING:128,ETO_PDY:8192,DT_CENTER:1,DT_RIGHT:2,DT_VCENTER:4,DT_BOTTOM:8,DT_WORDBREAK:16,DT_SINGLELINE:32,DT_EXPANDTABS:64,DT_CALCRECT:1024,DT_NOPREFIX:2048});
const fields=['height','width','escapement','orientation','weight'];
const bytes=['italic','underline','strikeOut','charSet','outPrecision','clipPrecision','quality','pitchAndFamily'];
const cssColor=c=>'#'+[c&255,c>>>8&255,c>>>16&255].map(n=>n.toString(16).padStart(2,'0')).join('');
export function installText(w,{dc,bitmaps,regions,add,stock,stocks}){
  const h=w.handles,m=w.memory,limit=integer(w.options.maxTextLength??16384,1,1048576);
  const canvas=(width,height)=>{
    if(width*height>bitmaps.maxPixels)throw new Win32Error('Text raster quota exceeded',8);
    let c;if(w.options.createCanvas)c=w.options.createCanvas(width,height);
    else if(typeof globalThis.OffscreenCanvas==='function')c=new globalThis.OffscreenCanvas(width,height);
    else{const doc=w.options.window?.document||globalThis.document;if(doc){c=doc.createElement('canvas');c.width=width;c.height=height;}}
    if(!c?.getContext)throw new Win32Error('Font rendering requires Canvas2D, OffscreenCanvas, or createCanvas adapter',50);
    c.width=width;c.height=height;return c;
  };
  const font=(faceName='Arial',height=-12,pitchAndFamily=0)=>({height,width:0,escapement:0,orientation:0,weight:400,italic:0,underline:0,strikeOut:0,charSet:1,outPrecision:0,clipPrecision:0,quality:0,pitchAndFamily,faceName});
  const fontStocks=[10,11,12,13,14,16,17],ensure=index=>{if(!stocks.has(index))stock(index,'font',font([10,11,16].includes(index)?'monospace':'Arial',-12,[10,11,16].includes(index)?1:2));return stocks.get(index);};
  const oldStock=w.resolve('gdi32','GetStockObject');add('GetStockObject',1,index=>fontStocks.includes(Number(index))?ensure(Number(index)):oldStock.fn(index),{replace:true});
  const oldCurrent=w.resolve('gdi32','GetCurrentObject');add('GetCurrentObject',2,(id,type)=>Number(type)===6?(dc(id).font||ensure(13)):oldCurrent.fn(id,type),{replace:true});
  const oldSelect=w.resolve('gdi32','SelectObject');add('SelectObject',2,(id,obj)=>{const s=dc(id);if(h.has(obj,'font')&&!s.font)s.font=ensure(13);return oldSelect.fn(id,obj);},{replace:true});
  const get=s=>h.get(s.font||ensure(13),'font');
  const readFont=(p,wide)=>{const v=m.view(p,wide?92:60),f={};fields.forEach((k,i)=>f[k]=v.getInt32(i*4,true));bytes.forEach((k,i)=>f[k]=v.getUint8(20+i));f.faceName=m.decode(m.bytes(p+28,wide?64:32),wide).split('\0')[0];return validate(f);};
  const validate=f=>{fields.forEach(k=>f[k]=integer(f[k],-32767,32767));bytes.forEach(k=>f[k]=integer(f[k],0,255));f.faceName=String(f.faceName||'Arial').slice(0,31);return f;};
  const writeFont=(f,p,n,wide)=>{const size=wide?92:60;if(!p)return size;if(integer(n,0,0x7fffffff)<size)throw new Win32Error('LOGFONT buffer too small');const v=m.view(p,size);m.bytes(p,size).fill(0);fields.forEach((k,i)=>v.setInt32(i*4,f[k],true));bytes.forEach((k,i)=>v.setUint8(20+i,f[k]));m.putString(p+28,f.faceName,32,wide);return size;};
  for(const wide of [false,true]){
    const suffix=wide?'W':'A';
    add('CreateFontIndirect'+suffix,1,p=>h.add('font',readFont(p,wide)));
    add('CreateFont'+suffix,14,(height,width,escapement,orientation,weight,italic,underline,strikeOut,charSet,outPrecision,clipPrecision,quality,pitchAndFamily,p)=>h.add('font',validate({height,width,escapement,orientation,weight,italic,underline,strikeOut,charSet,outPrecision,clipPrecision,quality,pitchAndFamily,faceName:m.string(p,wide)})));
    const old=w.resolve('gdi32','GetObject'+suffix);add('GetObject'+suffix,3,(id,n,p)=>h.has(id,'font')?writeFont(h.get(id,'font'),p,n,wide):old.fn(id,n,p),{replace:true});
  }
  const setup=s=>{
    const f=get(s),c=canvas(1,1),ctx=c.getContext('2d');if(!ctx)throw new Win32Error('Canvas2D text context unavailable',50);
    let size=Math.abs(f.height)||12;const family=f.faceName.replace(/["\\\n\r]/g,'');
    ctx.font=`${f.italic?'italic ':''}${Math.max(1,Math.min(1000,f.weight||400))} ${size}px "${family}", sans-serif`;
    if(['monospace','serif','sans-serif','system-ui','cursive','fantasy'].includes(family.toLowerCase()))ctx.font=ctx.font.replace('\"'+family+'\"',family);
    ctx.textBaseline='alphabetic';ctx.direction=s.textAlign&256?'rtl':'ltr';
    if(f.height>0){const measured=ctx.measureText('Mg'),cell=(measured.fontBoundingBoxAscent??measured.actualBoundingBoxAscent)+(measured.fontBoundingBoxDescent??measured.actualBoundingBoxDescent);if(cell>0){size=size*f.height/cell;ctx.font=ctx.font.replace(/[\d.]+px/,size+'px');}}
    const metric=ctx.measureText('Mg'),ascent=metric.fontBoundingBoxAscent??metric.actualBoundingBoxAscent??size*.8,descent=metric.fontBoundingBoxDescent??metric.actualBoundingBoxDescent??size*.2;
    const average=ctx.measureText('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz').width/52;
    return {ctx,font:f,size,ascent,descent,height:ascent+descent,xscale:f.width&&average?Math.abs(f.width)/average:1};
  };
  const read=(p,n,wide)=>{n=integer(n,0,limit);if(typeof p==='string')return p.slice(0,n);if(!n)return '';return m.decode(m.bytes(p,n*(wide?2:1)),wide);};
  const extent=(s,text,c=null)=>{if(!text.length)return {width:0,height:0,context:c};c=c||setup(s);return {width:c.ctx.measureText(text).width*c.xscale+text.length*(s.charExtra||0),height:c.height,context:c};};
  const draw=(s,x,y,text,flags=0,rectangle=null,advances=null)=>{
    flags=unsigned(flags);if(flags&~(2|4|128|8192))throw new Win32Error('Unsupported ExtTextOut options (glyph-index input requires a font-specific adapter)',50);
    if(flags&6&&!rectangle)throw new Win32Error('ExtTextOut rectangle required');
    const c=setup(s),e=extent(s,text,c),align=s.textAlign||0;
    if(align&1){x=s.x;y=s.y;}x=Number(x);y=Number(y);if(!Number.isFinite(x)||!Number.isFinite(y))throw new Win32Error('Invalid text origin');
    let advanceX=e.width,advanceY=0;
    if(advances){advanceX=advances.reduce((n,p)=>n+p[0],0);advanceY=advances.reduce((n,p)=>n+p[1],0);}
    const offset=(align&6)===6?-advanceX/2:(align&2)?-advanceX:0;
    const baseline=(align&24)===24?0:(align&8)?-c.descent:c.ascent;
    const angle=-c.font.escapement*Math.PI/1800,rotation=[Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),x,y],matrix=multiply(mapping(s),rotation);
    const logical=[offset-2,baseline-c.ascent-2,offset+Math.max(0,advanceX,e.width)+c.size+2,baseline+c.descent+Math.abs(advanceY)+2];
    let bounds=mapBounds(matrix,logical);if(flags&2){const b=mapBounds(mapping(s),rectangle);bounds=[Math.min(bounds[0],b[0]),Math.min(bounds[1],b[1]),Math.max(bounds[2],b[2]),Math.max(bounds[3],b[3])];}
    let clip=bitmaps.effective(s);if(flags&4)clip=regions.combine(clip,regions.transform(regions.rectangle(...rectangle),mapping(s)),1);
    const advance=()=>{if(align&1){s.x=Math.round(x+advanceX*Math.cos(angle)-advanceY*Math.sin(angle));s.y=Math.round(y+advanceX*Math.sin(angle)+advanceY*Math.cos(angle));}};
    const region=regions.combine(regions.rectangle(...bounds),clip,1);if(!region.count){advance();return 1;}
    bounds=region.bounds;const width=bounds[2]-bounds[0],height=bounds[3]-bounds[1],surface=canvas(width,height),ctx=surface.getContext('2d');
    ctx.font=c.ctx.font;ctx.textBaseline='alphabetic';ctx.direction=flags&128||align&256?'rtl':'ltr';ctx.textAlign='left';
    if(flags&2){const a=mapping(s);ctx.setTransform(a[0],a[1],a[2],a[3],a[4]-bounds[0],a[5]-bounds[1]);ctx.fillStyle=cssColor(s.backgroundColor);ctx.fillRect(rectangle[0],rectangle[1],rectangle[2]-rectangle[0],rectangle[3]-rectangle[1]);}
    ctx.setTransform(matrix[0],matrix[1],matrix[2],matrix[3],matrix[4]-bounds[0],matrix[5]-bounds[1]);
    if(s.backgroundMode===2&&text.length){ctx.fillStyle=cssColor(s.backgroundColor);ctx.fillRect(offset,baseline-c.ascent,advanceX,c.height);}
    ctx.fillStyle=cssColor(s.textColor);ctx.save();ctx.scale(c.xscale,1);
    if(!advances&&!s.charExtra)ctx.fillText(text,offset/c.xscale,baseline);
    else{let px=offset,py=baseline,index=0;for(const character of text){ctx.fillText(character,px/c.xscale,py);if(advances){for(let k=0;k<character.length;k++){px+=advances[index+k][0];py+=advances[index+k][1];}}else px+=c.ctx.measureText(character).width*c.xscale+(s.charExtra||0);index+=character.length;}}
    ctx.restore();if(c.font.underline)ctx.fillRect(offset,baseline+1,advanceX,Math.max(1,c.size/16));if(c.font.strikeOut)ctx.fillRect(offset,baseline-c.ascent*.35,advanceX,Math.max(1,c.size/16));
    const pixels=ctx.getImageData(0,0,width,height),target=bitmaps.read(s,bounds);
    for(const band of region.bands)for(let py=band.top;py<band.bottom;py++)for(let j=0;j<band.spans.length;j+=2)for(let px=band.spans[j];px<band.spans[j+1];px++){
      const i=((py-bounds[1])*width+px-bounds[0])*4,a=pixels.data[i+3]/255;if(!a)continue;for(let k=0;k<3;k++)target.data[i+k]=Math.round(pixels.data[i+k]*a+target.data[i+k]*(1-a));target.data[i+3]=0;
    }
    bitmaps.write(s,bounds,target);advance();return 1;
  };
  for(const [name,key]of [['TextAlign','textAlign'],['TextCharacterExtra','charExtra']]){
    add('Get'+name,1,id=>dc(id)[key]||0,{failure:key==='charExtra'?0x80000000:0xffffffff});
    add('Set'+name,2,(id,value)=>{value=integer(value,-0x7fffffff,0x7fffffff);if(key==='textAlign'&&(value&~(1|6|24|256)||![0,2,6].includes(value&6)||![0,8,24].includes(value&24)))throw new Win32Error('Invalid text alignment');const s=dc(id),old=s[key]||0;s[key]=value;return old;},{failure:key==='charExtra'?0x80000000:0xffffffff});
  }
  const rect=p=>{const v=m.view(p,16);return [0,4,8,12].map(o=>v.getInt32(o,true));};
  const pair=(p,x,y)=>{const v=m.view(p,8);v.setInt32(0,Math.round(x),true);v.setInt32(4,Math.round(y),true);};
  for(const wide of [false,true]){
    const suffix=wide?'W':'A';
    add('TextOut'+suffix,5,(id,x,y,p,n)=>draw(dc(id),x,y,read(p,n,wide)),{replace:true,mode:'browser',notes:'Canvas font shaping/rasterization on window and memory DCs, with complex clipping and affine transforms.'});
    add('ExtTextOut'+suffix,8,(id,x,y,flags,r,p,n,dx)=>{const text=read(p,n,wide),advance=[];if(dx){const stride=flags&8192?8:4,v=m.view(dx,text.length*stride);for(let i=0;i<text.length;i++)advance.push([v.getInt32(i*stride,true),stride===8?v.getInt32(i*stride+4,true):0]);}return draw(dc(id),x,y,text,flags,r?rect(r):null,dx?advance:null);},{mode:'browser'});
    for(const name of ['GetTextExtentPoint32','GetTextExtentPoint'])add(name+suffix,4,(id,p,n,out)=>{const e=extent(dc(id),read(p,n,wide));pair(out,e.width,e.height);return 1;},{mode:'browser'});
    add('GetTextFace'+suffix,3,(id,n,out)=>{const f=get(dc(id));if(!out)return f.faceName.length+1;n=integer(n,0,Math.floor(m.maxBytes/(wide?2:1)));return n?m.putString(out,f.faceName,n,wide)+1:0;});
    add('GetTextMetrics'+suffix,2,(id,out)=>{const c=setup(dc(id)),size=wide?60:56,v=m.view(out,size),values=[c.height,c.ascent,c.descent,Math.max(0,c.height-c.size),0,c.ctx.measureText('x').width*c.xscale,c.ctx.measureText('W').width*c.xscale,c.font.weight,0,96,96];m.bytes(out,size).fill(0);values.forEach((n,i)=>v.setInt32(i*4,Math.round(n),true));let o=44;for(const ch of [32,wide?65535:255,63,32]){if(wide){v.setUint16(o,ch,true);o+=2;}else v.setUint8(o++,ch);}for(const value of [c.font.italic,c.font.underline,c.font.strikeOut,6,c.font.charSet])v.setUint8(o++,value);return 1;},{mode:'browser',notes:'Metrics come from the selected Canvas font; native GDI hinting/font mapper values are not guaranteed identical.'});
    add('GetTextExtentExPoint'+suffix,7,(id,p,n,maxExtent,fit,dx,out)=>{const s=dc(id),text=read(p,n,wide);if(text.length>4096)throw new Win32Error('Cumulative text extent work quota exceeded',8);const c=setup(s),widths=Array.from({length:text.length},(_,i)=>Math.round(extent(s,text.slice(0,i+1),c).width)),fv=fit?m.view(fit,4):null,dv=dx?m.view(dx,widths.length*4):null,ov=m.view(out,8);let count=0;for(const value of widths){if(value<=Number(maxExtent))count++;else break;}if(fv)fv.setInt32(0,count,true);widths.forEach((n,i)=>dv?.setInt32(i*4,n,true));ov.setInt32(0,widths.at(-1)||0,true);ov.setInt32(4,text.length?Math.round(c.height):0,true);return 1;},{mode:'browser'});
    w.register('user32','DrawText'+suffix,(id,p,n,r,flags)=>{
      const s=dc(id),rectangle=rect(r),c=setup(s);flags=unsigned(flags);if(flags&~(1|2|4|8|16|32|64|1024|2048))throw new Win32Error('DrawText option is not supported',50);
      let text=Number(n)===-1?m.string(p,wide):read(p,n,wide);if(text.length>limit)throw new Win32Error('Text length quota exceeded',8);
      if(!(flags&2048))text=text.replace(/&&/g,'\u0001').replace(/&/g,'').replace(/\u0001/g,'&');if(flags&64)text=text.replace(/\t/g,'        ');if(flags&32)text=text.replace(/[\r\n]+/g,' ');
      const lines=[];for(const paragraph of text.split(/\r?\n/)){if(!(flags&16)||flags&32){lines.push(paragraph);continue;}let line='';for(const word of paragraph.split(/(\s+)/)){const next=line+word;if(line&&extent(s,next,c).width>rectangle[2]-rectangle[0]){lines.push(line.trimEnd());line=word.trimStart();}else line=next;}lines.push(line);}
      const lineHeight=Math.round(c.height),height=lines.length*lineHeight,width=Math.ceil(Math.max(0,...lines.map(t=>extent(s,t,c).width)));
      if(!text.length&&(flags&1024)&&!(flags&32)){const v=m.view(r,16);v.setInt32(8,rectangle[0],true);v.setInt32(12,rectangle[1],true);return 1;}
      if(flags&1024){const v=m.view(r,16);v.setInt32(8,rectangle[0]+width,true);v.setInt32(12,rectangle[1]+height,true);return height;}
      let y=rectangle[1];if(flags&32&&flags&4)y+=Math.floor((rectangle[3]-rectangle[1]-height)/2);else if(flags&32&&flags&8)y=rectangle[3]-height;
      const old=s.textAlign;try{s.textAlign=0;for(const line of lines){const width=extent(s,line,c).width,x=flags&1?(rectangle[0]+rectangle[2]-width)/2:flags&2?rectangle[2]-width:rectangle[0];draw(s,x,y,line,4,rectangle);y+=lineHeight;}}finally{s.textAlign=old;}return Math.round(y-rectangle[1]);
    },{arity:5,mode:'browser'});
  }
}
