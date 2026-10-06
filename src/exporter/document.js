import {escapeHTML} from '../core/core.js';
import {THEMES, themeId} from '../theme/theme.js';
import {exportFailure} from './diagnostics.js';
import {snapshotExportValue, jsonForHTML} from './serialization.js';

export const APPLICATION_SHELL_CSS = `html,body{margin:0;width:100%;height:100%;overflow:hidden}body{background:var(--vb-desktop)}button,input,select,textarea{font-family:var(--vb-font)}#app{position:fixed;inset:0}#vb6-startup{position:fixed;left:1rem;bottom:1rem;max-width:calc(100% - 4rem);z-index:2147483647;margin:0;padding:.75rem 1rem;background:var(--vb-face,#c0c0c0);color:var(--vb-text,#000);border:2px outset var(--vb-face,#c0c0c0);font:14px/1.5 sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none}#vb6-startup[hidden]{display:none}#vb6-startup[role=alert]{max-height:60%;overflow:auto;pointer-events:auto}`;
const RESERVED = new Set(['index.html', 'app.css', 'runtime.js', 'bootstrap.js', 'manifest.json']);

/** Deployment script names are local, unambiguous and portable to ZIP/Windows.
 * Their contents are trusted application code, never a credential store.
 */
export function documentSettings(value = {}) {
  const settings = snapshotExportValue(value, 'document');
  if (!settings || Array.isArray(settings) || typeof settings !== 'object') throw exportFailure('EXPORT_INVALID_DOCUMENT', 'Expected document settings', 'document');
  for (const key of Object.keys(settings)) if (!['title', 'description', 'language', 'direction', 'scripts'].includes(key)) {
    throw exportFailure('EXPORT_INVALID_DOCUMENT', 'Unknown document setting', 'document.' + key);
  }
  for (const key of ['title', 'description', 'language', 'direction']) if (settings[key] !== undefined && typeof settings[key] !== 'string') {
    throw exportFailure('EXPORT_INVALID_DOCUMENT', 'Expected text', 'document.' + key);
  }
  if (settings.language !== undefined && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(settings.language)) throw exportFailure('EXPORT_INVALID_DOCUMENT', 'Expected a language tag', 'document.language');
  if (settings.direction !== undefined && !['ltr', 'rtl', 'auto'].includes(settings.direction)) throw exportFailure('EXPORT_INVALID_DOCUMENT', 'Expected ltr, rtl or auto', 'document.direction');
  const scripts = settings.scripts === undefined ? {} : settings.scripts;
  if (!scripts || typeof scripts !== 'object' || Array.isArray(scripts) || Object.keys(scripts).length > 32) throw exportFailure('EXPORT_INVALID_DOCUMENT', 'Expected at most 32 deployment scripts', 'document.scripts');
  const names = new Set(RESERVED);
  for (const [name, source] of Object.entries(scripts)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*\.js$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(name) || names.has(name.toLowerCase())) throw exportFailure('EXPORT_INVALID_PATH', 'Expected a unique portable .js filename, not a reserved deployment name', 'document.scripts');
    if (typeof source !== 'string') throw exportFailure('EXPORT_INVALID_DOCUMENT', 'Expected trusted JavaScript source text', 'document.scripts.' + name);
    names.add(name.toLowerCase());
  }
  return {...settings, language: settings.language || 'en', scripts};
}

/** Do not rewrite arbitrary JavaScript: that corrupts strings, regexes and tagged
 * templates. Unsafe raw-text markers must be escaped by its author or deployed
 * as external files. The generated runtime itself contains neither marker.
 */
export function inlineScript(source) {
  if (/<\/script|<\x21--/i.test(source)) throw exportFailure('EXPORT_UNSAFE_INLINE_SCRIPT', 'Script contains an HTML raw-text delimiter; escape the literal in source or use exportApplicationFiles', 'script');
  return `<script>${source}\n</script>`;
}

export function applicationDocument({project, options, document, version, css, scripts, external = false}) {
  const theme = THEMES[themeId(options.theme ?? project.settings?.theme)];
  const direction = document.direction ? ` dir="${document.direction}"` : '';
  const description = document.description ?? project.description;
  if (!external && /<\/style/i.test(css)) throw exportFailure('EXPORT_UNSAFE_INLINE_STYLE', 'CSS contains an HTML raw-text delimiter; escape the literal in source or use exportApplicationFiles', 'style');
  const style = external ? '<link rel="stylesheet" href="./app.css">' : `<style>${css}</style>`;
  const scriptTags = external ? scripts.map(name => `<script defer src="./${escapeHTML(name)}"></script>`).join('\n') : scripts.map(inlineScript).join('\n');
  return `<!doctype html>\n<html lang="${document.language}" data-vb-theme="${theme.id}"${direction}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="generator" content="VB6 Studio Web ${escapeHTML(version)}"><meta name="color-scheme" content="${theme.scheme || (theme.id === 'contrast' ? 'dark' : 'light')}"><title>${escapeHTML(document.title ?? project.name)}</title>${description ? `<meta name="description" content="${escapeHTML(description)}">` : ''}${style}</head><body><div id="app"></div><p id="vb6-startup" role="status" aria-live="polite">Starting application…</p><noscript>This application requires JavaScript.</noscript><script id="vb6-project" type="application/json">${jsonForHTML(project)}</script><script id="vb6-options" type="application/json">${jsonForHTML(options)}</script>${scriptTags}</body></html>`;
}
