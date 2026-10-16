import {normalizeLength,evaluateLength} from './track-expression.js';
const MAX_TRACKS=1024,NAME=/^[A-Za-z_][\w-]*$/;
const clone=t=>({...t,...(t.before?{before:t.before.slice()}:{}),...(t.after?{after:t.after.slice()}:{}),...(t.tracks?{tracks:t.tracks.map(clone)}:{})});
export const cloneTracks=tracks=>tracks.map(clone);
export function trackNames(value){
  if(!Array.isArray(value)||value.length>32||value.some(n=>typeof n!=='string'||n.length>64||!NAME.test(n)||/^(auto|span)$/i.test(n)))throw new RangeError('Invalid or excessive grid line names');
  return [...new Set(value)];
}
/** Split top-level list arguments while retaining nested expressions/line names. */
export function splitTrackList(text,comma=false){
  const result=[];let start=0,level=0,brackets=0;
  function take(end){const token=text.slice(start,end).trim();if(token)result.push(token);else if(comma)throw new RangeError('Empty grid track argument');}
  for(let i=0;i<text.length;i++){
    const c=text[i];if(c==='(')level++;else if(c===')'){if(--level<0)throw new RangeError('Unbalanced grid parentheses');}
    else if(c==='['){if(brackets++)throw new RangeError('Invalid line name bracket');}else if(c===']'){if(--brackets<0)throw new RangeError('Unbalanced line names');}
    if(!level&&!brackets&&(comma?c===',':/\s/.test(c))){take(i);start=i+1;}
  }
  if(level||brackets)throw new RangeError('Unbalanced grid track definition');take(text.length);return result;
}
function functionArgs(token,name){const m=typeof token==='string'&&token.match(new RegExp('^'+name+'\\(([\\s\\S]*)\\)$','i'));return m?splitTrackList(m[1],true):null;}
function single(track,depth){
  if(depth>8)throw new RangeError('Track nesting limit exceeded');
  let before,after;
  if(track&&typeof track==='object'&&!Array.isArray(track)){
    if(depth>8)throw new RangeError('Track nesting limit exceeded');
    before=track.before===undefined?undefined:trackNames(track.before);after=track.after===undefined?undefined:trackNames(track.after);
    if(track.repeat!==undefined){
      if(!['auto-fit','auto-fill'].includes(track.repeat))throw new RangeError('Invalid automatic repeat');
      const tracks=normalizeTracks(track.tracks,0,depth+1);if(!tracks.length||tracks.some(t=>t.repeat))throw new RangeError('Nested or empty automatic repeat');
      checkRepeat(tracks);return {repeat:track.repeat,tracks,...(before?{before}:{}),...(after?{after}:{})};
    }
    for(const key of ['value','min','max','size'])if(Object.hasOwn(track,key)&&track[key]===null)throw new TypeError('Null grid track '+key);
    let base;
    if(track.mode!==undefined){
      const mode=typeof track.mode==='string'?['fixed','hug','fill'].indexOf(track.mode):track.mode;
      if(!Number.isInteger(mode)||mode<0||mode>2)throw new RangeError('Invalid grid track mode');
      const value=track.value??(mode===2?1:0);if(mode===2&&(typeof value!=='number'||!Number.isFinite(value)||value<=0))throw new RangeError('Fraction must be positive');
      if(mode===1&&(typeof value!=='number'||!Number.isFinite(value)||value<0))throw new RangeError('Invalid intrinsic track value');
      base={mode,value:mode===0?normalizeLength(value):value,min:0,max:Infinity};
    }else{if(track.size!==undefined&&!['number','string'].includes(typeof track.size))throw new TypeError('Track size must be a number or string');base=single(track.size??'1fr',depth+1);}
    const min=normalizeLength(track.min??base.min),max=normalizeLength(track.max??base.max,{infinity:true});
    if(typeof min==='number'&&typeof max==='number'&&max<min)throw new RangeError('Track maximum is less than minimum');
    return {...base,min,max,...(before?{before}:{}),...(after?{after}:{})};
  }
  if(typeof track==='number')return {mode:0,value:normalizeLength(track),min:0,max:Infinity};
  if(typeof track!=='string'||track.length>4096)throw new RangeError('Invalid grid track');
  track=track.trim();if(/^(hug|auto)$/i.test(track))return {mode:1,value:0,min:0,max:Infinity};
  const fr=track.match(/^((?:\d+(?:\.\d+)?|\.\d+))fr$/i);if(fr){const n=Number(fr[1]);if(!Number.isFinite(n)||n<=0)throw new RangeError('Fraction must be positive');return {mode:2,value:n,min:0,max:Infinity};}
  const mm=functionArgs(track,'minmax');if(mm){
    if(mm.length!==2)throw new RangeError('minmax needs two arguments');
    const min=/^(auto|hug)$/i.test(mm[0])?0:normalizeLength(mm[0]),upper=single(mm[1],depth+1);
    if(upper.min!==0||upper.max!==Infinity)throw new RangeError('Nested minmax is not supported');
    const max=upper.mode===0?upper.value:Infinity;
    // Preserve the independent capped-Hug contract for a fixed upper bound.
    const base={mode:upper.mode===0?1:upper.mode,value:upper.mode===0?0:upper.value,min,max};
    if(!/%|var\(/i.test(String(min)+String(max))&&evaluateLength(max,0)<evaluateLength(min,0))throw new RangeError('Track maximum is less than minimum');
    return base;
  }
  return {mode:0,value:normalizeLength(track),min:0,max:Infinity};
}
function checkRepeat(tracks){
  for(const t of tracks){if(t.repeat)throw new RangeError('Nested automatic repeat');const basis=t.mode===0?t.value:t.max!==Infinity?t.max:t.min;
    if(basis===0)throw new RangeError('Automatic repeat needs a definite positive track size or minimum');}
}
export function normalizeTracks(value,fallback=0,depth=0){
  if(depth>8)throw new RangeError('Track nesting limit exceeded');if(value===undefined)value=fallback;
  if(typeof value==='number'){if(!Number.isInteger(value)||value<0||value>MAX_TRACKS)throw new RangeError('Invalid track count');return Array.from({length:value},()=>({mode:2,value:1,min:0,max:Infinity}));}
  let result=[];
  if(typeof value==='string'){
    if(value.length>4096)throw new RangeError('Track definition exceeds 4096 characters');value=value.trim();
    // A JSON array begins with a value, not a bracketed custom-ident list.
    if(/^\[\s*(?:[\{"\d\-\]]|true\b|false\b|null\b)/.test(value))return normalizeTracks(JSON.parse(value),fallback,depth+1);
    let pending=[];
    for(const token of splitTrackList(value)){
      if(token.startsWith('[')){if(!token.endsWith(']'))throw new RangeError('Invalid grid line names');pending=trackNames([...pending,...token.slice(1,-1).trim().split(/\s+/).filter(Boolean)]);continue;}
      const repeat=functionArgs(token,'repeat');let next;
      if(repeat){
        if(repeat.length!==2)throw new RangeError('repeat needs two arguments');const pattern=normalizeTracks(repeat[1],0,depth+1);
        if(!pattern.length||pattern.some(t=>t.repeat))throw new RangeError('Nested or empty automatic repeat');
        if(/^(auto-fill|auto-fit)$/i.test(repeat[0])){checkRepeat(pattern);next=[{repeat:repeat[0].toLowerCase(),tracks:pattern}];}
        else{const count=Number(repeat[0]);if(!/^\d+$/.test(repeat[0])||!Number.isInteger(count)||count<1||count*pattern.length>MAX_TRACKS)throw new RangeError('Grid repeat exceeds 1024 tracks');next=Array.from({length:count},()=>cloneTracks(pattern)).flat();}
      }else next=[single(token,depth)];
      if(pending.length){next[0].before=trackNames([...pending,...next[0].before||[]]);pending=[];}result.push(...next);
      if(result.length>MAX_TRACKS)throw new RangeError('Expected at most 1024 grid tracks');
    }
    if(pending.length){if(!result.length)throw new RangeError('Grid line names require a track');result.at(-1).after=trackNames([...result.at(-1).after||[],...pending]);}
  }else{
    if(!Array.isArray(value)||value.length>MAX_TRACKS)throw new TypeError('Expected at most 1024 grid tracks');result=value.map(t=>single(t,depth));
  }
  if(result.filter(t=>t.repeat).length>1)throw new RangeError('Only one automatic repeat is permitted per axis');
  return result;
}
function resolved(t,extent,variables){
  const min=evaluateLength(t.min,extent,variables),max=evaluateLength(t.max,extent,variables),value=t.mode===0?evaluateLength(t.value,extent,variables):t.value;
  if(min<0||max<min||value<0)throw new RangeError('Invalid resolved track limits/size');return {...clone(t),min,max,value};
}
/** Expand responsive templates per arranged extent. Bounds are checked before
 * allocating the expanded list; the authored template is never modified. */
export function resolveTrackTemplate(template,extent,gap,variables={}){
  const repeat=template.find(t=>t.repeat),result=[];let repetitions=1;
  if(repeat){
    const pattern=repeat.tracks.map(t=>resolved(t,extent,variables)),others=template.filter(t=>!t.repeat).map(t=>resolved(t,extent,variables));
    const basis=t=>Math.max(1,t.mode===0?Math.max(t.min,Math.min(t.max,t.value)):t.max!==Infinity?t.max:t.min);
    const advance=pattern.reduce((sum,t)=>sum+basis(t),0)+gap*pattern.length;
    if(advance<=0)throw new RangeError('Automatic repeat requires positive track advance');
    const outside=others.reduce((sum,t)=>sum+basis(t),0)+gap*Math.max(0,others.length-1);
    repetitions=Math.max(1,Math.floor((extent-outside+(others.length?0:gap))/advance+1e-9));
    if(others.length+repetitions*pattern.length>MAX_TRACKS)throw new RangeError('Responsive grid track budget exceeded');
  }
  template.forEach((t,sourceIndex)=>{
    if(!t.repeat){result.push({...resolved(t,extent,variables),sourceIndex});return;}
    for(let n=0;n<repetitions;n++)for(let j=0;j<t.tracks.length;j++){
      const child=resolved(t.tracks[j],extent,variables);
      if(n===0&&j===0&&t.before)child.before=trackNames([...t.before,...child.before||[]]);
      if(n===repetitions-1&&j===t.tracks.length-1&&t.after)child.after=trackNames([...child.after||[],...t.after]);
      result.push({...child,sourceIndex,repeatIndex:n,patternIndex:j,autoRepeat:t.repeat});
    }
  });return result;
}
/** JSON form retains line names and responsive definitions; Infinity is omitted
 * instead of silently turning into null. Used by transactional designer edits. */
export function serializeTracks(tracks){
  return JSON.stringify(tracks.map(t=>t.repeat?{repeat:t.repeat,tracks:JSON.parse(serializeTracks(t.tracks)),...(t.before?{before:t.before}:{}),...(t.after?{after:t.after}:{})}:{mode:t.mode,value:t.value,...(t.min?{min:t.min}:{}),...(t.max!==Infinity?{max:t.max}:{}),...(t.before?{before:t.before}:{}),...(t.after?{after:t.after}:{})}));
}
