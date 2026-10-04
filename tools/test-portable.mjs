import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
const source = path.resolve(process.argv[2] || '');
if (!/\.exe$/i.test(source) || process.platform !== 'win32') throw new Error('Pass a Windows portable .exe on Windows');
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vb6-portable-smoke-'));
const executable = path.join(directory, path.basename(source));
await fs.copyFile(source, executable);
const reportPath = path.join(directory, 'smoke.json');
const code = await new Promise((resolve, reject) => {
  const child = spawn(executable, ['--native-smoke'], { cwd: directory, shell: false, env: { ...process.env, VB6_SMOKE_REPORT: reportPath, VB6_SMOKE_SOFTWARE_GPU: '1' }, stdio: 'inherit' });
  const timer = setTimeout(() => {
    const kill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { shell: false, stdio: 'ignore' });
    kill.on('error', () => child.kill());
    reject(new Error('Portable executable smoke timed out'));
  }, 120000);
  child.on('error', error => { clearTimeout(timer); reject(error); });
  child.on('close', code => { clearTimeout(timer); resolve(code); });
});
const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
await fs.mkdir('validation', { recursive: true });
await fs.writeFile(path.join('validation', path.basename(source) + '.smoke.json'), JSON.stringify(report, null, 2));
if (code !== 0 || !report.ok) throw new Error('Portable smoke failed: ' + JSON.stringify(report));
console.log(JSON.stringify(report, null, 2));
