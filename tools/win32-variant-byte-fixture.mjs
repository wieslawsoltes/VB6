/** Real OleAut32 copying/conversion of VT_UI1 with deliberately nonzero union
 * padding. This is valid bVal storage, not an oversized numeric input. */
export function appendNativeVariantByteChecks({add,check}){
  add('Dim paddingValue As Variant, paddingCopy As Variant, paddingBits As Long, paddingByte As Byte');
  for(const byte of [0,1,127,128,255])for(const padding of [0x12345600,0x7fffff00,0xffffff00]){
    const raw=((padding|byte)>>>0).toString(16).toUpperCase();
    add(`paddingValue=CByte(${byte})\npaddingBits=&H${raw}\nCopyMemory VarPtr(paddingValue)+8,VarPtr(paddingBits),4\npaddingCopy=paddingValue\npaddingByte=paddingCopy`);
    check(`paddingByte=${byte} And CByte(paddingValue)=${byte} And VarType(paddingCopy)=vbByte`, `VT_UI1 ${byte} ignores padding ${raw} after real VariantCopyInd/VariantChangeTypeEx`);
  }

}
