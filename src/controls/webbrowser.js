import {NOTHING,MISSING,Cell,unbox,truth} from '../runtime/values.js';
import {WEB_BROWSER_DEFAULTS,WEB_BROWSER_METHODS,WEB_BROWSER_READONLY,webBrowserEvent,webBrowserURL,webBrowserHTML,webBrowserFlags,WebBrowserError} from './webbrowser-contract.js';
import {WebBrowserFrame} from './webbrowser-frame.js';
import {WebBrowserHistory} from './webbrowser-history.js';

const unsupported = feature => {throw new WebBrowserError(feature+' requires a native browser host and is not available in an embedded HTML5 control',445,'WEBBROWSER_HOST_REQUIRED');};
const chromeProperties=new Set(['AddressBar','MenuBar','StatusBar','ToolBar','FullScreen','TheaterMode','Offline','RegisterAsBrowser','RegisterAsDropTarget']);
const stateNames=new Set([...Object.keys(WEB_BROWSER_DEFAULTS).filter(name=>!['Width','Height','BackColor'].includes(name)),...WEB_BROWSER_READONLY.filter(name=>!['Name','Parent','Container','HWND'].includes(name))]);

/** IWebBrowser2-shaped source API backed by the current browser's HTML engine.
 * Navigation queues its cancellable events rather than awaiting the VM from
 * inside a VB call (which would deadlock Form_Load/BeforeNavigate2).
 */
