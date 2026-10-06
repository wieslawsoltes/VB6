import test from 'node:test';
import assert from 'node:assert/strict';
import {OcxAmbientProperties,OCX_AMBIENT_DISPIDS,ocxTransformCoords} from '../src/controls/ocx-ambient.js';
import {OcxControlSite,OcxPropertyBag,ocxControlSite} from '../src/controls/ocx-site.js';
import {OcxContainer,ocxContainerFor} from '../src/controls/ocx-container.js';
import {OcxEventHub,ocxInterfaceId} from '../src/controls/ocx-events.js';
import {OcxWindowlessSurface} from '../src/controls/ocx-windowless.js';
import {ControlAdapterRegistry} from '../src/controls/adapters.js';
import {OcxPropertyPageSession} from '../src/controls/ocx-pages.js';
import {tagScalar,scalarType,unbox} from '../src/runtime/values.js';

function node(){const listeners=new Map();return {listeners,focusCount:0,addEventListener(n,f){(listeners.get(n)||listeners.set(n,new Set()).get(n)).add(f);},removeEventListener(n,f){listeners.get(n)?.delete(f);},dispatch(n,event){for(const f of [...(listeners.get(n)||[])])f(event);},focus(){this.focusCount++;this.dispatch('focusin',{});}};}
let sequence=0;
function control({container=null,lifecycle={},properties={},design=false,ocxState,event=()=>{},options={}}={}){
  const model={id:'test-'+(++sequence),name:'Gauge'+sequence,type:'Test.Gauge',properties:{Left:0,Top:0,Width:1500,Height:750,Visible:-1,Enabled:-1,TabStop:-1,...properties},...(ocxState===undefined?{}:{ocxState})};
  const adapter={__control:true,model,props:model.properties,node:node(),event,ocxLifecycle:lifecycle,refresh(){site.sync();},dispose(){site.close();this.disposed=true;}};
  const site=new OcxControlSite(model,{container,design,...options});site.bind(adapter);return {model,adapter,site};
}
const IID1='aaaaaaaa-1234-1234-1234-123456789abc',IID2='bbbbbbbb-1234-1234-1234-123456789abc';
const interfaces=[{iid:IID1,isDefault:true,events:[{name:'Changing',params:[{name:'Value',type:'Byte',byRef:true},{name:'Cancel',type:'Boolean',byRef:true}]}]},{iid:IID2,events:[{name:'Changed',params:[{name:'Value',type:'Variant'}]}]}];
const hub=()=>new OcxEventHub(interfaces);

