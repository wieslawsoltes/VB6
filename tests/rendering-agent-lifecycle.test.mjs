import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('agent browser harness recovers capture transport while preserving failures, exact pixels and cleanup',t=>{
 const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
 const script=fileURLToPath(new URL('../tools/test_rendering_agent_lifecycle.py',import.meta.url));
 const result=spawnSync(python,[script],{encoding:'utf8',timeout:30000});
 if(result.error?.code==='ENOENT'){t.skip('Python is not installed');return;}
 assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
 assert.match(result.stderr,/Ran 18 tests/);
});
