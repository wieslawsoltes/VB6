// Exact, one-use integration of the locally tested runtime changes.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const hash=s=>createHash('sha256').update(s).digest('hex');
function edit(path,before,after,update){let s=readFileSync(path,'utf8');if(hash(s)===after)return;if(hash(s)!==before)throw Error('Changed source: '+path);s=update(s);if(hash(s)!==after)throw Error('Output mismatch: '+path);writeFileSync(path,s);}
edit('src/controls/controls.js','ac419eaba2018176f7d31507c0aa19f7bbefa04ece4f40b9c4a2574f71b8816a','5ea1c9def7aa2504318bb14fd8725afccffaa0d1ef7a0ad59d7b74eb52fdee31',s=>{
  s="import {bindMouseInput,bindKeyboardInput,ownsInputEvent,acceptsInput} from './input.js';\n"+s;
  s=s.replace('this.props.ScaleWidth??this.node.clientWidth*units(this.props.ScaleMode||1)','this.props.ScaleWidth??(this.content||this.node).clientWidth*units(this.props.ScaleMode??1)').replace('this.props.ScaleHeight??this.node.clientHeight*units(this.props.ScaleMode||1)','this.props.ScaleHeight??(this.content||this.node).clientHeight*units(this.props.ScaleMode??1)');
  const start=s.indexOf('  attachEvents(){if(this.design)return;'),end=s.indexOf('  build(){',start);
  s=s.slice(0,start)+`  attachEvents(){
    if(this.design)return;
    bindMouseInput(this);if(!this.form)bindKeyboardInput(this);
    this.node.addEventListener('click',e=>{if(!ownsInputEvent(this,e)||e.vbHandled)return;if(!['TreeView','ListView','Toolbar','TabStrip','SSTab','MonthView','ListBox','ComboBox','FileListBox','DirListBox','DriveListBox'].includes(this.type))this.event('Click');});
    this.node.addEventListener('dblclick',e=>{if(ownsInputEvent(this,e))this.event('DblClick');});
    this.node.addEventListener('focusin',e=>{if(ownsInputEvent(this,e))this.event('GotFocus');});
    this.node.addEventListener('focusout',e=>{if(ownsInputEvent(this,e))this.event('LostFocus');});
  }
`+s.slice(end);
  const fs=s.indexOf('  attachEvents(){if(this.design)return;',s.indexOf('export class BrowserForm')),fe=s.indexOf('\n  event(',fs);
  let form=s.slice(fs,fe).replace('if(this.design)return;','if(this.design)return;bindMouseInput(this);bindKeyboardInput(this);');
  form=form.replace("if(e.target===this.content)this.event('Click');","if(ownsInputEvent(this,e))this.event('Click');");
  form=form.replace("this.node.addEventListener('keydown',","this.content.addEventListener('dblclick',e=>{if(ownsInputEvent(this,e))this.event('DblClick');});this.node.addEventListener('keydown',");
  form=form.replace("if(this.props.KeyPreview)this.event('KeyDown',[{ref:new Cell('Integer',e.keyCode||0)},(e.shiftKey?1:0)+(e.ctrlKey?2:0)+(e.altKey?4:0)]);",'');
  s=s.slice(0,fs)+form+s.slice(fe);
  s=s.replace('event(name,args=[],coalesce=false){if(this.design||!this.vm)return','event(name,args=[],coalesce=false){if(this.design||!this.vm||this.disposed)return');
  return s.replace('const first=this.controls.filter(c=>c.TabStop&&c.Visible&&c.Enabled).sort((a,b)=>a.TabIndex-b.TabIndex)[0];first?.SetFocus();','const first=this.controls.filter(c=>c.TabStop&&acceptsInput(c)&&!NONVISUAL_TYPES.has(c.type)).sort((a,b)=>a.TabIndex-b.TabIndex)[0];(first||this).SetFocus();');
});
edit('src/runtime/vm.js','66eb93099eec6bc6c676529bf760c535969957293d543e1790a34ab50a9f7791','2c9e9cc2a38c1c1f589ff31fa66a5f7a3ca33c7cb55eeb2d90e6374d356991da',s=>{
  s=s.replace("setState(state){this.state=state;this.emit('state',state);}","setState(state){this.state=state;if(['paused','stopped','error'].includes(state)){this.inputEpoch=(this.inputEpoch||0)+1;const pending=this.eventQueue.filter(e=>e.input);this.eventQueue=this.eventQueue.filter(e=>!e.input);for(const event of pending)event.resolve();}this.emit('state',state);}");
  const at=s.indexOf('  dispatch(module,name,args=[]');
  return s.slice(0,at)+`  // Trusted host input uses the normal interpreter queue, including debugger
  // stepping and DoEvents. Pending mouse motion is latest-value, per target and
  // actual instance; timers retain their existing dispatch/coalescing contract.
  enqueueInput(instance,key,action,{coalesce=false,valid=()=>true}={}){
    if(!['running','idle'].includes(this.state)||!valid())return Promise.resolve();
    const epoch=this.inputEpoch||0,guarded=()=>epoch===(this.inputEpoch||0)&&['running','idle'].includes(this.state)&&valid()?action():undefined;
    const existing=coalesce&&this.eventQueue.find(e=>e.input&&e.instance===instance&&e.key===key);
    if(existing){existing.action=guarded;return existing.promise;}
    if(this.eventQueue.length>=1000){this.output('Event queue limit reached; newest input discarded.');return Promise.resolve();}
    const event={input:true,instance,key,action:guarded};event.promise=new Promise(resolve=>event.resolve=resolve);
    this.eventQueue.push(event);this.processEvents();return event.promise;
  }
`+s.slice(at);
});
