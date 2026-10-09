import {CONTROL_DEFAULTS} from '../project/model.js';

const generic = {Visible:-1, Enabled:-1, TabIndex:0, FontName:'MS Sans Serif', FontSize:8.25,
  FontBold:0, FontItalic:0, ForeColor:-2147483640, BackColor:-2147483633, ToolTipText:'', Tag:''};
const font = ['FontName','FontSize','FontBold','FontItalic','FontUnderline','FontStrikethrough','FontCharset','FontWeight'];
const noTabStop = new Set(['Label','Frame','Shape','Line','Image','Timer']);
/** Lower browser-authored intrinsic designer records, not user code. Imported
 * native records are untouched. Generic editor adornment defaults are not VB6
 * properties of every intrinsic control (notably Timer and Line).
 */
export function prepareClassicDesigner(project) {
  for (const module of project.modules) {
    if (!module.form) continue;
    for (const node of [module.form,...module.form.controls]) {
      if (node.originalType) continue;
      const p = node.properties, defaults = {...generic,...CONTROL_DEFAULTS[node.type]};
      defaults.TabStop = noTabStop.has(node.type) ? 0 : -1;
      function omit(keys) {
        for (const key of keys) {
          if (!Object.hasOwn(p,key)) continue;
          if (p[key] !== defaults[key] && !(p[key] === 0 && defaults[key] === undefined)) {
            throw new Error('Microsoft VB6 has no persisted ' + node.type + '.' + key + ' setting matching this browser value (' + module.name + '.' + node.name + '). Use a native property or initialize supported runtime properties in Form_Load.');
          }
          delete p[key];
        }
      }
      if (node.type === 'Form' || node.type === 'MDIForm') {
        // FRM stores the client rectangle, unlike the editor's additional outer
        // sizing handles. Preserve explicit native client-position overrides.
        p.ClientWidth ??= p.Width ?? 9000; p.ClientHeight ??= p.Height ?? 6000;
        const border = Math.max(0, ((p.Width ?? p.ClientWidth) - p.ClientWidth) / 2) || 0;
        p.ClientLeft ??= (p.Left || 0) + border;
        p.ClientTop ??= (p.Top || 0) + Math.max(0, (p.Height ?? p.ClientHeight) - p.ClientHeight - border);
        for (const key of ['Width','Height','Left','Top']) delete p[key];
      }
      if (node.type === 'WebBrowser') omit([...font,'ForeColor','BackColor','URL','HomeURL','SearchURL','DocumentText','Zoom','AddressBar','MenuBar','StatusBar','ToolBar','FullScreen','TheaterMode','Resizable']);
      if (node.type === 'CommandButton') omit(['ForeColor']);
      if (node.type === 'Label' || node.type === 'Frame') omit(['TabStop']);
      if (node.type === 'Timer') {
        omit([...font,'ForeColor','BackColor','Visible','TabIndex','TabStop','ToolTipText','Width','Height']);
      }
      if (node.type === 'HScrollBar' || node.type === 'VScrollBar') omit([...font,'ForeColor','BackColor']);
      if (node.type === 'Image') omit([...font,'ForeColor','BackColor','TabIndex','TabStop']);
      if (node.type === 'Shape') omit([...font,'ForeColor','Enabled','TabIndex','TabStop','ToolTipText']);
      if (node.type === 'Line') {
        // Browser Line is horizontal; its Height is a designer hit rectangle,
        // not the native Y2 endpoint. Imported native diagonal lines bypass this.
        p.X1 ??= p.Left || 0; p.Y1 ??= p.Top || 0;
        p.X2 ??= p.X1 + (p.Width || 0); p.Y2 ??= p.Y1;
        for (const key of ['Left','Top','Width','Height']) delete p[key];
        omit([...font,'ForeColor','BackColor','Enabled','TabIndex','TabStop','ToolTipText']);
      }
      if (node.type === 'ComboBox' || node.type === 'ListBox') omit(['ListIndex']);
      if (node.type === 'OLE') omit(['Caption',...font,'ForeColor']);
    }
  }
  return project;
}
