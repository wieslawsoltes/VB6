// Stable editor entry point; the data-only language service is shared with the compiler.
import {validParameter,validParameterList,displayParameter} from '../language/signature-syntax.js';
export {validParameter,validParameterList,displayParameter};

/** Pascal call help also describes imported VB contracts. Brackets mark an
 * optional argument and an ellipsis marks ParamArray; neither changes the
 * declaration or mistakes a packed argument list for a scalar var parameter.
 * Defaults retain their authored representation, including VB string literals. */
export function displayPascalParameter(parameter) {
  const type=parameter.declaredType||((parameter.array||parameter.paramArray?'array of ':'')+parameter.type);
  const mode=parameter.paramArray?'':parameter.constant?'const ':parameter.byRef?'var ':'';
  let label=mode+parameter.name+': '+type;
  if(parameter.defaultValue!==undefined)label+=' = '+parameter.defaultValue;
  if(parameter.paramArray)label+='...';
  return parameter.optional?'['+label+']':label;
}
