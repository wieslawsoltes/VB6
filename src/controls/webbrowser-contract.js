/** Source-level SHDocVw/IWebBrowser2 contract; no MSHTML/ActiveX code is loaded.
 * References: Microsoft IWebBrowser2::Navigate2 / DWebBrowserEvents2 and the
 * WHATWG iframe sandbox specification (see docs/WEBBROWSER.md).
 */
export const WEB_BROWSER_ALIASES = Object.freeze(['WebBrowser', 'SHDocVw.WebBrowser', 'SHDocVwCtl.WebBrowser', 'Shell.Explorer', 'Shell.Explorer.2']);
export const isWebBrowser = type => WEB_BROWSER_ALIASES.some(name => name.toLowerCase() === String(type).toLowerCase());
export const WEB_BROWSER_CONSTANTS = Object.freeze({
  READYSTATE_UNINITIALIZED: 0, READYSTATE_LOADING: 1, READYSTATE_LOADED: 2,
  READYSTATE_INTERACTIVE: 3, READYSTATE_COMPLETE: 4,
  CSC_UPDATECOMMANDS: -1, CSC_NAVIGATEFORWARD: 1, CSC_NAVIGATEBACK: 2,
  navOpenInNewWindow: 1, navNoHistory: 2, navNoReadFromCache: 4,
  navNoWriteToCache: 8, navAllowAutosearch: 16, navBrowserBar: 32,
  navHyperlink: 64, navEnforceRestricted: 128, navNewWindowsManaged: 256,
  navUntrustedForDownload: 512, navTrustedForActiveX: 1024,
  navOpenInNewTab: 2048, navOpenInBackgroundTab: 4096,
  navKeepWordWheelText: 8192, navVirtualTab: 16384, navBlockRedirectsXDomain: 32768,
  REFRESH_NORMAL: 0, REFRESH_IFEXPIRED: 1, REFRESH_CONTINUE: 2, REFRESH_COMPLETELY: 3,
  OLECMDF_SUPPORTED: 1, OLECMDF_ENABLED: 2, OLECMDF_LATCHED: 4, OLECMDF_NINCHED: 8,
  OLECMDEXECOPT_DODEFAULT: 0, OLECMDEXECOPT_PROMPTUSER: 1,
  OLECMDEXECOPT_DONTPROMPTUSER: 2, OLECMDEXECOPT_SHOWHELP: 3,
  OLECMDID_OPEN: 1, OLECMDID_NEW: 2, OLECMDID_SAVE: 3, OLECMDID_SAVEAS: 4,
  OLECMDID_PRINT: 6, OLECMDID_PRINTPREVIEW: 7, OLECMDID_PAGESETUP: 8,
  OLECMDID_COPY: 12, OLECMDID_CUT: 11, OLECMDID_PASTE: 13,
  OLECMDID_UNDO: 15, OLECMDID_REDO: 16, OLECMDID_SELECTALL: 17,
  OLECMDID_REFRESH: 22, OLECMDID_STOP: 23, OLECMDID_OPTICAL_ZOOM: 63
});
export const WEB_BROWSER_DEFAULTS = Object.freeze({
  Width: 6000, Height: 4200, BackColor: 16777215, URL: 'about:blank',
  Silent: 0, Offline: 0, RegisterAsBrowser: 0, RegisterAsDropTarget: 0,
  AddressBar: 0, MenuBar: 0, StatusBar: 0, ToolBar: 0, FullScreen: 0,
  TheaterMode: 0, Resizable: -1, HomeURL: 'about:blank',
  SearchURL: 'https://www.bing.com/', DocumentText: '', Zoom: 100
});
const p = (name, type = 'Variant', byRef = false) => Object.freeze({name, type, byRef});
const e = (name, params = []) => Object.freeze({name, params: Object.freeze(params)});
export const WEB_BROWSER_EVENTS = Object.freeze([
  e('BeforeNavigate2', [p('pDisp','Object'),p('URL','Variant',true),p('Flags','Variant',true),p('TargetFrameName','Variant',true),p('PostData','Variant',true),p('Headers','Variant',true),p('Cancel','Boolean',true)]),
  e('NavigateComplete2', [p('pDisp','Object'),p('URL','Variant',true)]),
  e('DocumentComplete', [p('pDisp','Object'),p('URL','Variant',true)]),
  e('NavigateError', [p('pDisp','Object'),p('URL'),p('Frame'),p('StatusCode'),p('Cancel','Boolean',true)]),
  e('NewWindow2', [p('ppDisp','Object',true),p('Cancel','Boolean',true)]),
  e('NewWindow3', [p('ppDisp','Object',true),p('Cancel','Boolean',true),p('dwFlags','Long'),p('bstrUrlContext','String'),p('bstrUrl','String')]),
  e('DownloadBegin'), e('DownloadComplete'),
  e('ProgressChange', [p('Progress','Long'),p('ProgressMax','Long')]),
  e('StatusTextChange', [p('Text','String')]), e('TitleChange', [p('Text','String')]),
  e('CommandStateChange', [p('Command','Long'),p('Enable','Boolean')]),
  e('PropertyChange', [p('szProperty','String')]), e('OnQuit'),
  ...['OnVisible','OnToolBar','OnMenuBar','OnStatusBar','OnFullScreen','OnTheaterMode'].map(name => e(name,[p(name.slice(2), 'Boolean')])),
  e('WindowClosing', [p('IsChildWindow','Boolean'),p('Cancel','Boolean',true)]),
  e('WindowSetResizable', [p('Resizable','Boolean')]),
  ...['Left','Top','Width','Height'].map(name => e('WindowSet'+name,[p(name,'Long')])),
  e('SetSecureLockIcon',[p('SecureLockIcon','Long')]),
  e('FileDownload',[p('ActiveDocument','Boolean'),p('Cancel','Boolean',true)]),
  e('BeforeNavigate',[p('URL','String'),p('Flags','Long'),p('TargetFrameName','String'),p('PostData'),p('Headers','String'),p('Cancel','Boolean',true)]),
  e('NavigateComplete',[p('URL','String')]), e('GotFocus'), e('LostFocus')
]);
export const webBrowserEvent = name => WEB_BROWSER_EVENTS.find(event => event.name.toLowerCase() === String(name).toLowerCase());
export const webBrowserEventSignature = name => webBrowserEvent(name)?.params.map(param =>
  (param.byRef ? 'ByRef ' : 'ByVal ') + param.name + ' As ' + param.type).join(', ');
