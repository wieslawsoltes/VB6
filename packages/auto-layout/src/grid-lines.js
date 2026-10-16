/** CSS-style one-based line selectors are separate from the legacy zero-based
 * gridColumn/gridRow coordinates. Unknown names and out-of-budget lines fail
 * explicitly; no implicit negative-coordinate grid is silently synthesized. */
const nameRE=/^[A-Za-z_][\w-]{0,63}$/;
export function normalizeGridLine(value){
  if(value===undefined||value===null||value===''||value==='auto')return '';
  if(typeof value==='number'){if(!Number.isInteger(value)||value===0||Math.abs(value)>262145)throw new RangeError('Invalid grid line index');return String(value);}
  if(typeof value!=='string'||value.length>160)throw new RangeError('Invalid grid line selector');
  if(!value.trim())return '';
  const parts=value.trim().split(/\s+/);let span=false,number,name;
  if(parts[0]==='span'){span=true;parts.shift();}
  if(!parts.length||parts.length>2)throw new RangeError('Invalid grid line selector');
  for(const part of parts){if(/^[+-]?\d+$/.test(part)){if(number!==undefined)throw new RangeError('Repeated grid line index');number=Number(part);if(!Number.isInteger(number)||number===0||Math.abs(number)>262145||span&&number<0)throw new RangeError('Invalid grid line index');}
    else{if(name!==undefined||!nameRE.test(part)||/^(auto|span)$/i.test(part))throw new RangeError('Invalid grid line name');name=part;}}
  return (span?'span ':'')+(name?name+(number!==undefined?' '+number:''):String(number));
}
export function normalizeAreas(value){
  if(value===undefined||value===null||value==='')return [];
  let rows=value;
  if(typeof value==='string'){
    if(value.length>8192)throw new RangeError('Grid area budget exceeded');
    const text=value.trim();if(!text)return [];if(text.startsWith('['))rows=JSON.parse(text);
    else if(text.startsWith('"')||text.startsWith("'")){
      rows=[];let at=0;const re=/\s*(["'])([^"'\n]*)\1\s*/gy;for(;;){re.lastIndex=at;const m=re.exec(text);if(!m)break;rows.push(m[2]);at=re.lastIndex;}if(at!==text.length)throw new RangeError('Invalid quoted grid areas');
    }else rows=text.split(/\n|;/);
  }
  if(!Array.isArray(rows)||rows.length>1024)throw new TypeError('Expected at most 1024 grid area rows');
  const result=rows.map(row=>{if(typeof row!=='string'||row.length>8192)throw new TypeError('Grid area rows must be strings');const names=row.trim().split(/\s+/);if(names.length>1024||names.some(n=>!/^\.+$/.test(n)&&(!nameRE.test(n)||/^(auto|span)$/i.test(n))))throw new RangeError('Invalid grid area name');return names.map(n=>/^\.+$/.test(n)?'.':n);});
  if(!result.length)return [];
  const width=result[0].length;if(!width||result.some(r=>r.length!==width)||width*result.length>1048576)throw new RangeError('Grid areas must have equal bounded row widths');
  const regions=new Map();for(let y=0;y<result.length;y++)for(let x=0;x<width;x++){const name=result[y][x];if(name==='.')continue;const a=regions.get(name)||{x,y,right:x+1,bottom:y+1,count:0};a.x=Math.min(a.x,x);a.y=Math.min(a.y,y);a.right=Math.max(a.right,x+1);a.bottom=Math.max(a.bottom,y+1);a.count++;regions.set(name,a);}
  for(const a of regions.values())if(a.count!==(a.right-a.x)*(a.bottom-a.y))throw new RangeError('Named grid areas must be rectangular');
  return result.map(r=>r.join(' '));
}
export function normalizeGridSelectors(node){
  const result={gridTemplateAreas:normalizeAreas(node.gridTemplateAreas)};
  for(const key of ['gridColumnStart','gridColumnEnd','gridRowStart','gridRowEnd'])result[key]=normalizeGridLine(node[key]);
  const area=node.gridArea??'';if(typeof area!=='string'||area!==''&&(!nameRE.test(area)||/^(auto|span)$/i.test(area)))throw new RangeError('Invalid grid area name');result.gridArea=area;return result;
}
export function areaGeometry(rows){
  const regions=new Map();rows.forEach((row,y)=>row.split(' ').forEach((name,x)=>{if(name==='.')return;const a=regions.get(name);if(a){a.columnEnd=x+1;a.rowEnd=y+1;}else regions.set(name,{column:x,row:y,columnEnd:x+1,rowEnd:y+1});}));return regions;
}
export function lineNames(spec,regions,axis){
  const lines=Array.from({length:spec.length+1},()=>new Set());spec.forEach((t,i)=>{for(const name of t.before||[])lines[i].add(name);for(const name of t.after||[])lines[i+1].add(name);});
  for(const [name,a]of regions){lines[a[axis]]?.add(name+'-start');lines[a[axis+'End']]?.add(name+'-end');}
  return lines.map(s=>[...s]);
}
function parsed(selector){const parts=selector.split(' '),span=parts[0]==='span';if(span)parts.shift();const number=parts.find(p=>/^[+-]?\d+$/.test(p));return {span,number:number===undefined?1:Number(number),name:parts.find(p=>!/^[-+]?\d+$/.test(p))};}
export function resolveAxisPlacement(start,end,coordinate,span,names){
  const count=names.length-1;
  function absolute(selector,isEnd){
    const p=parsed(selector);if(p.span)return null;
    if(!p.name){const at=p.number>0?p.number-1:count+1+p.number;if(at<0)throw new RangeError('Grid line precedes the explicit grid');return at;}
    let matches=names.flatMap((line,i)=>line.includes(p.name)?[i]:[]);
    if(!matches.length)matches=names.flatMap((line,i)=>line.includes(p.name+(isEnd?'-end':'-start'))?[i]:[]);
    const at=p.number>0?matches[p.number-1]:matches[matches.length+p.number];if(at===undefined)throw new RangeError('Unknown grid line: '+selector);return at;
  }
  function spanning(selector,base,sign){const p=parsed(selector);if(!p.name)return base+sign*p.number;
    const indices=names.flatMap((line,i)=>line.includes(p.name)&&((i-base)*sign>0)?[i]:[]);if(sign<0)indices.reverse();const at=indices[p.number-1];if(at===undefined)throw new RangeError('Unknown grid line span: '+selector);return at;}
  const ss=start&&parsed(start).span,es=end&&parsed(end).span;
  if(ss&&es)throw new RangeError('Both grid edges cannot be spans');
  let a=start&&!ss?absolute(start,false):null,b=end&&!es?absolute(end,true):null;
  if(a!==null&&es)b=spanning(end,a,1);if(b!==null&&ss)a=spanning(start,b,-1);
  if(a!==null&&b!==null){if(b<a)[a,b]=[b,a];span=Math.max(1,b-a);coordinate=a;}
  else if(a!==null){coordinate=a;}
  else if(b!==null){coordinate=b-span;if(coordinate<0)throw new RangeError('Grid span precedes the explicit grid');}
  else if(ss||es){const p=parsed(ss?start:end);if(p.name)throw new RangeError('Named span needs a definite opposite line');span=p.number;}
  if(coordinate< -1||span<1||span>1024)throw new RangeError('Grid cell budget exceeded');return {coordinate,span};
}
export function resolveGridItem(node,item,columnNames,rowNames,regions){
  const area=node.gridArea?regions.get(node.gridArea):null;if(node.gridArea&&!area)throw new RangeError('Unknown grid area: '+node.gridArea);
  const c=resolveAxisPlacement(node.gridColumnStart||(area?String(area.column+1):''),node.gridColumnEnd||(area?String(area.columnEnd+1):''),area?.column??item.col,area?area.columnEnd-area.column:item.cs,columnNames);
  const r=resolveAxisPlacement(node.gridRowStart||(area?String(area.row+1):''),node.gridRowEnd||(area?String(area.rowEnd+1):''),area?.row??item.row,area?area.rowEnd-area.row:item.rs,rowNames);
  return {...item,col:c.coordinate,cs:c.span,row:r.coordinate,rs:r.span};
}
