/** Owned arrays of plain native records. These are internal SAFEARRAY
 * descriptors with an explicit element size and no COM record ownership flags.
 * Managed fields and boxing as Automation VT_RECORD remain rejected.
 * https://learn.microsoft.com/windows/win32/api/oleauto/nf-oleauto-safearrayallocdescriptor
 * https://learn.microsoft.com/windows/win32/api/oleauto/nf-oleauto-safearrayallocdata
 */
import {storageLayout} from './storage.js';
import {NATIVE_ARRAY_MAX_BYTES,NATIVE_ARRAY_MAX_RANK} from './arrays.js';
const P='native:record-array:',A='native:array:',DLL='oleaut32.dll';
const arg=argument=>({argument}),addr=address=>({address});
const save=(x,offset)=>x.emit(0x89,0x85).imm(offset);
const initializer=variable=>variable.nativeRecord.hasFixedStrings?'native:record:'+variable.nativeRecord.id+':initialize':0;

export const nativeRecordArrayMethods={
  recordArrayStorage(decl,module){
    this.nativeRecordArraysUsed=true;
    return storageLayout(this,decl,module,this.preparingProcedure);
  },
  initializeRecordArrayStorage(variable){
    const x=this.x,done=x.unique(),bounds=x.unique('record-array-bounds');
    this.ro.align(4).label(bounds);
    for(const bound of variable.nativeBounds)this.ro.u32(bound.upper-bound.lower+1).u32(bound.lower);
    this.rawStorageAddress(variable);x.emit(0x83,0x38,0).branch('ne',done);
    x.push(initializer(variable)).push(0).push(bounds).push(variable.nativeBounds.length).push(variable.nativeRecord.size);
    this.rawStorageAddress(variable);x.push().call(P+'redim');
    this.arrayRef(variable);x.emit(0x66,0x83,0x48,2,0x10).label(done);
  },
  redimRecordArrayStorage(variable,decl,preserve){
    const rank=decl.bounds?.length,x=this.x;
    if(!rank||rank>NATIVE_ARRAY_MAX_RANK)this.fail('Native ReDim requires one to 60 dimensions');
    const bounds=this.arrayWorkspace(rank*8,'record-array-bounds');
    this.rawStorageAddress(variable);x.push();
    for(let i=0;i<rank;i++){
      this.numeric(decl.bounds[i][0]||{kind:'literal',value:this.context.module.module.optionBase||0});x.push();
      this.numeric(decl.bounds[i][1]);x.emit(0x5b,0x39,0xd8).branch('l','error:9').emit(0x29,0xd8).branch('o','error:7').emit(0x40).branch('o','error:7');
      x.push();this.rawStorageAddress(bounds);x.emit(0x5a,0x89,0x90).imm(i*8).emit(0x89,0x98).imm(i*8+4);
    }
    x.emit(0x5b).push(initializer(variable)).push(preserve?1:0);this.rawStorageAddress(bounds);
    x.push().push(rank).push(variable.nativeRecord.size).emit(0x53).call(P+'redim');
  },
  initializeRecordArrayElements(variable){
    if(!variable.nativeRecord.hasFixedStrings)return;
    this.x.push(initializer(variable)).push(0);this.rawStorageAddress(variable);this.x.push().call(P+'initialize');
  }
};