test('ambient DISPIDs, VB booleans, immutable font and detached snapshots',()=>{
  const ambient=new OcxAmbientProperties({UserMode:true,backcolor:0x8000000f,Font:{Name:'Arial',Size:12,Bold:true}});
  assert.equal(ambient.UserMode,-1);assert.equal(ambient.get(-701),0x8000000f);assert.equal(ambient.get('uSeRmOdE'),-1);assert.equal(OCX_AMBIENT_DISPIDS.DisplayAsDefault,-713);
  assert.equal(ambient.Font.Weight,700);assert.throws(()=>ambient.Font.Size=25,TypeError);assert.throws(()=>ambient.UserMode=0,TypeError);
  ambient.snapshot().Font.Name='Changed';assert.equal(ambient.Font.Name,'Arial');assert.throws(()=>ambient.get(-999),/Unknown/);
});
test('ambient validation is atomic, duplicate case names and invalid OLE colors are rejected',()=>{
  const ambient=new OcxAmbientProperties({BackColor:1});for(const changes of [{BackColor:2,LocaleID:-1},{BackColor:3,backColor:4},{UIDead:1},{Font:{Size:0}},{BackColor:2**32},{Font:{Unknown:1}},[]])assert.throws(()=>ambient.update(changes));
  assert.equal(ambient.BackColor,1);assert.equal(ambient.LocaleID,1033);assert.equal(ambient.UIDead,0);
});
test('ambient updates notify only actual changes and deliver every notification after observer failure',()=>{
  const calls=[],ambient=new OcxAmbientProperties({},(n,id)=>{calls.push([n,id]);throw Error(n);});assert.throws(()=>ambient.update({BackColor:5,ForeColor:6}),AggregateError);
  assert.deepEqual(calls,[['BackColor',-701],['ForeColor',-704]]);assert.equal(ambient.BackColor,5);assert.deepEqual(ambient.update({BackColor:5}),[]);
});
test('coordinate transforms support asymmetric DPI, negatives and lossless reverse units',()=>{
  assert.deepEqual(ocxTransformCoords({x:2540,y:-2540},{dpiX:144,dpiY:192}),{x:144,y:-192});
  assert.deepEqual(ocxTransformCoords({x:96,y:192},{from:'pixels',to:'twips'}),{x:1440,y:2880});
  assert.deepEqual(ocxTransformCoords({x:72,y:144},{from:'points',to:'himetric'}),{x:2540,y:5080});
  for(const options of [{dpiX:0},{dpiY:NaN},{from:'__proto__'},{to:'bad'}])assert.throws(()=>ocxTransformCoords({x:1,y:2},options));
});
test('site lifecycle ordering distinguishes first initialization from persisted load',()=>{
  const log=[],lifecycle={initialize(){log.push('initialize');},initProperties(){log.push('init');},readProperties(b){log.push('read:'+b.ReadProperty('Value'));},resize(w,h){log.push(`resize:${w}:${h}`);},show(){log.push('show');},hide(){log.push('hide');},terminate(){log.push('terminate');}};
  const a=control({lifecycle});a.adapter.props.Height=1000;a.adapter.refresh();a.adapter.props.Visible=0;a.adapter.refresh();a.adapter.refresh();a.adapter.dispose();a.adapter.dispose();
  assert.deepEqual(log,['initialize','init','resize:1500:750','show','resize:1500:1000','hide','terminate']);
  log.length=0;const bag=new OcxPropertyBag();bag.WriteProperty('Value',42);control({lifecycle,ocxState:bag.Contents}).adapter.dispose();assert.deepEqual(log,['initialize','read:42','resize:1500:750','show','terminate']);
});
test('synchronous lifecycle rejects async hooks and registry cleans up failed creation',()=>{
  const log=[],registry=new ControlAdapterRegistry().register('Test.Async',{lifecycle:true,runtime:model=>({__control:true,model,node:{},refresh(){},dispose(){log.push('dispose');},ocxLifecycle:{initialize:async()=>{},terminate(){log.push('terminate');}}})});
  assert.throws(()=>registry.create({id:'x',type:'Test.Async',name:'X',properties:{}}),/synchronous/);assert.deepEqual(log,['terminate','dispose']);
});
test('activation, focus, lock and design-mode transitions respect container contracts',()=>{
  const log=[],{site}=control({lifecycle:{activate:ui=>log.push(['active',ui]),deactivate:()=>log.push(['inactive']),focus:v=>log.push(['focus',v]),ambientChanged:(n,id)=>log.push([n,id])}});
  assert.equal(site.State,'loaded');assert.equal(site.setFocus(true),true);assert.equal(site.State,'ui-active');site.LockInPlaceActive(true);assert.throws(()=>site.deactivate(),/locked/);assert.throws(()=>site.setDesignMode(true),/locked/);assert.equal(site.design,false);
  site.LockInPlaceActive(false);site.setDesignMode(true);assert.equal(site.Ambient.UserMode,0);assert.equal(site.State,'loaded');assert.equal(site.Focused,false);assert.equal(site.activate(),false);assert.throws(()=>site.setAmbient({UserMode:-1}),/setDesignMode/);
  assert.deepEqual(log,[['active',true],['focus',true],['inactive'],['focus',false],['UserMode',-709]]);assert.throws(()=>site.LockInPlaceActive(false),/Unbalanced/);
});
test('event freezing nests and design and UIDead suppress user events',async()=>{
  const events=[],{site}=control({event:(name,args)=>events.push([name,args])});site.FreezeEvents(true);site.FreezeEvents(true);await site.RaiseEvent('Changed',[1]);site.FreezeEvents(false);await site.RaiseEvent('Changed',[2]);site.FreezeEvents(false);await site.RaiseEvent('Changed',[3]);
  site.setDesignMode(true);await site.RaiseEvent('Changed',[4]);site.setDesignMode(false);site.setAmbient({UIDead:-1});await site.RaiseEvent('Changed',[5]);site.setAmbient({UIDead:0});await site.RaiseEvent('Changed',[6]);assert.deepEqual(events,[['Changed',[3]],['Changed',[6]]]);assert.throws(()=>site.FreezeEvents(false),/Unbalanced/);await assert.rejects(site.RaiseEvent('__proto__',[]),/Invalid/);
});
test('request-edit veto precedes notification and observer removal during delivery is respected',()=>{
  const log=[],{site}=control();let disconnect;site.observeProperties({requestEdit(){log.push('first');disconnect();return true;},changed(){log.push('changed');}});disconnect=site.observeProperties({requestEdit(){throw Error('retired');}});
  const veto=site.observeProperties({requestEdit(){return false;}});assert.equal(site.RequestEdit('Value'),false);assert.equal(site.Dirty,false);veto();assert.equal(site.RequestEdit('Value'),true);site.PropertyChanged('Value');assert.equal(site.Dirty,true);assert.equal(site.Revision,1);assert.deepEqual(log,['first','first','changed']);
});
test('property notification failures do not prevent other observers or dirty tracking',()=>{
  const log=[],{site}=control({options:{onPropertyChanged(){throw Error('owner');}}});site.observeProperties({changed(){throw Error('a');}});site.observeProperties({changed(){log.push('b');}});assert.throws(()=>site.PropertyChanged('Value'),AggregateError);assert.equal(site.Dirty,true);assert.deepEqual(log,['b']);
});
test('persistence does not commit failed writes and preserves dirty changes raised inside save',()=>{
  let mode='normal',value=1;const {site}=control({lifecycle:{writeProperties(b,s){b.WriteProperty('Value',value);if(mode==='fail')throw Error('save');if(mode==='dirty')s.PropertyChanged('Value');if(mode==='recursive')s.save();}}});
  site.PropertyChanged('Value');site.save({clearDirty:false});assert.equal(site.Dirty,true);site.save();assert.equal(site.Dirty,false);mode='fail';value=2;assert.throws(()=>site.save(),/save/);assert.equal(new OcxPropertyBag(site.save({onlyIfDirty:true})).ReadProperty('Value'),1);
  mode='dirty';site.save();assert.equal(site.Dirty,true);mode='recursive';assert.throws(()=>site.save(),/Recursive/);mode='normal';site.save();assert.equal(site.Dirty,false);
});
test('close is idempotent, invalidates identity and runs every cleanup despite failures',()=>{
  const log=[],{site,adapter}=control({lifecycle:{terminate(){log.push('term');throw Error('term');}}});site.onDispose(()=>{log.push('first');throw Error('first');});site.onDispose(()=>log.push('last'));assert.throws(()=>site.close(),AggregateError);site.close();assert.deepEqual(log,['last','first','term']);assert.equal(ocxControlSite(adapter),null);assert.equal(site.State,'closed');assert.throws(()=>site.Extender,/not active/);
});
test('registry shares one form container and refresh automatically notifies resize',()=>{
  const form={node:node(),controls:[]},log=[],registry=new ControlAdapterRegistry().register('Test.Gauge',{lifecycle:true,runtime:model=>({__control:true,model,props:model.properties,node:node(),refresh(){},dispose(){},ocxLifecycle:{resize(w){log.push(w);}}})});
  const model=i=>({id:''+i,name:'G'+i,type:'Test.Gauge',properties:{Width:100,Height:100}}),a=registry.create(model(1),{form}),b=registry.create(model(2),{form});const container=ocxContainerFor(form);
  assert.equal(container.Count,2);assert.equal(ocxControlSite(a).Container,ocxControlSite(b).Container);a.props.Width=200;a.refresh();assert.deepEqual(log,[100,100,200]);container.close();assert.equal(container.Count,0);assert.equal(ocxControlSite(a),null);assert.notEqual(ocxContainerFor(form),container);
});
test('container tabs stably, skips hidden/disabled controls and reverses without a current focus',()=>{
  const container=new OcxContainer(),a=control({container,properties:{TabIndex:2}}),b=control({container,properties:{TabIndex:1}}),c=control({container,properties:{TabIndex:1}});control({container,properties:{TabIndex:0,Enabled:0}});control({container,properties:{TabIndex:0,Visible:0}});
  assert.equal(container.focusNext(true),true);assert.equal(container.ActiveControl,a.adapter);container.focusNext();assert.equal(container.ActiveControl,b.adapter);container.focusNext();assert.equal(container.ActiveControl,c.adapter);container.focusNext(true);assert.equal(container.ActiveControl,b.adapter);assert.equal(b.adapter.node.focusCount,2);
});
test('container activation rollback preserves prior focus and locked source',()=>{
  const container=new OcxContainer(),a=control({container}),b=control({container,lifecycle:{activate(){throw Error('activation rejected');}}});container.activate(a.site);assert.throws(()=>container.activate(b.site),/rejected/);assert.equal(container.ActiveControl,a.adapter);assert.equal(a.site.Focused,true);a.site.LockInPlaceActive(true);assert.throws(()=>a.site.deactivate(),/locked/);assert.throws(()=>container.activate(b.site),/rejected/);assert.equal(container.ActiveControl,a.adapter);
});
test('active accelerators precede tab/default processing and mnemonics honor ambient support',async()=>{
  const container=new OcxContainer(),log=[],a=control({container,lifecycle:{translateAccelerator:e=>e.key==='Enter',mnemonic:e=>e.key==='a'}});control({container,properties:{Default:-1},event:()=>log.push('click')});container.activate(a.site);
  assert.equal(container.translateAccelerator({key:'Enter'}),true);assert.deepEqual(log,[]);assert.equal(container.translateAccelerator({key:'a',altKey:true}),true);a.site.setAmbient({SupportsMnemonics:0});assert.equal(container.translateAccelerator({key:'a',altKey:true}),false);assert.equal(container.translateAccelerator({key:'Tab',isComposing:true}),false);
  container.setDesignMode(true);assert.equal(a.site.Ambient.UserMode,0);assert.equal(container.translateAccelerator({key:'Enter'}),false);
});
test('container default/cancel event errors are reported and all DOM listeners are retired',async()=>{
  const host=node(),errors=[],container=new OcxContainer({node:host,onError:e=>errors.push(e.message)});const {adapter}=control({container,properties:{Cancel:-1},event:()=>{throw Error('cancel-handler');}});
  assert.equal(container.translateAccelerator({key:'Escape'}),true);await new Promise(r=>setImmediate(r));assert.deepEqual(errors,['cancel-handler']);assert.equal(host.listeners.get('keydown').size,1);container.close();assert.equal(host.listeners.get('keydown').size,0);assert.equal(adapter.node.listeners.get('focusin').size,0);assert.throws(()=>container.focusNext(),/closed/);
});
test('container hit-testing follows z-order and refresh invalidates old and new footprints',()=>{
  const container=new OcxContainer(),a=control({container}),b=control({container,properties:{Left:300}}),invalid=[];container.onInvalidate(r=>invalid.push(r));assert.equal(container.hitTest(400,20),b.site);assert.equal(container.hitTest(1500,20),b.site);assert.equal(container.hitTest(1800,20),null);
  b.adapter.props.Left=2000;b.adapter.refresh();assert.equal(container.hitTest(400,20),a.site);assert.equal(invalid[0].left,300);assert.equal(invalid[1].left,2000);
});
test('outgoing IIDs canonicalize safely and invalid or duplicate schema is rejected',()=>{
  assert.equal(ocxInterfaceId('{'+IID1.toUpperCase()+'}'),IID1);for(const id of ['bad','{'+IID1,IID1+'}',null])assert.throws(()=>ocxInterfaceId(id));assert.throws(()=>new OcxEventHub([interfaces[0],interfaces[0]]));assert.throws(()=>new OcxEventHub([{iid:IID1,events:[{name:'E',params:[{name:'x',type:'Pointer'}]}]}]));
});
test('IID-scoped event subscriptions share typed ByRef cells without cross-interface delivery',async()=>{
  const h=hub(),seen=[];h.advise(IID1,async(name,args)=>{seen.push(name);assert.equal(scalarType(args[0].ref.getScalar()),'byte');args[0].ref.set(9);args[1].ref.set(-1);});h.advise(IID1,(name,args)=>{seen.push(args[0].ref.get());assert.equal(args[1].ref.get(),-1);});h.advise(IID2,()=>{throw Error('wrong IID');});
  const result=await h.dispatch('{'+IID1+'}','changing',[tagScalar(4,'byte'),tagScalar(0,'boolean')]);assert.deepEqual(seen,['Changing',9]);assert.equal(scalarType(result.args[0]),'byte');assert.equal(scalarType(result.args[1]),'boolean');assert.equal(unbox(result.args[1]),-1);
});
test('event delivery validates before handlers, propagates overflow and preserves ByVal payloads',async()=>{
  const h=hub();let count=0;h.advise(IID1,()=>count++);await assert.rejects(h.dispatch(IID1,'Changing',[256,0]),/Overflow/);assert.equal(count,0);h.advise(IID1,(n,args)=>args[0].ref.set(300));await assert.rejects(h.dispatch(IID1,'Changing',[1,0]),/Overflow/);
  const value=tagScalar(5,'single');h.advise(IID2,(n,args)=>{assert.equal(scalarType(args[0]),'single');args[0]=123;});assert.equal((await h.dispatch(IID2,'Changed',[value])).args[0],value);
});
test('event unsubscribe during await prevents retired delivery and newly advised sinks wait for next event',async()=>{
  const h=hub(),seen=[];let release,entered;const begun=new Promise(r=>entered=r),pending=new Promise(r=>release=r);h.advise(IID2,async()=>{seen.push('first');entered();await pending;});const retired=h.advise(IID2,()=>seen.push('retired'));
  const event=h.dispatch(IID2,'Changed',[1]);await begun;h.unadvise(retired);h.advise(IID2,()=>seen.push('new'));release();await event;assert.deepEqual(seen,['first']);await h.dispatch(IID2,'Changed',[1]);assert.deepEqual(seen,['first','first','new']);
});
test('event freeze nests, recursion is bounded and close during delivery rejects',async()=>{
  const h=hub();let n=0;h.advise(IID2,()=>n++);h.freeze(true);h.freeze(true);await h.dispatch(IID2,'Changed',[1]);h.freeze(false);await h.dispatch(IID2,'Changed',[1]);h.freeze(false);await h.dispatch(IID2,'Changed',[1]);assert.equal(n,1);assert.throws(()=>h.freeze(false),/Unbalanced/);
  const recursive=hub();recursive.advise(IID2,()=>recursive.dispatch(IID2,'Changed',[1]));await assert.rejects(recursive.dispatch(IID2,'Changed',[1]),/recursion/);
  const closing=hub();closing.advise(IID2,()=>closing.close());await assert.rejects(closing.dispatch(IID2,'Changed',[1]),/closed/);
});
function pages(){const registry=new ControlAdapterRegistry().register('Test.Gauge',{runtime:()=>{},metadata:{properties:[{name:'Value',default:0},{name:'Mode',default:0,choices:[{value:0,label:'Auto'},{value:1,label:'Manual'}]},{name:'Serial',default:'A',readOnly:true}]}});const models=[1,2].map(i=>({id:''+i,name:'G'+i,type:'Test.Gauge',properties:{Value:i,Mode:0,Serial:'A'}}));return {registry,models};}
test('property pages edit multi-selection atomically and commit one detached transaction',()=>{
  const {registry,models}=pages(),calls=[],page=registry.createPropertyPageSession(models,{onApply:e=>calls.push(e)});page.edit({value:9,Mode:1});assert.equal(page.IsPageDirty,true);assert.equal(models[0].properties.Value,1);page.Objects[0].properties.Value=100;
  assert.equal(page.Apply(),true);assert.deepEqual(models.map(m=>m.properties.Value),[9,9]);assert.equal(calls.length,1);assert.equal(calls[0].length,2);assert.equal(calls[0][0].previous.Value,1);assert.equal(page.IsPageDirty,false);assert.equal(page.Apply(),false);
});
test('property-page validation failures do not add partial edits or overwrite pending values',()=>{
  const {registry,models}=pages(),page=new OcxPropertyPageSession(registry,models);page.edit({Value:7},0);for(const change of [{Value:9,Serial:'bad'},{Mode:2},{Value:2,value:3}])assert.throws(()=>page.edit(change));page.Apply();assert.deepEqual(models.map(m=>m.properties.Value),[7,2]);assert.equal(models[0].properties.Mode,0);
});
test('property-page stale selections reject apply, cancelled pages cannot mutate and snapshots are detached',()=>{
  const {registry,models}=pages(),page=new OcxPropertyPageSession(registry,models);page.edit({Value:8});models[1].name='NewName';assert.throws(()=>page.Apply(),/changed/);assert.equal(models[0].properties.Value,1);page.Cancel();assert.equal(page.IsPageDirty,false);assert.throws(()=>page.edit({Value:1}),/closed/);
});
test('property-page commit failure restores references, rejects asynchronous commits and recursive apply',()=>{
  const {registry,models}=pages(),before=models.map(m=>m.properties);let page=new OcxPropertyPageSession(registry,models,{onApply(){throw Error('undo failed');}});page.edit({Value:5});assert.throws(()=>page.Apply(),/undo failed/);models.forEach((m,i)=>assert.equal(m.properties,before[i]));assert.equal(page.IsPageDirty,true);
  page=new OcxPropertyPageSession(registry,models,{onApply:async()=>{}});page.edit({Value:5});assert.throws(()=>page.Apply(),/synchronous/);assert.equal(models[0].properties.Value,1);
  page=new OcxPropertyPageSession(registry,models,{onApply:()=>page.Apply()});page.edit({Value:5});assert.throws(()=>page.Apply(),/applying/);assert.equal(models[0].properties.Value,1);
});
function canvas(){const c=node(),calls=[],context={};for(const name of ['save','restore','setTransform','beginPath','rect','clip','clearRect','translate'])context[name]=(...a)=>calls.push([name,...a]);Object.assign(c,{calls,style:{},getContext:()=>context,getBoundingClientRect:()=>({left:10,top:20,width:100,height:50}),setPointerCapture:id=>calls.push(['capture',id]),releasePointerCapture:id=>calls.push(['release',id])});return c;}
function surface(container,options={}){const c=canvas(),queue=new Map();let id=0;const errors=[],s=new OcxWindowlessSurface(container,c,{schedule:f=>(queue.set(++id,f),id),cancel:id=>queue.delete(id),onError:e=>errors.push(e),...options});return {s,c,queue,errors,tick(){for(const [id,fn] of [...queue]){queue.delete(id);fn();}}};}
test('windowless host coalesces invalidation, clips paints, applies pixel ratio and restores after errors',()=>{
  const container=new OcxContainer(),painted=[];control({container,lifecycle:{paint(ctx,clip){painted.push(clip);throw Error('paint-one');}}});control({container,properties:{Left:300},lifecycle:{paint(){painted.push('two');}}});const {s,c,queue,errors,tick}=surface(container);s.resize(100,50,2);s.invalidate({left:5,top:5,width:10,height:10});assert.equal(queue.size,1);tick();assert.equal(painted.length,2);assert.equal(errors.length,1);assert.equal(c.width,200);assert.equal(c.height,100);assert.deepEqual(c.calls.find(x=>x[0]==='setTransform'),['setTransform',2,0,0,2,0,0]);assert.equal(c.calls.filter(x=>x[0]==='save').length,c.calls.filter(x=>x[0]==='restore').length);s.close();
});
test('windowless pointer capture maintains target across bounds and preserves VB twips/buttons/shift',async()=>{
  const container=new OcxContainer(),events=[],a=control({container,event:(n,args)=>events.push([n,args])}),{s,c}=surface(container);s.resize(100,50);const event=(x,y,extras={})=>({isPrimary:true,pointerId:7,clientX:x+10,clientY:y+20,button:0,buttons:1,preventDefault(){},...extras});
  c.dispatch('pointerdown',event(5,6,{ctrlKey:true}));c.dispatch('pointermove',event(150,60,{altKey:true}));c.dispatch('pointerup',event(150,60));await new Promise(r=>setImmediate(r));assert.deepEqual(events,[['MouseDown',[1,2,75,90]],['MouseMove',[1,4,2250,900]],['MouseUp',[1,0,2250,900]]]);assert.deepEqual(c.calls.filter(x=>['capture','release'].includes(x[0])),[['capture',7],['release',7]]);assert.equal(container.ActiveControl,a.adapter);
});
test('windowless host releases capture immediately on control disposal and ignores another pointer cancellation',()=>{
  const container=new OcxContainer(),a=control({container}),{s,c}=surface(container);s.resize(100,50);s.setCapture(a.site,4);c.dispatch('pointercancel',{pointerId:9});assert.equal(c.calls.filter(x=>x[0]==='release').length,0);a.adapter.dispose();assert.deepEqual(c.calls.filter(x=>x[0]==='release'),[['release',4]]);s.close();assert.equal(c.listeners.get('pointerdown').size,0);
});
test('windowless sizes, stale hosts and invalid rectangles fail before allocation or painting',()=>{
  const {s,c,queue}=surface(new OcxContainer());for(const args of [[0,10],[100,100,0],[16385,10],[9000,9000],[10,10,9]])assert.throws(()=>s.resize(...args),/limits/);assert.equal(c.width,undefined);assert.throws(()=>s.invalidate({left:0,top:0,width:NaN,height:1}));s.resize(10,10);assert.equal(queue.size,1);s.close();assert.equal(queue.size,0);assert.throws(()=>s.resize(10,10),/closed/);
});


