/** Pure project edits used by the MCP adapter. Every edit is staged before the live undo transaction. */
import {clone, lower} from '../core/core.js';
import {findModule, createControl, newId, normalizeProject, BASIC_CONTROL_TYPES, EXTENDED_CONTROL_TYPES} from '../project/model.js';
import {renameSymbol, formatCode, defaultEventSignature} from '../editor/language-service.js';
import {addProcedureSource, updateProcedureAttributes, formatControls} from '../ide/procedure-tools.js';
import {cleanProjectPath, fromBase64, toBase64} from '../project/frx.js';
import {setResource, removeResource, resourceKey, setResourceString, readRES} from '../project/res.js';
import {VirtualFileSystem} from '../runtime/filesystem.js';
import {McpError, isRecord} from './protocol.js';

export const CONTROL_TYPES = Object.freeze([...new Set([...BASIC_CONTROL_TYPES, ...EXTENDED_CONTROL_TYPES])].filter(s => s !== 'Pointer'));
export const fail = message => { throw new McpError(-32602, message); };
export const identifier = value => { if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,254}$/.test(value)) fail('Expected a VB identifier (maximum 255 characters).'); return value; };
export const moduleOf = (project, name) => findModule(project, name) || fail('Unknown module: ' + name);
export function formOf(project, name) { const m = moduleOf(project, name); if (!m.form) fail('Module has no designer: ' + name); return m.form; }
export function nodeOf(form, id, menus = false) {
  if (!menus && (id === form.id || id === '$form')) return form;
  const nodes = menus ? form.menus : form.controls;
  const exact = nodes.find(n => n.id === id); if (exact) return exact;
  const matches = nodes.filter(n => lower(n.name) === lower(id));
  if (matches.length !== 1) fail(matches.length ? 'Ambiguous control array; use the stable control ID.' : 'Unknown designer object: ' + id);
  return matches[0];
}
export function filePath(value) {
  if (typeof value !== 'string' || value.length > 1024 || /[\0-\x1f]/.test(value)) fail('Invalid virtual file path.');
  return '/' + cleanProjectPath(value.replace(/^\//, ''));
}
export function decodeFile(content, encoding = 'utf8') {
  if (typeof content !== 'string' || content.length > 4000000) fail('File payload exceeds 4,000,000 characters.');
  if (encoding === 'base64') return fromBase64(content);
  if (encoding !== 'utf8') fail('Unknown encoding.');
  return new TextEncoder().encode(content);
}
export function sourceEdits(project, edits) {
  if (!edits.length) fail('Supply at least one edit.');
  const next = clone(project), grouped = new Map();
  for (const edit of edits) {
    const m = moduleOf(next, edit.module), list = grouped.get(m.id) || [];
    if (edit.end < edit.start || edit.end > m.code.length) fail('Edit range outside ' + m.name + '. UTF-16 offsets are zero-based, end-exclusive.');
    if (edit.expectedText !== undefined && m.code.slice(edit.start, edit.end) !== edit.expectedText) fail('Source precondition failed in ' + m.name);
    list.push(edit); grouped.set(m.id, list);
  }
  for (const [id, list] of grouped) {
    const m = moduleOf(next, id); list.sort((a,b) => a.start-b.start || a.end-b.end);
    for (let i=1; i<list.length; i++) if (list[i].start < list[i-1].end || list[i].start === list[i-1].start) fail('Overlapping or same-offset edits are ambiguous.');
    for (const e of list.reverse()) m.code = m.code.slice(0,e.start) + e.text + m.code.slice(e.end);
  }
  return normalizeProject(next);
}
function renameModule(next, args) {
  const m = moduleOf(next, args.module), old = m.name; identifier(args.name);
  if (next.modules.some(n => n.id !== m.id && lower(n.name) === lower(args.name))) fail('Duplicate module name.');
  m.name = args.name;
  if (m.form) { m.form.name = args.name; m.form.properties.Name = args.name; }
  if (lower(next.startup) === lower(old)) next.startup = args.name;
  for (const n of next.modules) n.code = renameSymbol(n.code, old, args.name);
  return next;
}
function patchProperties(node, properties, remove = []) {
  if (Object.hasOwn(properties, 'Name') || remove.includes('Name')) fail('Use rename to change identity; Name cannot be patched.');
  for (const key of remove) delete node.properties[key];
  Object.assign(node.properties, clone(properties));
}
function editNode(next, args, menus) {
  const form = formOf(next, args.module), key = menus ? 'menus' : 'controls', nodes = form[key];
  if (args.action === 'add') {
    identifier(args.name); if (!menus && !CONTROL_TYPES.includes(args.type)) fail('Unknown control type.');
    const node = menus ? {id:newId(),name:args.name,type:'Menu',parent:null,properties:{Name:args.name,Caption:args.name,Enabled:-1,Visible:-1,Checked:0}} : createControl(args.type, args.name);
    if (args.parent) node.parent = nodeOf(form,args.parent,menus).name;
    patchProperties(node,args.properties||{}); nodes.push(node);
  } else {
    const node = nodeOf(form,args.id,menus); if (node === form) fail('Use form properties to edit the form itself.');
    if (args.action === 'update') patchProperties(node,args.properties||{},args.remove||[]);
    else if (args.action === 'rename') {
      identifier(args.name); const old=node.name;
      if (nodes.some(n=>n.id!==node.id && lower(n.name)===lower(old))) fail('Rename a complete control array using form.update; individual array identity cannot be split silently.');
      node.name=args.name; node.properties.Name=args.name;
      for (const n of nodes) if (lower(n.parent||'')===lower(old)) n.parent=args.name;
      const m=moduleOf(next,args.module); m.code=renameSymbol(m.code,old,args.name);
    } else if (args.action === 'reparent') node.parent = args.parent ? nodeOf(form,args.parent,menus).name : null;
    else if (args.action === 'remove') {
      const removed = new Set([node.name]); let count;
      do { count=removed.size; for(const n of nodes) if(removed.has(n.parent)) removed.add(n.name); } while(count!==removed.size);
      if (!args.cascade && nodes.some(n=>n!==node && removed.has(n.parent))) fail('Container has children; set cascade explicitly.');
      form[key] = nodes.filter(n=>n.id!==node.id && !(args.cascade && removed.has(n.parent)));
    } else if (args.action === 'reorder') {
      if (!Number.isInteger(args.index) || args.index<0 || args.index>=nodes.length) fail('Invalid item index.');
      nodes.splice(nodes.indexOf(node),1); nodes.splice(args.index,0,node);
    } else fail('Unknown designer action.');
  }
  // Only real containers may own controls. Control arrays cannot identify a unique parent.
  if (!menus) for (const n of form.controls) if (n.parent) {
    const parents=form.controls.filter(c=>lower(c.name)===lower(n.parent));
    if(parents.length!==1 || !['Frame','PictureBox','SSTab','TabStrip'].includes(parents[0].type)) fail('Parent must identify one container control.');
  }
  return next;
}
function singleLine(value, label, max=10000) {
  if(typeof value!=='string'||value.length>max||/[\r\n\0]/.test(value)) fail('Invalid '+label+'.'); return value;
}
function nativeMetadata(project, args, operation) {
  if(args.nativeProject) {
    const n=args.nativeProject;if(Object.keys(n).some(k=>!['path','entries'].includes(k)))fail('Unknown native project metadata.');
    if(n.path!==undefined) cleanProjectPath(n.path);
    if(n.entries!==undefined){if(!Array.isArray(n.entries)||n.entries.length>1000)fail('Invalid native entries.');for(const e of n.entries){if(!isRecord(e)||!/^\w+$/.test(e.key))fail('Invalid native entry key.');singleLine(e.value,'native entry');if(['name','startup','form','module','class','reference','object','resfile32'].includes(e.key.toLowerCase()))fail('Use the corresponding structured field for '+e.key+'.');}}
  }
  if(args.references)for(const entry of args.references){if(!['Reference','Object'].includes(entry.kind))fail('Reference kind must be Reference or Object.');singleLine(entry.value,'reference');}
  if(args.sourcePath!==undefined){const path=cleanProjectPath(args.sourcePath),m=moduleOf(project,args.module);if(project.modules.some(other=>other.id!==m.id&&lower(other.sourcePath||other.name+(other.kind==='form'?'.frm':other.kind==='class'?'.cls':'.bas'))===lower(path)))fail('Source path already belongs to another module.');if(!new RegExp('\\.'+(m.kind==='form'?'frm':m.kind==='class'?'cls':'bas')+'$','i').test(path))fail('Source extension must match the module kind.');}
  if(operation==='module.metadata'&&args.attributes)for(const a of args.attributes){singleLine(a,'attribute');if(!/^Attribute\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?\s*=/.test(a)||/^Attribute\s+VB_Name\s*=/i.test(a))fail('Use module.rename for identity; expected an Attribute declaration.');}
  if(args.nativeClassHeader!==undefined&&(!/^VERSION[^\n]*\nBEGIN[\s\S]*\nEND\s*$/i.test(args.nativeClassHeader.replace(/\r\n?/g,'\n'))||moduleOf(project,args.module).kind!=='class'))fail('A native class header must be a VERSION/BEGIN/END wrapper.');
}
export function editProject(project, operation, args) {
  nativeMetadata(project,args,operation);
  let next = clone(project);
  switch (operation) {
    case 'module.rename': return normalizeProject(renameModule(next,args));
    case 'project.update': {
      if (args.name !== undefined) next.name=identifier(args.name);
      if (args.description !== undefined) next.description=args.description;
      if (args.startup !== undefined) { if(args.startup!=='Sub Main') moduleOf(next,args.startup); next.startup=args.startup; }
      if (args.settings) Object.assign(next.settings,clone(args.settings));
      if (args.nativeProject) next.nativeProject=clone(args.nativeProject);
      break;
    }
    case 'references.set': next.references=clone(args.references); break;
    case 'module.metadata': {
      const m=moduleOf(next,args.module);
      for(const key of ['attributes','nativeClassHeader','sourcePath','sourceEncoding']) if(args[key]!==undefined) m[key]=clone(args[key]);
      break;
    }
    case 'code.transform': {
      const modules=args.module?[moduleOf(next,args.module)]:next.modules;
      if (args.action==='rename') { identifier(args.from); identifier(args.to); }
      for(const m of modules) m.code=args.action==='format'?formatCode(m.code,next.settings.tabWidth):renameSymbol(m.code,args.from,args.to);
      break;
    }
    case 'procedure.add': { const m=moduleOf(next,args.module); m.code=addProcedureSource(m,args).code; break; }
    case 'procedure.attributes': { const m=moduleOf(next,args.module); m.attributes=updateProcedureAttributes(m,args.name,args.attributes); break; }
    case 'procedure.event': {
      const m=moduleOf(next,args.module), form=formOf(next,args.module), node=nodeOf(form,args.id||'$form'); identifier(args.event);
      const object=node===form?(form.type==='MDIForm'?'MDIForm':'Form'):node.name, name=object+'_'+args.event;
      if(new RegExp('(?:Sub|Function)\\s+'+name+'\\s*\\(','i').test(m.code)) fail('Event procedure already exists.');
      const parameters=[...(node.properties.Index!==undefined?['Index As Integer']:[]),defaultEventSignature(node.type,args.event)].filter(Boolean).join(', ');
      m.code=m.code.trimEnd()+'\n\nPrivate Sub '+name+'('+parameters+')\n    \nEnd Sub\n'; break;
    }
    case 'bookmarks.set': {
      const m=moduleOf(next,args.module), length=m.code.split('\n').length;
      if(args.lines.some(n=>n>length)) fail('Bookmark outside source.'); m.bookmarks=[...new Set(args.lines)].sort((a,b)=>a-b); break;
    }
    case 'form.properties': patchProperties(formOf(next,args.module),args.properties,args.remove||[]); break;
    case 'control.edit': next=editNode(next,args,false); break;
    case 'menu.edit': next=editNode(next,args,true); break;
    case 'designer.format': {
      const f=formOf(next,args.module), nodes=args.ids.map(id=>nodeOf(f,id));
      if(nodes.includes(f)||new Set(nodes).size!==nodes.length) fail('Select distinct controls.');
      if(!formatControls(f,nodes,args.command,next.settings.gridSize,args.primaryId||nodes[0]?.id)) fail('Operation requires a compatible selection.'); break;
    }
    case 'files.write': {
      const fs=new VirtualFileSystem(next.vfs),path=filePath(args.path);
      if(args.encoding==='base64') fs.writeBytes(path,decodeFile(args.content,'base64')); else fs.write(path,args.content);
      if(fs.files.size>2000) fail('At most 2,000 virtual files.'); next.vfs=fs.snapshot(); break;
    }
    case 'files.manage': {
      const fs=new VirtualFileSystem(next.vfs),path=filePath(args.path);
      if(args.action==='remove') fs.remove(path);
      else if(args.action==='mkdir') fs.directories.add(path);
      else if(args.action==='rmdir') { if([...fs.files.keys(),...fs.directories].some(p=>p!==path&&p.startsWith(path+'/'))) fail('Directory is not empty.'); fs.directories.delete(path); }
      else if(args.action==='rename') fs.rename(path,filePath(args.destination));
      else if(args.action==='copy') fs.copy(path,filePath(args.destination));
      else fail('Unknown virtual file operation.'); next.vfs=fs.snapshot(); break;
    }
    case 'assets.write': {
      const path=cleanProjectPath(args.path); if(!/\.(png|jpg|jpeg|gif|bmp|webp|ico)$/i.test(path))fail('Use a raster image filename extension.'); if(!/^data:image\/(png|jpeg|gif|bmp|webp|x-icon|vnd.microsoft.icon);base64,[A-Za-z0-9+/=]+$/.test(args.data)) fail('Supply an inert raster image data URL, not HTML/SVG or a remote URL.');
      decodeFile(args.data.slice(args.data.indexOf(',')+1),'base64'); next.assets[path]={encoding:'base64',data:args.data.slice(args.data.indexOf(',')+1)}; break;
    }
    case 'assets.remove': { const path=cleanProjectPath(args.path); if(!Object.hasOwn(next.assets,path)) fail('Asset not found.'); delete next.assets[path]; break; }
    case 'appSettings.set': next.appSettings=clone(args.settings); break;
    case 'resources.write': next.resources=setResource(next.resources,args.entry); break;
    case 'resources.remove': {
      if(!next.resources?.entries.some(e=>resourceKey(e)===args.key)) fail('Unknown resource key.'); next.resources=removeResource(next.resources,args.key); break;
    }
    case 'resources.string': next.resources=setResourceString(next.resources,args.id,args.text,args.language||0); break;
    case 'resources.import': next.resources=readRES(decodeFile(args.data,'base64'),cleanProjectPath(args.fileName||'Project.res')); break;
    default: fail('Unknown project operation.');
  }
  return normalizeProject(next);
}
