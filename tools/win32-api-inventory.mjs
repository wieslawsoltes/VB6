/** Regenerate the shipped inventory from registered APIs, never a hand-maintained count. */
import {readFileSync,writeFileSync} from 'node:fs';
import {createWin32} from '../packages/win32-browser/src/index.js';
const root=new URL('../packages/win32-browser/',import.meta.url),metadata=JSON.parse(readFileSync(new URL('package.json',root),'utf8'));
const w=createWin32();try{
  const apis=w.manifest(),escape=s=>String(s).replaceAll('|','\\|').replaceAll('\n',' ');
  const rows=apis.map(x=>`| ${x.dll} | \`${x.name}\` | ${x.arity} | ${x.mode} | ${escape(x.notes)} |`);
  writeFileSync(new URL('API.md',root),`# Win32 browser export inventory\n\nVersion ${metadata.version}. ${apis.length} named exports, counting A/W variants and aliases.\nSee README.md and GDI.md for per-family restrictions and the VB6 ABI boundary.\nArity counts 32-bit arguments; PtInRect expands a by-value POINT into two scalars.\n\n| DLL | Export | Arity | Mode | Specific notes |\n| --- | --- | ---: | --- | --- |\n${rows.join('\n')}\n`);
}finally{w.dispose();}
