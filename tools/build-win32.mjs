import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {compileWin32} from '../src/native/compiler.js';
import {readProject,productName} from './build-windows.mjs';
export async function buildWin32(options) {
  if (!options.project) throw new Error('--project is required');
  const project = await readProject(options.project,options.sourceRoot);
  if (options.name) project.name = productName(options.name);
  const name = productName(project.name), result = compileWin32(project,options);
  const output = path.resolve(options.out || 'release/win32'); await fs.mkdir(output,{recursive:true});
  const filename = path.join(output,name + '.exe');
  // Never overwrite an existing executable by accident.
  await fs.writeFile(filename,result.bytes,{flag:'wx'});
  const sha256 = createHash('sha256').update(result.bytes).digest('hex');
  await fs.writeFile(path.join(output,name + '.build.json'),JSON.stringify({...result.report,sha256},null,2)+'\n');
  await fs.writeFile(path.join(output,name + '.sha256'),sha256+'  '+name+'.exe\n');
  return {filename,...result.report,sha256};
}
export function parseWin32Options(args) {
  const options = {}, fields = {'--project':'project','--out':'out','--name':'name','--source-root':'sourceRoot','--arch':'arch','--graphics':'graphics'};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help') options.help = true;
    else if (fields[args[i]]) { if (!args[i+1] || args[i+1].startsWith('--')) throw new Error('Missing value for '+args[i]); options[fields[args[i]]] = args[++i]; }
    else throw new Error('Unknown Win32 option: '+args[i]);
  }
  return options;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { const options = parseWin32Options(process.argv.slice(2)); if (options.help) console.log('Build a no-extraction x86 Windows EXE in JavaScript:\n  npm run build:win32 -- --project file.vb6web|file.vbp [--out directory] [--name Name]\nNative controls/GDI; Byte/Integer/Long/Boolean, Single/Double, Strings and typed arrays. Unsupported features produce diagnostics, not an executable.'); else console.log(JSON.stringify(await buildWin32(options),null,2)); }
  catch(error) { console.error(error.message); process.exitCode = 1; }
}
