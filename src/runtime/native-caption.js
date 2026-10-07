import {icon} from '../theme/icons.js';
/** Opt in only with an advertised host capability. Old v1 hosts remain native-framed.
 * Frame ownership is fixed at creation: changing it must not recreate a running VM.
 */
export function nativeCaptionMode(appearance,bridge) {
  return bridge?.capabilities?.applicationCaptions===true && appearance?.themeOptions?.systemCaption!==true
    ? 'application' : 'system';
}
export function nativeChromeInsets(form,mode) {
  const view=form.node.ownerDocument.defaultView,number=n=>Math.max(0,parseFloat(n)||0);
  const style=view.getComputedStyle(form.node),border=Number(form.props.BorderStyle??2);
  const title=mode==='application'&&border!==0
    ? number(view.getComputedStyle(form.titleBar).height)||(border>=4?15:20) : 0;
  const x=mode==='application'?number(style.borderLeftWidth)+number(style.borderRightWidth)+number(style.paddingLeft)+number(style.paddingRight):0;
  const y=mode==='application'?number(style.borderTopWidth)+number(style.borderBottomWidth)+number(style.paddingTop)+number(style.paddingBottom):0;
  const menu=form.menuBar.hidden?0:number(view.getComputedStyle(form.menuBar).height)||19;
  return {width:x,height:y+title+menu};
}
export function updateNativeCaption(form,state,focused) {
  form.node.classList.toggle('vb-inactive',!focused);
  form.node.classList.toggle('vb-native-maximized',state===2);
  for(const [button,action,restored] of [[form.minButton,'minimize',state===1],[form.maxButton,'maximize',state===2]]) {
    const glyph=restored?'restore':action,label=restored?'Restore':action==='minimize'?'Minimize':'Maximize';
    if(button.dataset.nativeGlyph!==glyph){button.replaceChildren(icon(glyph));button.dataset.nativeGlyph=glyph;}
    button.title=label;button.setAttribute('aria-label',label);
    button.setAttribute('data-caption-action',action);
  }
}
