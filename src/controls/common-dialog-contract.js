import {VBError} from '../language/lexer.js';
export const COMMON_DIALOG_DEFAULTS={CancelError:0,Color:0,FilterIndex:1,DefaultExt:'',InitDir:'',FileTitle:'',Flags:0,Min:0,Max:0};
export function dialogCancelled(control){if(control.props.CancelError&&!control.disposed)throw new VBError('Cancel was selected',32755);return false;}
export function dialogFont(values){
  const name=String(values.FontName??'').trim(),size=Number(values.FontSize),minimum=Number(values.Min??0),maximum=Number(values.Max??0);
  if(!Number.isFinite(minimum)||!Number.isFinite(maximum)||minimum<0||maximum<0||!name||name.length>255||/[\r\n\0]/.test(name)||!Number.isFinite(size)||size<=0||size>1638||minimum&&size<minimum||maximum&&size>maximum||minimum&&maximum&&minimum>maximum)throw new VBError('Invalid font name or size',380);
  return {FontName:name,FontSize:size,FontBold:values.FontBold?-1:0,FontItalic:values.FontItalic?-1:0,FontUnderline:values.FontUnderline?-1:0,FontStrikethru:values.FontStrikethru?-1:0};
}
export function dialogColor(value){const text=String(value);if(!/^#[0-9a-f]{6}$/i.test(text))throw new VBError('Color must be #RRGGBB',380);return parseInt(text.slice(1,3),16)+(parseInt(text.slice(3,5),16)<<8)+(parseInt(text.slice(5,7),16)<<16);}
