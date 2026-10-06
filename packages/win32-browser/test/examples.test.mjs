import test from 'node:test';
import assert from 'node:assert/strict';
import {runCommonServicesSample} from '../examples/common-services.mjs';
const expected={fileSize:6,sharedPosition:2,text:'Aé€',base64:'QcOp4oKs',wait:0,reset:258,yielded:true,guid:'{00112233-4455-6677-8899-AABBCCDDEEFF}'};

test('shipped JavaScript sample runs all services without the VB6 runtime',async()=>{
  assert.deepEqual(await runCommonServicesSample(),expected);
});

test('concurrent and repeated samples keep private files and named events isolated',async()=>{
  for(let round=0;round<3;round++){
    const results=await Promise.all(Array.from({length:4},()=>runCommonServicesSample()));
    for(const result of results)assert.deepEqual(result,expected);
  }
});
