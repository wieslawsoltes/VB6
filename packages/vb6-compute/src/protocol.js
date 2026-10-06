/** Versioned, host-shareable compute ABI. All state cells occupy one u32 word. */
export const COMPUTE_ABI = 2;
export const STATE_HEADER_WORDS = 6; // error, line, steps, draw count, procedure id, reserved
export const ARRAY_HEADER_WORDS = 16; // rank, length, four bound/stride triples, capacity, flags/locks
export const COMMAND_WORDS = 40;
export const MAX_CURVE_EDGES = 32;
export const BUFFER_USAGE = Object.freeze({ MAP_READ:1, COPY_SRC:4, COPY_DST:8, UNIFORM:64, STORAGE:128, INDIRECT:256, QUERY_RESOLVE:512 });
export const TEXTURE_USAGE = Object.freeze({ COPY_SRC:1, COPY_DST:2, TEXTURE_BINDING:4, STORAGE_BINDING:8, RENDER_ATTACHMENT:16 });
export const COMMAND_WGSL = `
struct DrawCommand {
  tags: vec4<u32>,
  a: vec4<f32>,
  b: vec4<f32>,
  color: vec4<f32>,
  color2: vec4<f32>,
  paint: vec4<f32>,
  matrix: vec4<f32>,
  offset: vec4<f32>,
  clip: vec4<f32>,
  bounds: vec4<f32>,
}
`;
export class ComputeError extends Error {
  constructor(message, code='GPU0001', details={}) {
    super(message); this.name='ComputeError'; this.code=code; Object.assign(this,details);
  }
}
export function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new ComputeError(`${name} must be an integer from ${min} to ${max}`, 'GPU_LIMIT');
  return value;
}
export function finite(value, name='value') {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value)))
    throw new ComputeError(`${name} must be a finite f32 number`, 'GPU_VALUE');
  return value;
}
export function shaderLiteral(value,type='long') {
  if(type==='single') {
    const n=Math.fround(finite(value));
    return `${Object.is(n,-0)?'-0.0':Number.isInteger(n)&&Math.abs(n)<1e21?n+'.0':String(n)}f`;
  }
  if(type==='boolean')return value ? '-1i' : '0i';
  integer(value,'integer literal',-2147483648,2147483647);
  return value===-2147483648?'(-2147483647i - 1i)':`${value}i`;
}
