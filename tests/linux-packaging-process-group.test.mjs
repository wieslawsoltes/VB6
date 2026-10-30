import assert from 'node:assert/strict';
import test from 'node:test';
import {waitForLinuxProcessGroupExit} from '../packages/linux-native/src/native-distribution-tools.mjs';

// Exercise the actual observer deterministically, including the interval where
// the kernel has accepted SIGKILL but /proc still reports an executing child.
const stat=(pid,state,group,name='tool')=>`${pid} (${name}) ${state} 1 ${group} ${group} 0 -1 0\n`;
function fixture(scans){
  let index=0,clock=0;const pauses=[],reads=[];
  return {pauses,reads,options:{
    readDirectory:async directory=>{assert.equal(directory,'/proc');return ['self','thread-self',...Object.keys(scans[Math.min(index,scans.length-1)])];},
    readFile:async filename=>{reads.push(filename);const value=scans[Math.min(index,scans.length-1)][filename.split('/')[2]];if(value instanceof Error)throw value;return value;},
    now:()=>clock,pause:async milliseconds=>{pauses.push(milliseconds);clock+=milliseconds;index++;}
  }};
}

test('Linux packaging waits for executing, sleeping and stopped group members to become terminal',async()=>{
  const probe=fixture([
    {'41':stat(41,'R',41),'42':stat(42,'S',41),'91':stat(91,'R',91)},
    {'41':stat(41,'Z',41),'42':stat(42,'T',41),'91':stat(91,'R',91)},
    {'41':stat(41,'Z',41),'42':stat(42,'X',41),'91':stat(91,'R',91)}
  ]);
  await waitForLinuxProcessGroupExit(41,probe.options);
  assert.deepEqual(probe.pauses,[10,10]);
  assert.equal(probe.reads.length,9);
});

test('Linux packaging handles comm delimiters, zombies and concurrent process reaping',async()=>{
  const probe=fixture([{
    '41':stat(41,'Z',41,'name ) with\na newline ('),
    '42':Object.assign(new Error('reaped before open'),{code:'ENOENT'}),
    '43':Object.assign(new Error('reaped during read'),{code:'ESRCH'}),
    '44':stat(44,'x',41),
    '91':stat(91,'R',91,'unrelated ) tool')
  }]);
  await waitForLinuxProcessGroupExit(41,probe.options);
  assert.deepEqual(probe.pauses,[]);
  await waitForLinuxProcessGroupExit(41,fixture([{}]).options);
});

test('Linux packaging cannot accept a live group when its bounded observation expires',async()=>{
  const probe=fixture([{'42':stat(42,'D',41)}]);
  await assert.rejects(waitForLinuxProcessGroupExit(41,{...probe.options,timeout:25}),/did not terminate.*live PIDs: 42/);
  assert.deepEqual(probe.pauses,[10,10,5]);
});

test('Linux packaging does not interpret missing procfs, unreadable or malformed status as successful cleanup',async()=>{
  const denied=Object.assign(new Error('procfs denied'),{code:'EACCES'});
  await assert.rejects(waitForLinuxProcessGroupExit(41,{readDirectory:async()=>{throw denied;}}),error=>error===denied);
  await assert.rejects(waitForLinuxProcessGroupExit(41,fixture([{'42':denied}]).options),error=>error===denied);
  for(const value of ['42 malformed','41 (different pid) Z 1 41 41','42 (tool) Z 1 nope 41']){
    await assert.rejects(waitForLinuxProcessGroupExit(41,fixture([{'42':value}]).options),/Invalid Linux process status/);
  }
  let clock=0;
  const probe=fixture([{'42':stat(42,'Z',41)}]);
  await assert.rejects(waitForLinuxProcessGroupExit(41,{...probe.options,timeout:5,now:()=>clock++*10}),/observation timed out/);
  for(const group of [0,-1,1.5,NaN,'41'])await assert.rejects(waitForLinuxProcessGroupExit(group),TypeError);
  for(const timeout of [0,-1,NaN,Infinity])await assert.rejects(waitForLinuxProcessGroupExit(41,{timeout}),TypeError);
});
