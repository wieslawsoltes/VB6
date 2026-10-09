import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {bundle} from './bundle.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const packageRoot=path.join(root,'packages/advanced-editor'),require=createRequire(path.join(packageRoot,'package.json'));
const adaptersOnly=process.argv.includes('--adapters-only'),vendorOnly=process.argv.includes('--vendor-only');
if(adaptersOnly&&vendorOnly)throw new Error('Choose either --adapters-only or --vendor-only.');
let esbuild,editorWorker;
try{if(!adaptersOnly){esbuild=require('esbuild');editorWorker=require.resolve('monaco-editor/editor/editor.worker');}}
catch(error){throw new Error('Install the optional pinned dependencies first: npm install --prefix packages/advanced-editor --ignore-scripts',{cause:error});}
const outdir=path.join(root,'dist/advanced-editor'),standalone=path.join(root,'dist/VB6-Studio-Web.html');
if(!fs.existsSync(standalone))throw new Error('Run npm run build before building the advanced editor.');
fs.mkdirSync(outdir,{recursive:true});
const common={absWorkingDir:root,bundle:true,platform:'browser',target:['es2022'],minify:true,legalComments:'eof',charset:'utf8',nodePaths:[path.join(packageRoot,'node_modules')],loader:{'.ttf':'dataurl','.woff':'dataurl','.woff2':'dataurl'},logLevel:'warning'};
if(!adaptersOnly){
  await esbuild.build({...common,entryPoints:['src/editor/advanced/monaco-entry.js'],outfile:path.join(outdir,'monaco.js'),format:'iife',globalName:'VB6AdvancedMonaco'});
  await esbuild.build({...common,entryPoints:[editorWorker],outfile:path.join(outdir,'editor.worker.js'),format:'iife'});
}
// IDE-specific adapters remain independently buildable with zero dependencies.
if(!vendorOnly){
fs.writeFileSync(path.join(outdir,'entry.js'),bundle(path.join(root,'src/editor/advanced/entry.js'),'VB6AdvancedEditorRuntime'));
fs.copyFileSync(path.join(root,'src/editor/advanced/editor.css'),path.join(outdir,'entry.css'));
fs.writeFileSync(path.join(outdir,'language.worker.js'),bundle(path.join(root,'src/editor/advanced/language.worker.js'),'VB6LanguageWorker'));
}
const monacoRoot=path.join(packageRoot,'node_modules/monaco-editor');
const licenses=[];
for(const name of ['LICENSE','License.txt','ThirdPartyNotices.txt']){const source=path.join(monacoRoot,name);if(fs.existsSync(source))licenses.push(`\n===== monaco-editor/${name} =====\n`+fs.readFileSync(source,'utf8'));}
if(!adaptersOnly&&!licenses.length)throw new Error('Monaco license notices were not found; refusing to package without attribution.');
if(!adaptersOnly)fs.writeFileSync(path.join(outdir,'THIRD-PARTY-NOTICES.txt'),licenses.join('\n'));
if(!vendorOnly){
const sources={},manifest={version:1,monaco:'0.57.0',esbuild:'0.25.9',files:{}};
for(const name of ['monaco.js','monaco.css','entry.js','entry.css','editor.worker.js','language.worker.js','THIRD-PARTY-NOTICES.txt']){
  const bytes=fs.readFileSync(path.join(outdir,name));manifest.files[name]={bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  if(/\.(?:js|css)$/.test(name))sources[name]=bytes.toString('utf8');
}
fs.writeFileSync(path.join(outdir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const payload='<script type="application/json" id="vb6-advanced-editor-assets">'+JSON.stringify(sources).replace(/</g,'\\u003c')+'</script>\n';
const template=fs.readFileSync(standalone,'utf8');
// Separate artifact: the standard file remains byte-identical and small.
fs.writeFileSync(path.join(root,'dist/VB6-Studio-Web-Advanced.html'),template.replace('</head>',()=>payload+'</head>'));
console.log('Built optional self-hosted editor and offline Advanced HTML:');
for(const [name,value]of Object.entries(manifest.files))console.log(`${name}: ${value.bytes.toLocaleString()} bytes; sha256 ${value.sha256}`);

}else console.log('Built pinned Monaco vendor assets.');
