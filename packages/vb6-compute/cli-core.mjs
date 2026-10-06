import fs from 'node:fs';
import path from 'node:path';
export const HELP=`VB6 Compute compiler (experimental)
Usage: vb6-compute INPUT --out OUTPUT [options]
Inputs: .bas/.vb source, .vb6web/.json project, or - for standard input.
  --format wgsl|json|html       Default: output extension
  --entry Module.Procedure     Default: Main/project startup
  --event EVENT=Module.Sub     Repeat to compile an event application
  --precision strict|single    Explicit f32 approximation only when selected
  --workgroup-size N           1..256
  --max-call-depth N           1..64
  --dynamic-array-capacity N   Fixed per-array GPU capacity
  --width N --height N         HTML surface size
  --count N --capacity N --fuel N
  --timer-interval SECONDS     HTML timer event cadence
  --title TEXT --force --help
Unsupported VB features are diagnosed; no CPU execution fallback is emitted.
`;
export function parseComputeCLI(args) {
  const config={compiler:{},export:{},events:{},force:false},names={entry:['compiler','entry'],precision:['compiler','precision'],'workgroup-size':['compiler','workgroupSize'],'max-call-depth':['compiler','maxCallDepth'],'dynamic-array-capacity':['compiler','dynamicArrayCapacity'],'max-state-words':['compiler','maxStateWords'],'gosub-stack-depth':['compiler','gosubStackDepth'],width:['export','width'],height:['export','height'],count:['export','count'],capacity:['export','capacity'],fuel:['export','fuel'],'timer-interval':['export','timerInterval'],title:['export','title']};
  const strings=new Set(['entry','precision','title']),seen=new Set();
  for(let i=0;i<args.length;i++) {
    const arg=args[i];
    if(arg==='--help'||arg==='-h'){config.help=true;continue;}
    if(arg==='--force'){config.force=true;continue;}
    if(!arg.startsWith('--')){if(config.input)throw new Error('Only one input is accepted');config.input=arg;continue;}
    const equal=arg.indexOf('='),name=arg.slice(2,equal<0?undefined:equal),value=equal<0?args[++i]:arg.slice(equal+1);
    if(value===undefined||value===''||value.startsWith('--'))throw new Error('Missing value for --'+name);
    if(name!=='event'){if(seen.has(name))throw new Error('Duplicate option --'+name);seen.add(name);}
    if(name==='out'){config.output=value;continue;}
    if(name==='format'){config.format=value;continue;}
    if(name==='event') {
      const match=/^([A-Za-z]+)=((?:[A-Za-z_]\w*\.)?[A-Za-z_]\w*)$/.exec(value);
      if(!match||Object.hasOwn(config.events,match[1]))throw new Error('Invalid or duplicate event binding');
      config.events[match[1]]=match[2];continue;
    }
    const target=names[name];if(!target)throw new Error('Unknown option --'+name);
    let parsed=value;
    if(!strings.has(name)){
      if(!(name==='timer-interval'?/^\d+(?:\.\d+)?$/:/^\d+$/).test(value))throw new Error('--'+name+' requires a nonnegative number');
      parsed=Number(value);if(!Number.isFinite(parsed))throw new Error('--'+name+' is out of range');
    }
    config[target[0]][target[1]]=parsed;
  }
  if(!config.help) {
    if(!config.input||!config.output)throw new Error('INPUT and --out OUTPUT are required');
    config.format??=path.extname(config.output).slice(1).toLowerCase();
    if(!['wgsl','json','html'].includes(config.format))throw new Error('Output format must be wgsl, json or html');
  }
  return config;
}
/** Compile before writing. Existing outputs and the input itself are protected. */
export function runComputeCLI(api,args,{runtimeSource,stdout=process.stdout,stderr=process.stderr}={}) {
  try {
    const config=parseComputeCLI(args);if(config.help){stdout.write(HELP);return 0;}
    const text=fs.readFileSync(config.input==='-'?0:config.input,'utf8');
    if(Buffer.byteLength(text)>16*1024*1024)throw new Error('Input exceeds the 16 MiB source limit');
    const extension=config.input==='-'?'.bas':path.extname(config.input).toLowerCase();
    if(!['.bas','.vb','.vb6web','.json'].includes(extension))throw new Error('Supported inputs: .bas, .vb, .vb6web, .json');
    const source=['.vb6web','.json'].includes(extension)?JSON.parse(text):text;
    const options={...config.compiler,...(Object.keys(config.events).length?{events:config.events}:{})};
    const application=config.format==='html'||Object.keys(config.events).length>0;
    const result=application?api.compileComputeApplication(source,options):api.compileCompute(source,options);
    const artifact=application?result.artifact:result;
    let output=config.format==='wgsl'?artifact.wgsl:config.format==='json'?JSON.stringify(result,null,2)+'\n':api.exportComputeHTML(result,{...config.export,runtimeSource:typeof runtimeSource==='function'?runtimeSource():runtimeSource});
    const destination=path.resolve(config.output);
    if(config.input!=='-') {
      if(path.resolve(config.input)===destination)throw new Error('Output must not replace the input');
      if(fs.existsSync(destination)){const a=fs.statSync(config.input),b=fs.statSync(destination);if(a.dev===b.dev&&a.ino===b.ino)throw new Error('Output aliases the input');}
    }
    // 'wx' is atomic against races when overwrite is not explicitly requested.
    fs.writeFileSync(destination,output,{encoding:'utf8',flag:config.force?'w':'wx'});
    for(const d of artifact.diagnostics)stderr.write(`${d.code}: ${d.message}\n`);
    stdout.write(`${config.format.toUpperCase()} written to ${destination}\n`);return 0;
  }catch(error){stderr.write(`${error.code||'GPU_CLI'}: ${error.message}\n`);return 1;}
}
