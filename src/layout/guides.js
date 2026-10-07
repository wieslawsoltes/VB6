/** Pure canvas-guide geometry. Build once per gesture; queries binary-search the
 * sorted x/y feature arrays rather than scanning every control on each move. */
const ends=(r,axis)=>axis==='x'?[r.x,r.x+r.width/2,r.x+r.width]:[r.y,r.y+r.height/2,r.y+r.height];
const lower=(a,value)=>{let l=0,h=a.length;while(l<h){const m=(l+h)>>>1;if(a[m].value<value)l=m+1;else h=m;}return l;};
export function unionBounds(rects){if(!rects.length)return null;let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;for(const r of rects){x=Math.min(x,r.x);y=Math.min(y,r.y);right=Math.max(right,r.x+r.width);bottom=Math.max(bottom,r.y+r.height);}return {x,y,width:right-x,height:bottom-y};}
export class GuideIndex {
  constructor(rects,{exclude=[],parent=null}={}){const skip=new Set(exclude);this.rects=rects.filter(r=>!skip.has(r.id));this.features={x:[],y:[]};for(const rect of [...this.rects,...parent?[{...parent,id:null}]:[]])for(const axis of ['x','y'])for(const value of ends(rect,axis))this.features[axis].push({value,rect});for(const axis of ['x','y'])this.features[axis].sort((a,b)=>a.value-b.value);this.spacing={x:spacingFeatures(this.rects,'x'),y:spacingFeatures(this.rects,'y')};this.sizes={x:this.rects.map(rect=>({value:rect.width,rect})).sort((a,b)=>a.value-b.value),y:this.rects.map(rect=>({value:rect.height,rect})).sort((a,b)=>a.value-b.value)};}
  snap(rect,tolerance=6,{x=true,y=true,xEdges=[0,1,2],yEdges=[0,1,2],resize=''}={}){
    const out={dx:0,dy:0,guides:[]};for(const axis of ['x','y']){if(!(axis==='x'?x:y))continue;let best=null;const sorted=this.features[axis];for(const edge of axis==='x'?xEdges:yEdges){const value=ends(rect,axis)[edge];const at=lower(sorted,value);for(const j of [at-1,at]){const f=sorted[j];if(!f)continue;const delta=f.value-value;if(Math.abs(delta)<=tolerance&&(!best||Math.abs(delta)<Math.abs(best.delta)))best={delta,f};}}
      if(best){out[axis==='x'?'dx':'dy']=best.delta;const other=best.f.rect;out.guides.push(axis==='x'?{kind:'align',x1:best.f.value,x2:best.f.value,y1:Math.min(rect.y,other.y),y2:Math.max(rect.y+rect.height,other.y+other.height)}:{kind:'align',y1:best.f.value,y2:best.f.value,x1:Math.min(rect.x,other.x),x2:Math.max(rect.x+rect.width,other.x+other.width)});}}
    return extraSnap(this,rect,tolerance,{x,y,resize},out);
  }
}

export function distanceGuides(a,b){
  const result=[],midX=Math.max(a.x,b.x)+(Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x))/2,midY=Math.max(a.y,b.y)+(Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y))/2;
  if(a.x+a.width<=b.x||b.x+b.width<=a.x){const left=a.x<b.x?a:b,right=left===a?b:a;result.push({kind:'distance',x1:left.x+left.width,x2:right.x,y1:midY,y2:midY,value:right.x-left.x-left.width});}
  else for(const [x1,x2]of [[a.x,b.x],[a.x+a.width,b.x+b.width]])if(x1!==x2)result.push({kind:'distance',x1,x2,y1:midY,y2:midY,value:Math.abs(x2-x1)});
  if(a.y+a.height<=b.y||b.y+b.height<=a.y){const top=a.y<b.y?a:b,bottom=top===a?b:a;result.push({kind:'distance',y1:top.y+top.height,y2:bottom.y,x1:midX,x2:midX,value:bottom.y-top.y-top.height});}
  else for(const [y1,y2]of [[a.y,b.y],[a.y+a.height,b.y+b.height]])if(y1!==y2)result.push({kind:'distance',y1,y2,x1:midX,x2:midX,value:Math.abs(y2-y1)});
  return result;
}
/** Line-aware insertion for horizontal/vertical stacks, wraps, and row-major grid. */
export function insertionGuide(rects,point,mode,parent){
  if(!rects.length)return {index:0,guide:{kind:'insert',x1:parent.x+4,x2:parent.x+4,y1:parent.y+4,y2:parent.y+Math.max(12,parent.height-4)}};
  const vertical=mode===2||mode===4,wrap=mode===3||mode===4||mode===5;
  let at=rects.length;
  if(!wrap)at=rects.findIndex(r=>vertical?point.y<r.y+r.height/2:point.x<r.x+r.width/2);
  else{let best=Infinity;for(let i=0;i<rects.length;i++){const r=rects[i],near=vertical?Math.max(r.x-point.x,0,point.x-r.x-r.width):Math.max(r.y-point.y,0,point.y-r.y-r.height);const distance=near*100000+(vertical?Math.abs(point.y-r.y-r.height/2):Math.abs(point.x-r.x-r.width/2));if(distance<best){best=distance;at=i+(vertical?point.y>=r.y+r.height/2:point.x>=r.x+r.width/2?1:0);}}}
  if(at<0)at=rects.length;const r=rects[Math.min(at,rects.length-1)],after=at===rects.length;
  return {index:at,guide:vertical?{kind:'insert',x1:r.x,x2:r.x+r.width,y1:r.y+(after?r.height:0),y2:r.y+(after?r.height:0)}:{kind:'insert',y1:r.y,y2:r.y+r.height,x1:r.x+(after?r.width:0),x2:r.x+(after?r.width:0)}};
}
/** Gap handles cover consecutive controls on a common visual line. */
export function gapRegions(rects,mode){const vertical=mode===2||mode===4,result=[];for(let i=1;i<rects.length;i++){const a=rects[i-1],b=rects[i];if(vertical){if(Math.min(a.x+a.width,b.x+b.width)<=Math.max(a.x,b.x))continue;const gap=b.y-a.y-a.height;result.push({x:Math.max(a.x,b.x),y:a.y+a.height,width:Math.max(8,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x)),height:Math.max(4,gap),value:gap,axis:'y'});}else{if(Math.min(a.y+a.height,b.y+b.height)<=Math.max(a.y,b.y))continue;const gap=b.x-a.x-a.width;result.push({x:a.x+a.width,y:Math.max(a.y,b.y),width:Math.max(4,gap),height:Math.max(8,Math.min(a.y+a.height,b.y+b.height)-Math.max(a.y,b.y)),value:gap,axis:'x'});}}return result;}

