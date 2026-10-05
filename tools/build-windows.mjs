import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { dataOrigins } = createRequire(import.meta.url)('../desktop/policy.cjs');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function parseOptions(args) {
  const options = { arch: 'x64', graphics: 'webgpu', out: path.join(root, 'release', 'windows'), stageOnly: false, unpacked: false };
  const values = { '--arch': 'arch', '--graphics': 'graphics', '--out': 'out', '--project': 'project', '--name': 'name', '--source-root': 'sourceRoot' };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--stage-only') options.stageOnly = true;
    else if (arg === '--data-origin') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for --data-origin');
      (options.dataOrigins ||= []).push(args[++i]);
    }
    else if (arg === '--dir') options.unpacked = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--no-extract') throw new Error('The portable target is one distributable EXE but extracts its embedded runtime at launch. Use build:win32 for the separate no-extraction x86 native/GDI target.');
    else if (values[arg]) {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + arg);
      options[values[arg]] = args[++i];
    } else throw new Error('Unknown option: ' + arg);
  }
  if (!['x64', 'arm64'].includes(options.arch)) throw new Error('--arch must be x64 or arm64');
  if (!['webgpu', 'auto', 'canvas2d'].includes(options.graphics)) throw new Error('--graphics must be webgpu, auto, or canvas2d');
  if (options.dataOrigins) options.dataOrigins = dataOrigins(options.dataOrigins);
  return options;
}
export function productName(value) {
  const name = String(value).trim();
  if (!name || name.length > 100 || /[<>:"/\\|?*\u0000-\u001f]/.test(name) || /[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error('Invalid Windows product name');
  return name;
}
export function externalizeScripts(html) {
  const files = new Map(), scripts = [];
  let index = 0;
  const result = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi, (full, attributes, source) => {
    const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
    if (type && !['text/javascript', 'application/javascript'].includes(type)) {
      if (type === 'application/json') return full;
      throw new Error('Unsupported script type in native entry: ' + type);
    }
    const src = attributes.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1];
    if (src) {
      if (!/^[\w./-]+$/.test(src) || src.startsWith('/') || src.split('/').includes('..')) throw new Error('Native entry references a nonlocal script');
      scripts.push(src);
    } else { const name = 'entry-' + index++ + '.js'; files.set(name, source); scripts.push(name); }
    return '';
  });
  if (!/<\/head\s*>/i.test(result) || !scripts.length) throw new Error('Native entry must be a complete application document');
  return { html: result.replace(/<\/head\s*>/i, '<script type="module" src="boot.mjs"></script></head>'), files, scripts };
}
export async function readProject(filename, sourceRoot) {
  const file = path.resolve(filename), bytes = await fs.readFile(file);
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Project exceeds 20 MiB');
  const { normalizeProject } = await import('../src/project/model.js');
  let project;
  if (/\.(vb6web|vb6proj|json)$/i.test(file)) project = normalizeProject(JSON.parse(bytes.toString('utf8')));
  else if (/\.vbp$/i.test(file)) {
    const base = path.resolve(sourceRoot || path.dirname(file)), relative = path.relative(base, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Project must be inside --source-root');
    const entries = [[relative.split(path.sep).join('/'), new Uint8Array(bytes)]];
    let total = bytes.length;
    async function walk(directory) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isSymbolicLink() || ['.git', 'node_modules', '.native-build', 'release', 'dist'].includes(entry.name)) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.(frm|bas|cls|frx|res|png|jpe?g|gif|bmp|ico|wmf|emf|rtf)$/i.test(entry.name) || /\.vbp\.vb6data\.json$/i.test(entry.name)) {
          const stat = await fs.stat(full);
          if (stat.size > 20 * 1024 * 1024 || (total += stat.size) > 100 * 1024 * 1024 || entries.length >= 10000) throw new Error('Project resource limit exceeded');
          entries.push([path.relative(base, full).split(path.sep).join('/'), new Uint8Array(await fs.readFile(full))]);
        }
      }
    }
    await walk(base);
    const { importFiles } = await import('../src/project/formats.js');
    const result = await importFiles(entries);
    const errors = result.diagnostics.filter(d => d.severity === 'error');
    if (errors.length) throw new Error(errors.map(d => d.message).join('\n'));
    project = result.project;
  } else throw new Error('Expected a .vb6web, .vb6proj, .json, or .vbp project');
  const type = project.nativeProject?.entries?.find(e => e.key.toLowerCase() === 'type')?.value;
  if (type && type.toLowerCase() !== 'exe') throw new Error('Only Standard EXE projects are supported; ActiveX EXE/DLL targets are not implemented');
  return project;
}
export async function stageWindows(options) {
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const project = options.project ? await readProject(options.project, options.sourceRoot) : null;
  const name = productName(options.name || project?.name || 'VB6 Studio');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'application';
  const appId = 'org.vb6studio.' + slug + '.' + sha256(name).slice(0, 12);
  const stage = path.join(root, '.native-build', slug + '-' + options.arch);
  const output = path.resolve(options.out);
  if (output === stage || output.startsWith(stage + path.sep)) throw new Error('Output directory must not be inside the staging directory');
  await fs.rm(stage, { recursive: true, force: true }); await fs.mkdir(path.join(stage, 'web'), { recursive: true });
  for (const file of ['main.cjs', 'preload.cjs', 'policy.cjs', 'smoke.cjs']) await fs.copyFile(path.join(root, 'desktop', file), path.join(stage, file));
  for (const file of ['boot.mjs', 'studio.mjs', 'gpu-probe.mjs', 'window-transport.mjs']) await fs.copyFile(path.join(root, 'desktop', file), path.join(stage, 'web', file));
  await fs.copyFile(path.join(root, 'LICENSE'), path.join(stage, 'LICENSE'));
  await fs.copyFile(path.join(root, 'THIRD-PARTY-NOTICES.md'), path.join(stage, 'THIRD-PARTY-NOTICES.md'));
  await fs.copyFile(path.join(root, 'src/data/vendor/LICENSE.sql.js'), path.join(stage, 'LICENSE.sql.js'));
  let html;
  if (project) {
    project.settings = { ...project.settings, renderer: options.graphics };
    const { exportApplication } = await import('../src/exporter/exporter.js');
    html = exportApplication(project, { persist: true, nativeWindows: true });
  } else {
    html = await fs.readFile(path.join(root, 'dist', 'index.html'), 'utf8');
    for (const file of ['studio.js', 'studio.css', 'vb6-runtime.js', 'vb6-controls.css']) await fs.copyFile(path.join(root, 'dist', file), path.join(stage, 'web', file));
  }
  const entry = externalizeScripts(html);
  await fs.writeFile(path.join(stage, 'web', 'index.html'), entry.html);
  for (const [file, text] of entry.files) await fs.writeFile(path.join(stage, 'web', file), text);
  const files = {};
  for (const file of (await fs.readdir(path.join(stage, 'web'))).sort()) files[file] = sha256(await fs.readFile(path.join(stage, 'web', file)));
  for (const file of entry.scripts) if (!Object.hasOwn(files, file.replace(/^\.\//, ''))) throw new Error('Missing bundled entry script: ' + file);
  const origins = dataOrigins([...(options.dataOrigins || []), ...(project?.dataSources?.connections || [])
    .filter(c => ['rest', 'odata', 'graphql', 'gateway'].includes(c.provider)).map(c => new URL(c.url).origin)]);
  const manifest = { version: 1, name, appId, dataOrigins: origins, kind: project ? 'application' : 'studio', graphics: options.graphics, scripts: entry.scripts, files };
  await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await fs.writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'vb6-' + slug, version: pkg.version, productName: name, description: project ? 'VB6 standalone Windows application' : 'VB6 Studio for Windows', main: 'main.cjs', author: 'VB6 Studio contributors', license: 'MIT' }, null, 2) + '\n');
  return { stage, output, manifest, version: pkg.version };
}
export async function verifyExecutable(file, arch) {
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(64); await handle.read(header, 0, header.length, 0);
    if (header.toString('ascii', 0, 2) !== 'MZ') throw new Error('Not a Windows executable');
    const pe = Buffer.alloc(6); await handle.read(pe, 0, pe.length, header.readUInt32LE(0x3c));
    if (pe.toString('ascii', 0, 4) !== 'PE\0\0') throw new Error('Invalid PE header');
    // NSIS portable launchers are normally x86 even when the embedded app is x64/ARM64.
    if (![0x14c, 0x8664, 0xaa64].includes(pe.readUInt16LE(4))) throw new Error('Unknown PE machine type');
    return { machine: pe.readUInt16LE(4), payloadArch: arch, size: (await handle.stat()).size };
  } finally { await handle.close(); }
}
export async function buildWindows(options) {
  execFileSync(process.execPath, [path.join(root, 'tools', 'build.mjs')], { cwd: root, stdio: 'inherit' });
  const result = await stageWindows(options);
  if (options.stageOnly) { console.log(JSON.stringify(result, null, 2)); return result; }
  const require = createRequire(path.join(root, 'desktop', 'package.json'));
  let builder;
  try { builder = require('electron-builder'); } catch { throw new Error('Install desktop build tools first: npm --prefix desktop install'); }
  const desktopPackage = JSON.parse(await fs.readFile(path.join(root, 'desktop', 'package.json'), 'utf8'));
  const architecture = options.arch === 'arm64' ? builder.Arch.arm64 : builder.Arch.x64;
  const targets = builder.Platform.WINDOWS.createTarget(options.unpacked ? 'dir' : 'portable', architecture);
  const artifacts = await builder.build({ targets, projectDir: result.stage, publish: 'never', config: {
    appId: result.manifest.appId, productName: result.manifest.name, electronVersion: desktopPackage.devDependencies.electron,
    asar: true, npmRebuild: false, directories: { output: result.output },
    files: ['*.cjs', 'manifest.json', 'web/**/*', 'package.json', 'LICENSE', 'LICENSE.sql.js', 'THIRD-PARTY-NOTICES.md'],
    win: { target: ['portable'], artifactName: '${productName}-${version}-win-${arch}.${ext}', requestedExecutionLevel: 'asInvoker' },
    portable: { requestExecutionLevel: 'user' }
  } });
  const executables = artifacts.filter(file => file.endsWith('.exe'));
  if (!options.unpacked && executables.length !== 1) throw new Error('Expected exactly one portable executable');
  const evidence = [];
  for (const file of executables) evidence.push({ file: path.basename(file), ...await verifyExecutable(file, options.arch), sha256: sha256(await fs.readFile(file)) });
  if (evidence.length) {
    await fs.writeFile(path.join(result.output, 'SHA256SUMS-' + options.arch + '.txt'), evidence.map(e => e.sha256 + '  ' + e.file).join('\n') + '\n');
    await fs.writeFile(path.join(result.output, 'build-info-' + options.arch + '.json'), JSON.stringify({ ...result.manifest, electron: desktopPackage.devDependencies.electron, builder: desktopPackage.devDependencies['electron-builder'], packaging: 'portable-self-extracting', artifacts: evidence }, null, 2) + '\n');
  }
  console.log(JSON.stringify({ stage: result.stage, artifacts: evidence }, null, 2));
  return { ...result, artifacts: evidence };
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) console.log('Build a single-distribution Windows EXE:\n  npm run build:windows -- [--project file.vb6web|file.vbp] [--arch x64|arm64]\n  [--graphics webgpu|auto|canvas2d] [--name "My App"] [--out directory]\n  [--source-root directory] [--data-origin https://api.example.com] [--stage-only] [--dir]\nThe portable target extracts its embedded Electron runtime at launch.');
    else await buildWindows(options);
  } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; }
}
