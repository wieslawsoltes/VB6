import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {PE32Image} from '../src/native/pe32.js';
import {newProject} from '../src/project/model.js';

// Inspect the actual emitted prologue and shared return/error-unwind cleanup,
// not only imports: an allocation API can be present while its owner leaks.
function compiledOwnership() {
  const finish=PE32Image.prototype.finish;let symbols;
  PE32Image.prototype.finish=function(...args){const out=finish.apply(this,args);symbols=out.symbols;return out;};
  try {
    const project=newProject('Ownership');project.startup='Sub Main';
    project.modules=[{id:'m',kind:'module',name:'Ownership',code:`Private Sub Owned(ByVal value As String)
End Sub
Private Sub Borrowed(ByRef value As String)
End Sub
Private Sub ArrayBorrowed(ByRef values() As String)
End Sub
Public Sub Main()
End Sub`}];
    const result=compileWin32(project),section=result.report.sections.find(s=>s.name==='.text'),bytes=Buffer.from(result.bytes);
    const offset=name=>symbols[name]-section.rva+section.offset;
    return {bytes,symbols,offset};
  } finally {PE32Image.prototype.finish=finish;}
}

test('ByVal String owns a zero-initialized local and frees it on the shared normal/error exit',()=>{
  const {bytes,symbols,offset}=compiledOwnership(),prefix='proc:Ownership:Owned';
  const prologue=bytes.subarray(offset(prefix),offset(prefix+':0'));
  // EBP-52 is the first owned slot after the 48-byte error frame.
  assert.ok(prologue.includes(Buffer.from('8d85ccffffff89c7b90100000031c0fcf3ab','hex')),'owned parameter is initialized before a fallible BSTR copy');
  const cleanup=offset(prefix+':cleanup');
  assert.equal(bytes[cleanup],0x50,'preserve the return value');
  assert.equal(bytes[cleanup+1],0xe8,'release expression temporaries first');
  assert.deepEqual(bytes.subarray(cleanup+6,cleanup+19),Buffer.from('b801000000508d85ccffffff50','hex'),'free the owned parameter slot, not its borrowed incoming argument');
  assert.equal(bytes[cleanup+19],0xe8);
  const target=symbols[prefix+':cleanup']+24+bytes.readInt32LE(cleanup+20);
  assert.equal(target,symbols['native:string:clear']);
});

test('ByRef String and whole-array parameter slots remain borrowed at procedure exit',()=>{
  const {bytes,offset}=compiledOwnership();
  for(const name of ['Borrowed','ArrayBorrowed']){
    const cleanup=offset('proc:Ownership:'+name+':cleanup');
    assert.deepEqual([...bytes.subarray(cleanup,cleanup+2)],[0x50,0xe8]);
    assert.equal(bytes[cleanup+6],0x58,'borrowed argument must not be freed: '+name);
  }
});
