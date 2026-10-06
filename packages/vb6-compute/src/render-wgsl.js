import {COMMAND_WGSL, MAX_CURVE_EDGES} from './protocol.js';
/** Original implementation informed by Vello's coarse/fine compute architecture.
 * Fixed 32-edge curve subdivision and 4-sample AA are explicit quality bounds.
 */
export const RENDER_WGSL = `${COMMAND_WGSL}
struct Config { width:u32,height:u32,total:u32,capacity:u32,stride:u32,lanes:u32,tiles_x:u32,tiles_y:u32,tile_capacity:u32,curve_count:u32,samples:u32,pad:u32 }
struct Curve { a:vec4<f32>,b:vec4<f32>,tags:vec4<u32> }
@group(0) @binding(0) var<storage,read_write> commands:array<DrawCommand>;
@group(0) @binding(1) var<storage,read> states:array<u32>;
@group(0) @binding(2) var<uniform> config:Config;
@group(0) @binding(3) var<storage,read> curves:array<Curve>;
@group(0) @binding(4) var<storage,read_write> edges:array<vec4<f32>>;
@group(0) @binding(5) var<storage,read_write> tiles:array<u32>;
@group(0) @binding(6) var output:texture_storage_2d<rgba8unorm,write>;
const EDGE_COUNT=${MAX_CURVE_EDGES}u;
fn command_active(index:u32)->bool {
  let lane=index/config.capacity;let base=lane*config.stride;
  return lane<config.lanes && states[base]==0u && index%config.capacity<states[base+3u];
}
fn transform(c:DrawCommand,p:vec2<f32>)->vec2<f32> {return vec2<f32>(c.matrix.x*p.x+c.matrix.z*p.y,c.matrix.y*p.x+c.matrix.w*p.y)+c.offset.xy;}
fn local(c:DrawCommand,p:vec2<f32>)->vec2<f32> {
  let q=p-c.offset.xy;let det=c.matrix.x*c.matrix.w-c.matrix.y*c.matrix.z;
  return vec2<f32>(c.matrix.w*q.x-c.matrix.z*q.y,-c.matrix.y*q.x+c.matrix.x*q.y)/det;
}
fn curve_point(c:Curve,t:f32)->vec2<f32> {
  if(c.tags.x==1u) {return mix(c.a.xy,c.a.zw,t);}
  let u=1.0-t;
  if(c.tags.x==2u) {return u*u*c.a.xy+2.0*u*t*c.a.zw+t*t*c.b.xy;}
  return u*u*u*c.a.xy+3.0*u*u*t*c.a.zw+3.0*u*t*t*c.b.xy+t*t*t*c.b.zw;
}
@compute @workgroup_size(64)
fn flatten(@builtin(global_invocation_id) gid:vec3<u32>) {
  let curve=gid.x/EDGE_COUNT;let step=gid.x%EDGE_COUNT;if(curve>=config.curve_count) {return;}
  let c=curves[curve];let t0=f32(step)/f32(EDGE_COUNT);let t1=f32(step+1u)/f32(EDGE_COUNT);
  edges[gid.x]=vec4<f32>(curve_point(c,t0),curve_point(c,t1));
}
@compute @workgroup_size(64)
fn prepare(@builtin(global_invocation_id) gid:vec3<u32>) {
  let index=gid.x;if(index>=config.total || !command_active(index)) {return;}
  var c=commands[index];var box=c.a;
  if(c.tags.x==1u) {commands[index].bounds=c.clip;return;}
  if(c.tags.x==4u) {box=vec4<f32>(c.a.xy-vec2<f32>(c.a.z),c.a.xy+vec2<f32>(c.a.z));}
  let lo=min(box.xy,box.zw);let hi=max(box.xy,box.zw);let pad=select(c.b.x*0.5,0.0,(c.tags.y&1u)!=0u);
  let a=transform(c,lo-vec2<f32>(pad));let b=transform(c,hi+vec2<f32>(pad));
  let d=transform(c,vec2<f32>(lo.x-pad,hi.y+pad));let e=transform(c,vec2<f32>(hi.x+pad,lo.y-pad));
  var bounds=vec4<f32>(max(min(min(a,b),min(d,e)),c.clip.xy),min(max(max(a,b),max(d,e)),c.clip.zw));
  if(abs(c.matrix.x*c.matrix.w-c.matrix.y*c.matrix.z)<1e-20) {bounds=vec4<f32>(0.0);}
  commands[index].bounds=bounds;
}
fn intersects(a:vec4<f32>,b:vec4<f32>)->bool {return all(a.xy<b.zw) && all(b.xy<a.zw) && all(a.xy<a.zw);}
@compute @workgroup_size(64)
fn coarse(@builtin(global_invocation_id) gid:vec3<u32>) {
  let tile=gid.x;if(tile>=config.tiles_x*config.tiles_y) {return;}
  let xy=vec2<f32>(f32(tile%config.tiles_x)*16.0,f32(tile/config.tiles_x)*16.0);
  let bounds=vec4<f32>(xy,xy+vec2<f32>(16.0));let base=tile*(config.tile_capacity+1u);var count=0u;
  for(var i=0u;i<config.total;i+=1u) {
    if(command_active(i) && intersects(commands[i].bounds,bounds)) {
      if(count<config.tile_capacity) {tiles[base+1u+count]=i;}count+=1u;
    }
  }
  // Overflow uses an ordered scan in fine(), never drops geometry.
  tiles[base]=count;
}
fn distance_segment(p:vec2<f32>,a:vec2<f32>,b:vec2<f32>)->f32 {
  let v=b-a;let length2=dot(v,v);if(length2<1e-20) {return length(p-a);}
  return length(p-(a+v*clamp(dot(p-a,v)/length2,0.0,1.0)));
}
fn hit(c:DrawCommand,p:vec2<f32>)->bool {
  if(c.tags.x==1u) {return true;}
  let q=local(c,p);let fill=(c.tags.y&1u)!=0u;let half=c.b.x*0.5;
  if(c.tags.x==2u) {
    let lo=min(c.a.xy,c.a.zw);let hi=max(c.a.xy,c.a.zw);
    if(fill) {return all(q>=lo) && all(q<hi);}
    return all(q>=lo-vec2<f32>(half)) && all(q<hi+vec2<f32>(half)) && !(all(q>=lo+vec2<f32>(half)) && all(q<hi-vec2<f32>(half)));
  }
  if(c.tags.x==3u) {return distance_segment(q,c.a.xy,c.a.zw)<=half;}
  if(c.tags.x==4u) {let dist=length(q-c.a.xy);if(fill) {return dist<c.a.z;}return abs(dist-c.a.z)<=half;}
  if(c.tags.x==5u) {
    var winding=0i;var stroke=false;
    for(var segment=c.tags.z;segment<c.tags.z+c.tags.w;segment+=1u) {
      for(var n=0u;n<EDGE_COUNT;n+=1u) {
        let edge=edges[segment*EDGE_COUNT+n];let a=edge.xy;let b=edge.zw;
        if(!fill && distance_segment(q,a,b)<=half) {stroke=true;}
        if((a.y<=q.y && b.y>q.y) || (b.y<=q.y && a.y>q.y)) {
          let x=a.x+(q.y-a.y)*(b.x-a.x)/(b.y-a.y);
          if(x>q.x) {winding+=select(-1i,1i,b.y>a.y);}
        }
      }
    }
    if(!fill) {return stroke;}if((c.tags.y&2u)!=0u) {return (winding&1i)!=0i;}return winding!=0i;
  }
  return false;
}
fn paint(c:DrawCommand,p:vec2<f32>)->vec4<f32> {
  var color=c.color;
  if(c.offset.z==1.0) {let q=local(c,p);let v=c.paint.zw-c.paint.xy;let denom=dot(v,v);var t=0.0;if(denom>1e-20) {t=clamp(dot(q-c.paint.xy,v)/denom,0.0,1.0);}color=mix(c.color,c.color2,t);}
  return vec4<f32>(color.rgb*color.a,color.a);
}
@compute @workgroup_size(8,8)
fn fine(@builtin(global_invocation_id) gid:vec3<u32>) {
  if(gid.x>=config.width || gid.y>=config.height) {return;}
  let tile=(gid.y/16u)*config.tiles_x+gid.x/16u;let base=tile*(config.tile_capacity+1u);let count=tiles[base];let overflow=count>config.tile_capacity;
  let total=select(count,config.total,overflow);var result=vec4<f32>(0.0);
  for(var sample=0u;sample<config.samples;sample+=1u) {
    var offset=vec2<f32>(0.5);if(config.samples==4u) {offset=vec2<f32>(0.25+f32(sample&1u)*0.5,0.25+f32(sample>>1u)*0.5);}
    let p=vec2<f32>(gid.xy)+offset;var pixel=vec4<f32>(0.0);
    for(var j=0u;j<total;j+=1u) {
      var i=j;if(!overflow) {i=tiles[base+1u+j];}if(!command_active(i)) {continue;}
      let c=commands[i];if(!all(p>=c.bounds.xy) || !all(p<c.bounds.zw) || !hit(c,p)) {continue;}
      let color=paint(c,p);if(c.tags.x==1u) {pixel=color;}else {pixel=color+pixel*(1.0-color.a);}
    }
    result+=pixel;
  }
  textureStore(output,vec2<i32>(gid.xy),result/f32(config.samples));
}
`;
