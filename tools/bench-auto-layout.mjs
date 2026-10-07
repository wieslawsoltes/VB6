/** Solver and guide-index timings, not DOM rendering or physical GPU claims. */
import fs from 'node:fs';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {LayoutEngine} from '../packages/auto-layout/src/index.js';
import {GuideIndex} from '../src/layout/guides.js';
const samples=100,results=[];
const stats=times=>{times.sort((a,b)=>a-b);return {median:times[Math.floor(times.length*.5)],p95:times[Math.floor(times.length*.95)]};};
const time=fn=>{const a=performance.now();fn();return performance.now()-a;};
for(const count of [1000,10000])for(const flow of ['Horizontal','Wrap','VerticalWrap','Grid']){
  const nodes=Array.from({length:count},(_,id)=>({id,bounds:{x:0,y:0,width:60,height:30},widthMode:flow==='Horizontal'||flow==='Grid'?'fill':'fixed',maxWidth:flow==='Horizontal'&&id%3===0?65:0}));
  let engine;const compile=time(()=>engine=new LayoutEngine(nodes,{width:1000,height:800,layout:flow,columns:20,gap:4,crossGap:6}));
  for(let i=0;i<20;i++)engine.arrange(1000+i%7,800+i%11);
  const values=Array.from({length:samples},(_,i)=>time(()=>engine.arrange(1000+i%7,800+i%11)));
  results.push({case:flow,nodes:count,compile,...stats(values)});
}
for(const count of [1000,10000]){
  const nodes=Array.from({length:count},(_,id)=>({id,bounds:{width:60,height:30},widthMode:'hug',heightMode:'hug',measure:()=>({width:60,height:30})}));
  const engine=new LayoutEngine(nodes,{width:1000,height:800,layout:'Wrap',heightMode:'hug',gap:4});
  for(let i=0;i<20;i++)engine.arrange(1000+i%7,800);
  results.push({case:'Hug wrap (trivial callback)',nodes:count,...stats(Array.from({length:samples},(_,i)=>time(()=>engine.arrange(1000+i%7,800))))});
  const rects=Array.from({length:count},(_,id)=>({id,x:id%100*72,y:Math.floor(id/100)*42,width:60,height:30}));let index;
  const compile=time(()=>index=new GuideIndex(rects));
  results.push({case:'Guide query',nodes:count,compile,...stats(Array.from({length:samples},(_,i)=>time(()=>index.snap({x:120+i,y:120+i,width:60,height:30},6))))});
}
const report={node:process.version,platform:process.platform,architecture:process.arch,cpu:os.cpus()[0]?.model,units:'milliseconds',samples,excludes:'DOM, painting, real text measurement and whole-editor transactions',results};
fs.mkdirSync('reports/auto-layout',{recursive:true});fs.writeFileSync('reports/auto-layout/benchmark.json',JSON.stringify(report,null,2));console.table(results);
