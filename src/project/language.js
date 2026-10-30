/** Source language is independent of designer, runtime, renderer and export target. */
export const PROJECT_LANGUAGES = Object.freeze([
  Object.freeze({id:'vb6',name:'Visual Basic 6',shortName:'Visual Basic',extension:'.bas'}),
  Object.freeze({id:'pascal',name:'Turbo Pascal 7.0',shortName:'Turbo Pascal',extension:'.pas'}),
]);
const aliases=new Map([['vb','vb6'],['basic','vb6'],['visualbasic','vb6'],['visual basic','vb6'],['visual basic 6','vb6'],['tp','pascal'],['tp7','pascal'],['turbo-pascal','pascal'],['turbopascal','pascal'],['turbo pascal','pascal']]);
export function normalizeLanguage(value){
  if(value===undefined||value===null||value==='')return 'vb6';
  const key=String(value).trim().toLowerCase(),id=aliases.get(key)||key;
  if(!PROJECT_LANGUAGES.some(language=>language.id===id))throw new RangeError('Unsupported source language: '+value);
  return id;
}
export function moduleLanguage(module,project=null){return normalizeLanguage(module?.language??project?.language);}
export function validateModuleLanguage(kind,language){
  const id=normalizeLanguage(language);
  if(kind==='class'&&id==='pascal')throw new RangeError('Pascal class modules are not supported. Declare Turbo Pascal object types inside a Pascal unit, or use an explicit Visual Basic class module (language: vb6).');
  return id;
}
export function languageDescriptor(language){const id=normalizeLanguage(language);return PROJECT_LANGUAGES.find(item=>item.id===id);}
export function sourceExtension(module,project=null){return moduleLanguage(module,project)==='pascal'?'.pas':module?.kind==='form'?'.frm':module?.kind==='class'?'.cls':'.bas';}
export function moduleSourcePath(module,project=null){return module.sourcePath||module.name+sourceExtension(module,project);}
export function createModuleSource(kind,name,language='vb6',{requireVariableDeclaration=true}={}){
  if(validateModuleLanguage(kind,language)==='pascal')return `unit ${name};\n\ninterface\n\nimplementation\n\n${kind==='form'?'procedure Form_Load;\nbegin\n\nend;\n\n':''}end.\n`;
  return (requireVariableDeclaration?'Option Explicit\n\n':'')+(kind==='form'?'Private Sub Form_Load()\n    \nEnd Sub\n':'');
}
