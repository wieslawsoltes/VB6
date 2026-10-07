/** Optional link-time pruning for compiler-described, non-fallthrough code units.
 * Every native address/call must be represented by a relocation. Untagged code
 * and every data relocation are roots; only proven unreachable code is removed.
 * Raw numeric pointers are deliberately outside this opt-in compiler contract.
 */
export function pruneNativeProcedures(sections, roots=[]) {
  if(!Array.isArray(roots)||roots.some(s=>typeof s!=='string'||!s))throw new Error('Invalid native reachability roots');
  const symbols=new Map(),units=[],bySection=new Map(),edges=new Map(),live=new Set();
  for(const section of sections){
    for(const [name,offset]of section.labels){
      if(symbols.has(name))throw new Error('Duplicate linker symbol: '+name);
      if(!Number.isInteger(offset)||offset<0||offset>section.length)throw new Error('Invalid native label offset');
      symbols.set(name,{section,offset});
    }
    const local=[...(section.codeUnits||[])].sort((a,b)=>a.start-b.start);let end=0;
    for(const unit of local){
      if(!(section.flags&0x20)||!unit.closed||typeof unit.name!=='string'||section.labels.get(unit.name)!==unit.start||!Number.isInteger(unit.start)||!Number.isInteger(unit.end)||unit.start<end||unit.end<=unit.start||unit.end>section.length)throw new Error('Invalid native code-unit metadata');
      end=unit.end;units.push(unit);edges.set(unit,new Set());
    }
    bySection.set(section,local);
  }
  const containing=(section,offset)=>{
    const list=bySection.get(section);let lo=0,hi=list.length;
    while(lo<hi){const m=(lo+hi)>>>1;if(list[m].start<=offset)lo=m+1;else hi=m;}
    const u=list[lo-1];return u&&offset<u.end?u:null;
  };
  const add=(from,to)=>{if(to){if(from)edges.get(from).add(to);else live.add(to);}};
  for(const root of roots){const symbol=symbols.get(root);if(!symbol)throw new Error('Unknown native reachability root: '+root);add(null,containing(symbol.section,symbol.offset));}
  // Plan and validate every relocation before changing any bytes or coordinates.
  const refs=[];let blocked=false;
  for(const section of sections)for(const fixup of section.fixups){
    const width=fixup.kind==='rel8'?1:4;
    if(!['rel8','rel','va','rva'].includes(fixup.kind)||!Number.isInteger(fixup.offset)||fixup.offset<0||fixup.offset+width>section.length||!Number.isSafeInteger(fixup.addend))throw new Error('Invalid native relocation in reachability');
    const from=containing(section,fixup.offset),last=containing(section,fixup.offset+width-1);
    if(from!==last)throw new Error('Native relocation crosses a code-unit boundary');
    const symbol=symbols.get(fixup.label);
    if(!symbol)continue; // Import/linker-created symbols are resolved after this pass.
    const target=symbol.offset+fixup.addend;
    // Pointer arithmetic outside a known section has no safe rebasing proof.
    if(target<0||target>symbol.section.length){blocked=true;continue;}
    add(from,containing(symbol.section,symbol.offset));
    add(from,containing(symbol.section,target));
    refs.push({fixup,symbol,target});
  }
  const stats={proceduresRemoved:0,procedureBytesSaved:0,removedProcedures:[],pruningBlocked:blocked};
  if(blocked)return stats;
  const queue=[...live];for(let i=0;i<queue.length;i++)for(const target of edges.get(queue[i]))if(!live.has(target)){live.add(target);queue.push(target);}
  const plans=new Map();
  for(const section of sections){
    const removed=bySection.get(section).filter(u=>!live.has(u));let saved=0;
    const prefix=removed.map(u=>{const before=saved;saved+=u.end-u.start;return before;});
    const map=offset=>{
      let lo=0,hi=removed.length;while(lo<hi){const m=(lo+hi)>>>1;if(removed[m].end<=offset)lo=m+1;else hi=m;}
      return offset-(lo?prefix[lo-1]+removed[lo-1].end-removed[lo-1].start:0);
    };
    const dead=offset=>{const u=containing(section,offset);return !!u&&!live.has(u);};
    plans.set(section,{removed,map,dead});stats.proceduresRemoved+=removed.length;stats.procedureBytesSaved+=saved;stats.removedProcedures.push(...removed.map(u=>u.name));
  }
  if(!stats.proceduresRemoved)return stats;
  for(const {fixup,symbol,target}of refs){const plan=plans.get(symbol.section);fixup.addend=plan.map(target)-plan.map(symbol.offset);}
  for(const section of sections){
    const {removed,map,dead}=plans.get(section);if(!removed.length)continue;
    const bytes=[];let cursor=0;for(const u of removed){for(;cursor<u.start;cursor++)bytes.push(section.bytes[cursor]);cursor=u.end;}for(;cursor<section.length;cursor++)bytes.push(section.bytes[cursor]);
    section.labels=new Map([...section.labels].filter(([,offset])=>!dead(offset)).map(([name,offset])=>[name,map(offset)]));
    section.fixups=section.fixups.filter(f=>!dead(f.offset)).map(f=>({...f,offset:map(f.offset)}));
    section.codeUnits=bySection.get(section).filter(u=>live.has(u)).map(u=>({...u,start:map(u.start),end:map(u.end)}));
    section.bytes=bytes;
  }
  return stats;
}
