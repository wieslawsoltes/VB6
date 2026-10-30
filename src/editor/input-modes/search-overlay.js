const matchLimit=2048;

/** Vim's overlay tokenizes one displayed source line at a time. Keep the same
 * regex semantics while limiting work and decorations to visible line ranges. */
export function searchLineRanges(index,ranges,query,limit=matchLimit){
  if(!query||!index?.lines?.length||limit<=0)return [];
  let regex;try{regex=new RegExp(query.source,String(query.flags||'').replace(/[gy]/g,'')+'g');}catch{return [];}
  const matches=[],visited=new Set();
  for(const range of ranges){
    const first=Math.max(1,range.startLineNumber),last=Math.min(index.lines.length,range.endLineNumber);
    for(let line=first;line<=last&&matches.length<limit;line++){
      if(visited.has(line))continue;visited.add(line);
      const text=index.lines[line-1],left=line===range.startLineNumber?(range.startColumn||1)-1:0,right=line===range.endLineNumber?(range.endColumn??text.length+1)-1:text.length;
      regex.lastIndex=0;let match;
      while((match=regex.exec(text))&&matches.length<limit){
        const from=match.index,to=from+match[0].length;
        if(from>right)break;
        if(to>=left)matches.push({line,from,to});
        if(!match[0].length){
          if(regex.lastIndex>=text.length)break;
          regex.lastIndex+=(regex.unicode||regex.unicodeSets)&&text.codePointAt(regex.lastIndex)>0xffff?2:1;
        }
      }
    }
    if(matches.length>=limit)break;
  }
  return matches;
}

/** Presentation only: never changes source text, selection, focus or history. */
export class InputModeSearchOverlay {
  constructor(host){this.host=host;this.native=new Map();this.advanced=new Map();this.revision=0;this.query=null;}
  set(overlay){
    const query=overlay?.query;
    this.query=typeof query?.source==='string'?{source:query.source,flags:query.flags||''}:null;this.revision++;
    if(!this.query)this.clear();
  }
  clearNative(){for(const state of this.native.values())state.node.remove();this.native.clear();}
  clearAdvanced(){for(const [view,state]of this.advanced)this.removeAdvanced(view,state);}
  removeAdvanced(view,state){for(const listener of state.listeners)listener.dispose?.();try{state.collection.clear();}catch{}this.advanced.delete(view);}
  clear(){this.clearNative();this.clearAdvanced();}
  paint(){
    const host=this.host;if(!this.query||host.disposed||!host.mode){this.clear();return;}
    if(host.surface){this.clearNative();this.paintAdvanced();}else{this.clearAdvanced();this.paintNative();}
  }
  paintAdvanced(){
    const host=this.host,index=host.index,surface=host.surface,views=new Set(surface.views.map(state=>state.view));
    for(const [view,state]of this.advanced)if(!views.has(view))this.removeAdvanced(view,state);
    for(const view of views){
      if(!view.createDecorationsCollection||!view.getVisibleRanges)continue;
      let state=this.advanced.get(view);
      if(!state){
        state={collection:view.createDecorationsCollection(),listeners:[]};this.advanced.set(view,state);
        for(const name of ['onDidScrollChange','onDidLayoutChange','onDidChangeModelContent','onDidChangeHiddenAreas'])if(typeof view[name]==='function')state.listeners.push(view[name](()=>host.schedulePaint()));
      }
      const ranges=view.getVisibleRanges(),signature=this.revision+':'+JSON.stringify(ranges);
      if(state.text===index.text&&state.signature===signature)continue;
      const matches=searchLineRanges(index,ranges,this.query);
      // Publish the cache before setting decorations, which can synchronously
      // notify another presentation observer in the same editor window.
      state.text=index.text;state.signature=signature;
      state.collection.set(matches.map(({line,from,to})=>({range:{startLineNumber:line,startColumn:from+1,endLineNumber:line,endColumn:to+1},options:{className:'input-mode-search-match',showIfCollapsed:true,
        ...(from===to?{beforeContentClassName:'input-mode-search-empty'}:{})}})));
    }
  }
  paintNative(){
    const host=this.host,editor=host.editor,index=host.index,doc=host.root.ownerDocument,{lineHeight,charWidth,tabSize}=host.options;
    const panes=host.xaml?[{input:editor.input,viewport:editor.viewport,range:{firstLine:0},lines:index.lines}]:editor.panes,inputs=new Set(panes.map(p=>p.input));
    for(const [input,state]of this.native)if(!inputs.has(input)){state.node.remove();this.native.delete(input);}
    for(const pane of panes){
      const {input,viewport}=pane;if(!viewport?.getBoundingClientRect||!input?.getBoundingClientRect)continue;
      const bounds=viewport.getBoundingClientRect(),rect=input.getBoundingClientRect(),style=doc.defaultView?.getComputedStyle?.(input),padding={left:parseFloat(style?.paddingLeft)||0,top:parseFloat(style?.paddingTop)||0};
      const origin=pane.range.firstLine||0,first=Math.max(origin,origin+Math.floor(((input.scrollTop||0)-padding.top)/lineHeight)),count=Math.ceil(viewport.clientHeight/lineHeight)+3;
      const last=Math.min(index.lines.length,origin+(pane.lines?.length??index.lines.length),first+count),ranges=[{startLineNumber:first+1,endLineNumber:last}];
      const signature=[this.revision,first,last,rect.left-bounds.left,rect.top-bounds.top,input.scrollLeft,input.scrollTop,viewport.clientWidth,viewport.clientHeight,lineHeight,charWidth,tabSize,padding.left,padding.top].join(':');
      let state=this.native.get(input);
      if(!state||state.node.parentNode!==viewport){
        state?.node.remove();const node=doc.createElement('div');node.className='input-mode-search-overlay';node.setAttribute('aria-hidden','true');viewport.append(node);state={node};this.native.set(input,state);
      }
      if(state.text===index.text&&state.signature===signature)continue;
      const nodes=[];
      for(const {line,from,to}of searchLineRanges(index,ranges,this.query)){
        const text=index.lines[line-1],a=host.visualColumn(text,from),b=host.visualColumn(text,to),left=rect.left-bounds.left+padding.left+a*charWidth-(input.scrollLeft||0),top=rect.top-bounds.top+padding.top+(line-1-origin)*lineHeight-(input.scrollTop||0),width=Math.max(charWidth,b*charWidth-a*charWidth);
        if(left+width<0||left>viewport.clientWidth||top+lineHeight<0||top>viewport.clientHeight)continue;
        const node=doc.createElement('span');node.className='input-mode-search-match';node.dataset.searchStart=String(index.starts[line-1]+from);node.dataset.searchEnd=String(index.starts[line-1]+to);
        Object.assign(node.style,{position:'absolute',left:left+'px',top:top+'px',width:width+'px',height:lineHeight+'px'});nodes.push(node);
      }
      state.text=index.text;state.signature=signature;state.node.replaceChildren(...nodes);
    }
  }
  dispose(){this.query=null;this.clear();}
}