export class WebBrowserController {
  constructor(control,{frameFactory=(host,entry,receive)=>new WebBrowserFrame(host,entry,receive)}={}){
    this.control=control;this.frameFactory=frameFactory;this.history=new WebBrowserHistory();
    this.closed=false;this.sequence=0;this.generation=0;this.documentSerial=0;this.frame=null;this.entry=null;this.busy=false;
    this.readyState=0;this.locationURL='';this.locationName='';this.lastError='';this.navigationStatus='uninitialized';
    this.document=NOTHING;this.properties=new Map();this.job=Promise.resolve();this.completion=false;
    control.props={...WEB_BROWSER_DEFAULTS,...control.props};
    this.install();
    this.stopSubscription=control.vm?.on?.('stop',()=>this.dispose());
    this.errorSubscription=control.vm?.on?.('error',()=>this.dispose());
    control.node.classList.add('vb-webbrowser');
    this.host=control.node.ownerDocument.createElement('div');
    Object.assign(this.host.style,{width:'100%',height:'100%',overflow:'hidden',background:'white'});
    control.node.append(this.host);
    if(control.design){this.host.textContent='WebBrowser — HTML5';this.host.style.display='grid';this.host.style.placeItems='center';}
    else{
      // A later Form_Load navigation wins over this initial designer URL.
      const initial=this.sequence;
      this.initialTimer=setTimeout(()=>{if(!this.closed&&this.sequence===initial){try{control.props.DocumentText?this.navigateHTML(control.props.DocumentText):this.navigate(control.props.URL||'about:blank');}catch(error){this.error(error);}}},0);
    }
  }
  install(){
    const control=this.control;
    Object.defineProperty(control,'SetFocus',{configurable:true,enumerable:true,value:()=>{this.assertOpen();if(!truth(control.props.Enabled)||!truth(control.props.Visible))throw new WebBrowserError('Cannot focus a hidden or disabled browser',5);(this.frame?.node||control.node).focus();}});
    for(const name of [...stateNames,'NavigationStatus','Parent','HWND',...(!Object.getOwnPropertyDescriptor(control,'Container')?['Container']:[])])Object.defineProperty(control,name,{configurable:true,enumerable:true,get:()=>this.get(name),set:value=>this.set(name,value)});
    for(const [name,parameters]of Object.entries(WEB_BROWSER_METHODS)){
      const fn=(...args)=>this.call(name,args.map(value=>value===MISSING?undefined:unbox(value)));
      fn.vbRawArgs=true;fn.vbPreserveMissing=true;
      fn.vbParams=parameters.map(param=>({name:param.replace(/\?$/,''),optional:param.endsWith('?'),byRef:name==='ClientToWindow'||name==='ExecWB'&&param==='pvaOut?',type:name==='ClientToWindow'?'Long':'Variant'}));
      Object.defineProperty(control,name,{configurable:true,enumerable:true,value:fn});
    }
  }
  assertOpen(){if(this.closed||this.control.disposed)throw new WebBrowserError('WebBrowser control has been released',91);}
  handles(name){return stateNames.has(name)||name==='NavigationStatus';}
  get(name){
    this.assertOpen();
    switch(name){
      case 'Application':return this.control;
      case 'Parent':case 'Container':return this.control.form||NOTHING;
      case 'HWND':return this.control.hWnd||0;
      case 'Document':return this.document;
      case 'Type':return 'HTML Document';
      case 'Engine':return 'HTML5 iframe';
      case 'LocationURL':return this.locationURL;
      case 'LocationName':return this.locationName;
      case 'Busy':return this.busy?-1:0;
      case 'ReadyState':return this.readyState;
      case 'TopLevelContainer':return 0;
      case 'DocumentAvailable':return this.document!==NOTHING?-1:0;
      case 'CanGoBack':return this.history.canBack?-1:0;
      case 'CanGoForward':return this.history.canForward?-1:0;
      case 'LastError':return this.lastError;
      case 'NavigationStatus':return this.navigationStatus;
      case 'FullName':case 'Path':return '';
      default:return this.control.props[name];
    }
  }
  set(name,value){
    this.assertOpen();value=unbox(value);
    if(WEB_BROWSER_READONLY.includes(name)||name==='NavigationStatus')throw new WebBrowserError('Property is read-only: '+name,383);
    if(name==='URL'){const url=this.address(value);this.control.props.URL=url;if(!this.control.design)this.navigate(url);return;}
    if(name==='DocumentText'){const html=webBrowserHTML(value);this.control.props.DocumentText=html;if(!this.control.design)this.navigateHTML(html);return;}
    if(name==='HomeURL'||name==='SearchURL'){this.control.props[name]=webBrowserURL(value,this.base());return;}
    if(name==='Zoom'){const zoom=Number(value);if(!Number.isFinite(zoom)||zoom<10||zoom>1000)throw new WebBrowserError('Zoom must be between 10 and 1000 percent',380);this.control.props.Zoom=zoom;this.refresh();return;}
    if(name==='Silent'){if(this.frame&&this.entry?.html===null&&truth(value)!==truth(this.control.props.Silent))unsupported('Changing Silent on an opaque document; set Silent before Navigate');this.control.props.Silent=truth(value)?-1:0;this.frame?.setSilent?.(truth(value));return;}
    if(chromeProperties.has(name)&&truth(value))unsupported(name);
    this.control.props[name]=truth(value)?-1:0;
  }
  base(){return /^https?:/i.test(this.locationURL)?this.locationURL:this.control.node.ownerDocument.baseURI;}
  address(url){return typeof url==='string'&&url.trim().startsWith('#')&&this.locationURL?webBrowserURL(this.locationURL.split('#')[0]+url.trim(),this.base()):webBrowserURL(url,this.base());}
  navigate(url,flags=0,target='',postData,headers){
    this.assertOpen();
    const address=this.address(url),bits=webBrowserFlags(flags??0);
    target=target??'';
    if(typeof target!=='string'||target.length>255)throw new WebBrowserError('Invalid TargetFrameName',5);
    if(!['','_self','_top','_parent','_blank'].includes(target))unsupported('Named target frame navigation');
    if(postData!==undefined&&postData!==null&&postData!==''&&postData!==MISSING)unsupported('Navigate PostData (use a document HTML form)');
    if(headers!==undefined&&headers!==null&&headers!==''&&headers!==MISSING)unsupported('Custom navigation Headers');
    const options={flags:bits,target,noHistory:!!(bits&2),newWindow:target==='_blank'||!!(bits&(1|2048|4096))};
    this.schedule({url:address,html:address.startsWith('about:blank')?'':null},options);
  }
  navigateHTML(html){this.assertOpen();this.schedule({url:'about:blank',html:webBrowserHTML(html)},{flags:0,target:'',newDocument:true});}
  schedule(entry,options={}){
    this.assertOpen();if(this.control.design)return;
    const sequence=++this.sequence;let accepted=false;
    this.job=Promise.resolve().then(async()=>{
      const current=()=>!this.closed&&sequence===this.sequence&&!['error','stopped'].includes(this.control.vm?.state);
      if(!current())return;
      const args=await this.emit('BeforeNavigate2',[this.control,entry.url,options.flags||0,options.target||'',undefined,'',0],current);
      if(!current()||truth(args[6]))return;
      // URL/Flags arguments are informational ByRef values in the classic
      // event. Only Cancel changes navigation; a handler redirects by Navigate.
      const legacy=await this.emit('BeforeNavigate',[entry.url,options.flags||0,options.target||'',undefined,'',0],current);
      if(!current()||truth(legacy[5]))return;
      if(options.newWindow){
        const newer=await this.emit('NewWindow3',[NOTHING,0,options.flags||0,this.locationURL,entry.url],current);
        if(!current()||truth(newer[1]))return;
        const older=await this.emit('NewWindow2',[newer[0],newer[1]],current);
        if(!current()||truth(older[1]))return;
        const destination=older[0];
        if(destination!==NOTHING&&destination?.webBrowser instanceof WebBrowserController){destination.Navigate(entry.url);return;}
        throw new WebBrowserError('Assign another WebBrowser to ppDisp, or cancel the new-window event. Automatic popups are not granted.',445,'WEBBROWSER_POPUP_REQUIRES_TARGET');
      }
      const fragment=!options.newDocument&&!options.replace&&this.frame?.fragment&&this.document!==NOTHING&&this.entry&&entry.url!==this.locationURL&&entry.url.split('#')[0]===this.locationURL.split('#')[0]&&(options.index===undefined||entry.documentId===this.entry.documentId);
      if(fragment){
        const frame=this.frame;await frame.fragment(entry.url);if(!current()||frame!==this.frame)return;
        this.entry={...this.entry,url:entry.url};this.locationURL=entry.url;this.control.props.URL=entry.url;
        this.history.commit(this.entry,options);this.notify('NavigateComplete2',[this.control,entry.url],current);this.notify('NavigateComplete',[entry.url],current);this.commands(current);return;
      }
      accepted=true;
      this.frame?.close();this.frame=null;this.document=NOTHING;
      const generation=++this.generation,frameCurrent=()=>!this.closed&&generation===this.generation;
      entry={...entry,documentId:entry.documentId??++this.documentSerial};this.entry={...entry};this.locationURL=entry.url;this.locationName='';this.lastError='';
      this.busy=true;this.readyState=1;this.navigationStatus='loading';this.completion=false;
      this.control.props.URL=entry.url;this.control.props.DocumentText=entry.html??'';
      this.history.commit(entry,options);
      this.notify('DownloadBegin',[],frameCurrent);this.notify('ProgressChange',[-1,-1],frameCurrent);this.commands(frameCurrent);
      this.frame=this.frameFactory(this.host,{...entry,silent:truth(this.control.props.Silent)},data=>{if(frameCurrent())this.receive(data,frameCurrent);});
      this.refresh();
    }).catch(error=>{if(!this.closed&&sequence===this.sequence)this.error(error,{url:entry.url,target:options.target||'',keepDocument:!accepted});});
    // The public method returns now; the VM must be allowed to finish its frame
    // before dispatching the queued cancellable event. job is host/test-only.
  }
  async emit(name,values,current=()=>!this.closed){
    const event=webBrowserEvent(name);if(!event||!current())return values;
    const cells=event.params.map((param,index)=>new Cell(param.type,values[index]));
    const args=cells.map((cell,index)=>event.params[index].byRef?{ref:cell}:cell.getScalar());
    // Keep the existing control-array Index prefix and VM dispatcher semantics.
    await this.control.event(name,args,false,current);
    return cells.map((cell,index)=>event.params[index].byRef?cell.get():values[index]);
  }
  notify(name,args=[],current=()=>!this.closed){void this.emit(name,args,current).catch(error=>{if(current())this.lastError=String(error?.message||error);});}
  commands(current){this.notify('CommandStateChange',[2,this.history.canBack?-1:0],current);this.notify('CommandStateChange',[1,this.history.canForward?-1:0],current);}
  receive(data,current){
    if(data.event==='document'){this.document=data.document;this.readyState=3;}
    else if(data.event==='title'){if(this.locationName!==data.title){this.locationName=data.title;this.notify('TitleChange',[data.title],current);}}
    else if(data.event==='complete'&&!this.completion){
      this.completion=true;this.readyState=4;this.busy=false;this.navigationStatus=data.opaque?'opaque':'complete';
      this.notify('NavigateComplete2',[this.control,this.locationURL],current);this.notify('NavigateComplete',[this.locationURL],current);
      this.notify('ProgressChange',[-1,-1],current);this.notify('DownloadComplete',[],current);
      this.notify('DocumentComplete',[this.control,this.locationURL],current);this.commands(current);
    }else if(data.event==='navigate'){
      try{const url=this.address(data.url);if(!['','_self','_top','_parent','_blank'].includes(data.target||''))unsupported('Named target frame navigation');this.schedule({url,html:url.startsWith('about:blank')?'':null},{flags:64,target:data.target,replace:data.replace,newWindow:data.target==='_blank'});}catch(error){this.error(error,{url:String(data.url||''),keepDocument:true});}
    }else if(data.event==='leaving'){
      this.document=NOTHING;this.navigationStatus='unobservable';this.notify('StatusTextChange',['The document navigated itself; its destination is not observable across browser origins.'],current);
    }else if(data.event==='error')this.error(data.error);
  }
  error(error,{url=this.locationURL,target='',keepDocument=false}={}){
    if(this.closed)return;
    const message=String(error?.message||error);this.lastError=message;
    if(!keepDocument){++this.generation;this.busy=false;this.readyState=0;this.navigationStatus='error';this.frame?.close();this.frame=null;this.document=NOTHING;}
    const generation=this.generation,sequence=this.sequence,current=()=>!this.closed&&generation===this.generation&&sequence===this.sequence;
    // Cancel suppresses the control-owned error display. A rejected popup or
    // argument does not destroy the document the user is already viewing.
    void this.emit('NavigateError',[this.control,url,target,-2147467259,0],current).then(args=>{
      if(!current())return;
      if(!keepDocument&&!truth(args[4]))this.host.textContent=message;
      this.notify('StatusTextChange',[message],current);
      if(!keepDocument)this.notify('DownloadComplete',[],current);
    }).catch(handlerError=>{if(current())this.lastError=String(handlerError?.message||handlerError);});
  }
  refresh(){
    if(this.closed)return;const p=this.control.props,zoom=Number(p.Zoom)||100;
    this.host.inert=this.control.design||!truth(p.Enabled);
    this.host.style.pointerEvents=this.host.inert?'none':'';
    if(this.frame?.node){this.frame.node.tabIndex=truth(p.Enabled)&&truth(p.TabStop)?Number(p.TabIndex)||0:-1;this.frame.node.style.zoom=String(zoom/100);this.frame.node.style.width=10000/zoom+'%';this.frame.node.style.height=10000/zoom+'%';}
  }
  requireDocument(){this.assertOpen();if(!this.frame?.document||this.document===NOTHING)throw new WebBrowserError('Document automation is available for about:blank/NavigateToString content after document readiness, not opaque external pages',70,'WEBBROWSER_DOCUMENT_UNAVAILABLE');return this.frame.document;}
  call(name,args){
    this.assertOpen();
    switch(name){
      case 'Navigate':case 'Navigate2':return this.navigate(...args);
      case 'NavigateToString':return this.navigateHTML(args[0]);
      case 'ExecuteScript':return this.requireDocument().script(args[0]);
      case 'PostWebMessageAsString':return this.requireDocument().message(args[0]);
      case 'GoBack':case 'GoForward':{const target=this.history.target(name==='GoBack'?-1:1);this.schedule(target.entry,{index:target.index,flags:0,target:''});return;}
      case 'GoHome':return this.navigate(this.control.props.HomeURL);
      case 'GoSearch':return this.navigate(this.control.props.SearchURL);
      case 'Refresh':case 'Refresh2':{
        const level=args[0]??0;if(![0,1,2,3].includes(Number(level)))throw new WebBrowserError('Invalid refresh level',5);
        if(Number(level)!==0)unsupported('Cache-specific Refresh2 levels');
        if(this.entry)this.schedule(this.entry,{replace:true,flags:0,target:''});return;
      }
      case 'Stop':this.stop();return;
      case 'QueryStatusWB':{
        const command=Number(args[0]);
        if(command===63)return 3;if(command===22)return this.entry?3:1;if(command===23)return this.busy?3:1;
        if(this.document!==NOTHING&&[6,11,12,13,15,16,17].includes(command))return this.frame.request({op:'command',command,query:true});
        return 0;
      }
      case 'ExecWB':{
        const command=Number(args[0]),option=Number(args[1]??0);if(![0,1,2,3].includes(option))throw new WebBrowserError('Invalid command execution option',5);
        if(option===3)unsupported('Command help');
        if(command===22)return this.call('Refresh',[]);
        if(command===23)return this.stop();
        if(command===63){if(args[2]!==undefined)this.set('Zoom',args[2]);const output=args[3]?.ref;if(output?.set)return output.set(this.control.props.Zoom);return this.control.props.Zoom;}
        if([6,11,12,13,15,16,17].includes(command)){
          this.requireDocument();if(command===6&&option===2)unsupported('Silent printing');
          return this.frame.request({op:'command',command,query:false}).then(value=>this.requireDocument().decode(value));
        }
        unsupported('OLE command '+command);break;
      }
      case 'PutProperty':{const key=this.propertyName(args[0]);if(!this.properties.has(key)&&this.properties.size>=128)throw new WebBrowserError('Browser property bag limit',7);this.properties.set(key,args[1]);this.notify('PropertyChange',[key]);return;}
      case 'GetProperty':{const key=this.propertyName(args[0]);return this.properties.get(key);}
      case 'ClientToWindow':{
        // Embedded browser has no separate application chrome: pixel dimensions
        // are unchanged, but both writable Long arguments are validated.
        for(const arg of args){if(!arg?.ref?.get||!arg.ref.set)throw new WebBrowserError('ClientToWindow requires ByRef Long dimensions',13);const value=Number(arg.ref.get());if(!Number.isInteger(value)||value<0||value>2147483647)throw new WebBrowserError('Invalid client dimension',5);}return;
      }
      case 'Quit':unsupported('Quit on an embedded WebBrowser (unload the containing form)');break;
      case 'ShowBrowserBar':unsupported('Internet Explorer browser bars');break;
      default:throw new WebBrowserError('Unknown WebBrowser method',438);
    }
  }
  propertyName(value){if(typeof value!=='string'||!value.length||value.length>255)throw new WebBrowserError('Invalid browser property name',5);return value;}
  stop(){this.assertOpen();++this.sequence;if(!this.busy)return;++this.generation;this.frame?.stop();this.frame=null;this.document=NOTHING;this.busy=false;this.readyState=0;this.navigationStatus='stopped';this.notify('DownloadComplete');}
  dispose(){if(this.closed)return;this.closed=true;++this.sequence;++this.generation;clearTimeout(this.initialTimer);this.stopSubscription?.();this.stopSubscription=null;this.errorSubscription?.();this.errorSubscription=null;this.frame?.close();this.frame=null;this.document=NOTHING;this.history.clear();this.properties.clear();}
}
