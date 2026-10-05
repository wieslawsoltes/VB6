import {sha256} from '../core/sha256.js';
import {clone} from '../core/core.js';
import {sourceFiles, workspaceProjects, selectWorkspaceProject} from '../project/formats.js';
import {validateWorkspace} from '../project/native-project.js';
import {writeZip} from '../project/zip.js';
import {toBase64} from '../project/frx.js';
import {compileWin32, NativeCompileError} from '../native/compiler.js';
import {exportApplication} from '../exporter/exporter.js';
import {McpError, checkAbort, randomToken} from './protocol.js';
import {S, N, E, REV} from './agent-schema.js';

/** Build outputs are inert bytes; this surface never executes an EXE or touches host files. */
export function installBuildTools(ide, adapter, {add, output, consent, commit, changed, checkRevision}) {
  const artifacts = new Map(), maxBytes = 32 * 1024 * 1024, ttlMs = 300000;
  const observers=new Set();
  const notify=()=>{for(const fn of observers){try{Promise.resolve(fn()).catch(()=>{});}catch{}}};
  const owner = ctx => ctx.principal || ctx.sessionKey || 'embedded';
  const remove = id => { const item = artifacts.get(id); if (!item) return; clearTimeout(item.timer); item.authority.removeEventListener('abort', item.revoke); artifacts.delete(id); notify(); };
  const purge = () => { for (const [id, item] of artifacts) if (item.epoch !== adapter.authorityEpoch || item.expiresAt <= Date.now()) remove(id); };
  adapter.onArtifactsChange = fn => { observers.add(fn); return () => observers.delete(fn); };
  adapter.inspectArtifacts = () => { purge(); return [...artifacts.values()].map(metadata); };
  adapter.releaseArtifactLocal = id => { const found=artifacts.has(id); remove(id); return found; };
  adapter.revokeArtifacts = () => { for (const id of artifacts.keys()) remove(id); };
  const priorRevoke = adapter.revokePrincipal;
  adapter.revokePrincipal = principal => { for (const [id,item] of artifacts) if (item.owner === principal) remove(id); priorRevoke?.(principal); };
  const dispose = adapter.dispose.bind(adapter);
  adapter.dispose = () => { for (const id of artifacts.keys()) remove(id); observers.clear(); dispose(); };
  const find = (id, ctx) => { purge(); const item = artifacts.get(id); if (!item || item.owner !== owner(ctx)) throw new McpError(-32602, 'Build artifact not found or expired.'); return item; };
  const metadata = item => ({artifactId: item.id, name: item.name, mimeType: item.mimeType, size: item.bytes.length, sha256: item.sha256, sourceRevision: item.sourceRevision, expiresAt: item.expiresAt});
  add('build.targets', 'Describe build/export targets. Building returns inert bytes; desktop packaging and the licensed classic compiler require their local CLI.', {}, [], () => output({
    targets: [{id: 'project', format: 'JSON', extension: '.vb6web'}, {id: 'html', format: 'standalone application HTML', extension: '.html'},
      {id: 'sources', format: 'native source/project group ZIP', extension: '.zip'}, {id: 'win32', format: 'freestanding x86 PE32', extension: '.exe', graphics: 'native controls/GDI', compatibility: 'Existing native compiler subset; unsupported constructs return diagnostics.'}],
    localOnly: ['Electron/WebGPU desktop packaging: npm run build:windows', 'Licensed Microsoft VB6 compiler: npm run build:classic'],
    maxArtifactBytes: maxBytes, maxRetainedArtifacts: 8, ttlMs, chunkBytes: 262144
  }));
  add('build.create', 'Build an immutable project, HTML, source ZIP or native Win32 EXE artifact. Requires the snapshot revision; does not execute project code. Read its exact bytes in chunks with build.read.', {target: E(['project','html','sources','win32']), expectedRevision: REV}, ['target','expectedRevision'], async (args, ctx) => {
    checkRevision(args.expectedRevision); checkAbort(ctx.signal); purge();
    const epoch = adapter.authorityEpoch, sourceRevision = adapter.revision, project = clone(ide.project);
    let data, report, mimeType, extension;
    if (args.target === 'win32') {
      try { const result = compileWin32(project); data = result.bytes; report = result.report; }
      catch (error) { if (!(error instanceof NativeCompileError)) throw error; return output({valid: false, sourceRevision, diagnostics: [{severity: 'error', message: error.message, module: error.module, line: error.line}]}); }
      extension = '.exe'; mimeType = 'application/vnd.microsoft.portable-executable';
    } else if (args.target === 'sources') { data = writeZip(sourceFiles(project)); extension = '.zip'; mimeType = 'application/zip'; }
    else if (args.target === 'html') { data = exportApplication(project); extension = '.html'; mimeType = 'text/html'; }
    else { data = JSON.stringify(project, null, 2); extension = '.vb6web'; mimeType = 'application/json'; }
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    if (bytes.length > maxBytes) throw new McpError(-32602, 'Build artifact exceeds 32 MiB.');
    const digest = await sha256(bytes);
    checkAbort(ctx.signal); adapter.assertEnabled(); checkRevision(sourceRevision);
    if (epoch !== adapter.authorityEpoch) throw new McpError(-32602, 'Project changed during build.');
    purge();
    while (artifacts.size >= 8 || [...artifacts.values()].reduce((n, item) => n + item.bytes.length, 0) + bytes.length > maxBytes) remove(artifacts.keys().next().value);
    const id = randomToken(24), item = {id, bytes, owner: owner(ctx), epoch, sourceRevision, mimeType, name: project.name + extension,
      authority: adapter.authoritySignal, expiresAt: Date.now() + ttlMs, sha256: [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')};
    item.revoke = () => remove(id); item.timer = setTimeout(item.revoke, ttlMs); item.timer.unref?.(); artifacts.set(id, item); item.authority.addEventListener('abort', item.revoke, {once: true}); notify();
    return output({valid: true, artifact: metadata(item), ...(report ? {report} : {})});
  });
  adapter.tools.at(-1).annotations.idempotentHint = false;
  add('build.read', 'Read an immutable build artifact using zero-based byte offsets. Every response includes the complete-file SHA-256 and source revision.', {artifactId: S, offset: N(0, maxBytes), count: N(1, 262144)}, ['artifactId'], (args, ctx) => {
    const item = find(args.artifactId, ctx), offset = args.offset || 0;
    if (offset > item.bytes.length) throw new McpError(-32602, 'Offset is beyond the artifact.');
    const bytes = item.bytes.subarray(offset, offset + (args.count || 65536));
    return output({...metadata(item), encoding: 'base64', offset, count: bytes.length, nextOffset: offset + bytes.length, hasMore: offset + bytes.length < item.bytes.length, data: toBase64(bytes)});
  });
  add('build.release', 'Release a caller-owned temporary build artifact. This does not delete project files or host files.', {artifactId: S}, ['artifactId'], (args, ctx) => { find(args.artifactId, ctx); remove(args.artifactId); return output({released: true}); });
  const group = () => ({path: ide.project.nativeWorkspace?.path || null, activePath: ide.project.nativeProject?.path || null,
    startupPath: ide.project.nativeWorkspace?.startupPath || null, projects: workspaceProjects(ide.project).map(p => ({id: p.id, name: p.name, path: p.nativeProject?.path || null, modules: p.modules.length}))});
  add('project.group', 'Read all open native project-group members, active project and startup project without switching or losing edits.', {}, [], () => output(group()));
  add('project.select', 'Switch the active member of a native project group while preserving edited peers and the IDE’s per-project document/debugger history. Revokes old project permissions.', {path: S, expectedRevision: REV}, ['path','expectedRevision'], async (args, ctx) => {
    if (!ide.project.nativeWorkspace) throw new McpError(-32602, 'No native project group is open.');
    const next = selectWorkspaceProject(ide.project, args.path);
    await consent('vb6.project.select', args, ctx); checkAbort(ctx.signal); checkRevision(args.expectedRevision);
    if (typeof ide.switchNativeProject === 'function') ide.switchNativeProject(args.path, {interactive: false});
    else { const saved = ide.savedJSON; ide.loadProject(next); ide.savedJSON = saved; }
    changed(); return output(group());
  }, {write: true});
  add('project.startup', 'Set the startup member of an open native project group, without switching the active project. Undoable and revision checked.', {path: S, expectedRevision: REV}, ['path','expectedRevision'], async (args, ctx) => {
    if (!ide.project.nativeWorkspace) throw new McpError(-32602, 'No native project group is open.');
    const next = clone(ide.project); next.nativeWorkspace.startupPath = args.path; validateWorkspace(next);
    await consent('vb6.project.startup', args, ctx); checkAbort(ctx.signal); checkRevision(args.expectedRevision);
    commit(next, 'MCP: set group startup project'); return output(group());
  }, {write: true});
}
