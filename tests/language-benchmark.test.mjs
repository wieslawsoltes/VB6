import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const tool=fileURLToPath(new URL('../tools/bench-language.mjs',import.meta.url));
test('language benchmark runs a checked, small fixture and emits machine-readable measurements',()=>{
  const run=spawnSync(process.execPath,[tool,'--modules','2','--locals','2','--tokens','5','--samples','1','--warmup','1'],{encoding:'utf8',timeout:10000});
  assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);
  assert.equal(result.options.modules,2);assert.equal(result.options.tokens,5);
  for(const metric of ['compileProject','warmDiagnostics','tokenize']){assert.equal(result.results[metric].samplesMs.length,1);assert.ok(result.results[metric].medianMs>=0);}
});
test('language benchmark rejects unknown options and invalid counts',()=>{
  for(const args of [['--unknown','1'],['--samples','0'],['--modules','NaN'],['--locals']]){
    const run=spawnSync(process.execPath,[tool,...args],{encoding:'utf8',timeout:10000});assert.equal(run.status,1);assert.equal(run.stdout,'');assert.ok(run.stderr.length>0);
  }
});
