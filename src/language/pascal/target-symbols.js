import {moduleLanguage} from '../../project/language.js';

/** Native exporters own a normalized project snapshot. VB conditional values
 * remain numeric; Pascal needs a separate presence map so a false target is
 * undefined while an ordinary user constant with value zero remains defined. */
export function setTargetConditionalConstants(project,constants) {
  const targetNames=new Set(Object.keys(constants).map(name=>name.toLowerCase()));
  const inherited=values=>Object.fromEntries(Object.entries(values||{}).filter(([name])=>!targetNames.has(name.toLowerCase())));
  project.settings={...project.settings,conditionalConstants:{...inherited(project.settings?.conditionalConstants),...constants}};
  const symbols=Object.fromEntries(Object.entries(constants).map(([name,value])=>[name,Boolean(value)]));
  for(const module of project.modules||[])if(moduleLanguage(module,project)==='pascal')
    module.pascalTargetSymbols={...inherited(module.pascalTargetSymbols),...symbols};
}