test('in-place locks preserve lifetime without blocking UI focus changes',()=>{
 const container=new OcxContainer(),log=[],a=control({container,lifecycle:{uiDeactivate(){log.push('ui');},deactivate(){log.push('full');}}}),b=control({container});
 container.activate(a.site);a.site.LockInPlaceActive(true);assert.equal(container.activate(b.site),true);assert.equal(a.site.State,'in-place-active');assert.equal(a.site.Focused,false);assert.equal(container.ActiveControl,b.adapter);assert.deepEqual(log,['ui']);assert.throws(()=>a.site.deactivate(),/locked/);a.site.LockInPlaceActive(false);a.site.deactivate();assert.deepEqual(log,['ui','full']);
});
test('hidden, disabled and UIDead sites relinquish UI focus and can be reactivated later',()=>{
 for(const mode of ['hidden','disabled','dead']){const container=new OcxContainer(),{site,adapter}=control({container});container.activate(site);site.LockInPlaceActive(true);
  if(mode==='dead')site.setAmbient({UIDead:-1});else{adapter.props[mode==='hidden'?'Visible':'Enabled']=0;adapter.refresh();}
  assert.equal(site.Focused,false);assert.equal(site.State,'in-place-active');assert.equal(container.ActiveControl,null);assert.equal(container.activate(site),false);
  if(mode==='dead')site.setAmbient({UIDead:0});else{adapter.props[mode==='hidden'?'Visible':'Enabled']=-1;adapter.refresh();}
  assert.equal(container.activate(site),true);assert.equal(container.ActiveControl,adapter);site.LockInPlaceActive(false);container.close();
 }
});
test('activation focus-hook failure does not leave two UI-active controls',()=>{
 const container=new OcxContainer(),a=control({container}),b=control({container,lifecycle:{focus(value){if(value)throw Error('focus-rejected');}}});container.activate(a.site);assert.throws(()=>container.activate(b.site),/focus-rejected/);assert.equal(container.ActiveControl,a.adapter);assert.equal(a.site.State,'ui-active');assert.equal(b.site.State,'in-place-active');assert.equal(b.site.Focused,false);
});


