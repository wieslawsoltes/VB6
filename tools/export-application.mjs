#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {writeZip} from '../src/project/zip.js';

const usage = `Usage: node tools/export-application.mjs PROJECT.vb6web --out PATH [--format html|directory|zip]
       node tools/export-application.mjs PROJECT.vb6web --check
Options:
  --options FILE    JSON runtime options (no credentials or callbacks)
  --document FILE   JSON title/language/direction/description and trusted scripts
  --help            Show this help without building the runtime
Build once with npm run build. Existing output is never overwritten.
Import classic projects in the IDE, then save as .vb6web before using this CLI.`;

async function readJSON(file) {
  if ((await fs.stat(file)).size > 64 * 1024 * 1024) throw new Error('Input exceeds the 64 MiB file limit: ' + file);
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error instanceof SyntaxError) throw new Error('Invalid JSON in ' + file); throw error; }
}

async function main(args) {
  if (args.includes('--help')) { console.log(usage); return; }
  const settings = {format: 'html'};
  let input;
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      if (input) throw new Error('Only one project input is allowed');
      input = arg; continue;
    }
    if (!['--out', '--format', '--options', '--document', '--check'].includes(arg)) throw new Error('Unknown option: ' + arg);
    if (seen.has(arg)) throw new Error('Repeated option: ' + arg);
    seen.add(arg);
    if (arg === '--check') settings.check = true;
    else {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Missing value for ' + arg);
      settings[arg.slice(2)] = args[++i];
    }
  }
  if (!input || !settings.check && !settings.out) throw new Error(usage);
  if (!['html', 'directory', 'zip'].includes(settings.format)) throw new Error('Expected format html, directory or zip');
  const project = await readJSON(input);
  const options = settings.options ? await readJSON(settings.options) : {};
  const document = settings.document ? await readJSON(settings.document) : {};
  let exporter;
  try { exporter = await import('../src/exporter/exporter.js'); }
  catch (error) { if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error('Run npm run build to generate the matching runtime payload first'); throw error; }
  if (settings.check) {
    const report = exporter.inspectApplicationExport(project, options, document);
    console.log(JSON.stringify(report, null, 2));
    if (!report.valid) process.exitCode = 1;
    return;
  }
  // Render and validate everything before claiming an output path. Exclusive
  // creation also rejects existing files, directories and symlinks; no --force.
  const output = path.resolve(settings.out);
  if (settings.format === 'html') {
    const html = exporter.exportApplication(project, options, document);
    await fs.writeFile(output, html, {flag: 'wx'});
  } else {
    const deployment = exporter.exportApplicationFiles(project, options, document);
    if (settings.format === 'zip') await fs.writeFile(output, writeZip(deployment.files), {flag: 'wx'});
    else {
      await fs.mkdir(output, {mode: 0o755});
      for (const [name, data] of Object.entries(deployment.files)) await fs.writeFile(path.join(output, name), data, {flag: 'wx'});
    }
    for (const diagnostic of deployment.diagnostics) console.error(diagnostic.code + ': ' + diagnostic.message);
  }
  console.log('Exported ' + settings.format + ': ' + output);
}

main(process.argv.slice(2)).catch(error => {
  if (error.code === 'EEXIST') console.error('Output already exists; choose a new path. Nothing was overwritten.');
  else if (error.diagnostics) console.error(JSON.stringify({valid: false, diagnostics: error.diagnostics}, null, 2));
  else console.error(error.message || String(error));
  process.exitCode = 1;
});
