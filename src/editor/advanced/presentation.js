import {registerTextView} from '../../rendering/text-view.js';

/** Monaco still owns editing, wrapping, folding, bidi, model/version state and
 * undo. Read bounded visible positions through its public view API; never
 * reconstruct a virtual text model in the workspace renderer. */
export function registerAdvancedPresentation(surface,state){
  const {view,pane}=state,monaco=surface.monaco,listeners=new Set(),disposables=[];
  const notify=()=>{for(const listener of [...listeners])listener();};
  for(const event of ['onDidScrollChange','onDidChangeCursorSelection','onDidChangeModelContent','onDidChangeModelDecorations','onDidLayoutChange','onDidFocusEditorText','onDidBlurEditorText','onDidCompositionStart','onDidCompositionEnd'])
    if(typeof view[event]==='function')disposables.push(view[event](notify));
  let saved=null,current='',configured=false,lastSettings=null;
  const configure=settings=>{lastSettings=settings;
    const enabled=!!settings&&settings.editing!=='native';
    if(!enabled){if(saved){view.updateOptions(saved);saved=null;}current='';configured=false;return;}
    const signature=`${settings.cellWidth}:${settings.cellHeight}`;if(signature===current)return;
    const keys=['fontFamily','fontSize','fontLigatures','letterSpacing','lineHeight','cursorStyle','cursorBlinking'];
    if(!saved){const raw=view.getRawOptions();saved=Object.fromEntries(keys.map(k=>[k,raw[k]]));}
    const canvas=pane.ownerDocument.createElement('canvas'),context=canvas.getContext('2d'),size=settings.cellHeight*.875;
    context.font=`${size}px monospace`;const spacing=settings.cellWidth-context.measureText('M').width;
    current=signature;configured=true;
    view.updateOptions({fontFamily:'monospace',fontSize:size,fontLigatures:false,letterSpacing:spacing,lineHeight:settings.cellHeight,cursorStyle:'block',cursorBlinking:'solid'});
    canvas.width=canvas.height=1;notify();
  };
  const read=()=>{
    const model=view.getModel(),layout=view.getLayoutInfo(),font=view.getOption(monaco.editor.EditorOption.fontInfo);
    const lineHeight=view.getOption(monaco.editor.EditorOption.lineHeight),pitch=font.typicalHalfwidthCharacterWidth;
    const output={width:layout.width,height:layout.height,cellWidth:pitch,cellHeight:lineHeight,items:[],carets:[],selection:[],focused:view.hasTextFocus(),composing:surface.composing,native:!configured||surface.composing};
    if(!model)return output;
    const ranges=view.getVisibleRanges(),selections=view.getSelections()||[];let budget=65536;
    const position=(line,column)=>view.getScrolledVisiblePosition({lineNumber:line,column});
    for(const range of ranges){
      for(let line=range.startLineNumber;line<=range.endLineNumber&&budget>0;line++){
        const text=model.getLineContent(line),start=line===range.startLineNumber?range.startColumn:1,end=line===range.endLineNumber?range.endColumn:text.length+1;
        if(/[\u0590-\u0dff\u200c-\u200f\u202a-\u202e\u2066-\u2069]/u.test(text)){output.native=true;continue;}
        const tokens=monaco.editor.tokenize(text.slice(0,65536),model.getLanguageId())[0]||[];let tokenIndex=0;
        const decorations=view.getLineDecorations(line)||[],attributes=decorations.map(d=>d.options);
        const matches=decorations.filter(d=>String(d.options.className||'').split(/\s+/).includes('input-mode-search-match')).map(d=>{
          const start=line===d.range.startLineNumber?d.range.startColumn:1,
            end=line===d.range.endLineNumber?d.range.endColumn:text.length+1;
          return {start,end:Math.max(start+1,end),empty:start===end};
        }).sort((a,b)=>a.start-b.start);let matchIndex=0;
        const base=position(line,start);
        if(base){
          output.items.push({x:layout.lineNumbersLeft,y:base.top,text:String(line),gutter:true});
          const bp=attributes.some(d=>String(d.glyphMarginClassName).includes('advanced-breakpoint'));
          const execution=attributes.some(d=>String(d.glyphMarginClassName).includes('advanced-execution-arrow'));
          if(bp||execution)output.items.push({x:layout.glyphMarginLeft,y:base.top,text:execution?'►':'●',marker:bp?12:14});
        }
        for(let col=start;col<end&&budget>0;){
          const glyph=String.fromCodePoint(text.codePointAt(col-1)||32),at=position(line,col);budget-=glyph.length;
          while(tokenIndex+1<tokens.length&&tokens[tokenIndex+1].offset<col)tokenIndex++;
          while(matchIndex<matches.length&&matches[matchIndex].end<=col)matchIndex++;
          if(at&&at.top>=-lineHeight&&at.top<layout.height&&at.left>=layout.contentLeft-pitch&&at.left<layout.width){
            const type=tokens[tokenIndex]?.type||'',selected=selections.some(s=>(line>s.startLineNumber||line===s.startLineNumber&&col>=s.startColumn)&&(line<s.endLineNumber||line===s.endLineNumber&&col<s.endColumn));
            const color=/comment/.test(type)?7:/string/.test(type)?11:/number/.test(type)?13:/keyword/.test(type)?15:14;
            const match=matches[matchIndex],searchMatch=!!match&&match.start<=col&&col<match.end;
            output.items.push({x:at.left,y:at.top,text:glyph==='\t'?' ':glyph,color,selected,searchMatch});
          }
          col+=glyph.length;
        }
        if(matches.some(match=>match.empty&&match.start===text.length+1)){
          const column=text.length+1,at=position(line,column),selected=selections.some(s=>(line>s.startLineNumber||line===s.startLineNumber&&column>=s.startColumn)&&(line<s.endLineNumber||line===s.endLineNumber&&column<s.endColumn));
          if(at&&at.top>=-lineHeight&&at.top<layout.height&&at.left>=layout.contentLeft-pitch&&at.left<layout.width)
            output.items.push({x:at.left,y:at.top,text:' ',searchMatch:true,selected});
        }
      }
    }
    if(output.focused)for(const selection of selections){const at=position(selection.positionLineNumber,selection.positionColumn);if(at)output.carets.push({x:at.left,y:at.top});}
    output.minimap=pane.querySelector('.minimap canvas');
    return output;
  };
  const off=registerTextView(pane,{read,configure,subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}});
  return {refresh(){if(lastSettings){current='';configure(lastSettings);}},dispose(){off();configure(null);listeners.clear();for(const d of disposables)d.dispose();}};
}
