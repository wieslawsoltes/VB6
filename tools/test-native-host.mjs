import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
const stage = path.resolve(process.argv[2] || '');
if (process.platform !== 'win32') throw new Error('Native host smoke requires Windows');
await fs.access(path.join(stage, 'manifest.json'));
const executable = path.resolve('desktop/node_modules/electron/dist/electron.exe');
await fs.mkdir('validation', { recursive: true });
const reportPath = path.resolve('validation', path.basename(stage) + '.host.json');
let output = '', failure = null;
const code = await new Promise(resolve => {
  const child = spawn(executable, [stage, '--native-smoke'], { cwd: process.cwd(), shell: false,
    env: { ...process.env, VB6_SMOKE_REPORT: reportPath, VB6_SMOKE_SOFTWARE_GPU: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const capture = data => { output = (output + data).slice(-1024 * 1024); process.stdout.write(data); };
  child.stdout.on('data', capture); child.stderr.on('data', capture);
  const timer = setTimeout(() => {
    failure = 'Native host smoke timed out';
    const kill = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { shell: false, stdio: 'ignore' });
    kill.on('error', () => child.kill());
    resolve(null);
  }, 90000);
  child.on('error', error => { clearTimeout(timer); failure = error.message; resolve(null); });
  child.on('close', code => { clearTimeout(timer); resolve(code); });
});
await fs.writeFile(reportPath + '.log', output);
let report;
try { report = JSON.parse(await fs.readFile(reportPath, 'utf8')); }
catch { report = { ok: false, error: failure || 'No smoke report produced', code, output }; await fs.writeFile(reportPath, JSON.stringify(report, null, 2)); }
console.log(JSON.stringify(report, null, 2));
if (failure || code !== 0 || !report.ok) throw new Error(failure || report.error || 'Native host smoke failed');
