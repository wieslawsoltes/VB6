import {ICON_PACKS,iconPackBody} from './icon-packs.js';
/** Offline, font-independent classic glyph renderer, shared by IDE and runtime. */
import {ICON_ART,CONTROL_ART,ICON_PALETTE} from './icon-art.js';
export const ICON_NAMES=Object.freeze(Object.keys(ICON_ART));
export const CONTROL_ICON_TYPES=Object.freeze(Object.keys(CONTROL_ART));
const markup=new Map(),documents=new WeakMap();
const own=(table,key)=>typeof key==='string'&&Object.hasOwn(table,key);
export function hasIcon(name){return own(ICON_ART,name);}
export function hasControlIcon(type){return own(CONTROL_ART,type);}
function sizeValue(size){if(typeof size!=='number'||!Number.isFinite(size)||size<8||size>64)throw new RangeError('Icon size must be between 8 and 64 pixels.');return Math.round(size);}
/** Compile adjacent opaque cells into horizontal runs: bounded DOM work per icon.
 * The disabled mask uses only the foreground, not white/face-filled interiors. */
function paths(pixels){const colors=new Map();let mask='';for(let y=0;y<16;y++)for(let x=0;x<16;){const c=pixels[y*16+x],start=x;while(x<16&&pixels[y*16+x]===c)x++;if(c==='.')continue;const run=`M${start} ${y}h${x-start}v1h-${x-start}z`;colors.set(c,(colors.get(c)||'')+run);if(c!=='w'&&c!=='f')mask+=run;}
 return `<g class="icon-art">${[...colors].map(([c,d])=>`<path fill="var(--vb-icon-${c},${ICON_PALETTE[c]})" d="${d}"/>`).join('')}</g><g class="icon-disabled" display="none"><path class="icon-disabled-light" fill="var(--vb-light,#fff)" transform="translate(1 1)" d="${mask}"/><path fill="var(--vb-gray,#808080)" d="${mask}"/></g>`;
}
/** Pure serializer for tests, reusable libraries, and the icon contact sheet.
 * No untrusted name or type is interpolated into markup. Unknown names have an
 * explicit missing-art tile, never the old misleading generic-form fallback. */
export function iconSVG(name,size=16,control=false,pack='classic'){size=sizeValue(size);if(pack!=='classic'&&pack!=='auto'&&(typeof pack!=='string'||!Object.hasOwn(ICON_PACKS,pack)))throw new RangeError('Unknown icon pack');const table=control?CONTROL_ART:ICON_ART,known=own(table,name),key=(control?'control:':'icon:')+(known?name:'missing');let body=markup.get(key);if(!body){body=paths(known?table[name]:ICON_ART.missing);markup.set(key,body);}if(pack==='auto'){body='<g shape-rendering="crispEdges" style="display:var(--vb-icon-classic-display,inline)">'+body+'</g>'+Object.keys(ICON_PACKS).map(id=>'<g class="theme-icon-layer" data-icon-pack="'+id+'" style="display:var(--vb-icon-'+id+'-display,none)">'+iconPackBody(known?name:'missing',control&&known,id)+'</g>').join('');}else if(pack!=='classic')body=iconPackBody(known?name:'missing',control&&known,pack);return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size}" height="${size}" aria-hidden="true" focusable="false" shape-rendering="${pack==='classic'?'crispEdges':'geometricPrecision'}">${body}</svg>`;}
function make(name,size,control){size=sizeValue(size);const known=control?hasControlIcon(name):hasIcon(name),resolved=known?name:'missing';let cache=documents.get(document);if(!cache){cache=new Map();documents.set(document,cache);}const key=(control?'control:':'icon:')+resolved+':'+size;let template=cache.get(key);if(!template){template=document.createElement('span');template.className=(control?'control-icon':'icon')+' pixel-icon';template.setAttribute('aria-hidden','true');if(control){template.classList.add('type-'+resolved);template.style.width='20px';template.style.height='20px';template.dataset.controlIcon=resolved;}else{template.style.width=size+'px';template.style.height=size+'px';template.dataset.icon=resolved;}template.innerHTML=iconSVG(resolved,size,control&&known,'auto');cache.set(key,template);}const result=template.cloneNode(true);if(!known)result.dataset.missingIcon='true';return result;}
export function icon(name,size=16){return make(name,size,false);}
export function controlIcon(type){return make(type,16,true);}

/** Supplementary UI glyph, keeping the original classic typography byte-for-byte. */
export function themedIndicator(name,classicText,size=12){
  const node=document.createElement('span');node.className='theme-indicator';node.setAttribute('aria-hidden','true');
  const old=document.createElement('span');old.className='indicator-classic';old.textContent=String(classicText);
  const modern=document.createElement('span');modern.className='indicator-modern';modern.append(icon(name,size));node.append(old,modern);return node;
}
