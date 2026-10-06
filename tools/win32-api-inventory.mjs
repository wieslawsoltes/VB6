/** Generate the complete named-export catalog; detailed per-export notes remain
 * machine-readable through createWin32().manifest(), without repeated prose. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createWin32} from '../packages/win32-browser/src/index.js';
const root=new URL('../packages/win32-browser/',import.meta.url),metadata=JSON.parse(readFileSync(new URL('package.json',root),'utf8'));
const w=createWin32();try {
  const apis=w.manifest(),groups=new Map();
  for(const api of apis){const key=api.dll+' / '+api.mode;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(api);}
  const sections=[...groups].map(([key,entries])=>'## '+key+'\n\n'+entries.map(x=>'`'+x.name+'('+x.arity+')`').join(', ')+'\n');
  writeFileSync(new URL('API.md',root),`# Win32 browser export inventory\n\nVersion ${metadata.version}. ${apis.length} named exports, counting ANSI/Unicode variants and aliases.\nParentheses give the number of 32-bit arguments; PtInRect expands a by-value POINT into two scalars.\n\nGroup headings identify the DLL and implementation mode. Export presence does not imply every native flag or behavior.\nThe public \`createWin32().manifest()\` also returns specific notes for each export.\nSee [README](README.md), [system services](SYSTEM-SERVICES.md), [common services](SERVICES.md),\n[GDI](GDI.md), [regions](REGIONS.md), and [advanced GDI](ADVANCED-GDI.md) for contracts and boundaries.\n\n${sections.join('\n')}`);
} finally {w.dispose();}
