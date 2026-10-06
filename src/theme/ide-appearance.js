/** IDE preference/controller layer. Application palettes are shared; settings and
 * ownership remain independent from the authored project and its runtime. */
import {THEMES, normalizeAppearance as normalizeClassicAppearance} from './theme.js';
import {PLATFORM_THEMES} from './platform-themes.js';
export const OPTIONAL_IDE_THEMES = PLATFORM_THEMES;
const freeze = Object.freeze;
export const IDE_THEMES = freeze({...THEMES,...OPTIONAL_IDE_THEMES});
export const IDE_THEME_ATTRIBUTES = freeze(['data-vb-theme','data-ide-theme','data-ide-theme-family',
  'data-ide-theme-scheme','data-ide-reduce-transparency','data-ide-reduce-motion']);
export function ideThemeId(value) {
  return typeof value === 'string' && Object.hasOwn(IDE_THEMES,value) ? value : 'classic';
}
export function normalizeIdeAppearance(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  return {...normalizeClassicAppearance(value),theme:ideThemeId(value.theme),
    followSystemTheme:value.followSystemTheme===true,reduceTransparency:value.reduceTransparency===true,
    reduceMotion:value.reduceMotion===true};
}
export function resolveIdeTheme(value = {}, prefersDark = false) {
  const a=normalizeIdeAppearance(value),profile=IDE_THEMES[a.theme];
  if (!a.followSystemTheme || !profile.family) return profile;
  const base=profile.id.replace(/-dark$/,'');
  return IDE_THEMES[prefersDark ? base+'-dark' : base];
}
export function copyIdeThemeAttributes(source, target) {
  for (const name of IDE_THEME_ATTRIBUTES) {
    const value=source.getAttribute(name);
    if (value===null) target.removeAttribute(name);
    else if (target.getAttribute(name)!==value) target.setAttribute(name,value);
  }
}
/** O(1) root updates. No per-control observers, layout reads or repaint loop. */
export class IdeThemeController {
  constructor(document) {
    this.document=document;
    this.view=document.defaultView;
    this.appearance=normalizeIdeAppearance();
    this.media=this.view.matchMedia?.('(prefers-color-scheme: dark)');
    this.onScheme=()=>this.apply(this.appearance);
    this.onPageHide=event=>{if(!event.persisted)this.dispose();};
    this.onPageShow=event=>{if(event.persisted)this.apply(this.appearance);};
    this.media?.addEventListener?.('change',this.onScheme);
    this.view.addEventListener('pagehide',this.onPageHide);
    this.view.addEventListener('pageshow',this.onPageShow);
  }
  apply(value) {
    this.appearance=normalizeIdeAppearance(value);
    const profile=resolveIdeTheme(this.appearance,!!this.media?.matches),root=this.document.documentElement;
    // Keep legacy palettes as explicit runtime boundaries. IDE-only selectors
    // override the chrome and portals, never .designer-scroll's application.
    const attributes={
      'data-vb-theme':profile.family?'classic':profile.id,
      'data-ide-theme':profile.id,'data-ide-theme-family':profile.family||'classic',
      'data-ide-theme-scheme':profile.scheme||(profile.id==='contrast'?'dark':'light'),
      'data-ide-reduce-transparency':String(this.appearance.reduceTransparency),
      'data-ide-reduce-motion':String(this.appearance.reduceMotion)
    };
    const legacyChanged=root.getAttribute('data-vb-theme')!==attributes['data-vb-theme'];
    let changed=false;
    for (const [name,next] of Object.entries(attributes)) {
      if (root.getAttribute(name)!==next) {root.setAttribute(name,next);changed=true;}
    }
    if (changed) {
      if (legacyChanged) root.dispatchEvent(new this.view.CustomEvent('vb-theme-change',{bubbles:true,detail:{theme:attributes['data-vb-theme']}}));
      root.dispatchEvent(new this.view.CustomEvent('vb-ide-theme-change',{bubbles:true,detail:{theme:profile.id,requestedTheme:this.appearance.theme}}));
    }
    return profile;
  }
  dispose() {
    this.media?.removeEventListener?.('change',this.onScheme);
    this.view.removeEventListener('pagehide',this.onPageHide);
    this.view.removeEventListener('pageshow',this.onPageShow);
  }
}
