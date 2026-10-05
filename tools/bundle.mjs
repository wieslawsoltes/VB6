/** Zero-dependency bundler for this project's deliberately restricted ESM sources.
 * Supports relative named imports, declaration exports and local export lists only; fails closed otherwise.
 */
import fs from 'node:fs';
import path from 'node:path';
export function bundle(entry,globalName='VB6'){
  const modules=new Map(),visiting=new Set();
  function visit(file){file=path.resolve(file);if(modules.has(file))return;if(visiting.has(file))throw new Error('Circular module dependency: '+file);visiting.add(file);let source=fs.readFileSync(file,'utf8'),imports=[];
    source=source.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"];?\s*$/gm,(all,names,spec)=>{if(!spec.startsWith('.'))throw new Error('Non-relative import in '+file);const resolved=path.resolve(path.dirname(file),spec);visit(resolved);imports.push({names,resolved});return '';});
    if(/^\s*import\s/m.test(source))throw new Error('Unsupported import syntax in '+file);
    const exports=[];source=source.replace(/\bexport\s+(?=(?:async\s+)?(?:function|class|const|let|var)\s+([\w$]+))/g,(_,name)=>{exports.push(name);return '';});
    source=source.replace(/^export\s*\{([\w$\s,]+)\};?\s*$/gm,(_,names)=>{for(const name of names.split(',').map(n=>n.trim()).filter(Boolean)){if(!/^[A-Za-z_$][\w$]*$/.test(name))throw new Error('Unsupported export name in '+file);exports.push(name);}return '';});
    if(/^\s*export\s/m.test(source))throw new Error('Unsupported export syntax in '+file);
    modules.set(file,{source,exports,imports});visiting.delete(file);
  }
  visit(entry);
  for(const [file,m] of modules)for(const imported of m.imports)for(const binding of imported.names.split(',').map(s=>s.trim()).filter(Boolean)){
    const match=/^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/.exec(binding);
    if(!match)throw new Error('Unsupported import binding '+binding+' in '+file);
    if(!modules.get(imported.resolved).exports.includes(match[1]))throw new Error('Missing export '+match[1]+' from '+imported.resolved+' imported by '+file);
  }
  const ids=new Map([...modules.keys()].map((file,i)=>[file,i]));const code=[`/* VB6 Studio Web 0.5.0 - MIT. Generated from modular sources. */\n(()=>{'use strict';\nconst __modules=[];`];
  for(const [file,m]of modules){const declarations=m.imports.map(i=>`const {${i.names.replace(/\bas\b/g,':')}}=__modules[${ids.get(i.resolved)}];`).join('\n');code.push(`\n/* ${path.relative(path.dirname(entry),file).replace(/\\/g,'/').replace(/\*\//g,'')} */\n__modules[${ids.get(file)}]=(()=>{\n${declarations}\n${m.source}\nreturn {${m.exports.join(',')}};\n})();`);}
  code.push(`globalThis[${JSON.stringify(globalName)}]=__modules[${ids.get(path.resolve(entry))}];\n})();`);return code.join('\n');
}
