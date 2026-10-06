import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {exportApplicationFiles, exportApplication, createApplicationExporter} from '../src/exporter/exporter.js';
import {EXAMPLES} from '../src/project/examples.js';
import {newProject} from '../src/project/model.js';
import {applicationThemeGallery} from '../tests/fixtures/application-theme-gallery.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, 'reports/exporter');
fs.mkdirSync(directory, {recursive: true});
function write(name, deployment) {
  const destination = path.join(directory, name); fs.mkdirSync(destination, {recursive: true});
  for (const [file, content] of Object.entries(deployment.files)) fs.writeFileSync(path.join(destination, file), content);
}
const catalog = EXAMPLES.map(example => {
  const project = JSON.parse(fs.readFileSync(path.join(root, 'examples', example.id + '.vb6web')));
  write(example.id, exportApplicationFiles(project, {persist: false}));
  return example.id;
});
write('gallery', exportApplicationFiles(applicationThemeGallery('fluent-dark'), {persist: false}));
const project = newProject('Export lifecycle'); project.id = 'export-lifecycle-fixture';
project.vfs.files['/binary.dat'] = {encoding: 'base64', data: 'AP+A'};
project.appSettings = {initial: 'authored'};
const document = {language: 'pl-PL', scripts: {'adapter.js': `
globalThis.adapterMessages = [];
globalThis.vb6ConfigureApplication = async ({runtime}) => {
  await Promise.resolve();
  globalThis.adapterRuntimePresent = typeof runtime.RuntimeAPI.AutomationRegistry === 'function';
  return {onMessage: message => adapterMessages.push(message.type), dataCredential: async () => 'fixture-session-only'};
};
globalThis.readyEvents = 0;
addEventListener('vb6:ready', () => { readyEvents++; });
addEventListener('unhandledrejection', () => { globalThis.unhandledExportRejection = true; });
`}};
write('adapter', exportApplicationFiles(project, {nativeWindows: false}, document));
write('no-persist', exportApplicationFiles(project, {nativeWindows: false, persist: false}, document));
fs.writeFileSync(path.join(directory, 'adapter.html'), exportApplication(project, {nativeWindows: false, persist: false}, document));
const failing = newProject('Startup failure'); failing.modules[0].code = 'Private Sub Form_Load()\nErr.Raise 5, "ExportFixture", "Visible startup failure"\nEnd Sub';
write('vb-error', exportApplicationFiles(failing, {persist: false, nativeWindows: false}));
const missing = createApplicationExporter({runtimeSource: '// intentionally missing runtime for failure test', runtimeCSS: ''});
write('missing-runtime', missing.files(project, {persist: false}));
write('adapter-error', exportApplicationFiles(project, {persist: false}, {scripts: {'adapter.js': 'globalThis.vb6ConfigureApplication = async () => { throw new Error("Adapter rejected <tag>"); };'}}));
fs.writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify(catalog));
console.log('Built ' + catalog.length + ' full-runtime deployments and lifecycle/failure fixtures.');
