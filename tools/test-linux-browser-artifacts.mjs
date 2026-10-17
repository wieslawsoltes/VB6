/** Execute only browser artifacts that exactly match our reviewed fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {exportLinuxApplication, verifyLinuxAOTArchive} from '../packages/linux-native/src/index.js';
import {readZip} from '../src/project/zip.js';
import {linuxBrowserProject} from '../tests/linux-browser-fixture.mjs';

if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Browser ELF execution requires native Linux x86-64.');
const input = path.resolve(process.argv[2] || 'reports/linux-aot-browser');
const expected = await exportLinuxApplication(linuxBrowserProject()), cases = [];
for (const browser of ['chromium', 'firefox', 'webkit']) for (const origin of ['http', 'file']) {
  const filename = browser + '-' + origin + '.zip', bytes = new Uint8Array(await fs.readFile(path.join(input, filename)));
  assert.deepEqual(bytes, expected.bytes, filename + ' must match the exact current-source fixture');
  await verifyLinuxAOTArchive(bytes, {name: 'LinuxBrowser'});
  const files = await readZip(bytes), work = await fs.mkdtemp(path.join(os.tmpdir(), 'vb6-linux-browser-'));
  try {
    // Exact byte comparison above establishes the file set before extraction.
    for (const [name, content] of files) {
      const file = path.join(work, name); await fs.mkdir(path.dirname(file), {recursive: true});
      await fs.writeFile(file, content, {flag: 'wx', mode: name === 'LinuxBrowser/bin/LinuxBrowser' ? 0o755 : 0o644});
    }
    const executable = path.join(work, 'LinuxBrowser/bin/LinuxBrowser');
    const result = spawnSync(executable, [], {cwd: os.tmpdir(), encoding: 'utf8', timeout: 30000, env: {...process.env, DISPLAY: '', WAYLAND_DISPLAY: ''}});
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, filename + '\n' + result.stderr);
    assert.equal(result.stdout.trim(), 'LINUX_BROWSER_AOT_OK');
    cases.push({browser, origin, archiveSha256: createHash('sha256').update(bytes).digest('hex'), exitCode: result.status, output: result.stdout.trim()});
    console.log('PASS actual browser ELF execution:', browser, origin);
  } finally {await fs.rm(work, {recursive: true, force: true});}
}
const out = path.resolve('reports/linux-aot-browser-native'); await fs.mkdir(out, {recursive: true});
await fs.writeFile(path.join(out, 'validation.json'), JSON.stringify({platform: process.platform, architecture: process.arch, passed: true, cases}, null, 2) + '\n');
