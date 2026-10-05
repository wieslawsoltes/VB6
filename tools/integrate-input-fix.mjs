import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const path='src/runtime/vm.js',hash=s=>createHash('sha256').update(s).digest('hex');
let s=readFileSync(path,'utf8');
const before='2c9e9cc2a38c1c1f589ff31fa66a5f7a3ca33c7cb55eeb2d90e6374d356991da',after='e8d514be9e17a214a09268d2d1a37290b612b96f89e4d6c11797b04be2192c74';
if(hash(s)!==after){if(hash(s)!==before)throw Error('Changed VM source');s=s.replace('    const existing=coalesce&&this.eventQueue.find(e=>e.input&&e.instance===instance&&e.key===key);',`    // Never move later pointer state ahead of a key/button/timer boundary.
    let existing;
    if(coalesce)for(let i=this.eventQueue.length-1;i>=0;i--){const pending=this.eventQueue[i];if(!pending.input||!pending.coalesce)break;if(pending.instance===instance&&pending.key===key){existing=pending;break;}}`).replace('const event={input:true,instance,key,action:guarded};','const event={input:true,coalesce,instance,key,action:guarded};');if(hash(s)!==after)throw Error('VM output mismatch');writeFileSync(path,s);}
