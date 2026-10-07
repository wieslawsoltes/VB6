import {VBError} from '../language/lexer.js';
import {MISSING,unbox,vbString} from './values.js';
/** Preserve omitted path arguments; an explicit empty path asks for a new object. */
export function installComLibrary(map,vm){
  const getObject=(pathname=MISSING,className=MISSING)=>{
    const path=pathname===MISSING?MISSING:vbString(unbox(pathname)),name=className===MISSING?MISSING:vbString(unbox(className));
    if(path===''&&name!==MISSING)return vm.createObject(name);
    if(!vm.automation)throw new VBError('No trusted Automation object binding is available',429);
    return vm.automation.getObject(path,name);
  };
  getObject.vbRawArgs=true;getObject.vbPreserveMissing=true;getObject.vbParams=[{name:'pathname',optional:true},{name:'class',optional:true}];
  map.set('getobject',getObject);return map;
}