export const WEB_BROWSER_METHODS = Object.freeze({
  Navigate: ['URL','Flags?','TargetFrameName?','PostData?','Headers?'],
  Navigate2: ['URL','Flags?','TargetFrameName?','PostData?','Headers?'],
  GoBack: [], GoForward: [], GoHome: [], GoSearch: [], Refresh: [], Refresh2: ['Level?'], Stop: [],
  QueryStatusWB: ['cmdID'], ExecWB: ['cmdID','cmdexecopt?','pvaIn?','pvaOut?'],
  GetProperty: ['Property'], PutProperty: ['Property','Value'], Quit: [],
  ClientToWindow: ['pcx','pcy'], ShowBrowserBar: ['pvaClsid','pvarShow?','pvarSize?'],
  NavigateToString: ['HTML'], ExecuteScript: ['Script'], PostWebMessageAsString: ['Message']
});
export const WEB_BROWSER_READONLY = Object.freeze(['Application','Parent','Container','Document','TopLevelContainer',
  'Type','LocationName','LocationURL','Busy','ReadyState','Name','FullName','Path','HWND',
  'DocumentAvailable','CanGoBack','CanGoForward','LastError','Engine']);
export const WEB_BROWSER_LIMITS = Object.freeze({url: 32768, html: 4 * 1024 * 1024, history: 128,
  historyBytes: 16 * 1024 * 1024, rpc: 128, objects: 4096, message: 1024 * 1024, loadTimeout: 30000, rpcTimeout: 10000});
export class WebBrowserError extends Error {
  constructor(message, number = 5, code = 'WEBBROWSER_INVALID_ARGUMENT') {
    super(message); this.name = 'WebBrowserError'; this.number = number; this.code = code;
  }
}
export function webBrowserURL(value, base = 'https://localhost/') {
  if (typeof value !== 'string' || value.length > WEB_BROWSER_LIMITS.url || /[\x00-\x1f\x7f]/.test(value))
    throw new WebBrowserError('Invalid WebBrowser URL');
  const text = value.trim();
  if (!text) return 'about:blank';
  if (/^about:blank(?:#[^\s]*)?$/i.test(text)) return 'about:blank' + text.slice(11);
  let url;
  try {
    const fallback = /^https?:/i.test(base) ? base : 'https://localhost/';
    const input = /^(?:localhost|www\.[a-z\d.-]+)(?::\d+)?(?:[/?#]|$)/i.test(text) ? 'https://' + text : text;
    url = new URL(input || 'about:blank', fallback);
  } catch { throw new WebBrowserError('Invalid WebBrowser URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new WebBrowserError('WebBrowser permits HTTP(S) and about:blank; use NavigateToString for HTML. Shell, file, data and script URLs are not browser navigation capabilities.', 70, 'WEBBROWSER_URL_DENIED');
  return url.href;
}
export function webBrowserFlags(value = 0) {
  const flags = Number(value);
  if (!Number.isSafeInteger(flags) || flags < 0 || flags > 0x7fffffff) throw new WebBrowserError('Invalid navigation Flags');
  // Never silently weaken cache, origin, download or ActiveX restrictions.
  const supported = 1 | 2 | 64 | 2048 | 4096;
  if ((flags & ~supported) !== 0) throw new WebBrowserError('These navigation flags require an Internet Explorer or native browser host.', 445, 'WEBBROWSER_FLAGS_UNSUPPORTED');
  return flags;
}
export function webBrowserHTML(value) {
  if (typeof value !== 'string' || value.length > WEB_BROWSER_LIMITS.html) throw new WebBrowserError('HTML must be a string of at most 4 MiB');
  return value;
}
