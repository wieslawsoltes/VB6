import {el} from '../core/core.js';
import {NativeDebuggerClient} from './native-debugger-client.js';
import {modal,promptDialog} from './ui.js';

/** Native process debugging uses the same classic dock/caption/table controls.
 * The browser never spawns programs itself. A local Windows host must consent to
 * each target. Closing the IDE expires a short debugger lease, not the process. */
export class NativeDebuggerWindow{
  constructor(ide){
    this.ide=ide;this.client=new NativeDebuggerClient();this.sessions=new Map();this.selected=null;this.busy=false;this.output='';this.generation=0;
    this.body=el('div',{class:'debug-body',style:{display:'flex',flexDirection:'column',minHeight:0}});
    this.panel=el('section',{class:'debug-dock debug-tool-window','aria-label':'Native Debugger Window'},ide.caption('Native Debugger',()=>ide.docking.show('nativeDebugger',false)),this.body);
    ide.docking.register('nativeDebugger',this.panel,{edge:'bottom',group:'debug-windows',hidden:true,title:'Native Debugger'});
    const button=(label,action,mode='connected')=>{const control=el('button',{type:'button',onclick:()=>this.guard(action),'data-native-mode':mode},label);this.buttons??=[];this.buttons.push(control);return control;};
    this.connection=button('Connect…',()=>this.connect(),'always');
    this.selector=el('select',{'aria-label':'Native debugger session',style:{minWidth:'170px'},onchange:()=>{this.selected=this.selector.value;this.renderState();void this.guard(()=>this.refresh());}});
    this.state=el('span',{role:'status','aria-label':'Native debugger state'},'Disconnected');
    this.body.append(el('div',{class:'watch-entry',style:{flexWrap:'wrap'}},this.connection,button('Disconnect',()=>this.disconnect()),button('Attach…',()=>this.attach()),button('Launch…',()=>this.launch()),this.selector,this.state));
    this.body.append(el('div',{class:'watch-entry',style:{flexWrap:'wrap'}},
      button('Continue',()=>this.execute('continue'),'paused'),button('Break',()=>this.execute('pause'),'running'),button('Step Into',()=>this.execute('stepInto'),'paused'),button('Step Over',()=>this.execute('stepOver'),'paused'),button('Step Out',()=>this.execute('stepOut'),'paused'),button('Detach',()=>this.detach(),'session'),
      button('Breakpoint…',()=>this.breakpoint(),'paused'),button('Run to Address…',()=>this.runTo(),'paused'),button('Symbols…',()=>this.symbols(),'paused')));
    this.mode=el('select',{'aria-label':'Native step mode',onchange:()=>this.guard(()=>this.execute('stepMode',{mode:this.mode.value}))},el('option',{value:'assembly'},'Machine instructions'),el('option',{value:'source'},'Source lines (matching symbols)'));
    this.view=el('select',{'aria-label':'Native debugger view',onchange:()=>this.guard(()=>this.refresh())},...['Call Stack','All Process Stacks','Threads','Processes','Registers','Disassembly','Modules','Locals','Breakpoints','Output'].map(text=>el('option',{value:text},text)));
    this.body.append(el('div',{class:'watch-entry',style:{flexWrap:'wrap'}},this.mode,this.view,button('Refresh',()=>this.refresh(),'session'),button('Memory…',()=>this.memory(),'paused'),button('Edit Register…',()=>this.register(),'paused'),button('Exceptions…',()=>this.exceptions(),'paused')));
    this.expression=el('input',{'aria-label':'Native expression',spellcheck:false,placeholder:'Native expression, for example @rip or poi(@rsp)',style:{flex:1,minWidth:100}});
    const evaluate=()=>this.inspect('evaluate',{expression:this.expression.value});
    this.expression.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();void this.guard(evaluate);}});
    this.body.append(el('div',{class:'watch-entry'},this.expression,button('Evaluate',evaluate,'paused')));
    this.result=el('div',{class:'debug-native-result',tabindex:0,'aria-label':'Native debugger result',style:{flex:1,overflow:'auto',minHeight:80,background:'var(--vb-window)',color:'var(--vb-window-text)'}});
    this.body.append(this.result,el('div',{class:'debug-context-bar'},'Native Windows machine-code view. A DLL or COM component is debugged in its host process; P-code interpreter frames are not native stack frames.'));
    this.panel.addEventListener('keydown',e=>{
      if(e.target.matches('input,textarea,select')||e.altKey||e.metaKey)return;
      const op=e.key==='F5'&&!e.shiftKey&&!e.ctrlKey?'continue':e.key==='F8'?(e.shiftKey&&e.ctrlKey?'stepOut':e.shiftKey?'stepOver':'stepInto'):e.ctrlKey&&['Pause','Break'].includes(e.key)?'pause':null;
      if(op){e.preventDefault();e.stopPropagation();void this.guard(()=>this.execute(op));}
    });
    this.unload=()=>{clearTimeout(this.timer);this.client.disconnect();};window.addEventListener('pagehide',this.unload);this.renderState();
  }
  show(){this.ide.root.classList.remove('hidden-debug');if(!this.opened){this.opened=true;this.ide.docking.model.sizes.bottom=Math.max(this.ide.docking.model.sizes.bottom,330);}this.ide.docking.show('nativeDebugger',true);this.ide.docking.focus('nativeDebugger');}
  active(){return this.sessions.get(this.selected);}
  async guard(action){if(this.busy)return;this.busy=true;this.renderState();let succeeded=false;try{const result=await action();succeeded=true;return result;}catch(error){this.state.textContent=error.message;this.text(error.message);}finally{this.busy=false;this.renderState(succeeded);}}
  renderState(message=true){
    const session=this.active(),paused=session?.state==='paused';
    for(const button of this.buttons)button.disabled=this.busy||({always:false,connected:!this.client.connected,session:!session,paused:!paused,running:session?.state!=='running'}[button.dataset.nativeMode]??true);
    this.mode.value=session?.stepMode||'assembly';this.mode.disabled=this.busy||!paused;this.expression.disabled=!paused;this.view.disabled=this.busy||!session;this.selector.disabled=this.busy||this.sessions.size<2;
    if(message)this.state.textContent=!this.client.connected?'Disconnected':session?'PID '+session.pid+' — '+session.state+' — pause '+session.pauseId:'Connected — choose a process';
  }
  updateSelector(){this.selector.replaceChildren(...[...this.sessions].map(([id,s])=>el('option',{value:id},'PID '+s.pid+' — '+s.state)));this.selector.value=this.selected??'';this.selector.disabled=this.busy||this.sessions.size<2;}
  text(value){this.result.replaceChildren(el('pre',{class:'output-text',style:{whiteSpace:'pre-wrap',margin:4}},String(value)));}
  table(headers,rows){this.result.replaceChildren(this.ide.debugTable(headers,rows));}
  async connect(){
    if(this.client.connected&&this.sessions.size)throw new Error('Detach the current native sessions before changing the bridge connection.');
    const endpoint=el('input',{value:'http://127.0.0.1:8767/debugger','aria-label':'Native debugger endpoint',style:{width:'100%'}}),token=el('input',{type:'password',autocomplete:'off','aria-label':'Native debugger token',style:{width:'100%'}});
    const content=el('div',{class:'watch-dialog'},el('p',{},'Run node tools/native-debugger.mjs on Windows with --origin '+location.origin+'. The bridge asks for local approval before each attach or launch.'),el('label',{},'Endpoint',endpoint),el('label',{},'One-time connection token',token),el('p',{},'The token stays in IDE memory. It is never saved with a project, settings, or exported application.'));
    const accepted=await modal('Native Debugger Connection',{width:550,content,buttons:[{label:'Connect',primary:true,value:true},{label:'Cancel',value:false}]});
    if(!accepted){token.value='';return;}
    const secret=token.value;token.value='';const capabilities=await this.client.connect(endpoint.value.trim(),secret);this.generation++;this.output='';this.text('Connected to '+capabilities.engine+'. Attach to a process or launch a Windows executable. Approve the target in the bridge terminal.');this.poll();
  }
  async disconnect(){
    clearTimeout(this.timer);const errors=[];
    for(const [id]of this.sessions)try{await this.client.request('detach',{session:id});}catch(error){errors.push(error.message);}
    this.client.disconnect();this.generation++;this.sessions.clear();this.selected=null;this.updateSelector();this.text(errors.length?'Connection closed. The bridge lease will detach unreachable sessions. '+errors.join('\n'):'Disconnected. Detached processes continue running.');
  }
  async attach(){
    const {processes}=await this.client.request('listProcesses'),select=el('select',{size:12,'aria-label':'Windows process to attach',style:{width:'100%'}},...processes.slice().sort((a,b)=>a.name.localeCompare(b.name)||a.pid-b.pid).map(p=>el('option',{value:p.pid},p.name+' (PID '+p.pid+')')));
    const content=el('div',{},el('p',{},'Choose an executable process. For a DLL or COM object, choose the hosting process. Windows access restrictions still apply.'),select);
    if(!await modal('Attach to Process',{width:500,content,buttons:[{label:'Attach',primary:true,value:true},{label:'Cancel',value:false}]}))return;
    const pid=Number(select.value);if(!pid)throw new Error('Select a process.');this.state.textContent='Approve PID '+pid+' in the local bridge terminal…';await this.adopt(await this.client.request('attach',{pid}));
  }
  async launch(){
    const executable=el('input',{'aria-label':'Native executable path',style:{width:'100%'},placeholder:'C:\\Applications\\App.exe'}),args=el('textarea',{'aria-label':'Native executable arguments',value:'[]',rows:3,style:{width:'100%'}}),children=el('input',{type:'checkbox','aria-label':'Debug child processes'});
    const content=el('div',{class:'watch-dialog'},el('label',{},'Executable on the Windows host',executable),el('label',{},'Arguments as a JSON array (no shell)',args),el('label',{},children,' Debug child processes too'));
    if(!await modal('Launch Native Process',{width:560,content,buttons:[{label:'Launch',primary:true,value:true},{label:'Cancel',value:false}]}))return;
    const values=JSON.parse(args.value);if(!Array.isArray(values)||values.some(v=>typeof v!=='string'))throw new Error('Arguments must be a JSON array of strings.');this.state.textContent='Approve this executable in the local bridge terminal…';
    await this.adopt(await this.client.request('launch',{executable:executable.value,args:values,debugChildren:children.checked}));
  }
  async adopt(value){this.sessions.set(value.id,{...value,cursor:0});this.selected=value.id;this.updateSelector();this.renderState();await this.refresh();}
  async detach(){const id=this.selected;if(!id)return;await this.client.request('detach',{session:id});this.sessions.delete(id);this.selected=this.sessions.keys().next().value??null;this.updateSelector();this.text('Detached. The target process remains running.');}
  async execute(method,params={}){
    const session=this.active();if(!session)throw new Error('Select a native session first.');
    const id=this.selected,result=await this.client.request(method,{session:id,pauseId:session.pauseId,...params});
    if(method==='stepMode'&&result?.mode)session.stepMode=result.mode;
    if(result&&typeof result.state==='string')Object.assign(session,result);else if(result?.pauseId!==undefined)session.pauseId=result.pauseId;
    this.updateSelector();this.renderState();return result;
  }
  async inspect(method,params={}){const ticket=this.refreshTicket=(this.refreshTicket||0)+1,id=this.selected;const result=await this.execute(method,params);if(ticket===this.refreshTicket&&id===this.selected)this.text(result.text??JSON.stringify(result,null,2));return result;}
  async refresh(){
    const ticket=this.refreshTicket=(this.refreshTicket||0)+1,id=this.selected,view=this.view.value,generation=this.generation;
    const current=()=>ticket===this.refreshTicket&&id===this.selected&&view===this.view.value&&generation===this.generation;
    if(!this.active())return;
    if(this.view.value==='Output'){this.text(this.output||'No native debugger output.');return;}
    if(this.active().state!=='paused'){this.text('Pause the process to inspect its live state.');return;}
    if(view==='Call Stack'){
      const {frames,text}=await this.execute('stack');if(!current())return;if(!frames.length){this.text(text);return;}
      this.table(['Frame','Return Address','Native Symbol'],frames.map(f=>({values:[f.index,f.returnAddress,f.symbol],action:()=>this.guard(()=>this.inspect('locals',{frame:f.index}))})));return;
    }
    if(view==='Threads'){
      const {threads}=await this.execute('threads');if(!current())return;this.table(['Thread','Process ID','Thread ID','Status'],threads.map(t=>({values:[(t.current?'→ ':'')+t.index,t.pid,t.tid,t.details],action:()=>this.guard(async()=>{await this.execute('selectThread',{index:t.index});await this.refresh();})})));return;
    }
    if(view==='Processes'){
      const {processes}=await this.execute('processes');if(!current())return;this.table(['Index','Process ID','Image'],processes.map(p=>({values:[(p.current?'→ ':'')+p.index,p.pid,p.name],action:()=>this.guard(async()=>{await this.execute('selectProcess',{index:p.index});await this.refresh();})})));return;
    }
    if(view==='Registers'){const {registers}=await this.execute('registers');if(!current())return;this.table(['Register','Hexadecimal Value'],Object.entries(registers).map(([key,value])=>({values:[key,value],action:()=>this.guard(()=>this.register(key,value))})));return;}
    if(view==='Breakpoints'){
      const state=await this.execute('status');if(!current())return;this.table(['ID','Location','Enabled',''],(state.breakpoints||[]).map(bp=>({values:[bp.id,bp.location,String(bp.enabled),el('button',{onclick:()=>this.guard(async()=>{await this.execute('removeBreakpoint',{id:bp.id});await this.refresh();})},'Remove')],action:()=>this.guard(async()=>{await this.execute('enableBreakpoint',{id:bp.id,enabled:!bp.enabled});await this.refresh();})})));return;
    }
    if(view==='All Process Stacks'){const result=await this.execute('allProcessStacks');if(!current())return;this.text(result.processes.map(p=>'PROCESS '+p.process.pid+' — '+p.process.name+'\n'+p.text).join('\n\n'));return;}
    const result=await this.execute({Disassembly:'disassemble',Modules:'modules',Locals:'locals'}[view]||'stack');if(current())this.text(result.text??JSON.stringify(result,null,2));
  }
  async breakpoint(){const location=await promptDialog('Native Breakpoint','Hexadecimal address or module!symbol:','');if(location!==null){await this.execute('setBreakpoint',{location});this.view.value='Breakpoints';await this.refresh();}}
  async runTo(){const address=await promptDialog('Run to Address','Hexadecimal machine address:','');if(address!==null)await this.execute('runToAddress',{address});}
  async symbols(){const path=await promptDialog('Native Symbols','Local Windows directory containing matching symbol files:','');if(path!==null)await this.inspect('symbolPath',{path});}
  async register(name='',value=''){
    const register=await promptDialog('Edit Native Register','Register name (for example rax, eax, rip or eip):',name);if(register===null)return;
    const next=await promptDialog('Edit Native Register','New hexadecimal value. Changing an instruction/stack pointer can invalidate the process:',value);if(next===null)return;
    await this.execute('setRegister',{register,value:next});this.view.value='Registers';await this.refresh();
  }
  async memory(){
    const address=el('input',{'aria-label':'Native memory address',placeholder:'0x1000'}),count=el('input',{type:'number',value:128,min:1,max:4096,'aria-label':'Native memory byte count'}),bytes=el('input',{'aria-label':'Native memory bytes to write',placeholder:'01 02 ff (at most 256 bytes)',style:{width:'100%'}}),text=el('pre',{class:'output-text',style:{maxHeight:280,overflow:'auto',whiteSpace:'pre-wrap'}});
    const show=result=>{text.textContent=result.address+'\n'+result.bytes.map((b,i)=>(i%16===0?'\n'+i.toString(16).padStart(4,'0')+': ':'')+(b===null?'??':b.toString(16).padStart(2,'0'))+' ').join('')+'\nUnreadable bytes: '+result.unreadableBytes;};
    const content=el('div',{},el('label',{},'Address ',address),el('label',{},' Byte count ',count),text,el('label',{},'Explicit memory write (not undoable)',bytes));
    await modal('Native Memory',{width:640,content,buttons:[{label:'Read',primary:true,action:async()=>{show(await this.execute('readMemory',{address:address.value,count:Number(count.value)}));return false;}},{label:'Write Bytes',action:async()=>{const input=bytes.value.trim();if(!/^[0-9a-f]{2}(?:\s+[0-9a-f]{2}){0,255}$/i.test(input))throw new Error('Enter 1 to 256 two-digit hexadecimal bytes.');show(await this.execute('writeMemory',{address:address.value,bytes:input.split(/\s+/).map(x=>parseInt(x,16))}));return false;}},{label:'Close',value:false}]});
  }
  async exceptions(){
    const code=await promptDialog('Native Exception Policy','Exception code in hexadecimal (for example 0xc0000005):','0xc0000005');if(code===null)return;
    const first=await modal('Native Exception Policy',{content:el('p',{},'Break on the first chance, or only when the target does not handle this exception?'),buttons:[{label:'First Chance',value:true},{label:'Unhandled Only',value:false},{label:'Cancel',value:null}]});if(first===null)return;await this.execute('exceptionPolicy',{code,mode:first?'firstChance':'secondChance'});
  }
  poll(){
    clearTimeout(this.timer);if(!this.client.connected)return;const generation=this.generation;
    this.timer=setTimeout(async()=>{
      try{for(const [id,session]of this.sessions){const result=await this.client.request('events',{session:id,after:session.cursor});if(generation!==this.generation)return;session.cursor=result.cursor;const oldPause=session.pauseId,oldState=session.state;Object.assign(session,result.status);if(oldState!==session.state)this.updateSelector();
        for(const event of result.events)if(event.type==='output')this.output=(this.output+event.data.text).slice(-131072);
        if(result.dropped)this.output+='\n[Some native output was discarded by the bounded bridge history.]\n';
        if(id===this.selected){this.renderState(!this.busy);if(!this.busy&&((oldPause!==session.pauseId||oldState!==session.state)&&session.state==='paused'||this.view.value==='Output'))await this.refresh();}
      }}catch(error){if(generation===this.generation)this.state.textContent=error.message;}
      finally{if(generation===this.generation)this.poll();}
    },600);
  }
}
export function installNativeDebugger(ide){
  const native=new NativeDebuggerWindow(ide),command=ide.command.bind(ide),menu=ide.menu.bind(ide);
  ide.command=(id,...args)=>id==='nativeDebugger'?native.show():command(id,...args);
  ide.menu=name=>{const items=menu(name);if(name==='Debug')items.push({separator:true},{id:'nativeDebugger',label:'Native Debugger…'});return items;};
  // Only UI actions hold this capability; it is never added to MCP/runtime tools.
  return native;
}
