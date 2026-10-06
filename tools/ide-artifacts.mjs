/** Verify reproducible IDE outputs without storing multi-megabyte bundles in Git. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export const IDE_ARTIFACTS = Object.freeze(['dist/studio.js', 'dist/VB6-Studio-Web.html']);
const MANIFEST = 'tools/ide-artifacts.json';
const rootDirectory = path.resolve(import.meta.dirname, '..');

function snapshot(root) {
  return Object.fromEntries(IDE_ARTIFACTS.map(name => {
    const file = path.join(root, name);
    if (!fs.lstatSync(file).isFile()) throw new Error(`IDE artifact must be a regular file: ${name}`);
    const data = fs.readFileSync(file);
    return [name, {bytes: data.length, sha256: createHash('sha256').update(data).digest('hex')}];
  }));
}

function validateManifest(value) {
  if (!value || value.version !== 1 || !value.files || Array.isArray(value.files) ||
      Object.keys(value).sort().join(',') !== 'files,version' ||
      Object.keys(value.files).sort().join('\n') !== [...IDE_ARTIFACTS].sort().join('\n')) {
    throw new Error('Invalid IDE artifact manifest: both exact output paths are required');
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
  for (const name of IDE_ARTIFACTS) {
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
  const manifest = {version: 1, files: snapshot(root)};
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
  console.log('Both generated IDE artifacts match the committed byte lengths and SHA-256 fingerprints.');
}
