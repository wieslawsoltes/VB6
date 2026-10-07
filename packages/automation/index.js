/** Framework-independent Automation/COM adapters and the VM value contract. */
export {AutomationRegistry,automationInvoke,automationMember,automationReference,automationEnumerate,automationSubscribe,isAutomationObject} from '../../src/runtime/automation.js';
export {registerComClass,createComAutomationRegistry} from '../../src/runtime/com-automation.js';
export {encodeAutomationValue,decodeAutomationValue} from '../../src/runtime/automation-wire.js';
export {VBError} from '../../src/language/errors.js';
export {NOTHING,MISSING,VBArray,VBCollection,VBDictionary,VBErrorValue,VBCurrency,VBDecimal,VBScalar,Cell,Ref,tagScalar,scalarType,unbox,readScalar} from '../../src/runtime/values.js';
