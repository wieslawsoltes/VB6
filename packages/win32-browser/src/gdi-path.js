import {Win32Error,integer} from './core.js';
import {mapping,mapPoint,inverse,IDENTITY} from './gdi-transform.js';

export const PATH_CONSTANTS=Object.freeze({ALTERNATE:1,WINDING:2,PT_CLOSEFIGURE:1,PT_LINETO:2,PT_BEZIERTO:4,PT_MOVETO:6});
export function installPaths(w,{dc,bitmaps,regions,add,style}){
  const h=w.handles,m=w.memory,max=integer(w.options.maxPathPoints??16384,4,262144);
  const wrap=(name,fn)=>{const old=w.resolve('gdi32',name);add(name,old.arity,(...args)=>fn(old.fn,...args),{replace:true});};
  const checked=(x,y)=>[integer(x,-0x4000000,0x3ffffff),integer(y,-0x4000000,0x3ffffff)];
  const device=(s,x,y)=>mapPoint(mapping(s),...checked(x,y)).map(Math.round);
  const path=s=>{if(s.path?.state!=='closed')throw new Win32Error('A completed path is required',1003);return s.path;};
  const append=(s,entries)=>{const old=s.path.entries;if(old.length+entries.length>max)throw new Win32Error('Path point quota exceeded',8);s.path={state:'open',entries:[...old,...entries]};};
  const last=s=>s.path.entries.at(-1);
  const start=(s,p)=>{if(!last(s)||last(s).type&1)append(s,[{point:p,type:6}]);};
  const points=(p,n,min=2)=>{n=integer(n,min,max);const v=m.view(p,n*8);return Array.from({length:n},(_,i)=>[v.getInt32(i*8,true),v.getInt32(i*8+4,true)]);};
  const flatten=entries=>{
    const out=[];let at=null;
    for(let i=0;i<entries.length;i++){
      const e=entries[i],type=e.type&~1;
      if(type!==4){out.push(e);at=e.point;continue;}
      if(!at||i+2>=entries.length||entries[i+1].type!==4||(entries[i+2].type&~1)!==4)throw new Win32Error('Invalid Bezier path');
      const end=entries[i+2],stack=[[at,e.point,entries[i+1].point,end.point,0]];i+=2;
      while(stack.length){const [a,b,c,d,depth]=stack.pop(),dx=d[0]-a[0],dy=d[1]-a[1],length=Math.hypot(dx,dy),distance=p=>length?Math.abs(dy*p[0]-dx*p[1]+d[0]*a[1]-d[1]*a[0])/length:Math.hypot(p[0]-a[0],p[1]-a[1]);
        if(depth>=16||Math.max(distance(b),distance(c))<=.25){out.push({point:d.map(Math.round),type:2});if(out.length>max)throw new Win32Error('Flattened path quota exceeded',8);continue;}
        const mid=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2],ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),center=mid(abc,bcd);
        stack.push([center,bcd,cd,d,depth+1],[a,ab,abc,center,depth+1]);
      }
      if(end.type&1)out[out.length-1]={...out.at(-1),type:3};at=end.point;
    }
    return out;
  };
  const figures=entries=>{const result=[];let current=null;for(const e of flatten(entries)){if((e.type&~1)===6){current=[];result.push(current);}if(!current)throw new Win32Error('Path has no starting point');current.push(e.point);if(e.type&1){current.closed=true;current=null;}}return result.filter(p=>p.length>=2);};
  const shape=(s,entries)=>regions.polygons(figures(entries),s.polyFillMode||1);
  const strokeShape=(s,entries)=>{
    const pen=h.get(s.pen,'pen');if(pen.null)return regions.rectangle(0,0,0,0);
    const transform=mapping(s),width=Math.max(1,(pen.width||1)*Math.sqrt(Math.abs(transform[0]*transform[3]-transform[1]*transform[2]))),polys=[];
    for(const figure of figures(entries)){
      const p=figure.closed?[...figure,figure[0]]:figure;
      for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue;const ox=-(b[1]-a[1])*width/2/length,oy=(b[0]-a[0])*width/2/length;
        polys.push([[a[0]+ox,a[1]+oy],[a[0]-ox,a[1]-oy],[b[0]-ox,b[1]-oy],[b[0]+ox,b[1]+oy]].map(p=>p.map(Math.round)));if(polys.length*4>max)throw new Win32Error('Stroke path quota exceeded',8);}
    }
    return polys.length?regions.polygons(polys,2):regions.rectangle(0,0,0,0);
  };
  const paint=(s,fill,stroke)=>{
    const effective=bitmaps.effective(s),f=fill?regions.combine(fill,effective,1):null,t=stroke?regions.combine(stroke,effective,1):null;
    const union=f&&t?regions.combine(f,t,2):f||t;if(!union?.count)return 1;
    const image=bitmaps.read(s,union.bounds),brush=h.get(s.brush,'brush'),pen=h.get(s.pen,'pen');
    for(const [region,color]of [[f,brush.color||0],[t,pen.color||0]])if(region)for(const band of region.bands)for(let y=band.top;y<band.bottom;y++)for(let j=0;j<band.spans.length;j+=2)for(let x=band.spans[j];x<band.spans[j+1];x++){const i=((y-union.bounds[1])*image.width+x-union.bounds[0])*4;image.data.set([color&255,color>>>8&255,color>>>16&255,0],i);}
    bitmaps.write(s,union.bounds,image);return 1;
  };
  const render=(s,entries,fill,stroke)=>paint(s,fill&&!h.get(s.brush,'brush').null?shape(s,entries):null,stroke?strokeShape(s,entries):null);
  const submit=(s,entries,fill=true,stroke=true)=>{if(s.path?.state==='open'){append(s,entries);return 1;}return render(s,entries,fill,stroke);};
  add('BeginPath',1,id=>{dc(id).path={state:'open',entries:[]};return 1;});
  add('EndPath',1,id=>{const s=dc(id);if(s.path?.state!=='open')throw new Win32Error('No open path',1003);s.path={...s.path,state:'closed'};return 1;});
  add('AbortPath',1,id=>{dc(id).path=null;return 1;});
  add('CloseFigure',1,id=>{const s=dc(id);if(s.path?.state!=='open')throw new Win32Error('No open path',1003);const entries=s.path.entries;if(entries.length)s.path={state:'open',entries:[...entries.slice(0,-1),{...entries.at(-1),type:entries.at(-1).type|1}]};return 1;});
  add('FlattenPath',1,id=>{const s=dc(id),p=path(s);s.path={state:'closed',entries:flatten(p.entries)};return 1;});
  add('WidenPath',1,id=>{const s=dc(id),r=strokeShape(s,path(s).entries),entries=[];for(const [l,t,right,b]of regions.rectangles(r))entries.push({point:[l,t],type:6},{point:[right,t],type:2},{point:[right,b],type:2},{point:[l,b],type:3});if(entries.length>max)throw new Win32Error('Widened path quota exceeded',8);s.path={state:'closed',entries};return 1;});
  add('GetPath',4,(id,p,types,n)=>{const s=dc(id),entries=path(s).entries;n=integer(n,0,max);if(!n)return entries.length;if(n<entries.length)throw new Win32Error('Path output buffer too small');const pts=m.view(p,entries.length*8),flags=m.bytes(types,entries.length),back=inverse(mapping(s)),result=entries.map(e=>mapPoint(back,...e.point).map(Math.round));result.forEach(([x,y],i)=>{pts.setInt32(i*8,x,true);pts.setInt32(i*8+4,y,true);flags[i]=entries[i].type;});return entries.length;},{failure:-1});
  add('PathToRegion',1,id=>{const s=dc(id),r=shape(s,path(s).entries),handle=h.add('region',{shape:r});s.path=null;return handle;});
  add('SelectClipPath',2,(id,mode)=>{mode=integer(mode,1,5);const s=dc(id),r=shape(s,path(s).entries),next=mode===5?r:regions.combine(s.clip||regions.rectangle(...bitmaps.bounds(s)),r,mode);s.clip=next;s.path=null;return 1;});
  for(const [name,fill,stroke]of [['FillPath',true,false],['StrokePath',false,true],['StrokeAndFillPath',true,true]])add(name,1,id=>{const s=dc(id),entries=path(s).entries;const result=render(s,entries,fill,stroke);s.path=null;return result;});
  wrap('MoveToEx',(old,id,x,y,p)=>{const s=dc(id),entry={point:device(s,x,y),type:6};if(s.path?.state==='open'&&s.path.entries.length>=max)throw new Win32Error('Path quota exceeded',8);const result=old(id,x,y,p);if(s.path?.state==='open')append(s,[entry]);return result;});
  wrap('LineTo',(old,id,x,y)=>{const s=dc(id);if(s.path?.state!=='open')return old(id,x,y);const entries=[];if(!last(s)||last(s).type&1)entries.push({point:device(s,s.x,s.y),type:6});entries.push({point:device(s,x,y),type:2});append(s,entries);[s.x,s.y]=checked(x,y);return 1;});
  for(const name of ['Rectangle','Ellipse'])wrap(name,(old,id,l,t,r,b)=>{const s=dc(id);if(s.path?.state!=='open')return old(id,l,t,r,b);let p;
    if(name==='Rectangle')p=[[l,t],[r,t],[r,b],[l,b]];
    else{[l,t,r,b]=[l,t,r,b].map(n=>integer(n,-0x4000000,0x3ffffff));const n=Math.min(1024,Math.max(16,Math.ceil(Math.PI*Math.sqrt(Math.max(Math.abs(r-l),Math.abs(b-t))))));p=Array.from({length:n},(_,i)=>[(l+r)/2+(r-l)/2*Math.cos(i/n*2*Math.PI),(t+b)/2+(b-t)/2*Math.sin(i/n*2*Math.PI)]).map(p=>p.map(Math.round));}
    append(s,p.map((vertex,i)=>({point:device(s,...vertex),type:i===0?6:i===p.length-1?3:2})));return 1;});
  const poly=(id,polys,closed,bezier=false,to=false)=>{
    const s=dc(id),entries=[];
    for(let p of polys){
      if(to)p=[[s.x,s.y],...p];
      if(bezier&&(p.length-1)%3)throw new Win32Error('Bezier points must be 1+3n');
      const continuing=to&&s.path?.state==='open'&&last(s)&&!(last(s).type&1);
      entries.push(...p.map((vertex,i)=>({point:device(s,...vertex),type:i===0?6:(bezier?4:2)|(closed&&i===p.length-1?1:0)})).slice(continuing?1:0));
    }
    const result=submit(s,entries,closed,true);
    if(to)[s.x,s.y]=polys.at(-1).at(-1);
    return result;
  };
  add('Polygon',3,(id,p,n)=>poly(id,[points(p,n)],true));
  add('Polyline',3,(id,p,n)=>poly(id,[points(p,n)],false));
  add('PolylineTo',3,(id,p,n)=>poly(id,[points(p,n,1)],false,false,true));
  add('PolyBezier',3,(id,p,n)=>poly(id,[points(p,n,4)],false,true));
  add('PolyBezierTo',3,(id,p,n)=>poly(id,[points(p,n,3)],false,true,true));
  for(const closed of [false,true])add(closed?'PolyPolygon':'PolyPolyline',4,(id,p,counts,n)=>{n=integer(n,1,max);const v=m.view(counts,n*4),polys=[];let offset=0;for(let i=0;i<n;i++){const count=integer(v.getInt32(i*4,true),2,max);if(offset+count>max)throw new Win32Error('Polygon point quota exceeded',8);polys.push(points(p+offset*8,count));offset+=count;}return poly(id,polys,closed);});
}
