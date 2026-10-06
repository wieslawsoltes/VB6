import {assertPublicConfiguration} from '../data/common.js';
import {THEMES,themeId} from '../theme/theme.js';
import { compileProject } from '../language/compiler.js';
import { escapeHTML, VERSION } from '../core/core.js';
import { RUNTIME_SOURCE, RUNTIME_CSS } from './runtime-payload.js';
export function jsonForHTML(value){return JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');}
export function exportApplication(project,options={}){
  assertPublicConfiguration(project.dataSources);for(const module of project.modules||[])for(const control of module.form?.controls||[])assertPublicConfiguration(control.properties);
  const compiled=compileProject(project);if(!compiled.valid)throw new Error(compiled.diagnostics.map(d=>`${d.source}:${d.line}: ${d.message}`).join('\n'));
  const settings={persist:options.persist!==false,...options};const selectedTheme=THEMES[themeId(options.theme??project.settings?.theme)];const title=escapeHTML(project.name);const source=RUNTIME_SOURCE.replace(/<\/script/gi,'<\\/script');
  return `<!doctype html>\n<html lang="en" data-vb-theme="${selectedTheme.id}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="generator" content="VB6 Studio Web ${RUNTIME_VERSION}"><meta name="color-scheme" content="${selectedTheme.scheme||(selectedTheme.id==='contrast'?'dark':'light')}"><title>${title}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:var(--vb-desktop)}button,input,select,textarea{font-family:var(--vb-font)}#app{position:fixed;inset:0}${RUNTIME_CSS}</style></head><body><div id="app"></div><script id="vb6-project" type="application/json">${jsonForHTML(project)}</script><script>${source}\nVB6Runtime.mountApplication(JSON.parse(document.getElementById('vb6-project').textContent),document.getElementById('app'),${jsonForHTML(settings)}).then(host=>{globalThis.vb6Application=host;});<\/script></body></html>`;
}
export const RUNTIME_VERSION=VERSION;
