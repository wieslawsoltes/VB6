/** Image filtering operates on premultiplied texels to avoid transparent fringes. */
export const IMAGE_WGSL=`
@group(0) @binding(7) var<storage,read> image_data:array<u32>;
fn image_texel(c:DrawCommand,position:vec2<i32>)->vec4<f32> {
  let lo=vec2<i32>(c.paint.xy);let hi=vec2<i32>(c.paint.xy+c.paint.zw)-vec2<i32>(1);
  let p=clamp(position,lo,hi);
  let packed=image_data[c.tags.z+u32(p.y)*c.tags.w+u32(p.x)];
  var rgba=vec4<f32>(f32(packed&255u),f32((packed>>8u)&255u),f32((packed>>16u)&255u),f32(packed>>24u))/255.0;
  if(c.b.w==0.0) {rgba=vec4<f32>(rgba.rgb*rgba.a,rgba.a);}
  return rgba;
}
fn image_paint(c:DrawCommand,q:vec2<f32>)->vec4<f32> {
  let position=c.paint.xy+(q-c.a.xy)/(c.a.zw-c.a.xy)*c.paint.zw-vec2<f32>(0.5);
  if(c.b.z==0.0) {return image_texel(c,vec2<i32>(floor(position+vec2<f32>(0.5))))*c.color.a;}
  let low=floor(position);let weight=position-low;let p=vec2<i32>(low);
  let a=mix(image_texel(c,p),image_texel(c,p+vec2<i32>(1,0)),weight.x);
  let b=mix(image_texel(c,p+vec2<i32>(0,1)),image_texel(c,p+vec2<i32>(1,1)),weight.x);
  return mix(a,b,weight.y)*c.color.a;
}
`;
