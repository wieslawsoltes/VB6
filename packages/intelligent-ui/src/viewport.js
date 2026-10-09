import {UIError, boundedData, record} from './safety.js';

/** Renderer-independent CSS-pixel viewport. No model access to browser globals. */
export const BREAKPOINTS = Object.freeze({sm:640, md:768, lg:1024, xl:1280});
export const DEFAULT_VIEWPORT = Object.freeze({width:1024, height:768});
export function normalizeViewport(value=DEFAULT_VIEWPORT) {
  const clean=boundedData(value,1024);
  if(!record(clean)||Object.keys(clean).some(key=>!['width','height'].includes(key)))
    throw new UIError('viewport','Viewport accepts only width and height in CSS pixels.');
  const result={};
  for(const key of ['width','height']) {
    const number=clean[key]??DEFAULT_VIEWPORT[key];
    if(typeof number!=='number'||!Number.isFinite(number)||number<0||number>16384)
      throw new UIError('viewport','Viewport dimensions must be finite numbers from 0 to 16,384.');
    result[key]=Math.round(number);
  }
  return Object.freeze(result);
}
export function matchesBreakpoint(viewport,name) {
  if(typeof name!=='string'||!Object.hasOwn(BREAKPOINTS,name))
    throw new UIError('breakpoint','Use sm, md, lg or xl.');
  return viewport.width>=BREAKPOINTS[name];
}
