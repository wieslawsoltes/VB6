import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeWindowTransport} from '../desktop/window-transport.mjs';
function setup(blocked=false){const commands=[],opens=[];let listener,unsubscribed=false;
 const bridge={prepareWindow:o=>{opens.push(o);return 'reserved';},windowCommand:async(...a)=>commands.push(a),onWindowEvent:f=>{listener=f;return()=>{unsubscribed=true;}}};
 const owner={open:(...args)=>{assert.deepEqual(args,['about:blank','reserved','popup']);return blocked?null:{document:{}};}};
 return{transport:createNativeWindowTransport(owner,bridge),commands,opens,emit:event=>listener(event),unsubscribed:()=>unsubscribed};}
test('desktop IDE reserves only tool windows and routes close to the existing pane lifecycle',async()=>{
 const s=setup(),r=s.transport.open({left:1,top:2,width:300,height:400},'Properties');assert.equal(r.native,true);assert.equal(s.opens[0].kind,'tool');let returned=0;r.onClose=()=>returned++;
 s.emit({id:'another',type:'close-request'});assert.equal(returned,0);s.emit({id:r.id,type:'close-request'});assert.equal(returned,1);
 await r.show();await r.title('Renamed');await r.close();s.emit({id:r.id,type:'closed'});assert.equal(returned,1);
 assert.deepEqual(s.commands.map(c=>c[1]),['show','title','destroy']);s.transport.dispose();assert.equal(s.unsubscribed(),true);
});
test('blocked native IDE window releases its reservation',async()=>{const s=setup(true);assert.throws(()=>s.transport.open({},'Tool'),/denied/);await Promise.resolve();assert.deepEqual(s.commands,[['reserved','cancel-reservation',undefined]]);s.transport.dispose();});
