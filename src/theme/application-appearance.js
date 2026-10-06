/** Project-owned application appearance. One listener per host/designer, no
 * DOM rebuild, external resources, per-control observers or implicit persistence. */
import {THEMES,themeId,applyTheme} from './theme.js';
export const APPLICATION_THEME_ATTRIBUTES=Object.freeze(['data-vb-theme','data-vb-theme-family',
  'data-vb-theme-scheme','data-vb-reduce-transparency','data-vb-reduce-motion']);
export function normalizeApplicationAppearance(value={}) {
  if(!value||typeof value!=='object'||Array.isArray(value))value={};
  const options=value.themeOptions&&typeof value.themeOptions==='object'&&!Array.isArray(value.themeOptions)?value.themeOptions:{};
  return {theme:themeId(value.theme),themeOptions:{followSystemTheme:options.followSystemTheme===true,
    reduceTransparency:options.reduceTransparency===true,reduceMotion:options.reduceMotion===true}};
}
export function resolveApplicationTheme(value={},prefersDark=false) {
  const a=normalizeApplicationAppearance(value),profile=THEMES[a.theme];
  if(!profile.family||!a.themeOptions.followSystemTheme)return profile;
  return THEMES[a.theme.replace(/-dark$/,'')+(prefersDark?'-dark':'')];
}
export function copyApplicationTheme(source,target) {
  for(const name of APPLICATION_THEME_ATTRIBUTES){const value=source.getAttribute(name);
    if(value===null)target.removeAttribute(name);else if(target.getAttribute(name)!==value)target.setAttribute(name,value);}
}
/** Transient body-mounted portals keep their opener's local appearance, even
 * when two applications in one document use different palettes. Release on close. */
export function bindApplicationTheme(source,target) {
  const origin=source?.closest?.('[data-vb-theme]')||source?.ownerDocument?.documentElement;
  if(!origin)return ()=>{};
  const update=()=>copyApplicationTheme(origin,target);
  update();origin.addEventListener('vb-theme-change',update);
  return ()=>origin.removeEventListener('vb-theme-change',update);
}
export class ApplicationThemeController {
  constructor(root,{onChange=()=>{}}={}) {
    this.root=root;this.view=root.ownerDocument?.defaultView;this.onChange=onChange;
    this.appearance=normalizeApplicationAppearance();this.disposed=false;
    this.media=this.view?.matchMedia?.('(prefers-color-scheme: dark)');
    this.onScheme=()=>this.apply(this.appearance);
    this.onPageShow=e=>{if(e.persisted)this.apply(this.appearance);};
    this.onPageHide=e=>{if(!e.persisted)this.dispose();};
    this.media?.addEventListener?.('change',this.onScheme);
    this.view?.addEventListener?.('pageshow',this.onPageShow);
    this.view?.addEventListener?.('pagehide',this.onPageHide);
  }
  apply(value) {
    if(this.disposed)return THEMES[themeId(this.root.getAttribute('data-vb-theme'))];
    this.appearance=normalizeApplicationAppearance(value);
    const profile=resolveApplicationTheme(this.appearance,!!this.media?.matches);
    let optionsChanged=false;
    for(const [key,name] of [['reduceTransparency','data-vb-reduce-transparency'],['reduceMotion','data-vb-reduce-motion']]){
      const next=String(this.appearance.themeOptions[key]);
      if(this.root.getAttribute(name)!==next){this.root.setAttribute(name,next);optionsChanged=true;}
    }
    const previous=this.root.getAttribute('data-vb-theme');applyTheme(this.root,profile.id);
    if(optionsChanged&&previous===profile.id){const EventClass=this.view?.CustomEvent||CustomEvent;
      this.root.dispatchEvent(new EventClass('vb-theme-change',{bubbles:true,detail:{theme:profile.id}}));}
    if(previous!==profile.id||optionsChanged)this.onChange(profile,this.appearance);
    return profile;
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;
    this.media?.removeEventListener?.('change',this.onScheme);
    this.view?.removeEventListener?.('pageshow',this.onPageShow);
    this.view?.removeEventListener?.('pagehide',this.onPageHide);
  }
}
