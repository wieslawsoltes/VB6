import os from 'node:os';import fs from 'node:fs';import {performance} from 'node:perf_hooks';
import {LayoutEngine} from '../packages/auto-layout/src/index.js';
const report={node:process.version,platform:process.platform,architecture:process.arch,cpu:os.cpus()[0]?.model,units:'milliseconds',samples:200,results:[]};
const percentile=(a,p)=>a.slice().sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))];
for(const count of [100,1000,10000,100000]){
 const begin=performance.now(),engine=new LayoutEngine(Array.from({length:count},(_,i)=>({id:i,bounds:{x:i%100,y:(i/100)|0,width:60,height:30},anchor:i%16})),{width:1000,height:1000}),compile=performance.now()-begin;
 for(let i=0;i<100;i++)engine.arrange(1000+i%17,1000+i%31);
 const times=[];for(let i=0;i<report.samples;i++){const start=performance.now();engine.arrange(1000+i%17,1000+i%31);times.push(performance.now()-start);}
 const update=[];for(let i=0;i<report.samples;i++){const start=performance.now();engine.update(i%count,{minWidth:i%17});update.push(performance.now()-start);}
 engine.arrange(1000,1000);const a=performance.now();for(let i=0;i<10000;i++)engine.arrange(1000,1000);
 report.results.push({nodes:count,compile,resizeMedian:percentile(times,.5),resizeP95:percentile(times,.95),updateMedian:percentile(update,.5),updateP95:percentile(update,.95),unchangedMean:(performance.now()-a)/10000});
}
fs.mkdirSync('reports/layout',{recursive:true});fs.writeFileSync('reports/layout/benchmark.json',JSON.stringify(report,null,2));console.table(report.results);console.log(report.node,report.platform,report.architecture,report.cpu);
