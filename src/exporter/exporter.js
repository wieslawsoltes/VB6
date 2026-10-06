import {VERSION} from '../core/core.js';
import {RUNTIME_SOURCE, RUNTIME_CSS} from './runtime-payload.js';
import {createApplicationExporter} from './application-exporter.js';
import {jsonForHTML} from './serialization.js';
import {ApplicationExportError} from './diagnostics.js';

// The full runtime is included once. No feature tree-shaking can accidentally
// remove dynamic controls, Declare adapters, source OCXs or late-bound services.
const exporter = createApplicationExporter({runtimeSource: RUNTIME_SOURCE, runtimeCSS: RUNTIME_CSS});

/** Backwards-compatible single-file HTML API used by the IDE and desktop host. */
export function exportApplication(project, options = {}, document = {}) { return exporter.html(project, options, document); }
/** Deployable local files, without inline executable JavaScript or JSON fetches. */
export function exportApplicationFiles(project, options = {}, document = {}) { return exporter.files(project, options, document); }
/** Structured diagnostics and dependency inventory without generating HTML. */
export function inspectApplicationExport(project, options = {}, document = {}) { return exporter.inspect(project, options, document); }
export const RUNTIME_VERSION = VERSION;
export {jsonForHTML, createApplicationExporter, ApplicationExportError};
