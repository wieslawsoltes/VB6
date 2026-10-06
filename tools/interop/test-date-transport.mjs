/** Actual Windows IDispatch/SAFEARRAY DATE transport, not a VB6 compiler oracle. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {NativeAutomationClient} from './native-automation.mjs';

const client=new NativeAutomationClient({
  allowed:['Scripting.Dictionary'],
  architecture:process.env.VB6_COM_ARCH||'x86',
  allowNativeCode:true,
});
const report={schema:1,architecture:client.architecture,status:'failed',checks:[],failures:[],
  scope:'Raw native DATE wire transport through installed Scripting.Dictionary; not JavaScript Date or licensed VB6 conformance',
  licensedVB6:false,negativeZeroCertified:false};
const started=Date.now(),date=v=>({t:'date',v}),text=v=>({t:'string',v});
const bits=n=>{const b=Buffer.alloc(8);b.writeDoubleLE(n);return b.toString('hex');};
const call=(handle,member,args=[],mode=1,byRef=[])=>client.request({op:'call',handle,member,args,mode,byRef,lcid:1033});
async function check(name,fn){
  try{const evidence=await fn();report.checks.push({name,...(evidence?{evidence}:{})});console.log('PASS',name);}
  catch(error){report.failures.push({name,message:error.message,code:error.code,hresult:error.hresult,actual:error.actual,expected:error.expected});console.error('FAIL',name,error.message);}
}
function exact(actual,expected){
  assert.equal(actual.t,'date');assert.equal(typeof actual.v,'number');
  assert.equal(bits(actual.v),bits(expected),'Native DATE payload changed');
  return {serial:expected,expectedBits:bits(expected),actualBits:bits(actual.v)};
}
async function withDictionary(fn){
  const object=await client.request({op:'create',progId:'Scripting.Dictionary'});
  try{return await fn(object.id);}finally{if(!client.closed)await client.request({op:'release',handle:object.id});}
}
try{
  report.host=await client.start();
  await check('matching native STA architecture',()=>{
    assert.equal(report.host.bitness,client.architecture==='x86'?32:64);assert.equal(report.host.apartment,'STA');
  });
  const serials=[0,2.75,-0.25,1e-9,-1e-9,1.000000001,-1.000000001,45000.123456789,
    -45000.123456789,-657434.000000001,-657434.99999999,2958465.99999999];
  for(const serial of serials)await check('scalar DATE '+serial,()=>withDictionary(async handle=>{
    // This path deliberately avoids the higher-level JS Date adapter.
    await call(handle,'Add',[text('date'),date(serial)]);
    return exact((await call(handle,'Item',[text('date')],2)).value,serial);
  }));
  await check('ByRef VARIANT argument and native copyback retain DATE bits',()=>withDictionary(async handle=>{
    const serial=-1.000000001;
    const response=await call(handle,'Add',[text('date'),date(serial)],1,[1]);
    exact(response.args[1],serial);
    return exact((await call(handle,'Item',[text('date')],2)).value,serial);
  }));
  for(const elementType of [7,12])await check('multidimensional SAFEARRAY '+elementType+' retains DATE bits and bounds',()=>withDictionary(async handle=>{
    const array={t:'array',elementType,bounds:[[-2,-1],[3,4]],v:[-0.25,1e-9,-1.000000001,45000.123456789].map(date)};
    await call(handle,'Add',[text('dates'),array]);
    const got=(await call(handle,'Item',[text('dates')],2)).value;
    assert.equal(got.elementType,elementType);assert.deepEqual(got.bounds,array.bounds);assert.equal(got.v.length,4);
    return got.v.map((v,i)=>exact(v,array.v[i].v));
  }));
  await check('nested Variant SAFEARRAY preserves inner DATE storage',()=>withDictionary(async handle=>{
    const inner={t:'array',elementType:7,bounds:[[5,6]],v:[1e-9,-0.25].map(date)};
    const outer={t:'array',elementType:12,bounds:[[-1,0]],v:[inner,text('unchanged')]};
    await call(handle,'Add',[text('nested'),outer]);
    assert.deepEqual((await call(handle,'Item',[text('nested')],2)).value,outer);
  }));
  await check('native DATE keys survive SAFEARRAY and repeated IEnumVARIANT export',()=>withDictionary(async handle=>{
    const values=[date(45000.123456789),date(45001.000000001),date(-45000.123456789)];
    for(const value of values)await call(handle,'Add',[value,text('value')]);
    const keys=(await call(handle,'Keys')).value;
    assert.deepEqual(keys.bounds,[[0,2]]);assert.equal(keys.elementType,12);
    assert.deepEqual(keys.v,values);
    for(let i=0;i<20;i++)assert.deepEqual(await client.request({op:'enumerate',handle,lcid:1033}),values);
  }));
  const invalid=[{label:'missing',wire:{t:'date'}},...[
    null,true,false,'2.75','not a date',{},[],NaN,Infinity,-Infinity,-657435,2958466,
  ].map((v,i)=>({label:String(i)+':'+String(v),wire:date(v)}))];
  // Nonfinite JavaScript numbers serialize as null: they must still be rejected,
  // never silently accepted as OLE DATE zero. This does not test raw JSON NaN.
  for(const {label,wire} of invalid)await check('invalid DATE '+label+' is rejected before native mutation',()=>withDictionary(async handle=>{
    await assert.rejects(()=>call(handle,'Add',[text('invalid'),wire]),/DATE|date|payload/i);
    const count=(await call(handle,'Count',[],2)).value;
    assert.equal(count.v,0);
    await call(handle,'Add',[text('valid'),date(1.000000001)]);
    exact((await call(handle,'Item',[text('valid')],2)).value,1.000000001);
  }));
  await check('invalid nested DATE unwinds temporary SAFEARRAY storage',()=>withDictionary(async handle=>{
    for(let i=0;i<20;i++){
      const invalidArray={t:'array',elementType:7,bounds:[[-2,-1]],v:[date(1.000000001),date(null)]};
      await assert.rejects(()=>call(handle,'Add',[text('invalid'),invalidArray]),/DATE|date|payload/i);
    }
    assert.equal((await call(handle,'Count',[],2)).value.v,0);
  }));
  await check('DATE lifetimes leave zero exported object handles',async()=>{
    for(let i=0;i<20;i++)await withDictionary(async handle=>{
      await call(handle,'Add',[text('date'),date(45000.123456789)]);
      exact((await call(handle,'Item',[text('date')],2)).value,45000.123456789);
    });
    const status=await client.request({op:'info'});assert.deepEqual(status,{objects:0,windows:0});return status;
  });
  await check('native allowlist remains enforced',()=>assert.rejects(()=>client.request({op:'create',progId:'WScript.Shell'}),/not allowed/));
  if(report.failures.length)throw Error(report.failures.length+' DATE transport checks failed');
  report.status='passed';
}catch(error){report.error={message:error.message,code:error.code};process.exitCode=1;}
finally{
  report.diagnostics=client.diagnostics();report.elapsedMs=Date.now()-started;
  try{await client.close();}catch(error){report.closeError=error.message;report.status='failed';process.exitCode=1;}
  await fs.mkdir('reports/native-date-transport',{recursive:true});
  await fs.writeFile('reports/native-date-transport/'+client.architecture+'.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
