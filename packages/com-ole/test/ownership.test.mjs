import test from 'node:test';
import assert from 'node:assert/strict';
import {ComObject,ComEnumerator,MemoryStream,StgMedium,OleDataObject,OleClipboard} from '../src/index.js';
test('clipboard flush detaches stream storage and preserves source seek',()=>{
  const s=new MemoryStream(new Uint8Array([1,2,3])),d=new OleDataObject(),c=new OleClipboard();
  try{s.Seek(2);const m=new StgMedium(4,s);d.SetData({cfFormat:13,tymed:4},m,true);c.OleSetClipboard(d);c.OleFlushClipboard();
    assert.equal(s.Seek(0,1),2);s.Seek(0);s.Write(new Uint8Array([9,9,9]));s.SetSize(1);
    const snapshot=c.OleGetClipboard();try{const out=snapshot.GetData({cfFormat:13,tymed:4});try{assert.deepEqual(out.data.toUint8Array(),new Uint8Array([1,2,3]));}finally{out.release();}}finally{snapshot.Release();}
  }finally{c.close();d.Release();s.Release();}
});
test('failed enumerator copy rolls back returned references and retains position',()=>{
  const a=new ComObject(),b=new ComObject();let fail=true;
  const e=new ComEnumerator([a,b],{retain:x=>x.AddRef(),release:x=>x.Release(),copy:x=>{if(x===b&&fail)throw Error('copy failure');x.AddRef();return x;}});
  try{assert.throws(()=>e.Next(2),/copy failure/);assert.equal(a.referenceCount,2);assert.equal(b.referenceCount,2);fail=false;const row=e.Next(2);assert.deepEqual(row.values,[a,b]);for(const item of row.values)item.Release();}
  finally{e.Release();a.Release();b.Release();}
});
test('enumerator acquisition rollback continues after a cleanup failure',()=>{
  const retained=[],released=[];assert.throws(()=>new ComEnumerator([1,2,3],{retain:x=>{if(x===3)throw Error('acquire');retained.push(x);},release:x=>{released.push(x);if(x===1)throw Error('release');}}),e=>e instanceof AggregateError&&e.errors.length===2);
  assert.deepEqual(retained,[1,2]);assert.deepEqual(released,[1,2]);
});
