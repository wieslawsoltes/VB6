import {pascalObjectDispatchBranches} from '../language/pascal/object-compatibility.js';
const key=value=>String(value).toLowerCase();

export const nativePascalObjectMethods={
  pascalObjectViewArgument(parameter,node,variable){
    const context=this.context,target=this.nativeRecordCallTarget;
    if(node.kind!=='id'||!variable.parameter||!variable.byRef||!target?.proc||key(variable.name)!==key(node.name))return null;
    const contract=pascalObjectDispatchBranches(this.program.modules,context.module.name,context.proc.name,node.name,target.module.name,target.proc.name,parameter.nativeRecord.id);
    if(!contract||key(contract.receiver.identity)!==variable.nativeRecord.id)return null;
    // Private override types are resolved by their validated defining identity,
    // without granting authored code access to the private type declaration.
    for(const branch of contract.branches){
      const definition=this.recordLayouts.definitions.get(key(branch.runtimeType));
      if(!definition)return null;
      const runtime=this.recordLayouts.layout(definition);
      if(!this.recordLayouts.referenceCompatible(runtime,variable.nativeRecord)||!this.recordLayouts.referenceCompatible(runtime,parameter.nativeRecord))return null;
    }
    const header=variable.nativeRecord.fields.get(key(contract.receiver.vmtField));
    if(!header||header.recordOffset!==0||header.nativeElementBytes!==4)return null;
    const x=this.x,valid=x.unique('pascal-object-view'),pin=this.address(variable);
    // Even compiler-generated dispatch retains a runtime check at the narrowing
    // point. A corrupt or uninitialized header never exposes descendant fields.
    x.push().emit(0x8b,0x00);
    for(const branch of contract.branches)x.compare(branch.typeId).branch('e',valid);
    x.value(210).jump('native:error:raise').label(valid).emit(0x58);
    return {pin};
  }
};
