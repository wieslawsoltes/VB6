import {VBError} from '../language/lexer.js';
export const instructionKey=ins=>{const {line,column,endColumn,source,procedure,sequencePoint,...rest}=ins;return JSON.stringify(rest);};
const key=instructionKey;
export const linearInstruction=ins=>['assign','expr','print','assert','graphics','filePrint','fileInput','fileRecord','fileSeek','fileCopy','fileRename','fileClose','fileOpen','stringMid','stringAlign','return','dim'].includes(ins.op);
/** Deterministic bounded edit alignment. Large edited gaps are rejected rather
 * than guessing where a suspended instruction should execute. */
export function instructionMap(oldCode,newCode,shape){
 const a=oldCode.map(key),b=newCode.map(key),map=new Map();let first=0,oldLast=a.length,newLast=b.length;
 while(first<oldLast&&first<newLast&&a[first]===b[first]){map.set(first,first);first++;}
 while(oldLast>first&&newLast>first&&a[oldLast-1]===b[newLast-1]){map.set(--oldLast,--newLast);}
 const n=oldLast-first,m=newLast-first;
 if(n*m>250000)throw new VBError('Restart required: edited active region is too large to relocate safely',5);
 const rows=Array.from({length:n+1},()=>new Uint32Array(m+1));
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)rows[i][j]=a[first+i]===b[first+j]?1+rows[i+1][j+1]:Math.max(rows[i+1][j],rows[i][j+1]);
 let i=0,j=0;while(i<n&&j<m){if(a[first+i]===b[first+j]){map.set(first+i,first+j);i++;j++;}else if(rows[i+1][j]>rows[i][j+1])i++;else j++;}
 map.set(a.length,b.length);
 const anchors=[[-1,-1],...[...map].sort((a,b)=>a[0]-b[0])];
 for(let k=0;k<anchors.length-1;k++){const [x,y]=anchors[k],[nextX,nextY]=anchors[k+1],length=nextX-x-1;if(length!==nextY-y-1)continue;for(let q=1;q<=length;q++)if(shape(oldCode[x+q])===shape(newCode[y+q]))map.set(x+q,y+q);}
 return map;
}

/** Index each new instruction once. Ambiguous duplicates deliberately remain
 * unmapped; a large inactive/retained procedure must not require an O(n*m) scan.
 */
export function uniqueInstructionLines(oldCode,newCode){
  const unique=new Map(),lines=new Map();
  for(const instruction of newCode){const key=instructionKey(instruction);unique.set(key,unique.has(key)?null:instruction);}
  for(const instruction of oldCode){if(instruction.implicit)continue;const match=unique.get(instructionKey(instruction));if(match)lines.set(instruction.line,match.line);}
  return lines;
}
