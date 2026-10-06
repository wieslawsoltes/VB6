import {VBError} from '../language/lexer.js';
import {VBErrorValue,tagScalar,coerce,defaultValue} from './values.js';
import {asDate} from './calendar.js';

/** Read one VB sequential Input field, not an entire physical line.
 * Quoted fields end at the first closing quote (VB Input is not CSV).
 * The returned cursor allows another Input statement to consume the same row.
 */
export function readInputField(text,start=0,type='Variant'){
  if(typeof text!=='string'||!Number.isInteger(start)||start<0||start>text.length)throw new VBError('Invalid file position',5);
  let i=start;while(text[i]===' '||text[i]==='\t')i++;
  if(i===text.length)throw new VBError('Input past end of file',62);
  const quoted=text[i]==='"';let token='';
  if(quoted){
    const end=text.indexOf('"',i+1);if(end<0)throw new VBError('Input past end of file',62);
    token=text.slice(i+1,end);i=end+1;
  }else{
    const begin=i;while(i<text.length&&text[i]!==','&&text[i]!=='\r'&&text[i]!=='\n')i++;
    if(i===text.length)throw new VBError('Input past end of file',62);
    token=text.slice(begin,i).trim();
  }
  while(text[i]===' '||text[i]==='\t')i++;
  if(text[i]===',')i++;
  else if(text[i]==='\r'){i++;if(text[i]==='\n')i++;}
  else if(text[i]==='\n')i++;
  const target=String(type).toLowerCase();let value;
  if(target==='string')value=tagScalar(token,'string');
  else if(quoted)value=target==='variant'?tagScalar(token,'string',true):defaultValue(type);
  else if(token==='')value=tagScalar(undefined,'empty',true);
  else if(token==='#NULL#')value=tagScalar(null,'null',true);
  else if(token==='#TRUE#'||token==='#FALSE#')value=tagScalar(token==='#TRUE#'?-1:0,'boolean',true);
  else if(/^#ERROR [-+]?\d+#$/.test(token))value=tagScalar(new VBErrorValue(Number(token.slice(7,-1))),'error',true);
  else if(token.startsWith('#')&&token.endsWith('#'))value=tagScalar(asDate(token.slice(1,-1)),'date',true);
  else if(target==='boolean'||target==='date')throw new VBError('Overflow',6);
  else if(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(token))value=tagScalar(coerce(token,'Double'),'double',true);
  else value=target==='variant'?tagScalar(token,'string',true):defaultValue(type);
  return {value,next:i};
}
