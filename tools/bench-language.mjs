/** Reproducible, non-gating front-end benchmark. Run each checkout in a fresh process. */
import {performance} from 'node:perf_hooks';
import {cpus} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const options={root:path.resolve(import.meta.dirname,'..'),modules:240,locals:30,samples:7,warmup:3,tokens:100000};
try {
  for(let i=2;i<process.argv.length;i+=2){
    const key=process.argv[i].replace(/^--/,''),value=process.argv[i+1];
    if(!Object.hasOwn(options,key)||value===undefined)throw new Error('Usage: node tools/bench-language.mjs [--root checkout] [--modules 240] [--locals 30] [--samples 7] [--warmup 3] [--tokens 100000]');
    if(key==='root')options.root=path.resolve(value);
    else {const n=Number(value);if(!Number.isSafeInteger(n)||n<1||n>1000000)throw new Error('Benchmark counts must be integers from 1 to 1000000');options[key]=n;}
  }
  const load=file=>import(pathToFileURL(path.join(options.root,'src/language',file)).href);
  const {compileProject}=await load('compiler.js'),{tokenize}=await load('lexer.js');
  const {ProjectDiagnosticCache,diagnosticSnapshot}=await load('diagnostics.js');
  const project={name:'LanguageBenchmark',modules:Array.from({length:options.modules},(_,i)=>({id:'m'+i,name:'M'+i,kind:'module',code:`Private Const Value = 3\nSub Work()\n${Array.from({length:options.locals},(_,j)=>`Dim n${j} As Long`).join('\n')}\nEnd Sub`}))};
  const assertValid=result=>{if(result.diagnostics?.length)throw new Error(JSON.stringify(result.diagnostics));return result;};
  assertValid(compileProject(project));
  const cache=new ProjectDiagnosticCache();assertValid(cache.check(diagnosticSnapshot(project)));
  const measure=fn=>{
    for(let i=0;i<options.warmup;i++)fn();
    const samples=[];for(let i=0;i<options.samples;i++){const start=performance.now();fn();samples.push(performance.now()-start);}
    const sorted=[...samples].sort((a,b)=>a-b),middle=sorted.length>>1;
    return {medianMs:sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2,minMs:sorted[0],maxMs:sorted.at(-1),samplesMs:samples};
  };
  const source='  item$ & "a""b" & F(1.25e3, a, &HFF, otherName) + .125';
  const results={
    compileProject:measure(()=>assertValid(compileProject(project))),
    warmDiagnostics:measure(()=>assertValid(cache.check(diagnosticSnapshot(project)))),
    tokenize:measure(()=>{for(let i=0;i<options.tokens;i++)tokenize(source);})
  };
  console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,cpu:cpus()[0]?.model,options,results},null,2));
}catch(error){console.error(error.message);process.exitCode=1;}
