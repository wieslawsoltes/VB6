/** Execute the exported C++ source-kit Pascal path against the native runtime. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {MacOSLowering} from '../packages/macos-native/src/compiler.js';
import {macOSOptions} from '../packages/macos-native/src/target.js';
import {pascalNativeVerificationProject,pascalNativeExpectedResult} from '../tests/pascal-integration-fixtures.mjs';
import {pascalNativeGuardCases} from './test-pascal-native.mjs';

export async function verifyPascalSourceKitExecution({compileMacOS,compiler,flags,objects,work,run}) {
  const checks=[];
  const pascalSource=path.join(work,'pascal-source-kit.cpp'),pascalExecutable=path.join(work,'pascal-source-kit');
  await fs.writeFile(pascalSource,compileMacOS(pascalNativeVerificationProject()).files['main.cpp']);
  await run(compiler,[...flags,pascalSource,...objects,'-o',pascalExecutable]);
  await run(pascalExecutable,[]);
  assert.equal((await fs.readFile(path.join(work,'pascal-native-result.txt'),'utf8')).trim(),pascalNativeExpectedResult);
  assert.equal(await fs.readFile(path.join(work,'pascal-native.txt'),'utf8'),'  42\r\n');
  assert.deepEqual([...await fs.readFile(path.join(work,'pascal-native.dat'))],[255,255,129,0,0,0,0,64]);
  checks.push('sanitized-pascal-source-kit-ancestry-dispatch-pointers-files');
  for(const guard of pascalNativeGuardCases().slice(0,2)){
    const program=compileProject(guard.project);assert.equal(program.valid,true,JSON.stringify(program.diagnostics));
    if(guard.name==='incompatible-virtual-tag'){
      // Inject a forged constructor tag after binding so the native receiver
      // contract, rather than a frontend diagnostic, must reject the program.
      const module=program.modules.get('virtualguard'),child=module.pascal.objectTypes.find(type=>type.name==='TChild');
      const constructor=module.procedures.get('main').code.find(instruction=>instruction.op==='expr'&&instruction.expr.callee?.name==='__PascalMethod_5_TBase_Init');
      assert.equal(constructor?.expr.args[1].kind,'literal');
      constructor.expr.args[1].value=child.typeId;
    }
    const source=path.join(work,guard.name+'.cpp'),executable=path.join(work,guard.name);
    await fs.writeFile(source,new MacOSLowering(program,macOSOptions({name:guard.project.name})).emit());
    await run(compiler,[...flags,source,...objects,'-o',executable]);
    await assert.rejects(()=>run(executable,[]),error=>error.code===guard.status&&guard.error.test(error.output));
    checks.push('sanitized-pascal-source-kit-'+guard.name);
  }
  return checks;
}
