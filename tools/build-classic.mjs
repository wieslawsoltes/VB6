import {decodeLayoutSidecar} from '../src/layout/project-sidecar.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { productName } from './build-windows.mjs';
import { inspectPE, verifyClassicExecutable } from './pe.mjs';
import { encodeANSI, decodeANSI } from '../src/runtime/binary-codec.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function parseClassicOptions(args) {
  const result = { out: path.join(root, 'release', 'classic'), codegen: 'preserve', timeout: 120000 };
  const keys = { '--project': 'project', '--out': 'out', '--compiler': 'compiler', '--codegen': 'codegen', '--source-root': 'sourceRoot', '--name': 'name', '--timeout': 'timeout', '--inspect': 'inspect' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage-only') result.stageOnly = true;
    else if (args[i] === '--help') result.help = true;
    else if (keys[args[i]]) {
      const key = keys[args[i]];
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + args[i]);
      result[key] = args[++i];
    } else throw new Error('Unknown classic option: ' + args[i] + '. Classic VB6 uses the external 32-bit runtime, not WebGPU or an embedded runtime.');
  }
  if (!['preserve', 'native', 'pcode'].includes(result.codegen)) throw new Error('--codegen must be preserve, native, or pcode');
  result.timeout = Number(result.timeout);
  if (!Number.isInteger(result.timeout) || result.timeout < 1000 || result.timeout > 3600000) throw new Error('--timeout must be 1000..3600000 milliseconds');
  if (!result.help && !result.inspect && !result.project) throw new Error('--project is required');
  if (result.inspect && result.project) throw new Error('--inspect cannot be combined with --project');
  return result;
}
// Keep the document byte-preserving; decode only values used as filesystem paths.
const decodeVBP = bytes => Buffer.from(bytes).toString('latin1');
const ansiValue = value => decodeANSI(Buffer.from(value, 'latin1'));
function fields(text) {
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) break;
    const match = line.match(/^\s*([^=]+?)\s*=\s*(.*)$/);
    if (match) entries.push({ key: match[1], value: match[2] });
  }
  return entries;
}
const unquote = value => value?.trim().replace(/^"|"$/g, '') || '';
function field(text, key) {
  const values = fields(text).filter(e => e.key.toLowerCase() === key.toLowerCase());
  if (values.length > 1) throw new Error('Duplicate VBP field: ' + key);
  return unquote(values[0]?.value);
}
export function configureVBP(bytes, name, codegen = 'preserve') {
  const text = decodeVBP(bytes), type = field(text, 'Type').toLowerCase();
  if (!['exe', 'oleexe'].includes(type)) throw new Error('Classic target requires Type=Exe or Type=OleExe; DLL/OCX projects are not EXEs');
  productName(name);
  const patch = new Map([['exename32', `ExeName32="${name}.exe"`], ['path32', 'Path32="."'], ['autoincrementver', 'AutoIncrementVer=0']]);
  if (codegen !== 'preserve') {
    if (!['native', 'pcode'].includes(codegen)) throw new Error('Invalid code generation mode');
    patch.set('compilationtype', 'CompilationType=' + (codegen === 'native' ? 0 : 1));
  }
  for (const key of patch.keys()) field(text, key);
  const lines = [], seen = new Set(); let section = false;
  function appendMissing() { for (const [key, value] of patch) if (!seen.has(key)) { lines.push(value); seen.add(key); } }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!section && /^\s*\[/.test(line)) { appendMissing(); section = true; }
    const key = !section && line.match(/^\s*([^=]+?)\s*=/)?.[1].toLowerCase();
    if (key && patch.has(key)) { lines.push(patch.get(key)); seen.add(key); } else lines.push(line);
  }
  appendMissing();
  const encodedName = Buffer.from(encodeANSI(name)).toString('latin1');
  return Buffer.from(lines.join('\r\n').replace(`ExeName32="${name}.exe"`, `ExeName32="${encodedName}.exe"`), 'latin1');
}
function inside(base, file) { const relative = path.relative(base, file); return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); }
async function copySources(source, destination) {
  const excluded = new Set(['.git', 'node_modules', '.native-build', 'release', 'dist']);
  let total = 0, count = 0;
  async function visit(from, to) {
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from, { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new Error('Classic source tree contains a symlink: ' + entry.name);
      if (++count > 10000) throw new Error('Classic source tree exceeds 10,000 entries');
      const file = path.join(from, entry.name), target = path.join(to, entry.name);
      if (entry.isDirectory()) await visit(file, target);
      else if (entry.isFile()) {
        total += (await fs.stat(file)).size;
        if (total > 512 * 1024 * 1024) throw new Error('Classic source tree exceeds 512 MiB');
        await fs.copyFile(file, target);
      }
    }
  }
  await visit(source, destination);
}
export async function stageClassic(options) {
  const input = await fs.realpath(path.resolve(options.project));
  if ((await fs.stat(input)).size > 20 * 1024 * 1024) throw new Error('Project exceeds 20 MiB');
  const original = await fs.readFile(input);
  const native = /\.vbp$/i.test(input);
  if (!native && !/\.(vb6web|vb6proj|json)$/i.test(input)) throw new Error('Expected .vbp or .vb6web project');
  const project = native ? null : JSON.parse(original.toString('utf8'));
  let anchoring=project?.settings?.anchoring===true;
  if(native){try{const companion=await fs.readFile(input+'.vb6layout.json');anchoring=decodeLayoutSidecar(companion).enabled;}catch(error){if(error.code!=='ENOENT')throw error;}}
  if(anchoring)throw new Error('The licensed classic VB6 compiler does not support the optional anchoring/layout extension. Use the HTML/Electron Windows target, or disable anchoring and implement explicit classic Form_Resize code. Layout metadata will not be silently discarded.');
  const name = productName(options.name || (native ? ansiValue(field(decodeVBP(original), 'ExeName32')).replace(/\.exe$/i, '') || path.basename(input, path.extname(input)) : project.name));
  const buildBase = path.join(root, '.native-build'); await fs.mkdir(buildBase, { recursive: true });
  const stage = await fs.mkdtemp(path.join(buildBase, 'classic-'));
  const source = path.join(stage, 'source'), output = path.resolve(options.out), bin = path.join(stage, 'bin');
  if (inside(stage, output)) throw new Error('Output must not be in the staging directory');
  await fs.mkdir(bin, { recursive: true }); let vbp;
  if (native) {
    const sourceRoot = await fs.realpath(path.resolve(options.sourceRoot || path.dirname(input)));
    if (!inside(sourceRoot, input)) throw new Error('Project must be inside --source-root');
    for (const entry of fields(decodeVBP(original))) {
      if (!['form', 'module', 'class', 'usercontrol', 'propertypage', 'userdocument', 'designer', 'resfile32'].includes(entry.key.toLowerCase())) continue;
      const relative = ansiValue(unquote(['module', 'class'].includes(entry.key.toLowerCase()) ? entry.value.slice(entry.value.indexOf(';') + 1) : entry.value));
      const candidate = path.resolve(path.dirname(input), relative.replace(/\\/g, '/'));
      if (path.win32.isAbsolute(relative) || !inside(sourceRoot, candidate)) throw new Error('Source reference escapes --source-root: ' + relative);
      if (!inside(sourceRoot, await fs.realpath(candidate))) throw new Error('Source reference escapes through a symlink');
    }
    await copySources(sourceRoot, source);
    vbp = path.join(source, path.relative(sourceRoot, input));
  } else {
    const { normalizeProject } = await import('../src/project/model.js');
    const { sourceFiles } = await import('../src/project/formats.js');
    const files = sourceFiles(normalizeProject(project));
    for (const [relative, content] of Object.entries(files)) {
      const destination = path.resolve(source, relative.replace(/\\/g, '/'));
      if (!inside(source, destination) || destination === source) throw new Error('Unsafe exported source path');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, typeof content === 'string' ? encodeANSI(content) : content);
      if (/\.vbp$/i.test(relative)) { if (vbp) throw new Error('Multiple project files in export'); vbp = destination; }
    }
    if (!vbp) throw new Error('Export did not produce a VBP');
  }
  const bytes = await fs.readFile(vbp);
  const references = fields(decodeVBP(bytes)).filter(e => ['reference', 'object'].includes(e.key.toLowerCase()));
  await fs.writeFile(vbp, configureVBP(bytes, name, options.codegen));
  const result = { stage, vbp, bin, output, name, executable: path.join(bin, name + '.exe'), log: path.join(stage, 'compiler.log'),
    target: 'classic-vb6', arch: 'x86', codegen: options.codegen, runtime: 'MSVBVM60.DLL (external Windows component)', references,
    compiled: false, notes: ['Requires a separately installed licensed VB6 compiler and the project’s registered dependencies.', 'No compiler, Microsoft runtime, or third-party OCX is bundled or registered by this tool.', 'Classic executables do not use the JavaScript/WebGPU renderer.'] };
  await fs.writeFile(path.join(stage, 'build-plan.json'), JSON.stringify(result, null, 2));
  return result;
}
export async function findCompiler(options, env = process.env) {
  const explicit = options.compiler || env.VB6_COMPILER;
  const candidates = explicit ? [path.resolve(explicit)] : [env['ProgramFiles(x86)'], env.ProgramFiles].filter(Boolean).map(base => path.join(base, 'Microsoft Visual Studio', 'VB98', 'VB6.EXE'));
  for (const candidate of candidates) { try { if ((await fs.stat(candidate)).isFile()) return candidate; } catch {} }
  throw new Error('VB6.EXE was not found. Set VB6_COMPILER or pass --compiler with your licensed VB6 installation.');
}
export function compilerArguments(plan) { return ['/make', plan.vbp, '/out', plan.log, '/outdir', plan.bin]; }
export function runCompiler(executable, args, { cwd, timeout }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, windowsHide: true, stdio: 'ignore' });
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      if (process.platform === 'win32' && child.pid) {
        const kill = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { shell: false, windowsHide: true, stdio: 'ignore' });
        kill.on('error', () => child.kill());
      } else child.kill('SIGKILL');
    }, timeout);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => { clearTimeout(timer); if (expired) reject(new Error('VB6 compilation timed out; inspect the compiler log for missing references or UI prompts.')); else resolve({ code, signal }); });
  });
}
export async function buildClassic(options, dependencies = {}) {
  if (!options.stageOnly && (dependencies.platform || process.platform) !== 'win32') throw new Error('Classic VB6 compilation requires Windows. --stage-only is available on other platforms.');
  const plan = await stageClassic(options);
  if (options.stageOnly) return plan;
  const compiler = await findCompiler(options), args = compilerArguments(plan);
  const status = await (dependencies.runCompiler || runCompiler)(compiler, args, { cwd: path.dirname(plan.vbp), timeout: options.timeout });
  if (status.code !== 0 || status.signal) throw new Error(`VB6 compiler failed (${status.code ?? status.signal}); see ${plan.log}`);
  let bytes;
  try { bytes = await fs.readFile(plan.executable); } catch { throw new Error('VB6 did not create a fresh executable; see ' + plan.log); }
  const pe = verifyClassicExecutable(bytes), hash = createHash('sha256').update(bytes).digest('hex');
  await fs.mkdir(plan.output, { recursive: true });
  const target = path.join(plan.output, plan.name + '.exe');
  // Do not overwrite an existing output: use a fresh --out directory for each build.
  await fs.copyFile(plan.executable, target, (await import('node:fs')).constants.COPYFILE_EXCL);
  const result = { ...plan, executable: target, compiler, args, compiled: true, pe, sha256: hash };
  await fs.writeFile(path.join(plan.output, plan.name + '.build.json'), JSON.stringify(result, null, 2) + '\n');
  await fs.writeFile(path.join(plan.output, plan.name + '.sha256'), hash + '  ' + plan.name + '.exe\n');
  try { await fs.copyFile(plan.log, path.join(plan.output, plan.name + '.compiler.log')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseClassicOptions(process.argv.slice(2));
    if (options.help) console.log('Classic 32-bit VB6 runtime target:\n  npm run build:classic -- --project file.vbp [--codegen preserve|native|pcode]\n    [--compiler C:\\...\\VB6.EXE] [--source-root directory] [--out directory] [--stage-only]\n  npm run build:classic -- --inspect file.exe\nVB6_COMPILER may specify the licensed compiler. No proprietary runtime/compiler is bundled.');
    else console.log(JSON.stringify(options.inspect ? inspectPE(await fs.readFile(path.resolve(options.inspect))) : await buildClassic(options), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
