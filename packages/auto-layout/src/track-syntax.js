/** Parenthesis-aware, bounded track syntax. Produces data, never JavaScript. */
export function expandTrackSyntax(text, depth=0) {
  if (depth > 8) throw new RangeError('Track nesting limit exceeded');
  const tokens=[];let start=0,level=0;
  const take=end=>{const token=text.slice(start,end).trim();if(token)tokens.push(token);};
  for(let i=0;i<text.length;i++){
    const c=text[i];if(c==='(')level++;else if(c===')'&&--level<0)throw new RangeError('Unbalanced grid track parentheses');
    if(!level&&/\s/.test(c)){take(i);start=i+1;}
  }
  if(level)throw new RangeError('Unbalanced grid track parentheses');take(text.length);
  const result=[];
  for(const token of tokens){
    const repeat=token.match(/^repeat\(\s*(\d+)\s*,([\s\S]*)\)$/i);
    if(repeat){const count=Number(repeat[1]);if(count<1||count>1024)throw new RangeError('Invalid grid repeat count');
      const tracks=expandTrackSyntax(repeat[2],depth+1);if(!tracks.length||result.length+tracks.length*count>1024)throw new RangeError('Grid repeat exceeds 1024 tracks');
      for(let i=0;i<count;i++)result.push(...tracks);
    }else{
      const minmax=token.match(/^minmax\(\s*(auto|(?:\d+(?:\.\d+)?|\.\d+)(?:px)?)\s*,\s*([^(),]+)\s*\)$/i);
      if(minmax){const min=minmax[1].toLowerCase()==='auto'?0:parseFloat(minmax[1]),max=minmax[2].trim();
        if(/^(?:\d+(?:\.\d+)?|\.\d+)(?:px)?$/i.test(max))result.push({size:'hug',min,max:parseFloat(max)});
        else if(/^(?:hug|auto|(?:\d+(?:\.\d+)?|\.\d+)fr)$/i.test(max))result.push({size:max,min});
        else throw new RangeError('Invalid minmax upper track');
      }else result.push(token);
    }
    if(result.length>1024)throw new RangeError('Expected at most 1024 grid tracks');
  }
  return result;
}