function spacingFeatures(rects,axis){
  const groups=new Map(),other=axis==='x'?'y':'x',size=axis==='x'?'width':'height',seen=new Set(),features=[[],[],[]],indices=new Map(rects.map((r,i)=>[r,i]));
  for(const r of rects)for(const edge of ends(r,other)){const key=Math.round(edge*1e6);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
  for(const row of groups.values()){
    row.sort((a,b)=>a[axis]-b[axis]);
    for(let i=1;i<row.length;i++){const a=row[i-1],b=row[i],key=indices.get(a)+':'+indices.get(b),gap=b[axis]-a[axis]-a[size];if(gap<0||seen.has(key)||a===b)continue;seen.add(key);
      const common={a,b,gap};features[0].push({value:b[axis]+b[size]+gap,...common});features[1].push({value:(a[axis]+a[size]+b[axis])/2,...common});features[2].push({value:a[axis]-gap,...common});
    }
  }
  for(const list of features)list.sort((a,b)=>a.value-b.value);return features;
}
function gapLine(a,b,axis){const horizontal=axis==='x';return horizontal?{kind:'equal-gap',x1:a.x+a.width,x2:b.x,y1:(a.y+b.y+Math.min(a.height,b.height))/2,y2:(a.y+b.y+Math.min(a.height,b.height))/2,value:b.x-a.x-a.width}:{kind:'equal-gap',y1:a.y+a.height,y2:b.y,x1:(a.x+b.x+Math.min(a.width,b.width))/2,x2:(a.x+b.x+Math.min(a.width,b.width))/2,value:b.y-a.y-a.height};}
function extraSnap(index,rect,tolerance,{x,y,resize},out){
  for(const axis of ['x','y']){
    if(!(axis==='x'?x:y))continue;const key=axis==='x'?'dx':'dy',size=axis==='x'?'width':'height',other=axis==='x'?'y':'x',cross=axis==='x'?'height':'width';
    const aligned=out.guides.some(g=>g.kind==='align'&&(axis==='x'?g.x1===g.x2:g.y1===g.y2));let best=aligned?Math.abs(out[key]):tolerance+1,candidate=null;
    if(resize){const list=index.sizes[axis],at=lower(list,rect[size]);for(const i of [at-1,at]){const f=list[i];if(!f)continue;const delta=(f.value-rect[size])*(resize.includes(axis==='x'?'w':'n')?-1:1);if(Math.abs(delta)<best&&Math.abs(delta)<=tolerance){best=Math.abs(delta);candidate={delta,size:f};}}}
    else for(let edge=0;edge<3;edge++){
      const list=index.spacing[axis][edge],value=ends(rect,axis)[edge];let at=lower(list,value-tolerance),visited=0;
      // Bound coincident rows: the index avoids unbounded pointer-time scans.
      for(;at<list.length&&list[at].value<=value+tolerance&&visited<64;at++,visited++){
        const f=list[at],delta=f.value-value;if(Math.abs(delta)>=best)continue;
        if(Math.max(rect[other],f.a[other],f.b[other])>=Math.min(rect[other]+rect[cross],f.a[other]+f.a[cross],f.b[other]+f.b[cross]))continue;
        if(edge===1&&f.b[axis]-f.a[axis]-f.a[size]<rect[size])continue;
        best=Math.abs(delta);candidate={delta,f,edge};
      }
    }
    if(!candidate)continue;out[key]=candidate.delta;out.guides=out.guides.filter(g=>g.kind!=='align'||(axis==='x'?g.x1!==g.x2:g.y1!==g.y2));
    if(candidate.size){const r=candidate.size.rect;out.guides.push(axis==='x'?{kind:'size',x1:r.x,x2:r.x+r.width,y1:r.y+r.height+60,y2:r.y+r.height+60,value:r.width}:{kind:'size',y1:r.y,y2:r.y+r.height,x1:r.x+r.width+60,x2:r.x+r.width+60,value:r.height});}
    else{const f=candidate.f,moved={...rect,[axis]:rect[axis]+candidate.delta};if(candidate.edge===1)out.guides.push(gapLine(f.a,moved,axis),gapLine(moved,f.b,axis));else out.guides.push(gapLine(f.a,f.b,axis),candidate.edge===0?gapLine(f.b,moved,axis):gapLine(moved,f.a,axis));}
  }
  return out;
}
