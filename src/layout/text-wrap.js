/** Plain-text, pre-wrap measurement without splitting Unicode grapheme clusters.
 * Uses the browser's full-string shaper supplied by the caller. This is a bounded
 * line-break subset, not an implementation of every UAX #14 or CSS Text rule. */
const eastAsian=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const emoji=/\p{Extended_Pictographic}|[\u{1f1e6}-\u{1f1ff}]/u;
const opening=/[\(\[\{〈《「『【〔〖〘〚（［｛“‘]$/u;
const closing=/^[\)\]\}〉》」』】〕〗〙〛）、。，．！？：；％…’”]/u;
const glue=/[\u00a0\u202f\u2060\ufeff]/u;
let segmenter;
function fallbackSegments(text){
  const result=[];let regional=0;
  for(const ch of text){const last=result.at(-1),isRegional=/[\u{1f1e6}-\u{1f1ff}]/u.test(ch);
    if(last&&(last.endsWith('\u200d')||ch==='\u200d'||/[\p{Mark}\ufe0e\ufe0f\u{1f3fb}-\u{1f3ff}]/u.test(ch)||isRegional&&regional%2))result[result.length-1]+=ch;
    else result.push(ch);
    regional=isRegional?regional+1:0;
  }
  return result;
}
export function layoutGraphemes(text){
  text=String(text);if(text.length>1048576)throw new RangeError('Layout text exceeds 1048576 code units');
  segmenter??=typeof globalThis.Intl?.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):false;
  return segmenter?Array.from(segmenter.segment(text),part=>part.segment):fallbackSegments(text);
}
function tokens(text){
  // The common ASCII path avoids allocating a grapheme array for long words.
  if(/^[\x00-\x7f]*$/.test(text))return text.match(/[^ \t-]+-?[ \t]*|-[ \t]*|[ \t]+/g)||[''];
  const parts=layoutGraphemes(text),result=[];let token='';
  for(let i=0;i<parts.length;i++){
    const a=parts[i],b=parts[i+1]||'';token+=a;
    const soft=a==='\u200b'||/[ \t]$/.test(a)&&!/[ \t]/.test(b)||/[-\u2010]$/.test(a)||eastAsian.test(a)||eastAsian.test(b)||emoji.test(a)&&emoji.test(b);
    if(!b||soft&&!glue.test(a+b)&&!opening.test(a)&&!closing.test(b)){result.push(token);token='';}
  }
  return result;
}
/** Widths use whole candidate strings, retaining kerning/ligatures/bidi shaping.
 * Long Latin words overflow normally. Emergency grapheme wrapping is explicit. */
export function measureWrappedText(text,measure,available,{wrap=true,breakLongWords=false}={}){
  text=String(text);if(text.length>1048576)throw new RangeError('Layout text exceeds 1048576 code units');
  if(typeof measure!=='function'||!Number.isFinite(available)||available<0)throw new TypeError('Expected a measurer and finite nonnegative width');
  let work=0,width=0,lineCount=0;const lines=[];
  const metric=value=>{work+=value.length+1;if(work>8388608)throw new RangeError('Layout text measurement budget exceeded');const n=measure(value.replace(/\u200b/g,''));if(!Number.isFinite(n)||n<0)throw new RangeError('Invalid measured text width');return n;};
  const advance=value=>metric(value.replace(/[ \t]+$/,''));
  const emit=value=>{lines.push(value);width=Math.max(width,advance(value));lineCount++;};
  for(const paragraph of text.replace(/\r\n?/g,'\n').split('\n')){
    if(!wrap||advance(paragraph)<=available){emit(paragraph);continue;}
    let line='';
    for(let token of tokens(paragraph)){
      if(line&&advance(line+token)>available){emit(line);line='';}
      if(breakLongWords&&advance(token)>available){
        const clusters=layoutGraphemes(token);let begin=0;
        while(begin<clusters.length){let lo=begin+1,hi=clusters.length,fit=begin+1;
          while(lo<=hi){const mid=(lo+hi)>>1;if(advance(clusters.slice(begin,mid).join(''))<=available){fit=mid;lo=mid+1;}else hi=mid-1;}
          const part=clusters.slice(begin,fit).join('');begin=fit;if(begin<clusters.length)emit(part);else token=part;
        }
      }
      line+=token;
    }
    emit(line);
  }
  return {width,lineCount,lines,measuredCodeUnits:work};
}
