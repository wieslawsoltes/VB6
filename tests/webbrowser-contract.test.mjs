import test from 'node:test';
import assert from 'node:assert/strict';
import {isWebBrowser, WEB_BROWSER_EVENTS, WEB_BROWSER_METHODS, WEB_BROWSER_CONSTANTS as C,
  WEB_BROWSER_LIMITS as L, webBrowserEventSignature, webBrowserURL, webBrowserHTML,
  webBrowserFlags, WebBrowserError} from '../src/controls/webbrowser-contract.js';

test('WebBrowser aliases retain original SHDocVw and Shell control identities', () => {
  for (const name of ['WebBrowser','SHDocVw.WebBrowser','shdocvw.webbrowser','Shell.Explorer.2']) assert.equal(isWebBrowser(name),true);
  for (const name of ['Browser','Evil.WebBrowser','Microsoft.WebBrowser',null]) assert.equal(isWebBrowser(name),false);
});
test('DWebBrowserEvents2 declarations retain typed cancellable ByRef arguments', () => {
  assert.equal(webBrowserEventSignature('DocumentComplete'),'ByVal pDisp As Object, ByRef URL As Variant');
  assert.match(webBrowserEventSignature('BeforeNavigate2'), /ByRef Cancel As Boolean$/);
  assert.match(webBrowserEventSignature('NewWindow2'), /^ByRef ppDisp As Object, ByRef Cancel As Boolean$/);
  assert.equal(new Set(WEB_BROWSER_EVENTS.map(e=>e.name)).size,WEB_BROWSER_EVENTS.length);
  assert.equal(WEB_BROWSER_METHODS.Navigate.length,5);
});
test('IWebBrowser2 enum values are not invented loading progress', () => {
  assert.deepEqual([C.READYSTATE_UNINITIALIZED,C.READYSTATE_LOADING,C.READYSTATE_LOADED,C.READYSTATE_INTERACTIVE,C.READYSTATE_COMPLETE],[0,1,2,3,4]);
  assert.equal(C.CSC_NAVIGATEBACK,2); assert.equal(C.CSC_NAVIGATEFORWARD,1);
  assert.equal(C.OLECMDF_SUPPORTED|C.OLECMDF_ENABLED,3);
});
test('URLs resolve with WHATWG semantics and keep relative HTML names relative', () => {
  assert.equal(webBrowserURL('page.html','https://example.test/app/index.html'),'https://example.test/app/page.html');
  assert.equal(webBrowserURL('../next?q=✓','https://example.test/app/index.html'),'https://example.test/next?q=%E2%9C%93');
  assert.equal(webBrowserURL('www.example.test'),'https://www.example.test/');
  assert.equal(webBrowserURL('about:blank#one'),'about:blank#one');
  assert.equal(webBrowserURL(''),'about:blank');
});
for (const url of ['javascript:alert(1)','vbscript:MsgBox(1)','file:///etc/passwd','data:text/html,hello','blob:https://example.test/123','https://user:pass@example.test','https:\n//example.test','about:config']) {
  test('navigation does not grant host authority: '+JSON.stringify(url),()=>assert.throws(()=>webBrowserURL(url),WebBrowserError));
}
test('URL/HTML limits are checked before DOM allocation',()=>{
  assert.throws(()=>webBrowserURL('a'.repeat(L.url+1)),WebBrowserError);
  assert.throws(()=>webBrowserHTML('a'.repeat(L.html+1)),WebBrowserError);
  assert.throws(()=>webBrowserHTML({toString:()=>'<script>'}),WebBrowserError);
  assert.equal(webBrowserHTML('<!doctype html><canvas></canvas>'),'<!doctype html><canvas></canvas>');
});
test('supported navigation flags roundtrip while unsupported security/cache flags fail explicitly',()=>{
  for(const flags of [0,C.navNoHistory,C.navHyperlink,C.navOpenInNewWindow,C.navOpenInNewTab|C.navNoHistory]) assert.equal(webBrowserFlags(flags),flags);
  for(const flags of [C.navTrustedForActiveX,C.navNoReadFromCache,C.navBlockRedirectsXDomain,NaN,-1,0.5,2**32]) assert.throws(()=>webBrowserFlags(flags),WebBrowserError);
});
