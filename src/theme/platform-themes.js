/** Shared immutable platform palettes. Original browser-rendered artwork and colors;
 * no native toolkit, proprietary font or OS resource dependencies. */
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const light = {
  face:'#f3f3f3',light:'#ffffff',highlight:'#e8e8e8',shadow:'#8a8a8a',dark:'#505050',
  text:'#1a1a1a',title:'#f3f3f3',titleEnd:'#f3f3f3',titleText:'#1a1a1a',
  inactive:'#ededed',inactiveEnd:'#ededed',inactiveText:'#616161',
  window:'#ffffff',windowText:'#1a1a1a',selection:'#0067b8',selectionText:'#ffffff',
  workspace:'#e4e7eb',desktop:'#d9e2ec',gray:'#646464',info:'#ffffff',infoText:'#1a1a1a',
  link:'#005a9e',keyword:'#003e9c',comment:'#256327',breakpoint:'#a4262c',execution:'#ffe58a'
};
const dark = {
  face:'#202020',light:'#545454',highlight:'#383838',shadow:'#8a8a8a',dark:'#b4b4b4',
  text:'#f5f5f5',title:'#282828',titleEnd:'#282828',titleText:'#f5f5f5',
  inactive:'#252525',inactiveEnd:'#252525',inactiveText:'#b4b4b4',
  window:'#191919',windowText:'#f5f5f5',selection:'#80caff',selectionText:'#102331',
  workspace:'#141414',desktop:'#182630',gray:'#ababab',info:'#303030',infoText:'#f5f5f5',
  link:'#80caff',keyword:'#8dc8ff',comment:'#9ccc8a',breakpoint:'#a4262c',execution:'#ffe58a'
};
const lightTokens = {
  font:'"Segoe UI Variable", "Segoe UI", system-ui, sans-serif',size:'12px',radius:'4px',windowRadius:'8px',
  border:'#8a8a8a',separator:'#d6d6d6',control:'#ffffff',hover:'#e5edf5',pressed:'#d4e3ef',focus:'#0067b8',
  surface:'#fafafa',gutter:'#f5f5f5',gutterText:'#626262',error:'#b42318',string:'#8f2424',
  shadow:'0 6px 20px #00000026, 0 1px 3px #00000020',controlShadow:'0 1px 1px #00000012',
  pressedShadow:'inset 0 1px 2px #00000016',material:'#f3f3f3',scrim:'#00000030',
  thumb:'#777777',success:'#256327',warning:'#805200',executionText:'#161616'
};
const darkTokens = {
  ...lightTokens,border:'#888888',separator:'#484848',control:'#303030',hover:'#393f46',pressed:'#414d59',
  focus:'#80caff',surface:'#252525',gutter:'#232323',gutterText:'#b4b4b4',error:'#ffb4ab',string:'#f1ada4',
  shadow:'0 8px 24px #00000066, 0 1px 3px #00000066',controlShadow:'0 1px 1px #00000055',
  pressedShadow:'inset 0 1px 2px #00000055',material:'#202020',scrim:'#00000066',thumb:'#adadad',
  success:'#9ccc8a',warning:'#ffd58a'
};
const profile = (id,name,family,scheme,colors,tokens) => ({id,name,family,scheme,colors,tokens});
export const PLATFORM_THEMES = freeze({
  fluent:profile('fluent','Fluent WinUI 3 — Light','fluent','light',light,lightTokens),
  'fluent-dark':profile('fluent-dark','Fluent WinUI 3 — Dark','fluent','dark',dark,darkTokens),
  macos26:profile('macos26','macOS 26 — Light','macos26','light',{
    ...light,face:'#ececf0',title:'#ececf0',titleEnd:'#ececf0',text:'#1d1d1f',titleText:'#1d1d1f',
    windowText:'#1d1d1f',selection:'#005ec4',workspace:'#dfe1e9',desktop:'#d9ddeb',link:'#0057b8',
    keyword:'#7136a8',comment:'#386738'
  },{...lightTokens,font:'-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',radius:'6px',windowRadius:'12px',
    focus:'#005ec4',surface:'#f7f7fa',hover:'#e0e7f4',pressed:'#ccd9ef',material:'color-mix(in srgb, #ececf0 92%, transparent)',
    controlShadow:'0 1px 2px #0000001f, inset 0 1px #ffffffcc',shadow:'0 12px 32px #20203833, 0 1px 4px #00000026'}),
  'macos26-dark':profile('macos26-dark','macOS 26 — Dark','macos26','dark',{
    ...dark,face:'#2b2b30',title:'#303036',titleEnd:'#303036',window:'#1e1e23',selection:'#8bc2ff',
    selectionText:'#102235',workspace:'#17171c',desktop:'#222535',link:'#91c6ff',keyword:'#dbadff',comment:'#9cd69c'
  },{...darkTokens,font:'-apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',radius:'6px',windowRadius:'12px',
    focus:'#8bc2ff',surface:'#303036',hover:'#41434e',pressed:'#4c5263',material:'color-mix(in srgb, #2b2b30 94%, transparent)',
    controlShadow:'0 1px 2px #00000066, inset 0 1px #ffffff12'}),
  x11:profile('x11','X11 — Light','x11','light',{
    ...light,face:'#bdbdb3',light:'#f2f2e8',highlight:'#d6d6cc',shadow:'#66665c',dark:'#35352d',
    title:'#526872',titleEnd:'#526872',titleText:'#ffffff',inactive:'#a5a59a',inactiveEnd:'#a5a59a',inactiveText:'#292922',
    window:'#fffff4',selection:'#365762',selectionText:'#ffffff',workspace:'#777970',desktop:'#526872',
    gray:'#505047',info:'#ffffdf',link:'#1d477f',keyword:'#233b83',comment:'#285e2d'
  },{...lightTokens,font:'"Liberation Sans", "DejaVu Sans", Arial, sans-serif',size:'11px',radius:'0px',windowRadius:'0px',
    border:'#66665c',separator:'#929287',control:'#bdbdb3',surface:'#bdbdb3',hover:'#cecec4',pressed:'#a6a69c',
    focus:'#233b83',gutter:'#e7e7db',gutterText:'#44443d',thumb:'#bdbdb3',material:'#bdbdb3',shadow:'3px 3px 0 #00000066',
    controlShadow:'inset 1px 1px #f2f2e8, inset -1px -1px #66665c',pressedShadow:'inset 1px 1px #66665c, inset -1px -1px #f2f2e8'}),
  'x11-dark':profile('x11-dark','X11 — Dark','x11','dark',{
    ...dark,face:'#343c3e',light:'#858f90',highlight:'#576265',shadow:'#99a4a6',dark:'#b5bfc0',
    title:'#385861',titleEnd:'#385861',titleText:'#ffffff',inactive:'#343c3e',inactiveEnd:'#343c3e',
    window:'#202729',windowText:'#f4f4e9',selection:'#b6d5dd',selectionText:'#192528',workspace:'#1c2527',desktop:'#273f47'
  },{...darkTokens,font:'"Liberation Sans", "DejaVu Sans", Arial, sans-serif',size:'11px',radius:'0px',windowRadius:'0px',
    border:'#99a4a6',separator:'#5a686b',control:'#343c3e',surface:'#343c3e',hover:'#48575c',pressed:'#263033',
    focus:'#b6d5dd',gutter:'#2d3537',gutterText:'#bcc4c4',thumb:'#75878c',material:'#343c3e',shadow:'3px 3px 0 #00000099',
    controlShadow:'inset 1px 1px #858f90, inset -1px -1px #151d20',pressedShadow:'inset 1px 1px #151d20, inset -1px -1px #858f90'})
});

/** Migrate stored choices without exposing duplicate Linux themes. Never coerce input. */
export const LEGACY_PLATFORM_THEME_IDS = Object.freeze({'x11-cde':'x11','x11-cde-dark':'x11-dark'});
export function canonicalPlatformThemeId(value) {
  return typeof value==='string' && Object.hasOwn(LEGACY_PLATFORM_THEME_IDS,value)
    ? LEGACY_PLATFORM_THEME_IDS[value] : value;
}
