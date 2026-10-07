import {nativeIntegerFits,nativeIntegerLiteral,nativeSignedIntegerLiteral,nativeIntegerUnaryType,nativeIntegerBinaryType} from './integers.js';
/** Conservative native optimization. Only assembler-tagged branches are resized;
 * raw bytes are never disassembled heuristically. All addressable labels survive.
 */
export function nativeOptimizationLevel(value=1) {
  if(typeof value==='string'&&/^(?:O)?[012]$/i.test(value))value=Number(value.replace(/^o/i,''));
  if(!Number.isInteger(value)||value<0||value>2)throw new Error('Native optimization must be 0, 1 or 2');
  return value;
}
/** Return null for any typed overflow or effectful expression. Successful folding
 * preserves every intermediate Byte/Integer/Long boundary, not just the result.
 */
export function foldNativeInteger(node,resolve=()=>null) {
  function evaluate(node) {
    if(!node)return null;
    if(node.kind==='group')return evaluate(node.expr);
    const signed=nativeSignedIntegerLiteral(node);if(signed)return signed;
    const literal=nativeIntegerLiteral(node);if(literal)return nativeIntegerFits(literal.value,literal.type)?literal:null;
    if(node.kind==='id'||node.kind==='member'){
      const bound=resolve(node);return bound&&nativeIntegerFits(bound.value,bound.type)?bound:null;
    }
    if(node.kind==='unary'){
      const a=evaluate(node.expr);if(!a)return null;const op=String(node.op).toLowerCase(),type=nativeIntegerUnaryType(op,a.type);if(!type)return null;
      let value=op==='-'?-a.value:op==='+'?a.value:~a.value;if(op==='not'&&type==='byte')value&=255;
      return nativeIntegerFits(value,type)?{value,type}:null;
    }
    if(node.kind!=='binary')return null;
    const left=evaluate(node.left),right=evaluate(node.right);if(!left||!right)return null;
    const a=left.value,b=right.value,op=String(node.op).toLowerCase(),type=nativeIntegerBinaryType(op,left.type,right.type);if(!type)return null;let value;
    switch(op){
      case '+':value=a+b;break;case '-':value=a-b;break;
      case '*':{const n=BigInt(a)*BigInt(b);if(n < -2147483648n||n > 2147483647n)return null;value=Number(n);break;}
      case '\\':case 'mod':if(b===0||op==='\\'&&a===-2147483648&&b===-1)return null;value=op==='mod'?a%b:Math.trunc(a/b);break;
      case 'and':value=a&b;break;case 'or':value=a|b;break;case 'xor':value=a^b;break;
      case 'eqv':value=~(a^b);if(type==='byte')value&=255;break;case 'imp':value=(~a)|b;if(type==='byte')value&=255;break;
      case '=':value=a===b?-1:0;break;case '<>':value=a!==b?-1:0;break;
      case '<':value=a<b?-1:0;break;case '<=':value=a<=b?-1:0;break;case '>':value=a>b?-1:0;break;case '>=':value=a>=b?-1:0;break;
      default:return null;
    }
    return nativeIntegerFits(value,type)?{value:Object.is(value,-0)?0:value,type}:null;
  }
  const value=evaluate(node);return value?{value:value.value}:null;
}

function branchPlan(section,fixup) {
  if(fixup.kind!=='rel'||!Number.isInteger(fixup.branch))return null;
  const unconditional=fixup.branch===0xeb;
  if(!unconditional&&(fixup.branch<0x70||fixup.branch>0x7f))throw new Error('Invalid native branch metadata');
  const prefix=unconditional?1:2,start=fixup.offset-prefix,size=prefix+4;
  if(start<0||start+size>section.length||section.bytes[start]!== (unconditional?0xe9:0x0f)||!unconditional&&section.bytes[start+1]!==fixup.branch+0x10)throw new Error('Native branch metadata does not match instruction');
  return {fixup,start,size,newSize:size};
}
function remapper(edits) {
  const ends=edits.map(e=>e.start+e.size),prefix=[0];
  for(const edit of edits)prefix.push(prefix.at(-1)+edit.size-edit.newSize);
  return offset=>{
    let lo=0,hi=ends.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(ends[mid]<=offset)lo=mid+1;else hi=mid;}
    return offset-prefix[lo];
  };
}
/** Mutates section bytes and fixups before PE layout. Nonzero code addends are
 * rebased along with their target labels. Interior addresses inhibit resizing.
 */
