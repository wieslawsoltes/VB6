#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(import.meta.dirname,'..');

/** Qualify declarations against only the files shipped to package consumers.
 * Supply TypeScript through PATH, or PASCAL_TSC; it is not an SDK dependency. */
export async function testPascalTypes({tsc=process.env.PASCAL_TSC||'tsc'}={}) {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-pascal-types-'));
  try {
    const source=path.join(root,'packages/turbo-pascal'),target=path.join(directory,'node_modules/@vb6/turbo-pascal');
    const manifest=JSON.parse(await fs.readFile(path.join(source,'package.json'),'utf8'));
    await fs.mkdir(target,{recursive:true});
    await fs.copyFile(path.join(source,'package.json'),path.join(target,'package.json'));
    await Promise.all(manifest.files.map(async file=>{
      await fs.mkdir(path.dirname(path.join(target,file)),{recursive:true});
      await fs.cp(path.join(source,file),path.join(target,file),{recursive:true});
    }));
    await fs.copyFile(path.join(root,'tests/pascal-sdk-consumer.mts'),path.join(directory,'consumer.mts'));
    const common=['--strict','--noUncheckedIndexedAccess','--exactOptionalPropertyTypes','--skipLibCheck','false','--target','ES2022','--lib','ES2022','consumer.mts'];
    const run=args=>{
      const result=spawnSync(tsc,[...common,...args],{cwd:directory,encoding:'utf8',timeout:60000});
      if(result.error)throw new Error('Unable to run TypeScript; provide tsc on PATH or set PASCAL_TSC.',{cause:result.error});
      assert.equal(result.status,0,result.stdout+result.stderr);
    };
    run(['--module','NodeNext','--moduleResolution','NodeNext','--noEmitOnError','--outDir','out']);
    run(['--module','ESNext','--moduleResolution','Bundler','--noEmit']);
    const consumer=await import(pathToFileURL(path.join(directory,'out/consumer.mjs')).href);
    assert.equal(consumer.qualified,true);
    return {valid:true,resolution:['NodeNext','Bundler'],isolatedPackage:true,runtimeConsumer:true};
  } finally {await fs.rm(directory,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {console.log(JSON.stringify(await testPascalTypes()));}
  catch(error){console.error(error.stack||error.message);process.exitCode=1;}
}
