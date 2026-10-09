/** Explicit UI fences only. Ordinary code examples, quoted text and user messages remain text. */
export function splitUIMessage(text){
  const parts=[];let cursor=0;const lines=text.split(/(?<=\n)/);let offset=0,open=null,other=null;
  for(const line of lines){const fence=/^\s*(`{3,}|~{3,})([^\n]*)/.exec(line);
    if(open){if(fence&&fence[1][0]===open.marker[0]&&fence[1].length>=open.marker.length&&!fence[2].trim()){parts.push({kind:'ui',id:'ui:'+open.start,source:text.slice(open.content,offset),partial:false});cursor=offset+line.length;open=null;}}
    else if(other){if(fence&&fence[1][0]===other[0]&&fence[1].length>=other.length&&!fence[2].trim())other=null;}
    else if(fence){if(['vb6-ui','intelligent-ui','dil'].includes(fence[2].trim())){if(offset>cursor)parts.push({kind:'text',id:'text:'+cursor,text:text.slice(cursor,offset)});open={start:offset,content:offset+line.length,marker:fence[1]};}else other=fence[1];}
    offset+=line.length;
  }
  if(open)parts.push({kind:'ui',id:'ui:'+open.start,source:text.slice(open.content),partial:true});else if(cursor<text.length)parts.push({kind:'text',id:'text:'+cursor,text:text.slice(cursor)});
  return parts;
}
