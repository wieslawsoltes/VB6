import {classicProjectEncoding, inspectClassicSources} from './classic-sources.js';
import {prepareClassicDesigner} from './classic-designer.js';
import {normalizeProject} from '../project/model.js';
import {moduleLanguage} from '../project/language.js';
import {sourceFiles} from '../project/formats.js';
import {bytesOf, decodeNativeText} from '../project/native-text.js';
import {cleanProjectPath} from '../project/frx.js';
import {normalizeClassicOptions, CLASSIC_TARGET, CLASSIC_LIMITS} from './classic-options.js';
import {configureClassicVBP, classicField, classicFields} from './classic-vbp.js';

function fail(message, code = 'CLASSIC_PROJECT') {
  const error = new Error(message);
  error.diagnostics = [{severity: 'error', code, message}];
  throw error;
}
/** The Microsoft compiler, not the browser parser/AOT subset, compiles the code.
 * Native source overlays, hidden attributes and opaque FRX/RES data are retained.
 * Snapshot cloning guarantees cancelled/failed exports never edit the project.
 */
export function prepareClassicProject(input, options = {}) {
  const serialized = JSON.stringify(input);
  if (!serialized || new TextEncoder().encode(serialized).length > CLASSIC_LIMITS.projectBytes) fail('Classic project exceeds 20 MiB.');
  const project = normalizeProject(JSON.parse(serialized));
  if(project.modules.some(module=>moduleLanguage(module,project)==='pascal'))fail('Turbo Pascal projects use the shared Win32, macOS, Linux or browser compiler. The Microsoft VB6 compiler accepts Visual Basic source only.', 'CLASSIC_LANGUAGE');
  const selected = normalizeClassicOptions(options, project.name);
  const encoding = classicProjectEncoding(project);
  if (project.nativeWorkspace) fail('Select or export a single native project before making an EXE; a project group can contain DLL/OCX build dependencies.');
  if (project.settings.anchoring) fail('Microsoft VB6 does not implement the browser anchoring/auto-layout extension. Disable it and provide classic Form_Resize code, or use the browser/Win32 target. Layout behavior will not be silently discarded.', 'CLASSIC_LAYOUT');
  if (project.dataSources?.connections?.length || project.dataSources?.commands?.length) fail('Browser data-source definitions are not native VB6 DataEnvironment designers. Use native ADO/DAO/RDO code and references or an imported native designer.', 'CLASSIC_DATA');
  const warnings = [];
  if (Object.keys(project.vfs?.files || {}).length) warnings.push('The browser virtual filesystem is not embedded. Deploy required data files separately; MSVBVM60 uses the Windows filesystem.');
  if (project.settings.theme && project.settings.theme !== 'classic') warnings.push('The Microsoft runtime uses native Windows/OCX appearance, not the browser application theme.');
  for (const module of project.modules) {
    if (module.sourceEncoding && /^utf-/i.test(module.sourceEncoding)) fail('Microsoft VB6 needs an ANSI source code page, not ' + module.sourceEncoding + ': ' + module.name);
    for (const node of module.form ? [module.form, ...module.form.controls] : []) {
      if (node.ocxState !== undefined) fail('Portable browser OCX property bags are not native OCX persistence: ' + module.name + '.' + node.name);
      if (!node.originalType && !['Form','MDIForm','Menu','PictureBox','Label','TextBox','Frame','CommandButton','CheckBox','OptionButton','ComboBox','ListBox','HScrollBar','VScrollBar','Timer','DriveListBox','DirListBox','FileListBox','Shape','Line','Image','Data','OLE'].includes(node.type)) {
        fail('A native component type and registered Object reference are required for ' + module.name + '.' + node.name + ' (' + node.type + '). Import its native .frm/.vbp definition; a browser adapter is not an OCX binary.', 'CLASSIC_COMPONENT');
      }
    }
  }
  // New modules in an imported project inherit its ANSI code page. Existing
  // native module documents and opaque records stay byte-preserving.
  for (const module of project.modules) if (!module.nativeSource && !module.sourceEncoding) module.sourceEncoding = encoding;
  const files = sourceFiles(prepareClassicDesigner(project)), paths = Object.keys(files);
  if (paths.length > CLASSIC_LIMITS.files) fail('Too many classic project files.');
  const projects = paths.filter(path => /\.vbp$/i.test(path));
  if (projects.length !== 1) fail('A classic EXE export must contain exactly one .vbp project.');
  const projectPath = projects[0];
  // Windows path checks are stricter than portable ZIP checks (ADS/device names).
  for (const file of paths) {
    cleanProjectPath(file);
    for (const part of file.replace(/\\/g, '/').split('/')) {
      if (/[<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)) fail('Unsafe Windows source path: ' + file);
    }
    if (/\.(vbp|frm|bas|cls|ctl|pag|dob|dsr)$/i.test(file)) {
      const decoded = decodeNativeText(files[file]);
      if (decoded.bom || /^utf-(?:16|32)/i.test(decoded.encoding)) fail('Microsoft VB6 cannot compile BOM/Unicode source: ' + file + '. Save it using the native project ANSI code page.');
    }
  }
  const sources = inspectClassicSources(project, files, projectPath, encoding);
  const vbpText = decodeNativeText(files[projectPath], {encoding}).text;
  const type = classicField(vbpText, 'Type').toLowerCase();
  if (!['exe', 'oleexe'].includes(type)) fail('Select a Standard EXE or ActiveX EXE project; DLL and OCX projects do not produce EXEs.');
  files[projectPath] = configureClassicVBP(bytesOf(files[projectPath]), selected.name, selected.codegen, encoding);
  const references = classicFields(vbpText).filter(entry => ['reference', 'object'].includes(entry.key.toLowerCase()));
  if (references.length) warnings.push('Referenced type libraries, COM servers and OCX controls must be installed and registered for 32-bit VB6. No dependency is installed or registered automatically.');
  warnings.push('Build-machine Windows ANSI code page must match ' + encoding + '; source bytes are not transliterated.');
  return {files, manifest: {version: 1, target: CLASSIC_TARGET, arch: 'x86', runtime: 'MSVBVM60.DLL', projectPath, ...selected, ...sources, projectType: type, compiled: false, references, warnings}};
}