test('classic same-type multi-selection pages receive detached objects and canonical validated changes',async()=>{
 let selected;const registry=new ControlAdapterRegistry().register('Lab.Multi',{runtime(){},propertyPages:(model,{objects})=>{selected=objects;objects[0].properties.Value=999;return {value:42};},metadata:{properties:[{name:'Value',default:1}]}});
 const models=[1,2].map(i=>({id:''+i,name:'C'+i,type:'Lab.Multi',properties:{Value:i}}));assert.equal(registry.canEditSelection(models),true);const result=await registry.editSelection(models);assert.deepEqual(result,{Value:42});assert.equal(selected.length,2);assert.deepEqual(models.map(m=>m.properties.Value),[1,2]);assert.equal(registry.canEditSelection([models[0],models[0]]),false);assert.equal(registry.canEditSelection([...models,{type:'Unknown'}]),false);
});
test('classic asynchronous multi-selection pages reject stale state, duplicate keys and cancellation',async()=>{
 let resolve;const registry=new ControlAdapterRegistry().register('Lab.Multi',{runtime(){},propertyPages:()=>new Promise(r=>resolve=r),metadata:{properties:[{name:'Value',default:1}]}}),models=[{id:'a',name:'A',type:'Lab.Multi',properties:{Value:1}},{id:'b',name:'B',type:'Lab.Multi',properties:{Value:2}}];
 const pending=registry.editSelection(models);models[1].properties.Value=4;resolve({Value:3});await assert.rejects(pending,/changed/);assert.equal(models[0].properties.Value,1);
 const duplicate=registry.editSelection(models);resolve({Value:1,value:2});await assert.rejects(duplicate,/Duplicate/);const cancelled=registry.editSelection(models);resolve(null);assert.equal(await cancelled,null);
});
