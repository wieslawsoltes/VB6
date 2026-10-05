import {IDENTIFIER, symbolKey} from './source-context.js';
import {PRIMITIVE_TYPES, TYPE_CATALOG, ENUM_TYPES} from './type-catalog.js';

const contextPattern = new RegExp('\\b(As(?:\\s+New)?|New|Implements)\\s+((?:' + IDENTIFIER + '\\s*\\.\\s*)*)$', 'i');
const simpleName = /^[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*[$%&!#@]?$/u;
const parts = name => String(name).split(/\s*\.\s*/).map(part => part.trim().replace(/^\[|\]$/g, ''));
const insertion = name => parts(name).map(part => simpleName.test(part) ? part : '[' + part + ']').join('.');
const visible = type => !type.hidden && !type.restricted;

/** The caller passes the masked statement up to the start of the incomplete
 * token. Completed qualifiers retain their spelling and bracket boundaries. */
export function typeCompletionContext(before) {
  const match = before.match(contextPattern);
  return match ? {construct: /New/i.test(match[1]), implementsType: /^Implements/i.test(match[1]), qualifier: parts(match[2]).filter(Boolean)} : null;
}

/** Project records belong to modules; external libraries may have nested
 * namespaces. Project one path component at a time instead of dropping every
 * qualifier and suggesting a leaf that would insert an unresolvable type. */
export function typeCandidates(service, project, module, context) {
  const types = [];
  const add = (symbol, paths, display = symbol.name) => types.push({symbol, paths, display});
  for (const name of PRIMITIVE_TYPES) add({name, type: name, kind: 'type'}, [name, 'VBA.' + name]);
  for (const target of project.modules) {
    if (target.kind !== 'module') {
      add({name: target.name, type: target.name, kind: target.kind === 'form' ? 'form' : 'class', moduleId: target.id,
        line: 1, creatable: target.form?.type !== 'MDIForm'}, [target.name, ...(project.name ? [project.name + '.' + target.name] : [])]);
    }
  }
  // Resolve unqualified collisions in the current module before other modules.
  for (const target of [module, ...project.modules.filter(item => item.id !== module.id)]) {
    for (const record of service.index(target, project).records) {
      if (target.id !== module.id && record.scope === 'private') continue;
      const qualified = target.name + '.' + record.name;
      add({...record, type: qualified}, [qualified, ...(project.name ? [project.name + '.' + qualified] : [])]);
    }
  }
  for (const type of [...TYPE_CATALOG.values(), ...ENUM_TYPES.values(), ...service.referenceTypes(project)]) {
    add({...type, type: type.type || type.name}, [type.name, ...(type.aliases || [])]);
  }
  const result = [];
  const projectPath = (entry, path) => {
    const segments = parts(path), prefix = context.qualifier;
    if (segments.length <= prefix.length || !prefix.every((part, i) => symbolKey(part) === symbolKey(segments[i]))) return;
    const name = segments[prefix.length], leaf = segments.length === prefix.length + 1;
    result.push(leaf ? {...entry.symbol, name, insertText: insertion(name)} :
      {name, insertText: insertion(name), kind: 'module', namespace: segments.slice(0, prefix.length + 1).join('.')});
  };
  for (const entry of types) {
    const type = entry.symbol;
    if (!visible(type)) continue;
    if (context.construct && (!['class', 'form'].includes(type.kind) || type.creatable === false)) continue;
    if (context.implementsType && !['class', 'interface'].includes(type.kind)) continue;
    if (!context.qualifier.length) {
      result.push({...type, name: entry.display, insertText: type.insertText || insertion(entry.display)});
      for (const path of entry.paths) if (parts(path).length > 1) projectPath(entry, path);
    } else for (const path of entry.paths) projectPath(entry, path);
  }
  return result;
}
