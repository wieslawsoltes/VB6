import {clone} from '../core/core.js';
import {normalizeProject} from './model.js';
const fileName=p=>p.sourcePath||p.name+(p.kind==='form'?'.frm':p.kind==='class'?'.cls':'.bas');
export function mergedProject(current,incoming){
  if(incoming.nativeWorkspace)throw new Error('Open a project group as a workspace rather than adding it as source files.');
  const next=clone(current);next.assets=Object.assign(Object.create(null),next.assets);const names=new Set(next.modules.map(m=>m.name.toLowerCase())),paths=new Set(next.modules.map(m=>fileName(m).toLowerCase()));
  for(const m of incoming.modules){if(names.has(m.name.toLowerCase()))throw new Error('A module named '+m.name+' already exists.');if(paths.has(fileName(m).toLowerCase())||Object.keys(next.assets).some(p=>p.toLowerCase()===fileName(m).toLowerCase()))throw new Error('A source file already uses '+fileName(m));names.add(m.name.toLowerCase());paths.add(fileName(m).toLowerCase());next.modules.push(m);}
  for(const [path,asset]of Object.entries(incoming.assets||{})){const existing=Object.keys(next.assets).find(p=>p.toLowerCase()===path.toLowerCase());if(paths.has(path.toLowerCase())||existing&&JSON.stringify(next.assets[existing])!==JSON.stringify(asset))throw new Error('Conflicting companion file: '+path);next.assets[existing||path]=asset;}
  return normalizeProject(next);
}
