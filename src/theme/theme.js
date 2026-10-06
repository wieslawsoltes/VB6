import {PLATFORM_THEMES,canonicalPlatformThemeId} from './platform-themes.js';
/** Theme data is shared by DOM controls, canvas/WebGPU drawing and the exporter.
 * Values are RGB, not OLE BGR. No proprietary font or artwork is embedded.
 */
const classic = {
  face:'#c0c0c0', light:'#ffffff', highlight:'#dfdfdf', shadow:'#808080', dark:'#000000',
  text:'#000000', title:'#000080', titleEnd:'#000080', titleText:'#ffffff',
  inactive:'#808080', inactiveEnd:'#808080', inactiveText:'#c0c0c0',
  window:'#ffffff', windowText:'#000000', selection:'#000080', selectionText:'#ffffff',
  workspace:'#808080', desktop:'#008080', gray:'#808080', info:'#ffffe1', infoText:'#000000',
  link:'#0000ff', keyword:'#000080', comment:'#008000', breakpoint:'#800000', execution:'#ffff00'
};
const profile = (id, name, colors) => Object.freeze({id, name, colors:Object.freeze(colors)});
export const CLASSIC_THEMES = Object.freeze({
  classic:profile('classic','Windows Classic',classic),
  standard:profile('standard','Windows Standard (2000)',{...classic,face:'#d4d0c8',highlight:'#e9e7e3',dark:'#404040',title:'#0a246a',titleEnd:'#a6caf0',inactiveEnd:'#c0c0c0',selection:'#0a246a'}),
  contrast:profile('contrast','High Contrast Black',{...classic,face:'#000000',light:'#ffffff',highlight:'#ffffff',shadow:'#c0c0c0',dark:'#ffffff',text:'#ffffff',inactive:'#000000',inactiveEnd:'#000000',inactiveText:'#ffffff',window:'#000000',windowText:'#ffffff',selection:'#800080',selectionText:'#ffffff',workspace:'#000000',desktop:'#000000',gray:'#00ff00',info:'#000000',infoText:'#ffffff',link:'#ffff00',keyword:'#00ffff',comment:'#00ff00',breakpoint:'#ff0000'})
});
export const THEMES = Object.freeze({...CLASSIC_THEMES,...PLATFORM_THEMES});
// Win32 GetSysColor indices. Reserved index 25 falls back to the button face.
export const SYSTEM_ROLES = Object.freeze(['face','desktop','title','inactive','face','window','dark','text','windowText','titleText','face','face','workspace','selection','selectionText','face','shadow','gray','text','inactiveText','light','dark','highlight','infoText','info','face','link','titleEnd','inactiveEnd','selection','face']);
export const SYSTEM_COLOR_NAMES = Object.freeze(['Scroll Bars','Desktop','Active Title Bar','Inactive Title Bar','Menu Bar','Window Background','Window Frame','Menu Text','Window Text','Title Bar Text','Active Border','Inactive Border','Application Workspace','Highlight','Highlight Text','Button Face','Button Shadow','Gray Text','Button Text','Inactive Caption Text','3D Highlight','3D Dark Shadow','3D Light','Info Text','Info Background']);
export function themeId(id) { id=canonicalPlatformThemeId(id);return typeof id==='string' && Object.hasOwn(THEMES,id) ? id : 'classic'; }
export function getTheme(element) {
  return THEMES[themeId(typeof element === 'string' ? element : element?.closest?.('[data-vb-theme]')?.dataset.vbTheme || element?.ownerDocument?.documentElement?.dataset.vbTheme)];
}
export function applyTheme(element, id) {
  const value=themeId(id),profile=THEMES[value];
  const attributes={'data-vb-theme':value,'data-vb-theme-family':profile.family||'classic',
    'data-vb-theme-scheme':profile.scheme||(value==='contrast'?'dark':'light')};
  let changed=false;
  for(const [name,next] of Object.entries(attributes))if(element.getAttribute(name)!==next){element.setAttribute(name,next);changed=true;}
  if(changed){const EventClass=element.ownerDocument?.defaultView?.CustomEvent||CustomEvent;
    element.dispatchEvent(new EventClass('vb-theme-change',{bubbles:true,detail:{theme:value}}));}
  return value;
}
export function colorValue(value, fallback='#c0c0c0', theme='classic') {
  if(typeof value==='string' && /^(#[\da-f]{3,8}|rgba?\(|hsla?\()/i.test(value))return value;
  const n=Number(value);if(!Number.isFinite(n))return fallback;
  const bits=n>>>0;
  if(bits & 0x80000000) return (THEMES[themeId(theme)].colors[SYSTEM_ROLES[bits&0xff]]) || fallback;
  return '#'+[bits&255,(bits>>>8)&255,(bits>>>16)&255].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function cssColor(value,fallback='#c0c0c0') {
  const bits=Number(value)>>>0;
  return Number.isFinite(Number(value)) && bits&0x80000000 && SYSTEM_ROLES[bits&255]
    ? `var(--vb-sys-${bits&255}, ${colorValue(value,fallback)})` : colorValue(value,fallback);
}
export function fontFamily(name='MS Sans Serif') {
  if(/^MS Sans Serif$/i.test(name))return '"MS Sans Serif", Tahoma, Arial, sans-serif';
  if(/^MS Serif$/i.test(name))return '"MS Serif", "Times New Roman", serif';
  // A quoted family cannot escape the declaration or turn into a URL.
  return '"'+String(name).replace(/["\\\n\r]/g,'')+'", Tahoma, Arial, sans-serif';
}
export const DEFAULT_APPEARANCE = Object.freeze({theme:'classic',windowMode:'hybrid',documentTabs:false,debugTabs:false,editorFont:'Courier New',editorSize:13,tooltips:true,procedureSeparators:true,autoIndent:true,autoListMembers:true,autoQuickInfo:true,autoDataTips:true,fullModule:true,margin:true,dragText:true,autoSyntaxCheck:true,requireVariableDeclaration:true,notifyStateLoss:false,largeToolbarIcons:false});
export function normalizeAppearance(value={}) {
  return {...DEFAULT_APPEARANCE,windowMode:value.windowMode==='mdi'?'mdi':'hybrid',autoSyntaxCheck:value.autoSyntaxCheck!==false,requireVariableDeclaration:value.requireVariableDeclaration!==false,notifyStateLoss:value.notifyStateLoss===true,largeToolbarIcons:value.largeToolbarIcons===true,autoQuickInfo:value.autoQuickInfo!==false,autoDataTips:value.autoDataTips!==false,fullModule:value.fullModule!==false,margin:value.margin!==false,dragText:value.dragText!==false,codeColors:Object.fromEntries(Object.entries(value.codeColors||{}).filter(([key,color])=>['text','background','keyword','comment','selection','selectionText','breakpoint','execution'].includes(key)&&/^#[0-9a-f]{6}$/i.test(color))),theme:themeId(value.theme),documentTabs:value.documentTabs===true,debugTabs:value.debugTabs===true,editorFont:['Courier New','Consolas','monospace'].includes(value.editorFont)?value.editorFont:'Courier New',editorSize:[11,12,13,14,16,18,20].includes(Number(value.editorSize))?Number(value.editorSize):13,tooltips:value.tooltips!==false,procedureSeparators:value.procedureSeparators!==false,autoIndent:value.autoIndent!==false,autoListMembers:value.autoListMembers!==false};
}
