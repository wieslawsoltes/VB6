/** Verify reproducible IDE/runtime/sample outputs against reviewed source fingerprints. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {EXAMPLES} from '../src/project/examples.js';

export const IDE_ARTIFACTS = Object.freeze(['dist/studio.js', 'dist/VB6-Studio-Web.html']);
// Derive sample paths from the authored catalog, never from an unchecked manifest.
const sampleIds = EXAMPLES.map(example => example.id);
if (sampleIds.some(id => typeof id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) ||
    new Set(sampleIds).size !== sampleIds.length) throw new Error('Invalid generated sample inventory');
export const LAYOUT_GENERATED_ARTIFACTS = Object.freeze(['dist/auto-layout.js', 'packages/auto-layout/dist/auto-layout.js', 'dist/vb6-native.js', 'src/editor/diagnostics-payload.js', 'dist/studio.css']);
export const WIN32_ARTIFACTS = Object.freeze(['dist/win32-browser.js','packages/win32-browser/dist/win32-browser.js']);
export const RENDERING_ARTIFACTS = Object.freeze(['dist/vb6-rendering.js']);
export const INTELLIGENT_UI_ARTIFACTS = Object.freeze(['dist/intelligent-ui-sandbox.html','packages/intelligent-ui/dist/intelligent-ui-sandbox.html','dist/intelligent-ui.js','dist/intelligent-ui-worker.js','dist/intelligent-ui.css','dist/intelligent-ui-mcp.html','src/intelligent-ui/payload.js','packages/intelligent-ui/dist/intelligent-ui.js','packages/intelligent-ui/dist/intelligent-ui-worker.js','packages/intelligent-ui/dist/intelligent-ui.css','packages/intelligent-ui/dist/intelligent-ui-mcp.html']);
export const GENERATED_ARTIFACTS = Object.freeze([
  ...IDE_ARTIFACTS, ...INTELLIGENT_UI_ARTIFACTS, ...WIN32_ARTIFACTS, ...RENDERING_ARTIFACTS, ...LAYOUT_GENERATED_ARTIFACTS, 'dist/vb6-controls.css', 'dist/vb6-runtime.js', 'src/exporter/runtime-payload.js',
  'dist/OCX-Source-Control-Lab.html',
  ...sampleIds.map(id => `dist/examples/${id}.html`)
]);
const MANIFEST = 'tools/ide-artifacts.json';
const rootDirectory = path.resolve(import.meta.dirname, '..');

function snapshot(root) {
  return Object.fromEntries(GENERATED_ARTIFACTS.map(name => {
    const file = path.join(root, name);
    if (!fs.lstatSync(file).isFile()) throw new Error(`IDE artifact must be a regular file: ${name}`);
    const data = fs.readFileSync(file);
    return [name, {bytes: data.length, sha256: createHash('sha256').update(data).digest('hex')}];
  }));
}

function validateManifest(value) {
  if (!value || value.version !== 2 || !value.files || Array.isArray(value.files) ||
      Object.keys(value).sort().join(',') !== 'files,version' ||
      Object.keys(value.files).sort().join('\n') !== [...GENERATED_ARTIFACTS].sort().join('\n')) {
    throw new Error('Invalid IDE artifact manifest: the exact IDE/runtime/sample inventory is required');
  }
  for (const [name, entry] of Object.entries(value.files)) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'bytes,sha256' ||
        !Number.isSafeInteger(entry.bytes) || entry.bytes < 1 ||
        typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error(`Invalid IDE artifact fingerprint: ${name}`);
    }
  }
}

export function verifyIdeArtifacts(root = rootDirectory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, MANIFEST), 'utf8'));
  validateManifest(manifest);
  const actual = snapshot(root);
  for (const name of GENERATED_ARTIFACTS) {
    const expected = manifest.files[name];
    if (expected.bytes !== actual[name].bytes || expected.sha256 !== actual[name].sha256) {
      throw new Error(`IDE artifact mismatch: ${name}. Review the source changes, then run npm run build:update-ide-artifacts and commit the updated manifest.`);
    }
  }
  return actual;
}

/** Explicit authoring operation. Normal builds never update their own expectations. */
export function recordIdeArtifacts(root = rootDirectory) {
  if (process.env.CI) throw new Error('IDE fingerprint updates are not permitted in CI');
  const manifest = {version: 2, files: snapshot(root)};
  validateManifest(manifest);
  const file = path.join(root, MANIFEST), temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
    fs.renameSync(temporary, file);
  } finally { fs.rmSync(temporary, {force: true}); }
  return manifest.files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyIdeArtifacts();
  console.log(`${GENERATED_ARTIFACTS.length} generated IDE/runtime/sample artifacts match their committed byte lengths and SHA-256 fingerprints.`);
}
