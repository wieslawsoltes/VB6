import {VBError} from '../language/errors.js';
/** Invariant English descriptions for the errors produced by this runtime.
 * Localized Windows resource tables and arbitrary COM HRESULT messages are not
 * loaded into the browser. Unknown numbers retain their numeric identity. */
const MESSAGES=Object.freeze({
  0:'',3:'Return without GoSub',5:'Invalid procedure call or argument',6:'Overflow',
  7:'Out of memory',9:'Subscript out of range',10:'This array is fixed or temporarily locked',
  11:'Division by zero',13:'Type mismatch',14:'Out of string space',16:'Expression too complex',
  18:'User interrupt occurred',20:'Resume without error',28:'Out of stack space',
  48:'Error in loading DLL',49:'Bad DLL calling convention',51:'Internal error',
  52:'Bad file name or number',53:'File not found',54:'Bad file mode',55:'File already open',
  57:'Device I/O error',58:'File already exists',59:'Bad record length',61:'Disk full',
  62:'Input past end of file',63:'Bad record number',67:'Too many files',68:'Device unavailable',
  70:'Permission denied',71:'Disk not ready',74:"Can't rename with different drive",75:'Path/File access error',
  76:'Path not found',91:'Object variable or With block variable not set',92:'For loop not initialized',
  93:'Invalid pattern string',94:'Invalid use of Null',380:'Invalid property value',
  383:'Property is read-only',424:'Object required',429:"ActiveX component can't create object",
  438:"Object doesn't support this property or method",445:"Object doesn't support this action",
  448:'Named argument not found',449:'Argument not optional',450:'Wrong number of arguments or invalid property assignment',
  451:'Property let procedure not defined and property get procedure did not return an object',
  453:'Specified DLL function not found',457:'This key is already associated with an element of this collection',
  458:'Variable uses an Automation type not supported in Visual Basic',
  500:'Variable is undefined',1002:'Syntax error'
});
export function errorDescription(number){
  if(!Number.isInteger(number)||number< -2147483648||number>2147483647)throw new VBError('Invalid procedure call or argument',5);
  return MESSAGES[number]??'Application-defined or object-defined error';
}
