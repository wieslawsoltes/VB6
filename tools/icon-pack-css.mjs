/** Build-time pack selectors and caption masks. No runtime fetch or icon font. */
import {iconPackForTheme,captionPackSVG} from '../src/theme/icon-packs.js';
export function iconPackTokens(theme){
 const pack=iconPackForTheme(theme.id),ids=['classic','fluent','macos26','x11'];
 let css=ids.map(id=>`  --vb-icon-${id}-display: ${pack===id?'inline':'none'};`).join('\n')+'\n';
 css+=`  --vb-modern-icon-display: ${pack==='classic'?'none':'inline-flex'};\n`;
 css+=`  --vb-pack-ink: currentColor; --vb-pack-fill: currentColor;\n`;
 for(const name of ['close','maximize','minimize','restore','detach','help']){
  // initial restores the inherited legacy mask via the CSS fallback, even
  // when an authored classic application is embedded inside a modern IDE.
  const image=pack==='classic'?'initial':`url("data:image/svg+xml,${encodeURIComponent(captionPackSVG(name,pack))}")`;
  css+=`  --vb-pack-caption-${name}: ${image};\n`;
 }
 return css;
}
