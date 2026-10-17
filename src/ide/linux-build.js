import {el} from '../core/core.js';
import {modal} from './ui.js';
import {compileLinuxAOT, exportLinuxApplication, verifyLinuxAOTArchive} from '../../packages/linux-native/src/index.js';

/** The same project snapshot and native compiler serve the IDE, CLI and MCP. */
export function installLinuxExport(ide, api) {
  if (ide.linuxExportInstalled) return;
  ide.linuxExportInstalled = true;
  if (api) Object.assign(api, {compileLinuxAOT, exportLinuxApplication, verifyLinuxAOTArchive});
  const menu = ide.menu.bind(ide), command = ide.command.bind(ide);
  let opened = false;
  ide.menu = name => {
    const items = menu(name);
    if (name === 'File') {
      const index = items.findIndex(item => item?.id === 'exportMacOS');
      items.splice(index < 0 ? items.length : index + 1, 0, {
        id: 'exportLinux', label: 'Make ' + ide.project.name + ' (Linux GTK AOT)…',
        icon: 'export', enabled: ide.runState === 'design' && !opened
      });
    }
    return items;
  };
  ide.command = async (id, ...args) => {
    if (id !== 'exportLinux') return command(id, ...args);
    if (opened || ide.runState !== 'design') {
      ide.status('Stop execution and close the current Linux build dialog before exporting.');
      return;
    }
    opened = true;
    const cancelled = new AbortController();
    let alive = true, busy = false, releaseDownload;
    const name = el('input', {value: ide.project.name, maxlength: 100, 'aria-label': 'Linux application name'});
    const optimization = el('select', {'aria-label': 'Linux native optimization'},
      ...[0, 1, 2, 3].map(level => el('option', {value: String(level), selected: level === 2}, 'O' + level)));
    const output = el('pre', {role: 'status', 'aria-live': 'polite', tabindex: -1,
      style: {whiteSpace: 'pre-wrap', maxHeight: '180px', overflow: 'auto', margin: '8px 0'}});
    const downloads = el('div', {'data-linux-download': '', style: {overflowWrap: 'anywhere', marginBottom: '10px'}});
    const fields = [name, optimization];
    const selected = () => ({name: name.value, optimization: Number(optimization.value)});
    const field = (caption, input) => el('label', {style: {display: 'grid', gridTemplateColumns: '145px minmax(0,1fr)', gap: '8px', marginBottom: '8px'}},
      el('span', {}, caption), input);
    const clearDownload = () => {releaseDownload?.(); releaseDownload = undefined; downloads.replaceChildren();};
    const diagnostics = error => error.diagnostics?.length
      ? error.diagnostics.map(item => [item.module || item.source, item.line, item.message].filter(value => value !== undefined && value !== '').join(': ')).join('\n')
      : error.message;
    const content = el('div', {},
      el('p', {}, 'Export a native Linux x86-64 executable with GTK controls. Compilation works here, including in the offline standalone IDE.'),
      field('Application name', name), field('Optimization', optimization),
      el('p', {}, 'Extract the ZIP on Linux and run the application in its bin directory. Keep the Resources directory beside bin. The target system needs GTK 3.24 and the system libraries listed in the archive.'),
      output, downloads);

    function preflight() {
      try {
        const result = compileLinuxAOT(ide.project, selected());
        output.textContent = result.report.modules + ' modules, ' + result.report.procedures + ' native procedures, '
          + result.report.codeBytes + ' bytes of project code.\nTarget: Linux x86-64 / GTK 3.24. Optimization: O' + result.options.optimization + '.';
      } catch (error) {output.textContent = diagnostics(error);}
    }
    for (const input of fields) input.addEventListener('change', () => {clearDownload(); preflight();});
    preflight();

    function offerArchive(filename, bytes) {
      clearDownload();
      const doc = downloads.ownerDocument, view = doc.defaultView;
      const url = view.URL.createObjectURL(new view.Blob([bytes], {type: 'application/zip'}));
      const link = doc.createElement('a');
      link.href = url; link.download = filename; link.textContent = 'Save ZIP: ' + filename;
      downloads.append(link);
      // Keep a clicked download alive long enough for the browser to consume it.
      releaseDownload = () => view.setTimeout(() => view.URL.revokeObjectURL(url), 60000);
      try {link.click();} catch (error) {downloads.append(doc.createTextNode(' Use Save ZIP to download: ' + error.message));}
    }

    async function perform() {
      if (!alive || busy) return false;
      busy = true; clearDownload(); fields.forEach(input => input.disabled = true);
      try {
        if (ide.runState !== 'design') throw new Error('Stop execution before exporting.');
        const project = ide.project, snapshot = JSON.stringify(project), options = selected();
        output.textContent = 'Compiling native x86-64 code and linking the GTK runtime…';
        const result = await exportLinuxApplication(JSON.parse(snapshot), options, {signal: cancelled.signal});
        cancelled.signal.throwIfAborted();
        if (!alive) return false;
        if (ide.project !== project || JSON.stringify(ide.project) !== snapshot || ide.runState !== 'design')
          throw new Error('Project changed during export. Build again to download the current revision.');
        ide.lastLinuxBuild = result.report;
        offerArchive(result.options.name + '-linux-x64.zip', result.bytes);
        output.textContent = 'Native Linux application ZIP ready: ' + result.bytes.length + ' bytes.\nSHA-256: ' + result.report.sha256
          + '\nExtract the complete archive on Linux; bin/' + result.options.name + ' is the native executable.';
        ide.emit('export', {kind: 'linux-x64-aot', report: result.report});
        ide.status('Native Linux GTK application archive is ready to save.');
      } catch (error) {
        if (alive && !cancelled.signal.aborted) {
          ide.lastLinuxBuild = {success: false, diagnostics: error.diagnostics || [{severity: 'error', message: error.message}]};
          output.textContent = diagnostics(error);
          ide.status('Linux export failed: ' + error.message);
        }
      } finally {busy = false; if (alive) fields.forEach(input => input.disabled = false);}
      return false;
    }
    try {
      await modal('Make Linux GTK Application', {width: 660, content, nativeModal: true,
        buttons: [{label: 'Export Linux ZIP', value: false, primary: true, action: perform}, {label: 'Close', value: false}],
        onReady: ({dialog, finish}) => {
          // Closing remains effective during hashing or linking an application.
          dialog.querySelector('.ide-dialog-footer button:last-child').addEventListener('click', event => {
            event.stopImmediatePropagation(); finish(false);
          }, {capture: true});
        }});
    } finally {alive = false; cancelled.abort(); clearDownload(); opened = false;}
  };
}
