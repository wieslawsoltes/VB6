import {assertPublicConfiguration} from '../data/common.js';
import {ApplicationExportError, exportDiagnostic} from './diagnostics.js';
import {snapshotExportValue} from './serialization.js';

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function validateShape(project, options) {
  const errors = [];
  const require = (ok, message, path) => { if (!ok) errors.push(exportDiagnostic('EXPORT_INVALID_MODEL', message, path)); };
  require(object(project), 'Expected a project object', 'project');
  require(object(options), 'Expected runtime options', 'options');
  if (!object(project)) return errors;
  require(typeof project.name === 'string', 'Expected a project name', 'project.name');
  require(Array.isArray(project.modules) && project.modules.length > 0, 'Expected at least one module', 'project.modules');
  for (const [i, module] of (Array.isArray(project.modules) ? project.modules : []).entries()) {
    const path = `project.modules[${i}]`;
    require(object(module), 'Expected a module object', path);
    if (!object(module)) continue;
    require(typeof module.name === 'string' && !!module.name, 'Expected a module name', path + '.name');
    require(typeof module.code === 'string', 'Expected module source text', path + '.code');
    if (module.kind === 'form') require(object(module.form), 'Form module is missing its form model', path + '.form');
    if (module.form) {
      require(object(module.form), 'Expected a form model', path + '.form');
      require(Array.isArray(module.form.controls), 'Expected a control array', path + '.form.controls');
      require(module.form.menus === undefined || Array.isArray(module.form.menus), 'Expected a menu array', path + '.form.menus');
      for (const list of ['controls', 'menus']) for (const [j, node] of (Array.isArray(module.form[list]) ? module.form[list] : []).entries()) {
        require(object(node) && typeof node.name === 'string' && typeof node.type === 'string' && object(node.properties), 'Expected a named control/menu with properties', `${path}.form.${list}[${j}]`);
      }
    }
  }
  for (const key of ['settings', 'assets', 'vfs', 'appSettings']) require(project[key] === undefined || object(project[key]), 'Expected an object', 'project.' + key);
  require(project.references === undefined || Array.isArray(project.references), 'Expected a reference array', 'project.references');
  if (project.dataSources !== undefined) {
    require(object(project.dataSources) && Array.isArray(project.dataSources.connections) && Array.isArray(project.dataSources.commands), 'Expected data-source connections and commands', 'project.dataSources');
  }
  for (const [i, connection] of (Array.isArray(project.dataSources?.connections) ? project.dataSources.connections : []).entries()) {
    require(object(connection), 'Expected a data connection object', `project.dataSources.connections[${i}]`);
  }
  if (object(options)) {
    for (const key of ['persist', 'nativeWindows', 'debuggerEnabled', 'breakOnEntry', 'immediateContext']) require(options[key] === undefined || typeof options[key] === 'boolean', 'Expected a boolean runtime option', 'options.' + key);
    for (const key of ['breakpoints', 'watchpoints']) require(options[key] === undefined || Array.isArray(options[key]), 'Expected a debugger array', 'options.' + key);
    require(options.instructionLimit === undefined || Number.isSafeInteger(options.instructionLimit) && options.instructionLimit > 0, 'Expected a positive instruction limit', 'options.instructionLimit');
  }
  return errors;
}

/** Preserve all project fields. This is deliberately not normalizeProject, which
 * repairs IDs, renames projects and can change authored layout/renderer settings.
 */
export function prepareApplicationExport(input, runtimeOptions, compile) {
  const project = snapshotExportValue(input, 'project');
  const options = snapshotExportValue(runtimeOptions, 'options');
  const errors = validateShape(project, options);
  if (errors.length) throw new ApplicationExportError(errors);
  try {
    assertPublicConfiguration(project.dataSources);
    assertPublicConfiguration(options);
    for (const asset of Object.values(project.assets || {})) {
      const url = typeof asset === 'string' ? asset : asset?.url;
      if (typeof url === 'string' && /^(https?:)?\/\//i.test(url)) assertPublicConfiguration({url});
    }
    for (const module of project.modules) if (module.form) {
      assertPublicConfiguration(module.form.properties);
      for (const node of [...module.form.controls, ...(module.form.menus || [])]) assertPublicConfiguration(node.properties);
    }
  } catch (error) {
    throw new ApplicationExportError([exportDiagnostic('EXPORT_PRIVATE_CONFIGURATION', error.message, 'configuration', {number: error.number})]);
  }
  let compiled;
  try { compiled = compile(project); }
  catch (error) { throw new ApplicationExportError([exportDiagnostic('EXPORT_COMPILE_FAILED', error.message || 'Project compilation failed', undefined, {source: error.source, line: error.line, number: error.number})]); }
  if (!compiled || typeof compiled.valid !== 'boolean' || compiled.diagnostics !== undefined && !Array.isArray(compiled.diagnostics)) throw new ApplicationExportError([exportDiagnostic('EXPORT_COMPILE_FAILED', 'Compiler returned an invalid result')]);
  const diagnostics = (compiled.diagnostics || []).map(d => ({code: 'EXPORT_COMPILER_DIAGNOSTIC', ...d}));
  if (!compiled.valid) {
    throw new ApplicationExportError(diagnostics.length ? diagnostics : [exportDiagnostic('EXPORT_COMPILE_FAILED', 'Project compilation failed')]);
  }
  const dependencies = [];
  for (const [name, asset] of Object.entries(project.assets || {})) {
    const url = typeof asset === 'string' ? asset : asset?.url;
    if (typeof url !== 'string') continue;
    if (/^(blob:|file:)/i.test(url)) diagnostics.push(exportDiagnostic('EXPORT_TRANSIENT_ASSET', 'Transient blob/file assets must be imported as embedded project assets', 'project.assets.' + name));
    else if (/^(https?:)?\/\//i.test(url)) {
      dependencies.push({kind: 'asset', name, url});
      diagnostics.push(exportDiagnostic('EXPORT_EXTERNAL_ASSET', 'Remote asset requires network access at deployment', 'project.assets.' + name, {severity: 'warning'}));
    }
  }
  for (const connection of project.dataSources?.connections || []) if (connection.url) {
    dependencies.push({kind: 'data', name: connection.name, provider: connection.provider, url: connection.url});
    diagnostics.push(exportDiagnostic('EXPORT_DATA_SERVICE', 'Data service must be available and permit the deployed origin; credentials are supplied at runtime', 'project.dataSources', {severity: 'warning'}));
  }
  for (const module of compiled.modules?.values?.() || []) for (const proc of module.procedures?.values?.() || []) if (proc.external) {
    dependencies.push({kind: 'declare', source: module.name, name: proc.name, library: proc.external.library, entry: proc.external.entry});
  }
  if (diagnostics.some(d => d.severity === 'error')) throw new ApplicationExportError(diagnostics.filter(d => d.severity === 'error'));
  return {project, options: {persist: true, ...options}, diagnostics, dependencies};
}

export function applicationInventory(project) {
  return {
    modules: project.modules.length,
    forms: project.modules.filter(m => m.form).length,
    controls: project.modules.reduce((n, m) => n + (m.form?.controls.length || 0), 0),
    menus: project.modules.reduce((n, m) => n + (m.form?.menus?.length || 0), 0),
    assets: Object.keys(project.assets || {}).length,
    resources: project.resources?.entries?.length || 0,
    virtualFiles: Object.keys(project.vfs?.files || {}).length,
    references: project.references?.length || 0
  };
}
