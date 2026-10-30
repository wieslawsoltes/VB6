import {projectPixels,nearestEGA} from './graphics.js';
import {TUI_SURFACE_PIXEL_BUDGET} from './cells.js';
import {textViewFor} from '../rendering/text-view.js';
import {CellBuffer,CanvasCellRenderer} from './cells.js';
import {tuiAttribute} from './appearance.js';

export function paintTextView(buffer,snapshot,profile){
  const editor=tuiAttribute(profile,'editor'),selection=tuiAttribute(profile,'selected'),search=tuiAttribute(profile,'search');
  const {cellWidth,cellHeight}=snapshot;
  if(!Number.isFinite(cellWidth)||cellWidth<=0||!Number.isFinite(cellHeight)||cellHeight<=0||!Array.isArray(snapshot.items)||snapshot.items.length>70000)throw new RangeError('Text view exceeds projection budget');
  buffer.fill(0,0,buffer.columns,buffer.rows,' ',editor.foreground,editor.background);
  for(const item of snapshot.items){
    if(!Number.isFinite(item.x)||!Number.isFinite(item.y)||typeof item.text!=='string')continue;
    const x=Math.round(item.x/cellWidth),y=Math.floor((item.y+cellHeight*.5)/cellHeight);
    if(y<0||y>=buffer.rows||x<0||x>=buffer.columns)continue;
    const a=item.selected?selection:item.searchMatch?search:editor;
    buffer.text(x,y,item.text,{width:Math.min(32,buffer.columns-x),foreground:item.marker??(item.selected||item.searchMatch?a.foreground:item.color??a.foreground),background:a.background});
  }
  for(const caret of snapshot.focused?snapshot.carets||[]:[]){
    const x=Math.round(caret.x/cellWidth),y=Math.floor((caret.y+cellHeight*.5)/cellHeight);
    if(x>=0&&y>=0&&x<buffer.columns&&y<buffer.rows){const i=y*buffer.columns+x;buffer.put(x,y,buffer.glyphs[i],editor.background,editor.foreground);}
  }
}
export class TuiTextViews{
  constructor(owner){this.owner=owner;this.entries=new Map();this.dirty=new Set();}
  scan(root){
    if(!root?.querySelectorAll)return;
    for(const node of [...(root.matches?.('[data-vb-text-view]')?[root]:[]),...root.querySelectorAll('[data-vb-text-view]')]){
      const provider=textViewFor(node);if(!provider||!this.owner.owns(node))continue;
      if(this.entries.get(node)?.provider===provider)continue;if(this.entries.has(node))this.remove(node);
      const entry={provider,canvas:null,painter:null,buffer:null,next:null,pixels:0};this.entries.set(node,entry);
      entry.off=provider.subscribe(()=>{this.dirty.add(node);this.owner.requestPaint();});
      provider.configure?.(this.owner.settings);this.owner.observeSize(node);this.dirty.add(node);
    }
  }
  invalidate(node){for(const key of this.entries.keys())if(!node||key===node||node.contains?.(key)||key.contains(node))this.dirty.add(key);}
  configure(){
    for(const entry of this.entries.values()){
      entry.provider.configure?.(this.owner.settings);
      this.owner.surfacePixels-=entry.pixels;entry.pixels=0;
      entry.painter?.dispose();entry.painter=null;entry.buffer=null;entry.next=null;
    }
    this.invalidate();
  }
  flush(){
    const owner=this.owner;
    for(const node of this.entries.keys())if(!node.isConnected||!owner.owns(node)||textViewFor(node)!==this.entries.get(node).provider)this.remove(node);
    for(const node of [...this.dirty]){
      this.dirty.delete(node);const e=this.entries.get(node);if(!e||!node.getClientRects().length||node.closest('[hidden]'))continue;
      try{
        const s=e.provider.read();
        if(s.native){e.visible=false;if(e.canvas)e.canvas.hidden=true;node.removeAttribute('data-tui-text-view');continue;}
        if(![s.width,s.height,s.cellWidth,s.cellHeight].every(Number.isFinite)||s.width<=0||s.height<=0||s.cellWidth<1||s.cellHeight<1)continue;
        const columns=Math.ceil(s.width/s.cellWidth),rows=Math.ceil(s.height/s.cellHeight);
        if(columns>512||rows>256||columns*rows>65536)throw new RangeError('Text view cell budget exceeded');
        if(!e.canvas){e.canvas=owner.document.createElement('canvas');e.canvas.className='vb-tui-text-view';e.canvas.setAttribute('aria-hidden','true');node.append(e.canvas);}
        e.canvas.hidden=false;e.canvas.style.width=s.width+'px';e.canvas.style.height=s.height+'px';
        if(e.painter&&(e.painter.cellWidth!==s.cellWidth||e.painter.cellHeight!==s.cellHeight)){e.painter.dispose();e.painter=null;}
        e.painter||=new CanvasCellRenderer(e.canvas,{cellWidth:s.cellWidth,cellHeight:s.cellHeight,atlas:owner.atlas});
        e.painter.setExtent(s.width,s.height);
        const size=e.painter.dimensions({columns,rows},owner.view.devicePixelRatio),pixels=size.width*size.height;
        if(owner.surfacePixels-e.pixels+pixels>TUI_SURFACE_PIXEL_BUDGET)throw new RangeError('Text view surface budget exceeded');
        owner.surfacePixels+=pixels-e.pixels;e.pixels=pixels;
        if(!e.buffer||e.buffer.columns!==columns||e.buffer.rows!==rows){e.buffer=new CellBuffer(columns,rows);e.next=new CellBuffer(columns,rows);}
        paintTextView(e.next,s,owner.settings.profile);this.minimap(e,s,node);e.buffer.blit(e.next,0,0);e.painter.render(e.buffer,owner.view.devicePixelRatio);
        // Preserve the genuine minimap and scrollbar interaction layer through
        // rectangular holes; these use the EGA chrome stylesheet as well.
        const bounds=node.getBoundingClientRect();
        for(const part of node.querySelectorAll('.scrollbar,.contentWidgets>*,.overlayWidgets>*')){
          const r=part.getBoundingClientRect();if(r.width&&r.height){const d=owner.view.devicePixelRatio||1;e.painter.context.clearRect((r.left-bounds.left)*d,(r.top-bounds.top)*d,r.width*d,r.height*d);}
        }
        e.buffer.invalidate();e.visible=true;e.fallback=null;node.setAttribute('data-tui-text-view','');
      }catch(error){e.fallback=error.message;owner.metrics.failures++;e.canvas?.remove();e.painter?.dispose();e.canvas=e.painter=null;owner.surfacePixels-=e.pixels;e.pixels=0;node.removeAttribute('data-tui-text-view');if(!/budget/.test(error.message))owner.onError(error,node);}
    }
  }
  minimap(entry,snapshot,node){
    const source=snapshot.minimap;if(!source?.width||!source?.height)return;
    const box=source.getBoundingClientRect(),host=node.getBoundingClientRect();
    const columns=Math.min(64,Math.max(1,Math.ceil(box.width/snapshot.cellWidth))),rows=Math.min(256,Math.max(1,Math.ceil(box.height/snapshot.cellHeight)));
    this.scratch||=this.owner.document.createElement('canvas');this.scratch.width=columns*2;this.scratch.height=rows*4;
    const ctx=this.scratch.getContext('2d',{willReadFrequently:true});ctx.drawImage(source,0,0,this.scratch.width,this.scratch.height);
    const image=ctx.getImageData(0,0,this.scratch.width,this.scratch.height),histogram=new Uint32Array(16);
    for(let i=0;i<image.data.length;i+=4)histogram[nearestEGA(image.data[i],image.data[i+1],image.data[i+2])]++;
    let paper=0;for(let i=1;i<16;i++)if(histogram[i]>histogram[paper])paper=i;
    for(let i=0;i<image.data.length;i+=4)if(nearestEGA(image.data[i],image.data[i+1],image.data[i+2])===paper)image.data[i+3]=0;
    const buffer=new CellBuffer(columns,rows),attribute=tuiAttribute(this.owner.settings.profile,'editor');
    projectPixels(buffer,image,{mode:'braille',background:attribute.background});
    entry.next.blit(buffer,Math.floor((box.left-host.left)/snapshot.cellWidth),Math.floor((box.top-host.top)/snapshot.cellHeight));
  }
  remove(node){const e=this.entries.get(node);if(!e)return;e.off?.();e.provider.configure?.(null);e.painter?.dispose();e.canvas?.remove();this.owner.surfacePixels-=e.pixels;this.owner.unobserveSize(node);node.removeAttribute('data-tui-text-view');this.entries.delete(node);this.dirty.delete(node);}
  dispose(){for(const node of [...this.entries.keys()])this.remove(node);if(this.scratch)this.scratch.width=this.scratch.height=1;this.scratch=null;}
}
