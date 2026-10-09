import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {EXAMPLES} from '../src/project/examples.js';
import {compileWin32} from '../src/native/compiler.js';

/** Exercise the same compiler as File > Make Win32 EXE. Never substitute an
 * HTML/Electron export or treat an unsupported feature as a successful build. */
export async function checkWin32Samples({optimizations = [0, 1, 2]} = {}) {
  const results = [];
  for (const example of EXAMPLES) {
    const filename = new URL('../examples/' + example.id + '.vb6web', import.meta.url);
    const source = await fs.readFile(filename, 'utf8');
    for (const optimization of optimizations) {
      const project = JSON.parse(source), before = JSON.stringify(project);
      try {
        const {bytes, report} = compileWin32(project, {optimization});
        if (JSON.stringify(project) !== before) throw new Error('Compiler mutated the authored project');
        if (bytes[0] !== 0x4d || bytes[1] !== 0x5a || report.target !== 'win32-aot' || report.extraction !== false)
          throw new Error('Export is not a freestanding Win32 AOT executable');
        results.push({sample: example.id, optimization, success: true, bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex')});
      } catch (error) {
        results.push({sample: example.id, optimization, success: false, error: error.message,
          ...(error.diagnostics ? {diagnostics: error.diagnostics} : {})});
      }
    }
  }
  return {samples: EXAMPLES.length, passed: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length, results};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1) throw new Error('Usage: node tools/check-win32-samples.mjs [report.json]');
    const report = await checkWin32Samples();
    for (const result of report.results)
      console.log(`${result.success ? 'PASS' : 'FAIL'} ${result.sample} O${result.optimization}: ${result.success ? result.bytes + ' bytes' : result.error}`);
    if (args[0]) await fs.writeFile(path.resolve(args[0]), JSON.stringify(report, null, 2) + '\n');
    console.log(`${report.passed} passed; ${report.failed} failed; ${report.samples} samples`);
    process.exitCode = report.failed ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
