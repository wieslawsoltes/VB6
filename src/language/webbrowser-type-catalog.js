import {WEB_BROWSER_ALIASES,WEB_BROWSER_DEFAULTS,WEB_BROWSER_METHODS,WEB_BROWSER_EVENTS,WEB_BROWSER_READONLY,webBrowserEventSignature} from '../controls/webbrowser-contract.js';
import {WEB_DOM_TYPES} from '../controls/webbrowser-dom-contract.js';

/** Declarative source contracts. This never loads a page, a type library or COM. */
export function installWebBrowserTypeCatalog({add,member,method,enumType}){
  const boolean=new Set('Silent Offline RegisterAsBrowser RegisterAsDropTarget AddressBar MenuBar StatusBar FullScreen TheaterMode Resizable Busy TopLevelContainer DocumentAvailable CanGoBack CanGoForward'.split(' '));
  const typeOf=name=>name==='Document'?'HTMLDocument':['Application','Parent'].includes(name)?'WebBrowser':name==='Container'?'Control':boolean.has(name)?'Boolean':['ReadyState','Zoom','ToolBar','HWND'].includes(name)?'Long':['Width','Height'].includes(name)?'Single':name==='BackColor'?'ColorConstants':'String';
  const names=[...new Set([...Object.keys(WEB_BROWSER_DEFAULTS),...WEB_BROWSER_READONLY,'NavigationStatus','Enabled','Visible','Left','Top','TabIndex','TabStop','Tag','ToolTipText'])];
  const members=names.map(name=>member(name,['Enabled','Visible','TabStop'].includes(name)?'Boolean':['Left','Top'].includes(name)?'Single':name==='TabIndex'?'Integer':typeOf(name),null,{readOnly:WEB_BROWSER_READONLY.includes(name)||name==='NavigationStatus'}));
  for(const [name,params]of Object.entries(WEB_BROWSER_METHODS))members.push(method(name,params.map(p=>(p.endsWith('?')?'Optional ':'')+(name==='ClientToWindow'||p==='pvaOut?'?'ByRef ':'ByVal ')+p.replace(/\?$/,'')+' As '+(name==='ClientToWindow'?'Long':'Variant')).join(', '),name==='QueryStatusWB'?'Long':['GetProperty','ExecuteScript','ExecWB'].includes(name)?'Variant':'Void'));
  members.push(method('Move','Left As Single, Optional Top As Single, Optional Width As Single, Optional Height As Single'),method('SetFocus'),method('ZOrder','Optional Position As Long'));
  for(const event of WEB_BROWSER_EVENTS)members.push({name:event.name,kind:'event',type:'Void',params:webBrowserEventSignature(event.name).split(', ').filter(Boolean)});
  add('WebBrowser',members,{aliases:[...WEB_BROWSER_ALIASES.slice(1),'SHDocVw.IWebBrowser2','IWebBrowser2','SHDocVw.WebBrowser_V1'],creatable:false});
  const domNames={document:'HTMLDocument',element:'HTMLElement',collection:'HTMLElementCollection',style:'HTMLStyle',window:'HTMLWindow2',location:'HTMLLocation',attribute:'HTMLAttribute'};
  const objectType=(kind,name)=>{
    if(['Document','OwnerDocument'].includes(name))return 'HTMLDocument';
    if(['ParentWindow','DefaultView'].includes(name))return 'HTMLWindow2';
    if(name==='Location')return 'HTMLLocation';if(name==='Style')return 'HTMLStyle';
    if(/^(?:Forms|Images|Links|Anchors|Scripts|All|Children|ChildNodes|Attributes|Options|Elements|QuerySelectorAll|GetElementsByName|GetElementsByTagName|Tags)$/.test(name))return 'HTMLElementCollection';
    return kind==='collection'&&name==='Tags'?'HTMLElementCollection':'HTMLElement';
  };
  for(const [kind,list]of Object.entries(WEB_DOM_TYPES)){
    const data=list.map(m=>{
      const type=m.result==='object'?objectType(kind,m.name):m.scalar||'Variant';
      const params=m.params.map(p=>(p.optional?'Optional ':'')+p.name+' As Variant').join(', ');
      return m.modes.includes(1)?method(m.name,params,type):member(m.name,type,m.params.length?params:null,{readOnly:!m.modes.includes(4)});
    });
    const name=domNames[kind];add(name,data,{aliases:['MSHTML.'+name,'I'+name,'MSHTML.I'+name,...(kind==='document'?['IHTMLDocument2','IHTMLDocument3','MSHTML.IHTMLDocument2','MSHTML.IHTMLDocument3']:[])],creatable:false,...(kind==='collection'?{defaultMember:'Item'}:{})});
  }
  enumType('SHDocVw.BrowserNavConstants',/^nav/);enumType('SHDocVw.CommandStateChangeConstants',/^CSC_/);
  enumType('SHDocVw.RefreshConstants',/^REFRESH_/);enumType('SHDocVw.tagREADYSTATE',/^READYSTATE_/);
  enumType('OLECMDID',/^OLECMDID_/);enumType('OLECMDF',/^OLECMDF_/);enumType('OLECMDEXECOPT',/^OLECMDEXECOPT_/);
}
