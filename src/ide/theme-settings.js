/** Small, inert preview of the selected IDE skin; applying remains transactional. */
import {el} from '../core/core.js';
import {IDE_THEMES,ideThemeId,normalizeIdeAppearance,resolveIdeTheme} from '../theme/ide-appearance.js';
export function createIdeThemeSettings(value) {
  const appearance=normalizeIdeAppearance(value),listeners=new Set();
  const select=el('select',{'aria-label':'IDE theme'},...Object.values(IDE_THEMES).map(theme=>el('option',{value:theme.id},theme.name)));
  select.value=appearance.theme;
  const toggle=(name,label)=>{
    const input=el('input',{type:'checkbox',checked:appearance[name],'aria-label':label});
    return {input,label:el('label',{class:'option-check'},input,label)};
  };
  const system=toggle('followSystemTheme','Follow system light/dark appearance'),
    transparency=toggle('reduceTransparency','Reduce theme transparency'),motion=toggle('reduceMotion','Reduce theme motion');
  const preferences=el('div',{class:'ide-theme-preferences'},system.label,transparency.label,motion.label);
  const caption=el('div',{class:'ide-theme-preview-title'}),code=el('pre',{class:'ide-theme-preview-code'},
    el('span',{class:'ide-theme-preview-comment'},"' Theme preview\n"),el('span',{class:'ide-theme-preview-keyword'},'Public Sub '),'Main()');
  const preview=el('div',{class:'ide-theme-preview',role:'img','aria-label':'IDE theme preview'},caption,
    el('div',{class:'ide-theme-preview-tools'},el('span',{class:'ide-theme-preview-button'},'Command'),el('span',{class:'ide-theme-preview-selected'},'Selected'),el('span',{},'Properties')),
    el('div',{class:'ide-theme-preview-body'},el('div',{class:'ide-theme-preview-tree'},'Project1',el('br'), '  Form1'),code));
  const note=el('p',{class:'ide-theme-note'},'IDE appearance only. Application Theme controls your forms and exports. Operating-system title bars and native browser dialogs remain system-managed.');
  const current=()=>({theme:ideThemeId(select.value),followSystemTheme:system.input.checked,reduceTransparency:transparency.input.checked,reduceMotion:motion.input.checked});
  const paint=()=>{
    const selected=IDE_THEMES[ideThemeId(select.value)],view=select.ownerDocument.defaultView;
    const theme=resolveIdeTheme(current(),!!view.matchMedia?.('(prefers-color-scheme: dark)').matches);
    caption.textContent=theme.name;preview.dataset.previewTheme=theme.id;preview.dataset.vbTheme=theme.family?'classic':theme.id;
    preview.setAttribute('aria-label',theme.name+' IDE theme preview');
    system.input.disabled=!selected.family;transparency.input.disabled=selected.family!=='macos26';motion.input.disabled=!selected.family;
    for (const listener of listeners) listener();
  };
  for (const input of [select,system.input,transparency.input,motion.input]) input.addEventListener('change',paint);
  paint();
  return {select,preferences,preview,note,value:current,onChange:listener=>listeners.add(listener)};
}
