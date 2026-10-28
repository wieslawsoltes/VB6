import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..'),temp=mkdtempSync(join(tmpdir(),'vb6-xaml-package-'));
function run(command,args,cwd=temp) {
  const result=spawnSync(command,args,{cwd,encoding:'utf8'});
  if(result.error||result.status!==0)throw new Error([result.error?.message,result.stdout,result.stderr].filter(Boolean).join('\n'));
  return result.stdout;
}
try {
  const pack=JSON.parse(run('npm',['pack','--json','--pack-destination',temp],join(root,'packages/xaml-compiler')))[0];
  for(const required of ['src/index.js','src/index.d.ts','src/schema.js','src/macos26.js','LICENSE','README.md'])if(!pack.files.some(f=>f.path===required))throw new Error('Package is missing '+required);
  mkdirSync(join(temp,'node_modules/@vb6/xaml-compiler'),{recursive:true});
  run('tar',['-xzf',join(temp,pack.filename),'-C',join(temp,'node_modules/@vb6/xaml-compiler'),'--strip-components=1']);
  writeFileSync(join(temp,'package.json'),'{"type":"module"}\n');
  const source=`import {compileXaml,instantiateXaml,createObjectHost,XamlLanguageService,createMacOS26Schema} from '@vb6/xaml-compiler';\nconst text='<Button xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Content="Isolated" Width="42"/>';\nconst result=compileXaml(text);\nif(!result.success||!result.program)throw new Error(JSON.stringify(result.diagnostics));\nconst instance=instantiateXaml(result.program,createObjectHost());\nif(instance.root.properties.Content!=='Isolated'||instance.root.properties.Width!==42)throw new Error('Incorrect construction');\ninstance.dispose();\nconst service=new XamlLanguageService();service.openDocument('test.xaml',text,1);\nif(service.diagnostics('test.xaml').length)throw new Error('Unexpected diagnostics');\nservice.closeDocument('test.xaml');\nconst macText='<mac:Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" xmlns:mac="urn:vb6:macos26"><mac:SegmentedControl x:Name="Modes" SelectionMode="Single" SelectedIndex="1"><mac:Segment Key="icons" Title="Icons"/><mac:Segment Key="list" Title="List" IsEnabled="False"/></mac:SegmentedControl></mac:Window>';\nconst macResult=compileXaml(macText,{schema:createMacOS26Schema()});\nif(!macResult.success||!macResult.program)throw new Error(JSON.stringify(macResult.diagnostics));\nconst macInstance=instantiateXaml(macResult.program,createObjectHost()),modes=macInstance.names.get('Modes');\nif(!modes||macInstance.root.properties.Content!==modes)throw new Error('Incorrect macOS named content construction');\nconst segments=modes.properties.Segments;\nif(!Array.isArray(segments)||segments.length!==2||segments[0].properties.Key!=='icons'||segments[1].properties.Title!=='List'||segments[1].properties.IsEnabled!==false)throw new Error('Incorrect macOS typed collection construction');\nmacInstance.dispose();\n`;
  writeFileSync(join(temp,'consumer.mjs'),source);run(process.execPath,['consumer.mjs']);
  writeFileSync(join(temp,'consumer.mts'),source);
  const available=spawnSync('tsc',['--version'],{encoding:'utf8'});
  if(available.status===0)run('tsc',['--strict','--noEmit','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2023','consumer.mts']);
  console.log(JSON.stringify({package:pack.name,version:pack.version,files:pack.files.length,size:pack.size,isolatedImport:'passed',types:available.status===0?'passed':'not run: tsc unavailable'},null,2));
} finally {rmSync(temp,{recursive:true,force:true});}
