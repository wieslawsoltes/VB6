/** Reusable Pascal frontend. Form/control models and executable backends are
 * shared with the host; no DOM, network, eval or external compiler is required. */
import {tokenizePascal,PascalError,PASCAL_KEYWORDS} from '../../../src/language/pascal/lexer.js';
import {parsePascalModule} from '../../../src/language/pascal/parser.js';
import {compilePascalModule,lowerPascalModule} from '../../../src/language/pascal/compiler.js';
import {compileProject,compileModule} from '../../../src/language/compiler.js';
import {normalizeProject,newProject} from '../../../src/project/model.js';

export const PASCAL_VERSION='0.1.0';
export const PASCAL_DIALECT='Turbo Pascal 7.0';

/** Supply units explicitly so project contents are deterministic in browsers,
 * workers and Node. Filesystem resolution belongs to the host or CLI. */
export function createPascalProject(source,{name='PascalApplication',moduleName=name,units=[],settings={},form=null}={}) {
  if(typeof source!=='string')throw new TypeError('Pascal source must be a string.');
  if(!Array.isArray(units))throw new TypeError('Pascal units must be an array.');
  const project=newProject(name,{language:'pascal'});
  project.startup=form?moduleName:'Sub Main';
  project.settings={...project.settings,...settings};
  project.modules=[{id:'pascal_main',name:moduleName,kind:form?'form':'module',language:'pascal',code:source,...(form?{form}:{})},
    ...units.map((unit,index)=>{
      if(!unit||typeof unit.name!=='string'||typeof unit.code!=='string')throw new TypeError('Each unit needs a name and source code.');
      return {...unit,id:unit.id||'pascal_unit_'+index,kind:unit.kind||'module',language:unit.language||'pascal'};
    })];
  return normalizeProject(project);
}

export function compilePascalSource(source,options={}) {
  return compileProject(createPascalProject(source,options),{retainSyntax:options.retainSyntax===true});
}

export {tokenizePascal,PascalError,PASCAL_KEYWORDS,parsePascalModule,compilePascalModule,lowerPascalModule,compileProject,compileModule};
