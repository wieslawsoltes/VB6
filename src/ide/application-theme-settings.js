/** Project-owned appearance editor. Preview is isolated and never edits the
 * live project, starts a VM, mutates undo or changes the IDE's appearance. */
import {el} from '../core/core.js';
import {icon} from '../theme/icons.js';
import {THEMES} from '../theme/theme.js';
import {ApplicationThemeController,normalizeApplicationAppearance} from '../theme/application-appearance.js';
export function createApplicationThemeSettings(settings) {
  const value=normalizeApplicationAppearance(settings);
  const select=el('select',{'aria-label':'Application theme'},...Object.values(THEMES).map(t=>el('option',{value:t.id},t.name)));select.value=value.theme;
  const toggle=(key,label)=>{const input=el('input',{type:'checkbox','aria-label':label,checked:value.themeOptions[key]});return {input,node:el('label',{class:'option-check'},input,label)};};
  const system=toggle('followSystemTheme','Application: follow system light/dark appearance'),transparency=toggle('reduceTransparency','Application: reduce transparency'),motion=toggle('reduceMotion','Application: reduce motion');
  const captions=toggle('systemCaption','Application: use operating-system captions in desktop exports');
  const preferences=el('div',{class:'application-theme-preferences'},system.node,transparency.node,motion.node,captions.node);
  const preview=el('div',{class:'application-theme-preview',inert:true,'aria-label':'Application theme preview'});
  const frame=el('div',{class:'vb-dialog',style:{position:'relative',margin:0,width:'100%',minWidth:0,maxWidth:'100%',padding:'2px'}});
  frame.append(el('div',{class:'vb-form-title'},icon('form',12),el('span',{class:'caption'},'Application preview'),el('button',{class:'vb-window-button',type:'button',tabindex:-1,'data-caption-action':'close','aria-label':'Close'},icon('close',12))));
  const body=el('div',{class:'application-theme-sample',style:{display:'flex',flexWrap:'wrap',gap:'8px',padding:'9px',alignItems:'center'}});
  body.append(el('button',{class:'vb-command',type:'button',tabindex:-1,style:{position:'relative',height:'24px'}},icon('save',12),' Save'),
    el('label',{class:'vb-check'},el('input',{type:'checkbox',checked:true,tabindex:-1}),'Enabled'),
    el('label',{class:'vb-check'},el('input',{type:'radio',checked:true,tabindex:-1}),'Choice'),
    el('div',{class:'vb-progress',style:{width:'75px',height:'16px'}},el('div',{class:'vb-progress-fill',style:{width:'62%'}})));
  frame.append(body);preview.append(frame);
  const controller=new ApplicationThemeController(preview),current=()=>({theme:select.value,themeOptions:{followSystemTheme:system.input.checked,reduceTransparency:transparency.input.checked,reduceMotion:motion.input.checked,...(captions.input.checked?{systemCaption:true}:{})}});
  const paint=()=>{const t=THEMES[select.value]||THEMES.classic;system.input.disabled=!t.family;transparency.input.disabled=t.family!=='macos26';motion.input.disabled=!t.family;controller.apply(current());};
  for(const input of [select,system.input,transparency.input,motion.input,captions.input])input.addEventListener('change',paint);paint();
  const note=el('p',{class:'application-theme-note'},'Saved with this project and embedded in HTML/Electron exports. Authored RGB colors, fonts, images and layout are preserved. Desktop captions match the application by default. The OS-caption option applies when a desktop window opens; existing windows are not recreated. Native file dialogs and Win32 controls remain system-managed.');
  return {select,preferences,preview,note,value:current,dispose:()=>controller.dispose()};
}