export function optimizeNativeSections(sections,level=1) {
  level=nativeOptimizationLevel(level);
  const stats={level,passes:0,branchesShortened:0,fallthroughBranchesRemoved:0,bytesSaved:0};
  if(!level)return stats;
  for(const section of sections) {
    if(!(section.flags&0x20))continue;
    // Start from current coordinates on every pass. Length decreases monotonically.
    while(true) {
      const candidates=section.fixups.map(f=>branchPlan(section,f)).filter(Boolean).sort((a,b)=>a.start-b.start);
      if(!candidates.length)break;
      const labels=new Map(section.labels),protectedOffsets=new Set(labels.values()),references=[],candidateFixups=new Set(candidates.map(c=>c.fixup));
      let unsafe=false;
      for(const owner of sections)for(const fixup of owner.fixups)if(labels.has(fixup.label)) {
        const base=labels.get(fixup.label),target=base+fixup.addend;
        if(target<0||target>section.length){unsafe=true;break;}
        protectedOffsets.add(target);references.push({fixup,base,target});
      }
      if(unsafe)break;
      // Also protect every other relocation field from being removed or split.
      for(const f of section.fixups)if(!candidateFixups.has(f)) {
        protectedOffsets.add(f.offset);protectedOffsets.add(f.offset+(f.kind==='rel8'?1:4));
      }
      const boundaries=[...protectedOffsets].sort((a,b)=>a-b);
      const interior=(start,end)=>{
        let lo=0,hi=boundaries.length;while(lo<hi){const m=(lo+hi)>>>1;if(boundaries[m]<=start)lo=m+1;else hi=m;}
        return lo<boundaries.length&&boundaries[lo]<end;
      };
      const edits=[];
      for(const c of candidates) {
        const target=labels.get(c.fixup.label);
        if(target===undefined||c.fixup.addend!==0||interior(c.start,c.start+c.size))continue;
        if(level===2&&target===c.start+c.size)c.newSize=0;
        else {
          const afterSelf=target>=c.start+c.size?target-(c.size-2):target;
          const distance=afterSelf-c.start-2;
          if(distance>=-128&&distance<=127)c.newSize=2;
        }
        if(c.newSize<c.size)edits.push(c);
      }
      if(!edits.length)break;
      const map=remapper(edits),byFixup=new Map(edits.map(e=>[e.fixup,e])),bytes=[];
      let cursor=0;
      for(const e of edits){for(;cursor<e.start;cursor++)bytes.push(section.bytes[cursor]);if(e.newSize)bytes.push(e.fixup.branch,0);cursor=e.start+e.size;}
      for(;cursor<section.length;cursor++)bytes.push(section.bytes[cursor]);
      for(const r of references)r.fixup.addend=map(r.target)-map(r.base);
      const fixups=[];
      for(const f of section.fixups){
        const e=byFixup.get(f);
        if(e){if(e.newSize)fixups.push({...f,offset:map(e.start)+1,kind:'rel8',branch:undefined});}
        else fixups.push({...f,offset:map(f.offset)});
      }
      section.labels=new Map([...labels].map(([label,offset])=>[label,map(offset)]));
      if(section.codeUnits)section.codeUnits=section.codeUnits.map(u=>({...u,start:map(u.start),end:map(u.end)}));
      stats.bytesSaved+=section.length-bytes.length;stats.passes++;
      stats.branchesShortened+=edits.filter(e=>e.newSize===2).length;
      stats.fallthroughBranchesRemoved+=edits.filter(e=>e.newSize===0).length;
      section.bytes=bytes;section.fixups=fixups;
    }
  }
  return stats;
}
