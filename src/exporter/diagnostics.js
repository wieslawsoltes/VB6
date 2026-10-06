/** Stable, machine-readable exporter failures; messages never include data values. */
export class ApplicationExportError extends Error {
  constructor(diagnostics) {
    super(diagnostics.map(d => `${d.source || d.path || 'Export'}${d.line ? ':' + d.line : ''}: ${d.message}`).join('\n'));
    this.name = 'ApplicationExportError';
    this.diagnostics = diagnostics.map(d => Object.freeze({...d}));
    this.code = diagnostics[0]?.code || 'EXPORT_FAILED';
    this.path = diagnostics[0]?.path;
    this.number = diagnostics[0]?.number;
  }
}

export function exportDiagnostic(code, message, path, extra = {}) {
  return {severity: 'error', code, message, ...(path ? {path} : {}), ...extra};
}

export function exportFailure(code, message, path) {
  return new ApplicationExportError([exportDiagnostic(code, message, path)]);
}