export function emitNativeRecordArrayHelpers(compiler){
  if(!compiler.nativeRecordArraysUsed)return;
  const x=compiler.x,maxBytes=compiler.maxArrayBytes??NATIVE_ARRAY_MAX_BYTES;
  // redim(slot, elementBytes, rank, declarationOrderBounds, preserve, initializer)
  const noOld=x.unique(),counts=x.unique(),counted=x.unique(),create=x.unique(),validate=x.unique(),preserveNow=x.unique(),success=x.unique(),publish=x.unique(),allocated=x.unique(),copied=x.unique(),copyBounds=x.unique();
  x.label(P+'redim').enter(24).value(arg(8)).emit(0x89,0xc3,0x8b,0x00);save(x,-4);
  x.test().branch('e',noOld).emit(0x66,0xf7,0x40,2,0x10,0).branch('ne','error:10').emit(0x83,0x78,8,0).branch('ne','error:10');
  x.label(noOld).value(arg(12)).compare(1).branch('l','error:5').compare(512*1024).branch('g','error:7');
  x.value(arg(16)).compare(1).branch('l','error:9').compare(NATIVE_ARRAY_MAX_RANK).branch('g','error:9');
  x.emit(0x89,0xc7).value(arg(20)).emit(0x89,0xc6).value(1);save(x,-16);
  x.label(counts).emit(0x85,0xff).branch('e',counted).emit(0x8b,0x06).compare(1).branch('l','error:9');
  x.emit(0x0f,0xaf,0x45,0xf0).branch('o','error:7');save(x,-16);
  x.emit(0x0f,0xaf,0x45,12).branch('o','error:7').compare(maxBytes).branch('g','error:7');
  x.emit(0x83,0xc6,8,0x4f).jump(counts).label(counted).value(0);save(x,-12);save(x,-8);
  x.value(arg(-4)).test().branch('e',create).emit(0x8b,0x40,4,0x3b,0x45,12).branch('ne','error:13');
  x.value(arg(24)).test().branch('e',create);
  x.api(DLL,'SafeArrayGetDim',[arg(-4)]).emit(0x3b,0x45,16).branch('ne','error:9');
  x.push(arg(-4)).call(A+'count');save(x,-12);
  x.value(arg(20)).emit(0x89,0xc6,0xbf).imm(1).label(validate);
  x.push(addr(-20)).emit(0x57).push(arg(-4)).invoke(DLL,'SafeArrayGetLBound').call(A+'check');
  x.value(arg(-20)).emit(0x3b,0x46,4).branch('ne','error:9').emit(0x3b,0x7d,16).branch('e',preserveNow);
  x.push(addr(-20)).emit(0x57).push(arg(-4)).invoke(DLL,'SafeArrayGetUBound').call(A+'check');
  x.emit(0x8b,0x06,0x03,0x46,4,0x48,0x3b,0x45,0xec).branch('ne','error:9').emit(0x83,0xc6,8,0x47).jump(validate);
  x.label(preserveNow).emit(0x56).push(arg(-4)).invoke(DLL,'SafeArrayRedim').call(A+'check').jump(success);
  x.label(create).api(DLL,'SafeArrayAllocDescriptor',[arg(16),addr(-8)]).call(A+'check');
  x.value(arg(-8)).emit(0x89,0xc7).value(arg(12)).emit(0x89,0x47,4,0x83,0xc7,16);
  // SafeArrayCreate reverses declaration-order bounds in the descriptor. Keep
  // the same order so PtrOfIndex/GetLBound/Redim share the existing array ABI.
  x.value(arg(16)).emit(0x89,0xc1,0xc1,0xe0,3,0x03,0x45,20,0x83,0xe8,8,0x89,0xc6);
  x.label(copyBounds).emit(0x8b,0x06,0x89,0x07,0x8b,0x46,4,0x89,0x47,4,0x83,0xee,8,0x83,0xc7,8,0x49).branch('ne',copyBounds);
  x.api(DLL,'SafeArrayAllocData',[arg(-8)]).test().branch('ns',allocated);
  x.push().push(arg(-8)).invoke(DLL,'SafeArrayDestroyDescriptor').emit(0x58).call(A+'check');
  x.label(allocated).value(arg(-4)).test().branch('e',publish).push().invoke(DLL,'SafeArrayDestroy').test().branch('ns',publish);
  x.push().push(arg(-8)).invoke(DLL,'SafeArrayDestroy').emit(0x58).call(A+'check');
  x.label(publish).value(arg(-8)).emit(0x89,0x03).value(0);save(x,-12);
  x.label(success).push(arg(28)).push(arg(-12)).push(arg(8)).call(P+'initialize').value(0).leave(24);

  // Initialize only newly allocated records; existing values survive Preserve.
  const done=x.unique(),loop=x.unique();
  x.label(P+'initialize').enter().value(arg(16)).test().branch('e',done).value(arg(8)).emit(0x8b,0x00).test().branch('e',done).emit(0x89,0xc6);
  x.push().call(A+'count').emit(0x2b,0x45,12).test().branch('le',done).emit(0x89,0xc7);
  x.value(arg(12)).emit(0x0f,0xaf,0x46,4,0x03,0x46,12,0x89,0xc6);
  x.label(loop).emit(0x56,0xff,0x55,16).value(arg(8)).emit(0x8b,0x00,0x03,0x70,4,0x4f).branch('ne',loop);
  x.label(done).value(0).leave(12);
}
