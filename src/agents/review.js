import {findModule} from '../project/model.js';
import {sourceEdits} from '../mcp/agent-project.js';
/** Build review data from the same pure edit implementation used for the undo transaction. */
export function operationReview(project, request) {
  const changes = [], args = request.arguments;
  if (request.name === 'vb6.code.edit') {
    const candidate = sourceEdits(project, args.edits);
    for (const module of project.modules) {
      const after = findModule(candidate, module.id);
      if (after && module.code !== after.code) changes.push({module: module.name, before: module.code, after: after.code});
    }
  } else if (request.name === 'vb6.module.write') {
    const module = findModule(project, args.module);
    if (module) changes.push({module: module.name, before: module.code, after: args.code});
  }
  return {request, changes};
}
