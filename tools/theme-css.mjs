import {iconPackTokens} from './icon-pack-css.mjs';
/** Generates only palette declarations; no font assets are read or distributed. */
import fs from 'node:fs';
import {ICON_PALETTE} from '../src/theme/icon-art.js';
import {THEMES,SYSTEM_ROLES} from '../src/theme/theme.js';
const kebab = key=>key.replace(/[A-Z]/g,m=>'-'+m.toLowerCase());
let text='/* Generated palette declarations. See tools/theme-css.mjs. */\n';
for(const theme of Object.values(THEMES)){
 text+=(theme.id==='classic'?':root, ':'')+`[data-vb-theme="${theme.id}"] {\n`;
 for(const [name,value] of Object.entries(theme.colors))text+=`  --vb-${kebab(name)}: ${value};\n`;
 // Declare the whole icon palette at every theme boundary (nested runtime themes
 // must reset it); never invert all descendants of a contrast-themed IDE.
 for(const [key,color] of Object.entries(ICON_PALETTE)){
  const contrast={k:'var(--vb-text)',w:'var(--vb-window)',f:'var(--vb-face)',s:'var(--vb-shadow)',d:'var(--vb-dark)',n:'#00ffff',b:'#00ffff',t:'#00ffff',g:'#00ff00',o:'#ffff00',r:'#ff8080',m:'#ff80ff'};
  text+=`  --vb-icon-${key}: ${theme.id==='contrast'?(contrast[key]||color):color};\n`;
 }
 text+=iconPackTokens(theme);
 for(let i=0;i<SYSTEM_ROLES.length;i++)text+=`  --vb-sys-${i}: var(--vb-${kebab(SYSTEM_ROLES[i])});\n`;
 text+=`  --vb-app-color-scheme: ${theme.scheme||(theme.id==='contrast'?'dark':'light')};\n`;
 if(theme.family){for(const [name,value] of Object.entries(theme.tokens))text+=`  --vb-app-${kebab(name)}: ${value};\n`;text+=`  color-scheme:${theme.scheme};\n`;}
 text+='}\n';
}
text+=`:root { --vb-font:"MS Sans Serif",Tahoma,Arial,sans-serif; --vb-size:11px; --vb-caption-height:18px; --vb-scrollbar:16px; }
[data-vb-theme] { color:var(--vb-text); color-scheme:light; }
[data-vb-theme="contrast"] { color-scheme:dark; }
.pixel-icon { display:inline-flex; flex:none; align-items:center; justify-content:center; vertical-align:middle; }
.pixel-icon svg { display:block; overflow:hidden; flex:none; }
.pixel-icon { pointer-events:none; }
.pixel-icon .icon-disabled { display:none; }
:is(button:disabled,[aria-disabled="true"]) .pixel-icon .icon-art { display:none; }
:is(button:disabled,[aria-disabled="true"]) .pixel-icon .icon-disabled { display:inline; }

[data-vb-theme="contrast"] .vb-command { text-shadow:none; }
`;
text+=Object.values(THEMES).filter(t=>t.scheme==='dark').map(t=>`[data-vb-theme="${t.id}"]{color-scheme:dark}`).join('\n')+'\n';
fs.writeFileSync(new URL('../src/theme/palette.css',import.meta.url),text);
