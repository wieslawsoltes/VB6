/** Browser-hosted CommonDialog editors; native printer/DC/help APIs are separate. */
import {VBError} from '../language/lexer.js';
import {el} from '../core/core.js';
import {cssColor,fontFamily} from '../theme/theme.js';
import {dialogCancelled,dialogFont,dialogColor} from './common-dialog-contract.js';
function host(control){if(control.design||control.disposed||!control.vm?.host?.modal)throw new VBError('CommonDialog requires an active runtime host',5);return control.vm.host;}
export async function showColor(control){
  const h=host(control),initial=cssColor(control.props.Color||0),content=el('div',{class:'vb-common-color'}),picker=el('input',{type:'color',value:initial,'aria-label':'Color palette'}),hex=el('input',{type:'text',value:initial,'aria-label':'Color hexadecimal',maxLength:7});content.append(el('label',{text:'Color (#RRGGBB):'},hex),picker);
  picker.addEventListener('input',()=>hex.value=picker.value);hex.addEventListener('input',()=>{if(/^#[0-9a-f]{6}$/i.test(hex.value))picker.value=hex.value;});
  const result=await h.modal(control.props.DialogTitle||'Color','',[{caption:'OK',value:1},{caption:'Cancel',value:0}],null,{content,accept:()=>({Color:dialogColor(hex.value)}),width:460,height:260});
  if(control.disposed)return false;if(!result)return dialogCancelled(control);control.set('Color',result.Color);return true;
}
export async function showFont(control){
  const h=host(control),p=control.props,initial=dialogFont(p),content=el('div',{class:'vb-common-font'}),name=el('input',{type:'text',value:initial.FontName,'aria-label':'Font name',maxLength:255}),size=el('input',{type:'number',value:initial.FontSize,'aria-label':'Font size',min:p.Min||.1,max:p.Max||1638,step:.25}),preview=el('div',{class:'vb-font-preview',text:'AaBbYyZz 0123456789'}),effects={};
  const choices=el('datalist',{id:'vb-fonts-'+control.model.id});for(const font of ['MS Sans Serif','Arial','Times New Roman','Courier New','Segoe UI','Tahoma','Verdana','Georgia','monospace','sans-serif','serif'])choices.append(el('option',{value:font}));name.setAttribute('list',choices.id);
  content.append(el('label',{text:'Font:'},name),el('label',{text:'Size:'},size),choices);
  for(const [key,label]of Object.entries({FontBold:'Bold',FontItalic:'Italic',FontUnderline:'Underline',FontStrikethru:'Strikeout'})){const input=el('input',{type:'checkbox','aria-label':label});input.checked=!!initial[key];effects[key]=input;content.append(el('label',{class:'vb-font-effect'},input,label));}content.append(preview);
  const read=()=>dialogFont({FontName:name.value,FontSize:size.value,Min:p.Min,Max:p.Max,...Object.fromEntries(Object.entries(effects).map(([key,input])=>[key,input.checked]))}),paint=()=>{try{const font=read();Object.assign(preview.style,{fontFamily:fontFamily(font.FontName),fontSize:Math.min(48,font.FontSize)*96/72+'px',fontWeight:font.FontBold?'bold':'normal',fontStyle:font.FontItalic?'italic':'normal',textDecoration:[font.FontUnderline?'underline':'',font.FontStrikethru?'line-through':''].join(' ')});}catch{}};
  content.addEventListener('input',paint);paint();const result=await h.modal(p.DialogTitle||'Font','',[{caption:'OK',value:1},{caption:'Cancel',value:0}],null,{content,accept:read,width:460,height:390});
  if(control.disposed)return false;if(!result)return dialogCancelled(control);for(const [key,value]of Object.entries(result))control.set(key,value);return true;
}
