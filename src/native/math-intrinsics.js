/** Native numeric intrinsics used by authored graphics and ordinary VB code.
 * Rnd/Randomize follow Microsoft's documented VB6-compatible 24-bit generator,
 * including distinct Single Timer and Double explicit-seed bit mixing:
 * https://github.com/dotnet/runtime/blob/main/src/libraries/Microsoft.VisualBasic.Core/src/Microsoft/VisualBasic/VBMath.vb
 * https://learn.microsoft.com/office/vba/language/reference/user-interface-help/rgb-function
 * Transcendentals use the installed Windows CRT's native Double implementation.
 * No live x87 value crosses a VB error boundary, and caller control state returns.
 */
import {nativeNumericMethods} from './numeric.js';
import {planNativeArguments} from './call-plan.js';
import {mem16,mem32} from './x86-operands.js';
const P='native:math:',key=v=>String(v).toLowerCase(),arg=argument=>({argument});
const at=(base,displacement=0)=>mem32({base,displacement}),slot=v=>at('ebp',v.offset),lit=value=>({kind:'literal',value});
const functions={sin:'sin',cos:'cos',tan:'tan',atn:'atan',exp:'exp',log:'log'};
function ownName(c,node){const callee=node.kind==='call'?node.callee:node;return callee.kind==='id'&&!c.variable(callee)&&!c.resolveProcedure(callee)?key(callee.name):null;}
export const nativeMathMethods={
  numericType(node){
    const name=ownName(this,node);
    if(Object.hasOwn(functions,name))return 'double';
    if(name==='rnd')return 'single';
    if(['rgb','qbcolor'].includes(name))return 'long';
    return nativeNumericMethods.numericType.call(this,node);
  },
  numericBuiltin(node,name){
    if(!name||ownName(this,node)!==name||!['rnd','randomize','rgb','qbcolor',...Object.keys(functions)].includes(name))
      return nativeNumericMethods.numericBuiltin.call(this,node,name);
    const x=this.x,params=name==='rgb'?['red','green','blue'].map(name=>({name})):[{name:name==='qbcolor'?'color':'number',optional:['rnd','randomize'].includes(name)}];
    const plan=planNativeArguments({name,params},node.args,message=>this.fail(message)),slots=[];
    (this.nativeMathKinds ||=new Set()).add(name);
    if(['rnd','randomize'].includes(name)&&!this.nativeRandomSeed)this.nativeRandomSeed=this.slot(P+'seed',0x50000);
    if(name==='randomize'){
      const entry=plan.slots[0];
      if(entry.omitted){const timer=this.floatWorkspace();this.rawStorageAddress(timer);x.push().call('native:date:timer');
        // Timer is a Single. It is already represented by an exact R8 snapshot.
        const bits=this.arrayWorkspace(4,'random-timer');x.emit(0xdd,0x00);this.rawStorageAddress(bits);x.emit(0xd9,0x18).mov('eax',at('eax'));
      }else{this.floatExpression(entry.node);x.mov('eax',at('eax',4));}
      x.mov('ecx','eax').shift('sar','ecx',16).and('eax',65535).xor('eax','ecx').shift('shl','eax',8)
        .mov('edx',mem32({label:this.nativeRandomSeed})).and('edx',0xff0000ff).or('eax','edx').store(this.nativeRandomSeed).value(0);return true;
    }
    for(const entry of plan.order){
      const expr=entry.omitted?lit(1):entry.node;
      if(['rgb','qbcolor'].includes(name)){
        this.boxVariant(expr);this.unboxVariant('long');
        x.test().branch('s','error:5');
        if(name==='rgb'){const fits=x.unique();x.compare(255).branch('le',fits).value(255).label(fits);}else x.compare(15).branch('g','error:5');
      }else{this.floatExpression(expr);if(name==='rnd')this.roundSingle();}
      const value=this.arrayWorkspace(4,'math-argument');x.mov(slot(value),'eax');slots[entry.index]=value;
    }
    if(name==='rgb'){
      x.mov('eax',slot(slots[2])).shift('shl','eax',16).mov('ecx',slot(slots[1])).shift('shl','ecx',8).or('eax','ecx').or('eax',slot(slots[0]));return true;
    }
    if(name==='qbcolor'){
      const table=P+'qb-palette';if(!this.ro.labels.has(table)){this.ro.align(4).label(table);for(const color of [0,0x800000,0x008000,0x808000,0x000080,0x800080,0x008080,0xc0c0c0,0x808080,0xff0000,0x00ff00,0xffff00,0x0000ff,0xff00ff,0x00ffff,0xffffff])this.ro.u32(color);}
      x.mov('eax',slot(slots[0])).mov('eax',mem32({label:table,index:'eax',scale:4}));return true;
    }
    const out=this.floatWorkspace();this.rawStorageAddress(out);x.push().push(arg(slots[0].offset)).call(P+name);return true;
  }
};
export function emitNativeMathHelpers(c){
  const x=c.x,kinds=c.nativeMathKinds||new Set();
  for(const [name,api]of Object.entries(functions))if(kinds.has(name)){
    x.label(P+name).enter(8).value(arg(8)).call('native:number:finite').mov('ebx','eax');
    if(name==='log'){
      x.mov('eax',at('ebx',4)).test().branch('s','error:5').or('eax',at('ebx')).test().branch('e','error:5');
    }
    // All exceptions masked, round-to-nearest, Double precision while in CRT.
    x.emit(0xd9,0x7d,0xfc,0x66,0xc7,0x45,0xf8,0x7f,0x02,0xd9,0x6d,0xf8)
      .pushOperand(at('ebx',4)).pushOperand(at('ebx')).invoke('ucrtbase.dll',api).add('esp',8)
      .value(arg(12)).emit(0xdd,0x18,0xdb,0xe2,0xd9,0x6d,0xfc).call('native:number:finite').leave(8);
  }
  if(kinds.has('rnd')){
    const ready=x.unique(),next=x.unique();
    x.label(P+'rnd').enter(4).value(arg(8)).emit(0xdd,0x00,0xd9,0x5d,0xfc).mov('eax',at('ebp',-4)).mov('ecx','eax').and('ecx',0x7fffffff).testOperand('ecx','ecx').branch('e',ready)
      .test().branch('ns',next).mov('ecx','eax').shift('shr','ecx',24).add('eax','ecx').and('eax',0xffffff).store(c.nativeRandomSeed);
    x.label(next).mov('eax',mem32({label:c.nativeRandomSeed})).imul('eax','eax',0x43fd43fd).add('eax',0xc39ec3).and('eax',0xffffff).store(c.nativeRandomSeed);
    x.label(ready).push(arg(12)).push({memory:c.nativeRandomSeed}).call('native:number:from-int')
      .push(arg(12)).push(c.floatLiteral(16777216)).push(arg(12)).call('native:number:divide')
      .push(arg(12)).push(arg(12)).call('native:number:single').leave(8);
  }
}
