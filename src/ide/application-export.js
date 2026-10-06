import {download, safeName} from '../core/core.js';
import {writeZip} from '../project/zip.js';
import {exportApplicationFiles, inspectApplicationExport, createApplicationExporter} from '../exporter/exporter.js';

/** Local download command; deliberately not an arbitrary agent UI command.
 * Existing MCP export tools keep their consent/revision checks unchanged.
 */
export function installApplicationExport(ide, api) {
  if (ide.applicationExportInstalled) return;
  ide.applicationExportInstalled = true;
  Object.assign(api, {exportApplicationFiles, inspectApplicationExport, createApplicationExporter});
  const menu = ide.menu.bind(ide), command = ide.command.bind(ide);
  ide.menu = name => {
    const items = menu(name);
    if (name === 'File') {
      const index = items.findIndex(item => item?.id === 'exportHTML');
      items.splice(index + 1, 0, {id: 'exportDeployment', label: 'Make Deployment Archive (.zip)…', icon: 'export', enabled: ide.runState === 'design'});
    }
    return items;
  };
  ide.command = async (id, ...args) => {
    if (id !== 'exportDeployment') return command(id, ...args);
    if (ide.runState !== 'design') { ide.status('Stop execution before exporting a deployment.'); return; }
    try {
      const deployment = exportApplicationFiles(ide.project);
      const bytes = writeZip(deployment.files);
      download(safeName(ide.project.name) + '-app.zip', bytes, 'application/zip');
      ide.lastApplicationExport = deployment.manifest;
      const warnings = deployment.diagnostics.filter(d => d.severity === 'warning').length;
      ide.status('Made deployment archive — ' + Object.keys(deployment.files).length + ' files, ' + Math.round(bytes.length / 1024) + ' KB.' + (warnings ? ' Review ' + warnings + ' deployment warning(s) in manifest.json.' : ''));
      ide.emit('export', {kind: 'deployment', manifest: deployment.manifest});
    } catch (error) {
      ide.lastApplicationExport = {diagnostics: error.diagnostics || [{severity: 'error', message: error.message}]};
      ide.status('Deployment export failed: ' + error.message);
    }
  };
}
