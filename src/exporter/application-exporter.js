import {compileProject} from '../language/compiler.js';
import {VERSION} from '../core/core.js';
import {ApplicationExportError, exportDiagnostic, exportFailure} from './diagnostics.js';
import {prepareApplicationExport, applicationInventory} from './preflight.js';
import {APPLICATION_SHELL_CSS, applicationDocument, documentSettings} from './document.js';
import {APPLICATION_BOOTSTRAP} from './bootstrap.js';

/** Reusable exporter independent of generated payload imports and IDE state.
 * The default facade supplies the full, build-matched browser runtime. Custom
 * runtimes must supply a matching compiler and VB6Runtime.mountApplication API.
 */
export function createApplicationExporter({runtimeSource, runtimeCSS, version = VERSION, compile = compileProject}) {
  if (typeof runtimeSource !== 'string' || !runtimeSource.trim() || typeof runtimeCSS !== 'string' || typeof version !== 'string' || typeof compile !== 'function') {
    throw exportFailure('EXPORT_INVALID_RUNTIME', 'Expected runtime source, CSS, version and compiler', 'runtime');
  }
  const css = APPLICATION_SHELL_CSS + '\n' + runtimeCSS;
  const prepare = (project, options, document) => ({...prepareApplicationExport(project, options, compile), document: documentSettings(document), version, css});
  const manifestFor = result => ({
    schema: 1, target: 'browser', runtimeVersion: version, project: {id: result.project.id, name: result.project.name},
    inventory: applicationInventory(result.project), dependencies: result.dependencies, diagnostics: result.diagnostics
  });
  function inspect(project, options = {}, document = {}) {
    try { return {valid: true, ...manifestFor(prepare(project, options, document))}; }
    catch (error) {
      return {valid: false, diagnostics: error instanceof ApplicationExportError ? error.diagnostics : [exportDiagnostic('EXPORT_FAILED', error.message || 'Export preflight failed')]};
    }
  }
  function html(project, options = {}, document = {}) {
    const result = prepare(project, options, document);
    return applicationDocument({...result, scripts: [runtimeSource, ...Object.values(result.document.scripts), APPLICATION_BOOTSTRAP]});
  }
  function files(project, options = {}, document = {}) {
    const result = prepare(project, options, document);
    const scripts = ['runtime.js', ...Object.keys(result.document.scripts), 'bootstrap.js'];
    const output = {
      'index.html': applicationDocument({...result, scripts, external: true}),
      'app.css': css,
      'runtime.js': runtimeSource,
      ...result.document.scripts,
      'bootstrap.js': APPLICATION_BOOTSTRAP
    };
    const encoder = new TextEncoder();
    const manifest = {...manifestFor(result), entry: 'index.html', files: Object.entries(output).map(([path, content]) => ({path, bytes: encoder.encode(content).byteLength}))};
    // No timestamps, random IDs, network access or source normalization. A fixed
    // input/payload produces byte-identical HTML, files and manifest.
    output['manifest.json'] = JSON.stringify(manifest, null, 2) + '\n';
    return {entry: 'index.html', files: output, manifest, diagnostics: result.diagnostics};
  }
  return Object.freeze({inspect, html, files});
}
