/** Read-only cell projection of a native input's UTF-16 selection. No editable
 * state, key synthesis or clipboard interception lives in the painter. */
export function layoutText(text,{columns,rows,scrollColumn=0,scrollRow=0,tabSize=8,
  selectionStart=0,selectionEnd=0,selectionDirection='none',focused=false,password=false,
  wrap=false,alignment='left',maxCodeUnits=1048576}={}) {
  for(const value of [columns,rows,scrollColumn,scrollRow,tabSize,maxCodeUnits])
    if(!Number.isSafeInteger(value)||value<0)throw new RangeError('Invalid text projection geometry');
  if(columns<1||rows<1||columns*rows>65536||tabSize<1||tabSize>32)throw new RangeError('Text projection exceeds cell budget');
  text=String(text??'');if(text.length>maxCodeUnits)throw new RangeError('Text projection exceeds source budget');
  const clamp=n=>Math.min(text.length,Math.max(0,Math.trunc(Number(n)||0)));
  const start=Math.min(clamp(selectionStart),clamp(selectionEnd)),end=Math.max(clamp(selectionStart),clamp(selectionEnd));
  const caretIndex=selectionDirection==='backward'?start:end,lines=new Map();
  let x=0,y=0,caret=null;
  // Keep logical line extents separate from selection paint. A selected newline
  // extends its highlight to the viewport edge, but must not change the line's
  // alignment or move its glyphs. Empty lines also own an aligned caret.
  const visibleLine=()=>{
    if(y<scrollRow||y>=scrollRow+rows)return null;
    let line=lines.get(y-scrollRow);
    if(!line)lines.set(y-scrollRow,line={cells:[],length:0,newline:null});
    return line;
  };
  const cell=(glyph,from,to)=>{
    if(wrap&&x>=columns){x=0;y++;}
    if(!caret&&caretIndex>=from&&caretIndex<to)caret={x:x-scrollColumn,y:y-scrollRow};
    const line=visibleLine();
    if(line){
      line.length=x+1;
      if(x>=scrollColumn&&x<scrollColumn+columns)
        line.cells.push({x:x-scrollColumn,y:y-scrollRow,glyph:password?'•':glyph,sourceStart:from,sourceEnd:to,selected:focused&&from<end&&to>start});
    }
    x++;
  };
  for(let index=0;index<text.length;) {
    const from=index,code=text.codePointAt(index),glyph=String.fromCodePoint(code);index+=glyph.length;
    if(glyph==='\r'||glyph==='\n') {
      if(glyph==='\r'&&text[index]==='\n')index++;
      if(caretIndex>=from&&caretIndex<index)caret={x:x-scrollColumn,y:y-scrollRow};
      const line=visibleLine();
      if(line){line.length=x;if(focused&&from<end&&index>start)line.newline={from,to:index};}
      x=0;y++;
    } else if(glyph==='\t'&&!password) {
      const count=tabSize-(x%tabSize);for(let n=0;n<count;n++)cell(' ',from,index);
    } else cell(glyph,from,index);
    if(y>=scrollRow+rows&&index>caretIndex)break;
  }
  if(caretIndex===text.length){if(wrap&&x>=columns){x=0;y++;}caret={x:x-scrollColumn,y:y-scrollRow};}
  visibleLine();
  const cells=[];
  for(const [row,line]of lines){
    const shift=scrollColumn?0:alignment==='right'?Math.max(0,columns-line.length):alignment==='center'?Math.max(0,Math.floor((columns-line.length)/2)):0;
    for(const item of line.cells){item.x+=shift;cells.push(item);}
    if(line.newline)for(let n=Math.max(0,line.length+shift-scrollColumn);n<columns;n++)
      cells.push({x:n,y:row,glyph:' ',sourceStart:line.newline.from,sourceEnd:line.newline.to,selected:true});
    if(caret?.y===row)caret.x+=shift;
  }
  // An insertion point exactly on the trailing edge still needs visible block
  // ink. Use the last cell without shifting text or changing native selection;
  // positions genuinely outside the scrolled viewport remain hidden.
  if(caret?.x===columns)caret.x=columns-1;
  if(!focused||start!==end||!caret||caret.x<0||caret.y<0||caret.x>=columns||caret.y>=rows)caret=null;
  return {cells,caret};
}

export function paintText(buffer,state,profile,{x:originX=0,y:originY=0,width=buffer.columns,height=buffer.rows}={}) {
  if(![originX,originY,width,height].every(Number.isSafeInteger)||originX<0||originY<0||width<1||height<1||originX+width>buffer.columns||originY+height>buffer.rows)throw new RangeError('Invalid text paint region');
  const fg=state.disabled?8:profile.foreground,bg=profile.background;
  const layout=layoutText(state.text,{columns:width,rows:height,scrollColumn:state.scrollColumn||0,
    scrollRow:state.scrollRow||0,password:state.password,wrap:state.wrap,alignment:state.alignment,
    selectionStart:state.selectionStart,selectionEnd:state.selectionEnd,selectionDirection:state.selectionDirection,
    focused:state.cellEditing&&!state.disabled});
  for(const cell of layout.cells)buffer.put(originX+cell.x,originY+cell.y,cell.glyph,cell.selected?profile.accent:fg,cell.selected?profile.selection:bg);
  if(layout.caret&&!state.readOnly){const x=originX+layout.caret.x,y=originY+layout.caret.y,i=y*buffer.columns+x;buffer.put(x,y,buffer.glyphs[i],bg,fg===bg?profile.accent:fg);}
  return layout;
}
