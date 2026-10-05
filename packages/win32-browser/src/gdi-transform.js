import {Win32Error,integer} from './core.js';
export const TRANSFORM_CONSTANTS=Object.freeze({GM_COMPATIBLE:1,GM_ADVANCED:2,MWT_IDENTITY:1,MWT_LEFTMULTIPLY:2,MWT_RIGHTMULTIPLY:3,MM_TEXT:1,MM_LOMETRIC:2,MM_HIMETRIC:3,MM_LOENGLISH:4,MM_HIENGLISH:5,MM_TWIPS:6,MM_ISOTROPIC:7,MM_ANISOTROPIC:8});
export const IDENTITY=Object.freeze([1,0,0,1,0,0]);
export function multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
export function inverse(a){const det=a[0]*a[3]-a[1]*a[2];if(!Number.isFinite(det)||Math.abs(det)<1e-20)throw new Win32Error('Singular coordinate transform');return [a[3]/det,-a[1]/det,-a[2]/det,a[0]/det,(a[2]*a[5]-a[3]*a[4])/det,(a[1]*a[4]-a[0]*a[5])/det];}
export function mapPoint(a,x,y){const px=a[0]*x+a[2]*y+a[4],py=a[1]*x+a[3]*y+a[5];if(!Number.isFinite(px)||!Number.isFinite(py)||Math.abs(px)>0x3ffffff||Math.abs(py)>0x3ffffff)throw new Win32Error('Transformed coordinate out of range');return [px,py];}
export function mapping(s){
  let sx=1,sy=1;const mode=s.mapMode||1;
  if(mode>=2&&mode<=6){sx=96/({2:254,3:2540,4:100,5:1000,6:1440})[mode];sy=-sx;}
  else if(mode>=7){sx=s.viewportExtX/s.windowExtX;sy=s.viewportExtY/s.windowExtY;if(mode===7){const n=Math.min(Math.abs(sx),Math.abs(sy));sx=Math.sign(sx)*n;sy=Math.sign(sy)*n;}}
  return multiply([sx,0,0,sy,s.viewportX-sx*(s.windowX||0),s.viewportY-sy*(s.windowY||0)],s.world||IDENTITY);
}
export function translatedOnly(s){const a=mapping(s);return a[0]===1&&!a[1]&&!a[2]&&a[3]===1;}
export function devicePoint(s,x,y){return mapPoint(mapping(s),x,y).map(Math.round);}
export function mapBounds(a,r){const p=[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]].map(([x,y])=>mapPoint(a,x,y));return [Math.floor(Math.min(...p.map(p=>p[0]))),Math.floor(Math.min(...p.map(p=>p[1]))),Math.ceil(Math.max(...p.map(p=>p[0]))),Math.ceil(Math.max(...p.map(p=>p[1])))];}
export function readTransform(memory,p){const v=memory.view(p,24),a=[0,4,8,12,16,20].map(o=>v.getFloat32(o,true));if(a.some(n=>!Number.isFinite(n)))throw new Win32Error('Non-finite XFORM');return a;}
export function installTransforms(w,{dc,add}){
  const m=w.memory,pair=(p,x,y)=>{const v=m.view(p,8);v.setInt32(0,x,true);v.setInt32(4,y,true);};
  add('GetGraphicsMode',1,id=>dc(id).graphicsMode||1);
  add('SetGraphicsMode',2,(id,mode)=>{mode=integer(mode,1,2);const s=dc(id),old=s.graphicsMode||1;if(mode===1&&(s.world||IDENTITY).some((v,i)=>v!==IDENTITY[i]))throw new Win32Error('Reset world transform before GM_COMPATIBLE');s.graphicsMode=mode;return old;});
  add('GetWorldTransform',2,(id,p)=>{const a=dc(id).world||IDENTITY,v=m.view(p,24);a.forEach((n,i)=>v.setFloat32(i*4,n,true));return 1;});
  const set=(s,a)=>{if(s.graphicsMode!==2)throw new Win32Error('World transform requires GM_ADVANCED');inverse(a);s.world=Object.freeze(a);return 1;};
  add('SetWorldTransform',2,(id,p)=>set(dc(id),readTransform(m,p)));
  add('ModifyWorldTransform',3,(id,p,mode)=>{const s=dc(id);mode=integer(mode,1,3);const a=mode===1?IDENTITY:readTransform(m,p),old=s.world||IDENTITY;return set(s,mode===1?[...IDENTITY]:mode===2?multiply(old,a):multiply(a,old));});
  add('CombineTransform',3,(out,a,b)=>{const x=readTransform(m,a),y=readTransform(m,b),r=multiply(y,x),v=m.view(out,24);if(r.some(n=>!Number.isFinite(Math.fround(n))))throw new Win32Error('XFORM overflow');r.forEach((n,i)=>v.setFloat32(i*4,n,true));return 1;});
  add('GetMapMode',1,id=>dc(id).mapMode||1,{replace:true});
  add('SetMapMode',2,(id,mode)=>{mode=integer(mode,1,8);const s=dc(id),old=s.mapMode||1;s.mapMode=mode;s.windowExtX=s.windowExtY=s.viewportExtX=s.viewportExtY=1;return old;},{replace:true});
  for(const [name,x,y] of [['WindowOrg','windowX','windowY'],['WindowExt','windowExtX','windowExtY'],['ViewportExt','viewportExtX','viewportExtY']]){
    add('Get'+name+'Ex',2,(id,p)=>{const s=dc(id);pair(p,s[x],s[y]);return 1;});
    add('Set'+name+'Ex',4,(id,a,b,p)=>{const s=dc(id);a=integer(a,-0x7fffffff,0x7fffffff);b=integer(b,-0x7fffffff,0x7fffffff);if(p)pair(p,s[x],s[y]);if(name!=='WindowOrg'&&(s.mapMode||1)<7)return 1;if(name!=='WindowOrg'&&(!a||!b))throw new Win32Error('Mapping extents cannot be zero');s[x]=a;s[y]=b;return 1;});
  }
  add('OffsetWindowOrgEx',4,(id,x,y,p)=>{const s=dc(id);return w.resolve('gdi32','SetWindowOrgEx').fn(id,s.windowX+Number(x),s.windowY+Number(y),p);});
  for(const [name,x,y]of [['Window','windowExtX','windowExtY'],['Viewport','viewportExtX','viewportExtY']])add('Scale'+name+'ExtEx',6,(id,xn,xd,yn,yd,p)=>{const s=dc(id);[xn,xd,yn,yd]=[xn,xd,yn,yd].map(n=>integer(n,-0x7fffffff,0x7fffffff));if(!xd||!yd)throw new Win32Error('Zero mapping denominator');return w.resolve('gdi32','Set'+name+'ExtEx').fn(id,Math.round(s[x]*xn/xd),Math.round(s[y]*yn/yd),p);});
  for(const inv of [false,true])add(inv?'DPtoLP':'LPtoDP',3,(id,p,n)=>{n=integer(n,0,Math.floor(m.maxBytes/8));const s=dc(id),a=inv?inverse(mapping(s)):mapping(s),v=m.view(p,n*8),points=Array.from({length:n},(_,i)=>mapPoint(a,v.getInt32(i*8,true),v.getInt32(i*8+4,true)).map(Math.round));points.forEach(([x,y],i)=>{v.setInt32(i*8,x,true);v.setInt32(i*8+4,y,true);});return 1;});
}
