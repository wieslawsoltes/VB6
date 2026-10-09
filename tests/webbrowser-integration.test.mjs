import test from 'node:test';
import assert from 'node:assert/strict';
import {WebBrowserHistory} from '../src/controls/webbrowser-history.js';
import {WebBrowserController} from '../src/controls/webbrowser.js';
import {WebBrowserDocument} from '../src/controls/webbrowser-document.js';
import {WebBrowserControl,registerWebBrowserControls} from '../src/controls/webbrowser-control.js';
import {ControlAdapterRegistry} from '../src/controls/adapters.js';
import {WEB_BROWSER_ALIASES,WEB_BROWSER_LIMITS as L} from '../src/controls/webbrowser-contract.js';
import {NOTHING,Cell} from '../src/runtime/values.js';
import {createControl,newProject,normalizeProject} from '../src/project/model.js';
import {parseFRM,serializeFRM,serializeVBP} from '../src/project/formats.js';
import {builtinType,ENUM_TYPES} from '../src/language/type-catalog.js';
import {defaultEventSignature} from '../src/editor/language-service.js';
import {prepareClassicDesigner} from '../src/exporter/classic-designer.js';
import {nativeControlStyle} from '../src/native/control-plan.js';
const entry=n=>({url:'https://example.test/'+n,html:null});
function fixture(handler=()=>{}){
  const events=[],frames=[],host={style:{},append(){},replaceChildren(){}};
  const control={model:{name:'Browser1'},props:{Enabled:-1,Visible:-1},design:true,node:{classList:{add(){}},ownerDocument:{baseURI:'https://app.test/',createElement:()=>host},append(){}},event:async(name,args,coalesce,current)=>{if(current()){events.push(name);await handler(name,args);}}};
  const browser=new WebBrowserController(control,{frameFactory:(_host,entry,receive)=>{const frame={entry,receive,node:{style:{}},closed:false,close(){this.closed=true;},stop(){this.close();},fragment:async()=>{}};frames.push(frame);return frame;}});
  control.webBrowser=browser;control.design=false;
  return {control,browser,events,frames};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('refresh preserves forward history and no-history refresh preserves previous real entry',()=>{
 const h=new WebBrowserHistory();for(let i=0;i<3;i++)h.commit(entry(i));h.commit(entry(1),{index:1});h.commit(entry('changed'),{replace:true});assert.equal(h.target(1).entry.url,entry(2).url);
 h.commit(entry('transient'),{noHistory:true});h.commit(entry('transient'),{replace:true});assert.equal(h.target(-1).entry.url,entry('changed').url);assert.equal(h.canForward,false);
 h.commit(entry('changed'),{index:1});assert.equal(h.canForward,true);
});
test('history is bounded, branches independently, and rejects unavailable travel',()=>{
 const h=new WebBrowserHistory(),other=new WebBrowserHistory();assert.throws(()=>h.target(-1));
 for(let i=0;i<L.history+20;i++)h.commit(entry(i));assert.equal(h.entries.length,L.history);assert.equal(h.index,L.history-1);assert.equal(other.entries.length,0);
 h.commit(entry(40),{index:3});h.commit(entry('branch'));assert.equal(h.entries.length,5);assert.equal(h.canForward,false);h.clear();assert.equal(h.canBack,false);
});
test('cancelled BeforeNavigate2 never replaces the document or commits history',async()=>{
 const f=fixture((name,args)=>{if(name==='BeforeNavigate2')args[6].ref.set(-1);});f.control.Navigate('https://example.test/');await f.browser.job;
 assert.equal(f.frames.length,0);assert.deepEqual(f.events,['BeforeNavigate2']);assert.equal(f.browser.history.entries.length,0);f.browser.dispose();
});
test('redirect from BeforeNavigate2 suppresses stale navigation',async()=>{
 const f=fixture((name,args)=>{if(name==='BeforeNavigate2'&&args[1].ref.get()==='https://example.test/old')f.control.Navigate('https://example.test/new');});
 f.control.Navigate('https://example.test/old');await flush();await f.browser.job;assert.equal(f.frames.length,1);assert.equal(f.browser.locationURL,'https://example.test/new');f.browser.dispose();
});
test('DocumentComplete occurs once and stale frames cannot publish state',async()=>{
 const f=fixture();f.control.NavigateToString('<p>one</p>');await f.browser.job;
 f.frames[0].receive({event:'document',document:{id:1}});f.frames[0].receive({event:'complete',opaque:false});f.frames[0].receive({event:'complete',opaque:false});await flush();
 assert.equal(f.events.filter(n=>n==='DocumentComplete').length,1);assert.equal(f.control.ReadyState,4);assert.equal(f.control.Busy,0);
 f.control.NavigateToString('<p>two</p>');await f.browser.job;assert.equal(f.frames[0].closed,true);f.frames[0].receive({event:'title',title:'stale'});assert.equal(f.control.LocationName,'');assert.equal(f.control.Document,NOTHING);f.browser.dispose();
});
test('same-document fragments retain document identity while refresh replaces it',async()=>{
 const f=fixture();f.control.NavigateToString('<p id="one">one</p>');await f.browser.job;const doc={id:1};f.frames[0].receive({event:'document',document:doc});f.frames[0].receive({event:'complete',opaque:false});
 f.control.Navigate('#one');await f.browser.job;assert.equal(f.control.Document,doc);assert.equal(f.frames.length,1);assert.equal(f.control.LocationURL,'about:blank#one');
 f.control.Refresh();await f.browser.job;assert.equal(f.frames.length,2);assert.equal(f.control.Document,NOTHING);f.browser.dispose();
});
test('NewWindow2 can supply another browser without opening host windows',async()=>{
 const target=fixture();const source=fixture((name,args)=>{if(name==='NewWindow2')args[0].ref.set(target.control);});source.control.Navigate('https://example.test/',1);await source.browser.job;await target.browser.job;
 assert.equal(source.frames.length,0);assert.equal(target.frames.length,1);source.browser.dispose();target.browser.dispose();
});
test('Stop cancels queued navigation and disposal prevents further calls',async()=>{
 const f=fixture();f.control.NavigateToString('one');f.control.Stop();await f.browser.job;assert.equal(f.frames.length,0);
 f.control.NavigateToString('two');await f.browser.job;f.control.Stop();assert.equal(f.frames[0].closed,true);assert.equal(f.control.Busy,0);assert.equal(f.control.NavigationStatus,'stopped');f.browser.dispose();assert.throws(()=>f.control.Navigate('about:blank'),e=>e.number===91);
});
test('native-only flags/chrome and inaccessible document automation fail explicitly',()=>{
 const f=fixture();for(const call of [()=>f.control.Navigate('https://example.test/',0,'', 'body'),()=>f.control.Navigate('https://example.test/',4),()=>f.control.ShowBrowserBar('x'),()=>f.control.Quit(),()=>f.control.Refresh2(3),()=>f.control.ExecWB(1),()=>{f.control.Offline=-1;}])assert.throws(call,e=>e.number===445);
 assert.throws(()=>f.control.ExecuteScript('1'),e=>e.number===70);assert.throws(()=>{f.control.ReadyState=4;},e=>e.number===383);assert.throws(()=>{f.control.Zoom=0;},e=>e.number===380);f.browser.dispose();
});
test('browser property bag and command output preserve VB values and ByRef',()=>{
 const f=fixture(),width=new Cell('Long',200),height=new Cell('Long',100),out=new Cell('Variant');
 f.control.ClientToWindow({ref:width},{ref:height});assert.equal(width.get(),200);assert.throws(()=>f.control.ClientToWindow(200,100),e=>e.number===13);
 f.control.ExecWB(63,0,125,{ref:out});assert.equal(out.get(),125);assert.equal(f.control.QueryStatusWB(63),3);assert.equal(f.control.QueryStatusWB(999),0);
 f.control.PutProperty('x',42);assert.equal(f.control.GetProperty('x'),42);f.browser.dispose();
});
test('document handles have stable identities and revoke together',()=>{
 const d=new WebBrowserDocument(async()=>({empty:true})),root=d.decode({handle:1,type:'document'});assert.equal(root,d.decode({handle:1,type:'document'}));assert.deepEqual(d.encode(root),{handle:1});
 assert.throws(()=>d.decode({handle:1,type:'window'}));for(let i=2;i<300;i++)d.decode({handle:i,type:'element'});assert.equal(d.sessions.length,3);d.close();assert.equal(d.sessions.length,0);assert.throws(()=>d.encode(root),e=>e.number===91);
});
test('document bridge never accepts unrelated host objects or forged capabilities',()=>{
 const d=new WebBrowserDocument(async()=>{}),other=new WebBrowserDocument(async()=>{});const foreign=other.decode({handle:1,type:'document'});
 for(const v of [foreign,{window:true},{handle:1},()=>{},Infinity,'x'.repeat(L.message+1)])assert.throws(()=>d.encode(v));
 for(const v of [{handle:0,type:'document'},{handle:1,type:'constructor'},{handle:1,type:'document',extra:1},{nothing:true,extra:1}])assert.throws(()=>d.decode(v));
 assert.equal(d.decode({nothing:true}),NOTHING);assert.equal(d.decode({empty:true}),undefined);d.close();other.close();
});
test('normal VM events retain pause, support array Index and discard stale generations',async()=>{
 const calls=[],proc={},vm={state:'paused',eventQueue:[],processEvents(){},callProcedure:async(...args)=>calls.push(args)};
 const c={vm,model:{id:'b',name:'Browser1'},props:{Index:7},instance:{module:{procedures:new Map([['browser1_documentcomplete',proc]])}}};let valid=true;
 const pending=WebBrowserControl.prototype.event.call(c,'DocumentComplete',[42],false,()=>valid);assert.equal(vm.eventQueue.length,1);assert.equal(vm.eventQueue[0].input,undefined);vm.state='idle';const event=vm.eventQueue.shift();await event.action();event.resolve();await pending;assert.deepEqual(calls[0][2],[7,42]);
 const stale=WebBrowserControl.prototype.event.call(c,'DocumentComplete',[99],false,()=>valid);valid=false;const next=vm.eventQueue.shift();await next.action();next.resolve();await stale;assert.equal(calls.length,1);
});
test('registration supports original aliases but exposes only one designer entry',()=>{
 const r=registerWebBrowserControls();for(const alias of WEB_BROWSER_ALIASES)assert.equal(r.has(alias),true);assert.equal(r.catalog().filter(e=>e.designer).length,1);assert.equal(r.describe('WebBrowser').defaultEvent,'DocumentComplete');assert.doesNotThrow(()=>r.validateProperties('WebBrowser',{Name:'Browser2'}));assert.throws(()=>r.validateProperties('WebBrowser',{ReadyState:4}));
 const custom=new ControlAdapterRegistry().register('WebBrowser',{runtime:()=>{}});registerWebBrowserControls(custom);assert.equal(custom.has('WebBrowser',true),false);
});
test('canonical browser projects are unchanged by normalization; imported aliases retain identity',()=>{
 const p=newProject();p.modules[0].form.controls.push(createControl('WebBrowser','Browser1'));const before=JSON.parse(JSON.stringify(p.modules));const normalized=normalizeProject(p);assert.deepEqual(normalized.modules,before);
 p.modules[0].form.controls[0].type='SHDocVwCtl.WebBrowser';const model=normalizeProject(p).modules[0].form.controls[0];assert.equal(model.type,'WebBrowser');assert.equal(model.originalType,'SHDocVwCtl.WebBrowser');
});
test('FRM browser identity and actual SHDocVw type-library header survive roundtrip',()=>{
 const source='VERSION 5.00\nObject = "{EAB22AC0-30C1-11CF-A7EB-0000C05BAE0B}#1.1#0"; "shdocvw.dll"\nBegin VB.Form Form1\n Begin SHDocVwCtl.WebBrowser Browser1\n  Left = 120\n  Width = 3000\n End\nEnd\nAttribute VB_Name = "Form1"\n';
 const {module}=parseFRM(source,'Form1.frm');assert.equal(module.form.controls[0].type,'WebBrowser');assert.equal(module.form.controls[0].originalType,'SHDocVwCtl.WebBrowser');const out=serializeFRM(module);assert.match(out,/Begin SHDocVwCtl.WebBrowser Browser1/);assert.match(out,/EAB22AC0/);assert.equal((out.match(/Object =/g)||[]).length,1);
});
test('source catalog has typed DOM properties, original aliases and cancellable events',()=>{
 for(const alias of WEB_BROWSER_ALIASES)assert.equal(builtinType(alias).name,'WebBrowser');
 const props=builtinType('WebBrowser').members;assert.equal(props.find(p=>p.name==='Document').kind,'property');assert.equal(props.find(p=>p.name==='Document').type,'HTMLDocument');
 assert.equal(builtinType('MSHTML.IHTMLDocument2').members.find(p=>p.name==='Body').kind,'property');assert.match(defaultEventSignature('WebBrowser','BeforeNavigate2'),/ByRef Cancel As Boolean/);assert.ok(ENUM_TYPES.get('shdocvw.browsernavconstants').members.some(m=>m.name==='navNoHistory'));
});
test('freestanding native control planner refuses unsupported modern browser hosting',()=>{
 assert.throws(()=>nativeControlStyle('WebBrowser',{}),/Unsupported native control: WebBrowser/);
});

test('unrelated browser-suffixed ProgIDs do not acquire the built-in control identity',()=>{
 const {module}=parseFRM('VERSION 5.00\nBegin VB.Form Form1\n Begin Vendor.WebBrowser Browser1\n End\nEnd\n');assert.equal(module.form.controls[0].type,'Vendor.WebBrowser');
});
test('native source export declares the original typelib and rejects browser-only designer values',()=>{
 const p=newProject();p.modules[0].form.controls.push(createControl('WebBrowser','Browser1'));
 assert.match(serializeVBP(p),/Object=\{EAB22AC0-30C1-11CF-A7EB-0000C05BAE0B\}#1.1#0; ieframe.dll/);
 const native=prepareClassicDesigner(structuredClone(p));assert.equal(native.modules[0].form.controls[0].properties.DocumentText,undefined);assert.match(serializeFRM(native.modules[0]),/Begin SHDocVwCtl.WebBrowser Browser1/);
 p.modules[0].form.controls[0].properties.DocumentText='<p>HTML5 extension</p>';assert.throws(()=>prepareClassicDesigner(p),/no persisted WebBrowser.DocumentText/);
});
