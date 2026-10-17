import {el} from '../core/core.js';
import {modal} from './ui.js';
import {writeZip} from '../project/zip.js';
import {compileMacOS, createMacOSBuildKit, MacOSCompilerClient, verifyMacOSAppArchive, compileMacOSAOT, exportMacOSApplication, verifyMacOSAOTArchive} from '../../packages/macos-native/src/index.js';

/** A native export session is local UI authority, never an unattended agent command. */
export function installMacOSExport(ide, api) {
  if (ide.macOSExportInstalled) return;
  ide.macOSExportInstalled = true;
  if (api) Object.assign(api, {compileMacOS, createMacOSBuildKit, verifyMacOSAppArchive, compileMacOSAOT, exportMacOSApplication, verifyMacOSAOTArchive});
  const menu = ide.menu.bind(ide), command = ide.command.bind(ide);
  let opened = false;
  ide.menu = name => {
    const items = menu(name);
    if (name === 'File') {
      const index = items.findIndex(item => item?.id === 'exportClassic');
      items.splice(index < 0 ? items.length : index + 1, 0, {id: 'exportMacOS', label: 'Make ' + ide.project.name + '.app (macOS Apple Silicon)…', icon: 'export', enabled: ide.runState === 'design' && !opened});
    }
    return items;
  };
  ide.command = async (id, ...args) => {
    if (id !== 'exportMacOS') return command(id, ...args);
    if (opened || ide.runState !== 'design') {ide.status('Stop execution and close the current build dialog before exporting.'); return;}
    opened = true;
    const cancelled = new AbortController(), client = new MacOSCompilerClient();
    let alive = true, busy = false, releaseDownload;
    const name = el('input', {value: ide.project.name, maxlength: 100, 'aria-label': 'macOS application name'});
    const identifier = el('input', {value: 'org.vb6studio.application', maxlength: 200, 'aria-label': 'Bundle identifier', spellcheck: false});
    const minimum = el('input', {value: '11.0', 'aria-label': 'Minimum macOS version', spellcheck: false});
    const optimization = el('select', {'aria-label': 'Native optimization'}, ...[0, 1, 2, 3].map(level => el('option', {value: String(level), selected: level === 2}, 'O' + level)));
    const endpoint = el('input', {type: 'url', value: 'http://127.0.0.1:8769/macos', 'aria-label': 'macOS compiler bridge URL', spellcheck: false});
    const token = el('input', {type: 'password', autocomplete: 'off', 'aria-label': 'macOS compiler bridge token', spellcheck: false});
    const output = el('pre', {role: 'status', 'aria-live': 'polite', tabindex: -1, style: {whiteSpace: 'pre-wrap', maxHeight: '140px', overflow: 'auto', margin: '8px 0'}});
    const downloads = el('div', {'data-macos-download': '', style: {overflowWrap: 'anywhere', marginBottom: '10px'}});
    const fields = [name, identifier, minimum, optimization, endpoint, token];
    const selected = () => ({name: name.value, bundleIdentifier: identifier.value, minimumVersion: minimum.value, optimization: Number(optimization.value)});
    const field = (caption, input) => el('label', {style: {display: 'grid', gridTemplateColumns: '145px minmax(0,1fr)', gap: '8px', marginBottom: '8px'}}, el('span', {}, caption), input);
    const clearDownload = () => {releaseDownload?.(); releaseDownload = null; downloads.replaceChildren();};
    const appearanceWarnings = report => (report?.diagnostics || []).filter(item => item.severity === 'warning')
      .map(item => '\n' + (item.code ? item.code + ': ' : '') + item.message).join('');
    const origin = globalThis.location?.origin;
    const content = el('div', {},
      el('p', {}, 'Compile VB6 to a native arm64 Mach-O executable with AppKit controls. The app contains no browser, JavaScript interpreter, Wine or Microsoft runtime.'),
      output, downloads, field('Application name', name), field('Bundle identifier', identifier), field('Minimum macOS', minimum), field('Optimization', optimization),
      el('details', {}, el('summary', {}, 'Advanced: optional Mac compiler bridge'), field('Bridge URL', endpoint), field('Session token', token),
        el('p', {}, 'On your Mac with Xcode Command Line Tools: node tools/serve-macos.mjs ' + (origin === 'null' ? '--allow-file-origin' : '--origin ' + (origin || 'http://127.0.0.1:8080'))),
        el('p', {}, 'Paste its token, then approve this build in the terminal. The token is discarded when the dialog closes. The exporter never runs the generated application.')),
      el('p', {}, 'Export .app ZIP works directly here, including offline: no Mac, Clang, server or bridge is needed. Project code supports O0–O3; the shared native SDK uses O2. The optional bridge recompiles with Apple Clang; the separate source build kit is not an executable.'),
      el('p', {}, 'This target is experimental, not complete VB6/Win32/COM parity. Default signing is ad-hoc, not notarization or Gatekeeper approval. Review diagnostics and test the native application before deployment.'));
    function offerArchive(filename, bytes) {
      clearDownload();
      const doc = downloads.ownerDocument, view = doc.defaultView, urls = view.URL;
      const url = urls.createObjectURL(new view.Blob([bytes], {type: 'application/zip'}));
      const link = doc.createElement('a'); link.href = url; link.download = filename; link.tabIndex = 0; link.textContent = 'Save ZIP: ' + filename;
      downloads.append(link, doc.createElement('br'), doc.createTextNode('No download? Click Save ZIP above, or open the standalone IDE outside an embedded preview.'));
      releaseDownload = () => view.setTimeout(() => urls.revokeObjectURL(url), 60000);
      try {link.click();} catch (error) {downloads.append(doc.createTextNode(' Automatic download could not start: ' + error.message));}
    }
    function preflight() {
      try {
        const result = compileMacOSAOT(ide.project, selected());
        output.textContent = result.report.modules + ' modules, ' + result.report.procedures + ' native procedures. Project code: O' + result.options.optimization + ', ' + result.report.codeBytes + ' bytes. Target: arm64, minimum macOS ' + result.options.minimumVersion + '.\nDirect AOT emits native code with the bundled SDK. Test application behavior on your Mac.';
        output.textContent += appearanceWarnings(result.report);
      } catch (error) {output.textContent = error.message;}
    }
    for (const input of [name, identifier, minimum, optimization]) input.addEventListener('change', () => {clearDownload(); preflight();});
    preflight();
    async function perform(mode) {
      const executable = mode !== 'source';
      if (!alive || busy) return false;
      busy = true; clearDownload(); fields.forEach(input => input.disabled = true);
      try {
        if (ide.runState !== 'design') throw new Error('Stop execution before exporting.');
        const project = ide.project, snapshot = JSON.stringify(project), options = selected();
        output.textContent = mode === 'direct' ? 'Compiling ARM64 code, linking the native runtime and signing the app…' : 'Checking native source compatibility…';
        let result, prepared;
        if (mode === 'direct') {
          result = await exportMacOSApplication(JSON.parse(snapshot), options, {signal: cancelled.signal});
          prepared = {options: result.options};
        } else if (mode === 'bridge') {
          prepared = compileMacOS(JSON.parse(snapshot), options);
          output.textContent = 'Connecting to the Mac. Approve this native build in the terminal…';
          await client.connect(endpoint.value, token.value, {signal: cancelled.signal}); token.value = '';
          result = await client.build(JSON.parse(snapshot), options, {signal: cancelled.signal});
        } else {
          prepared = createMacOSBuildKit(JSON.parse(snapshot), options);
          result = {bytes: writeZip({...prepared.files, 'project.vb6web': snapshot}), report: prepared.report};
        }
        cancelled.signal.throwIfAborted();
        if (!alive) return false;
        if (ide.project !== project || JSON.stringify(ide.project) !== snapshot || ide.runState !== 'design') throw new Error('Project changed during export. Build again to download the current revision.');
        ide.lastMacOSBuild = result.report;
        offerArchive(prepared.options.name + (executable ? '.app.zip' : '-macos-source.zip'), result.bytes);
        output.textContent = mode === 'direct'
          ? 'Direct native ARM64 .app ZIP ready: ' + result.bytes.length + ' bytes.\nSHA-256: ' + result.report.sha256 + '\nAll code-page and resource hashes verified. Ad-hoc signing is not Developer ID, notarization or Gatekeeper approval.'
          : executable
          ? 'Native arm64 .app ZIP verified: ' + result.bytes.length + ' bytes.\nSHA-256: ' + result.report.sha256 + '\nAd-hoc signing is not notarization. The browser checks structure and hashes, not the cryptographic code signature.'
          : 'Source build kit ready: ' + result.bytes.length + ' bytes. This is not an executable. Extract it on a Mac and run node build.mjs.';
        output.textContent += appearanceWarnings(result.report);
        ide.emit('export', {kind: mode === 'direct' ? 'macos-arm64-aot' : executable ? 'macos-arm64' : 'macos-source', report: result.report});
        ide.status(executable ? 'Native macOS application archive is ready to save.' : 'macOS source build archive is ready to save; native compilation is still required.');
      } catch (error) {
        if (alive && !cancelled.signal.aborted) {
          ide.lastMacOSBuild = {success: false, diagnostics: error.diagnostics || [{severity: 'error', message: error.message}]};
          output.textContent = error.message + (error.compilerLog ? '\n' + error.compilerLog : '');
          ide.status('macOS export failed: ' + error.message);
        }
      } finally {client.disconnect(); token.value = ''; busy = false; if (alive) fields.forEach(input => input.disabled = false);}
      return false;
    }
    try {
      // Native top-layer modality keeps export status, signature warnings and
      // approval controls above the IDE's retained canvas without changing its
      // rendering backend. Reuse the existing classic-chrome dialog host.
      // https://html.spec.whatwg.org/multipage/interactive-elements.html#dom-dialog-showmodal
      await modal('Make macOS Apple Silicon Application', {width: 720, content, nativeModal: true,
        buttons: [{label: 'Export .app ZIP', value: false, primary: true, action: () => perform('direct')},
          {label: 'Build via Mac Bridge', value: false, action: () => perform('bridge')},
          {label: 'Download Source Build Kit', value: false, action: () => perform('source')}, {label: 'Close', value: false}],
        onReady: ({dialog, finish}) => {
          // Close must remain effective during an asynchronous build/approval.
          dialog.querySelector('.ide-dialog-footer button:last-child').addEventListener('click', event => {event.stopImmediatePropagation(); finish(false);}, {capture: true});
        }});
    } finally {alive = false; cancelled.abort(); client.disconnect(); token.value = ''; clearDownload(); opened = false;}
  };
}
