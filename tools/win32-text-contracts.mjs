import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const file=process.argv[2];if(!file)throw new Error('Usage: node tools/win32-text-contracts.mjs text-native.json');
const records=JSON.parse(readFileSync(file,'utf8').replace(/^\ufeff/,''));assert.equal(records.length,18);
const face=records.find(r=>r.name==='face'&&r.n===128),line=records.find(r=>r.name==='draw'&&r.text==='A'&&r.flags===32).result;
assert.ok(face.text.length>0&&line>0);
const checks=[];
for(const r of records){
 if(r.name==='face'){
  assert.equal(r.required,face.text.length+1);assert.equal(r.result,Math.min(r.n,r.required));assert.equal(r.text,face.text.slice(0,Math.max(0,r.result-1)));
 }else if(r.name==='spacing'){
  assert.equal(r.delta,r.text.length*3);assert.equal(r.extra[1],r.normal[1]);if(!r.text)assert.deepEqual(r.normal,[0,0]);
 }else if(r.name==='draw'){
  const emptyCalc=!r.text&&r.flags===1024;
  const expected=emptyCalc?1:r.flags===36?Math.floor((200-line)/2)+line:r.flags===40?200:line;
  assert.equal(r.result,expected);
  if(emptyCalc)assert.deepEqual(r.rect,[10,20,10,20]);
  else if(r.flags&1024){assert.equal(r.rect[3],20+line);if(!r.text)assert.equal(r.rect[2],10);}
  else assert.deepEqual(r.rect,[10,20,210,220]);
 }else throw new Error('Unknown native case '+r.name);
 checks.push({name:r.name,text:r.text,n:r.n,flags:r.flags,passed:true});
}
const report={scope:'Font-independent NUL counts, spacing and layout return semantics; physical glyph metrics are not compared. The real-browser matrix independently enforces these rules using its selected Canvas metrics.',checks};
writeFileSync(file.replace(/text-native\.json$/,'text-comparison.json'),JSON.stringify(report,null,2)+'\n');
console.log('Passed all '+checks.length+' live Windows text semantic contracts.');
