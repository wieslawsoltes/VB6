/**
 * Read-only layout for Vim edits that have not reached the canonical Monaco
 * model yet. The optional Monaco bundle supplies its own pinned line-break
 * calculator and Unicode cursor-column implementation. No editor, model or
 * DOM node is created or changed here.
 */
export function createVimLineLayout(view,monaco,MonospaceLineBreaksComputerFactory,CursorColumns){
  const get=name=>view.getOption(monaco.editor.EditorOption[name]);
  const font=get('fontInfo'),tabSize=view.getModel()?.getOptions().tabSize||4;
  const wrappingColumn=get('wrappingInfo')?.wrappingColumn??-1,wrappingIndent=get('wrappingIndent');
  const wordBreak=get('wordBreak'),wrapOnEscapedLineFeeds=get('wrapOnEscapedLineFeeds');
  const twoCells=get('effectiveFullwidthCharacterWidth')==='twoCells',pitch=font.typicalHalfwidthCharacterWidth;
  const factory=new MonospaceLineBreaksComputerFactory(get('wordWrapBreakBeforeCharacters')||'',get('wordWrapBreakAfterCharacters')||'');
  const cache=new Map(),clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)||0));
  const previousCharacter=(text,offset)=>offset>1&&/[\uDC00-\uDFFF]/.test(text[offset-1])&&/[\uD800-\uDBFF]/.test(text[offset-2])?offset-2:Math.max(0,offset-1);
  return {
    line(value){
      const text=String(value);let result=cache.get(text);
      if(result){cache.delete(text);cache.set(text,result);return result;}
      const computer=factory.createLineBreaksComputer({getLineContent:()=>text,getLineInjectedText:()=>null},font,tabSize,wrappingColumn,wrappingIndent,wordBreak,wrapOnEscapedLineFeeds,twoCells);
      computer.addRequest(1,null);const projection=computer.finalize()[0],count=projection?.getOutputLineCount()||1,rows=new Map();
      const clip=ch=>{ch=Math.floor(clamp(ch,0,text.length));return ch>0&&/[\uDC00-\uDFFF]/.test(text[ch])&&/[\uD800-\uDBFF]/.test(text[ch-1])?ch-1:ch;};
      const rowAt=ch=>projection?projection.translateToOutputPosition(clip(ch)).outputLineIndex:0;
      const row=number=>{
        number=Math.floor(clamp(number,0,count-1));let value=rows.get(number);if(value)return value;
        const start=number?projection.breakOffsets[number-1]:0,end=projection?projection.breakOffsets[number]:text.length,indent=number?projection.wrappedTextIndentLength:0;
        value={number,start,end,indent,text:' '.repeat(indent)+text.slice(start,end)};rows.set(number,value);return value;
      };
      result={
        count,rowAt,
        character(number,pixels){
          const current=row(number),column=CursorColumns.columnFromVisibleColumn(current.text,Math.max(0,pixels)/pitch,tabSize)-1;
          let ch=clip(clamp(current.start+Math.max(0,column-current.indent),current.start,current.end));
          // At a soft-wrap boundary the same offset denotes the next row's
          // start. A normal-mode motion to this row must remain on this row.
          if(current.number<count-1&&ch===current.end)ch=Math.max(current.start,previousCharacter(text,ch));
          return ch;
        },
        left(ch){ch=clip(ch);const current=row(rowAt(ch));return CursorColumns.visibleColumnFromColumn(current.text,current.indent+ch-current.start+1,tabSize)*pitch;},
      };
      cache.set(text,result);if(cache.size>128)cache.delete(cache.keys().next().value);return result;
    },
  };
}
