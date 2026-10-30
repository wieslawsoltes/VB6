/** Execute the same record contracts against the compiled native source kit. */
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {nativeRecordIdentityCases} from '../tests/native-record-identity-fixtures.mjs';

export async function verifyNativeRecordIdentityExecution({compileMacOS, compiler, flags, objects, work, run}) {
  const checks = [];
  for (const fixture of nativeRecordIdentityCases()) {
    const source = path.join(work, 'records-' + fixture.name + '.cpp');
    const executable = path.join(work, 'records-' + fixture.name);
    await fs.writeFile(source, compileMacOS(fixture.project).files['main.cpp']);
    await run(compiler, [...flags, source, ...objects, '-o', executable]);
    const output = await run(executable, []);
    const lines = output.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    assert.deepEqual(lines, fixture.expectedOutput, fixture.name + ' native output');
    checks.push('native-record-identity-' + fixture.name);
  }
  return checks;
}
