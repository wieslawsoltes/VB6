import test from 'node:test';
import assert from 'node:assert/strict';
import {RuntimeAgentControl} from '../src/runtime/agent-control.js';

function fixture() {
 const field={value:'old'},buttons=[{disabled:false,click(){this.clicked=true;}},{disabled:true,click(){throw new Error('must not click');}}];
 const dialog={isConnected:true,querySelector(s){return s==='input'?field:s==='[role=dialog]'?{getAttribute:()=> 'Input'}:s==='.vb-dialog-message'?{textContent:'Message'}:null;},querySelectorAll:()=>buttons};
 const c={model:{name:'Button1'},props:{Enabled:-1,Visible:-1},type:'CommandButton',disposed:false,node:{isConnected:true,hidden:false,closest:()=>null,click(){this.clicked=true;},querySelector:()=>null,focus(){this.focused=true;}},get(k){return this.props[k]??'';},set(k,v){this.props[k]=v;},event(){return Promise.resolve();},TextMatrix(){return 'cell';},setIndexed(k,a,v){this.cell={k,a,v};},AddItem(v){this.item=v;}};
 const form={...c,model:{name:'Form1',menus:[]},type:'Form',controls:[c],instance:{},node:{...c.node},props:{Enabled:-1,Visible:-1}};
 const sent=[],host={forms:[form],dialogs:[],vm:{state:'running',debugPauseId:0,dispatch:()=>Promise.resolve()},send:(type,data)=>sent.push({type,...data})};
 return {agent:new RuntimeAgentControl(host),host,c,form,dialog,field,buttons,sent};
}
test('runtime agent: paginated objects, no owner DOM, and run-unique opaque identities',()=>{
 const f=fixture(),all=f.agent.inspect();assert.equal(all.items.length,2);assert.equal(f.agent.inspect({offset:1,limit:1}).items[0].name,'Button1');assert.equal(all.hasMore,false);
 assert.notEqual(new RuntimeAgentControl(f.host).inspect().items[0].id,all.items[0].id);assert.ok(!JSON.stringify(all).includes('instance'));
});
test('runtime agent: only returned controls can receive bounded input',()=>{
 const f=fixture(),id=f.agent.inspect().items[1].id;f.agent.interact({target:id,action:'click'});assert.equal(f.c.node.clicked,true);
 for(const target of ['document','owner','mcp','constructor','__proto__'])assert.throws(()=>f.agent.interact({target,action:'click'}));
 for(const property of ['vm','constructor','node','Name','DataSource'])assert.throws(()=>f.agent.interact({target:id,action:'set',property,value:'x'}));
 f.agent.interact({target:id,action:'set',property:'Text',value:'OK'});assert.equal(f.c.props.Text,'OK');
 assert.throws(()=>f.agent.interact({target:id,action:'set',property:'Text',value:'x'.repeat(100001)}));
});
test('runtime agent: removed, hidden, disabled and modal-blocked objects reject input',()=>{
 for(const block of [f=>f.c.disposed=true,f=>f.c.node.isConnected=false,f=>f.c.node.hidden=true,f=>f.c.props.Enabled=0,f=>f.c.node.closest=()=>({})]){const f=fixture(),id=f.agent.inspect().items[1].id;block(f);assert.throws(()=>f.agent.interact({target:id,action:'click'}));}
 const f=fixture(),id=f.agent.inspect().items[1].id;f.host.dialogs.push(f.dialog);assert.throws(()=>f.agent.interact({target:id,action:'click'}));
});
test('runtime agent: only top application dialog can be answered; no IDE dialog selector exists',()=>{
 const f=fixture();f.host.dialogs.push(f.dialog);const id=f.agent.inspect().dialogs[0].id;
 assert.throws(()=>f.agent.interact({target:id,action:'dialog',button:1}));assert.equal(f.field.value,'old');
 f.agent.interact({target:id,action:'dialog',button:0,value:'typed'});assert.equal(f.field.value,'typed');assert.equal(f.buttons[0].clicked,true);
 f.host.dialogs.push({...f.dialog});assert.throws(()=>f.agent.interact({target:id,action:'dialog',button:0}));
});
test('runtime agent: indexed grid/list access is allowlisted, not unrestricted dispatch',()=>{
 const f=fixture(),id=f.agent.inspect().items[1].id;assert.equal(f.agent.interact({target:id,action:'indexedGet',method:'TextMatrix',arguments:[1,1]}).value,'cell');
 f.agent.interact({target:id,action:'indexedSet',method:'TextMatrix',arguments:[1,1],value:'new'});assert.deepEqual(f.c.cell,{k:'TextMatrix',a:[1,1],v:'new'});
 f.agent.interact({target:id,action:'call',method:'AddItem',arguments:['new item']});assert.equal(f.c.item,'new item');
 for(const method of ['constructor','dispose','build','get','set','ShowOpen','ShowSave','ensureSurface'])assert.throws(()=>f.agent.interact({target:id,action:'call',method,arguments:[]}));
 assert.throws(()=>f.agent.interact({target:id,action:'indexedGet',method:'TextMatrix',arguments:[-1,1]}));
});
test('runtime agent: menu ancestors, separators and stale menu identities are checked',async()=>{
 const f=fixture(),root={name:'Root',properties:{Caption:'Root',Enabled:-1,Visible:-1}},leaf={name:'Leaf',parent:'Root',properties:{Caption:'Leaf',Enabled:-1,Visible:-1}};
 f.form.model.menus=[root,leaf];let dispatched;f.host.vm.dispatch=async(instance,name)=>{dispatched=name;};const id=f.agent.inspect().items.find(i=>i.name==='Leaf').id;
 f.agent.interact({target:id,action:'menu'});assert.equal(dispatched,'Leaf_Click');await Promise.resolve();assert.equal(f.sent.at(-1).type,'agentActivity');
 root.properties.Enabled=0;assert.throws(()=>f.agent.interact({target:id,action:'menu'}));root.properties.Enabled=-1;leaf.properties.Caption='-';assert.throws(()=>f.agent.interact({target:id,action:'menu'}));
});
test('runtime agent: inspection describes only the requested page',()=>{
 const f=fixture();let reads=0;f.c.get=()=>{reads++;return 'x';};f.agent.inspect({offset:0,limit:1});assert.equal(reads,0);f.agent.inspect({offset:1,limit:1});assert.ok(reads>0);
});


test('runtime agent: paused control mutations require debugger operations, while dialog replies remain available',()=>{
 const f=fixture(),id=f.agent.inspect().items[1].id;f.host.vm.state='paused';
 for(const args of [{action:'click'},{action:'focus'},{action:'set',property:'Text',value:'bad'},{action:'event',event:'Click'},{action:'call',method:'AddItem',arguments:['bad']},{action:'indexedSet',method:'TextMatrix',arguments:[1,1],value:'bad'}])assert.throws(()=>f.agent.interact({target:id,...args}),/Resume/);
 assert.equal(f.c.node.clicked,undefined);assert.equal(f.c.props.Text,undefined);
 assert.equal(f.agent.interact({target:id,action:'indexedGet',method:'TextMatrix',arguments:[1,1]}).value,'cell');
 f.host.dialogs.push(f.dialog);const dialog=f.agent.inspect().dialogs[0].id;f.agent.interact({target:dialog,action:'dialog',button:0,value:'allowed'});assert.equal(f.field.value,'allowed');
});
