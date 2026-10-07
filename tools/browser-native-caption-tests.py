#!/usr/bin/env python3
"""Real popup DOM tests of the native adapter using an explicit simulated IPC host.
This tests application markup/state/geometry, not an installed OS window manager.
The existing Electron smoke harness is the platform integration check.
"""
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import unittest
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ENGINE=os.environ.get('VB6_BROWSER','chromium')
MEMORY=os.environ.get('VB6_TEST_TRANSPORT')=='memory'
REPORT=ROOT/'reports'/'application-themes'/ENGINE/'native-captions'
THEMES=['classic','standard','contrast','fluent','fluent-dark','macos26','macos26-dark','x11','x11-dark']
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
class NativeCaptions(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  subprocess.run(['node','tools/build-theme-fixtures.mjs'],cwd=ROOT,check=True)
  REPORT.mkdir(parents=True,exist_ok=True);cls.results=[]
  cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
  threading.Thread(target=cls.server.serve_forever,daemon=True).start()
  cls.base=f'http://127.0.0.1:{cls.server.server_port}/';cls.pw=sync_playwright().start();options={}
  if ENGINE=='chromium':options={'executable_path':os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or cls.pw.chromium.executable_path,'args':['--no-sandbox']}
  cls.browser=getattr(cls.pw,ENGINE).launch(**options)
 @classmethod
 def tearDownClass(cls):
  (REPORT/'results.json').write_text(json.dumps(cls.results,indent=2));cls.browser.close();cls.pw.stop();cls.server.shutdown();cls.server.server_close()
 def setUp(self):
  self.context=self.browser.new_context(viewport={'width':1100,'height':800});self.context.set_default_timeout(8000);self.errors=[]
  self.context.on('page',lambda p:p.on('pageerror',lambda e:self.errors.append(str(e))))
  self.document_requests=[]
  self.context.on('request',lambda r:self.document_requests.append(r.url) if r.resource_type=='document' else None)
  self.page=self.context.new_page();path=ROOT/'reports/application-themes/fixtures/gallery.html'
  if MEMORY:self.page.set_content(path.read_text())
  else:self.page.goto(self.base+str(path.relative_to(ROOT)))
  self.page.wait_for_function('typeof vb6Application==="object"')
 def tearDown(self):
  self.page.evaluate('()=>window.nativeApp?.dispose()');self.context.close();self.assertEqual(self.errors,[])
 def record(self,**values):self.results.append({'test':self._testMethodName,'ipc':'simulated','transport':'memory' if MEMORY else 'http','engine':ENGINE,**values})
 def gesture_popup(self,action,arg=None):
  # Real browsers require transient user activation. Electron reservations are
  # host-owned, but a simulated IPC host must still use a real browser gesture.
  self.page.evaluate('''arg=>{
   document.querySelector('#caption-popup-trigger')?.remove();
   const button=document.createElement('button');button.id='caption-popup-trigger';
   button.type='button';button.textContent='Open caption test window';
   button.style.cssText='position:fixed;left:8px;top:8px;z-index:2147483647';
   const invoke=('''+action+''');
   window.captionActionError=null;
   button.addEventListener('click',()=>{button.remove();
    window.captionAction=Promise.resolve().then(()=>invoke(arg));
    window.captionAction.catch(error=>{window.captionActionError=String(error);});
   },{once:true});document.body.append(button);
  }''',arg)
  try:
   with self.page.expect_popup() as opened:self.page.locator('#caption-popup-trigger').click()
   return opened.value
  except Exception:
   print('Native popup diagnostics:',self.page.evaluate('''()=>({
    actionError:window.captionActionError,
    records:[...(window.nativeBridge?.records||[])].map(([id,r])=>({id,created:!!r.win,closed:r.win?.closed,sameWindow:r.win===window,name:r.win?.name,url:r.win?.document.URL,ready:r.win?.document.readyState,formConnected:r.win?.document.querySelector('.vb-form')?.isConnected})),
    commands:window.nativeBridge?.commands,body:document.body.innerText.slice(-1200)
   })'''),flush=True)
   raise
 def native(self,theme='macos26',system=False,legacy=False):
  popup=self.gesture_popup('''async([theme,system,legacy])=>{
   const api=VB6Runtime.RuntimeAPI,p=structuredClone(vb6Application.project);vb6Application.dispose();
   p.settings.theme=theme;p.settings.themeOptions={systemCaption:system};
   const f=p.modules[0].form;Object.assign(f.properties,{ClientWidth:6000,ClientHeight:3000,Caption:'Themed desktop app',FontSize:18,FontName:'Courier New'});
   f.menus=[];f.controls=f.controls.filter(c=>['TextBox1','CommandButton1','Label1'].includes(c.name));
   f.controls.forEach((c,i)=>Object.assign(c.properties,{Left:150,Top:150+i*600,Width:4000,Height:420}));
   p.modules[0].code='Private Attempts As Integer\\nPrivate Sub Form_QueryUnload(Cancel As Integer, UnloadMode As Integer)\\nAttempts = Attempts + 1\\nIf Attempts = 1 Then Cancel = 1\\nEnd Sub';
   const records=new Map(),commands=[];let listener,sequence=0;
   const open=window.originalOpen||(window.originalOpen=window.open.bind(window));window.open=(url,id,features)=>{const r=records.get(id);const w=open(url,id,features+',width='+r.options.width+',height='+r.options.height);if(w===window)throw new Error('Native popup reused its controller window');r.win=w;r.url=url;return w;};
   const bridge={version:1,...(legacy?{}:{capabilities:{applicationCaptions:true}}),
    prepareWindow:options=>{const id='caption-'+(++sequence);records.set(id,{options});return id;},
    windowCommand:async(id,name,value)=>{commands.push([id,name,value]);if(name==='destroy'){records.get(id)?.win?.close();records.delete(id);}},
    onWindowEvent:f=>{listener=f;return()=>{listener=null;};}};
   window.nativeBridge={records,commands,emit:e=>listener?.(e)};
   const root=document.querySelector('#app');root.replaceChildren();window.nativeApp=new api.ApplicationHost(p,root,{persist:false,nativeWindows:false});
   api.installNativeHost(nativeApp,bridge);await nativeApp.start();window.originalVM=nativeApp.vm;
  }''',[theme,system,legacy])
  self.page.evaluate('()=>window.captionAction')
  popup.wait_for_selector('.vb-form[data-native-window]')
  options=self.page.evaluate('[...nativeBridge.records.values()][0].options')
  popup.set_viewport_size({'width':int(options['width']),'height':int(options['height'])})
  self.emit(0,True)
  return popup,options
 def emit(self,state,focused):
  self.page.evaluate('''([state,focused])=>{const [id,r]=[...nativeBridge.records][0];nativeBridge.emit({id,type:'state',state,focused,visible:true,bounds:{x:r.options.x,y:r.options.y},contentBounds:{width:r.options.width,height:r.options.height}});}''',[state,focused])
 def test_popup_document_remains_the_live_form_owner_after_load(self):
  popup,_=self.native('fluent-dark')
  popup.wait_for_load_state('load')
  popup.wait_for_timeout(100)
  self.assertNotEqual(popup,self.page)
  self.assertEqual(self.page.evaluate('[...nativeBridge.records.values()][0].url'),'')
  # document.open copies the entry document URL (HTML document-open step 12);
  # it does not navigate or fetch that URL again. Verify both parts of that contract.
  expected_url=self.page.url.split('#')[0]
  self.assertEqual(popup.evaluate('document.URL'),expected_url)
  self.assertEqual(self.document_requests,[] if MEMORY else [expected_url])
  self.assertEqual(popup.evaluate('document.compatMode'),'CSS1Compat')
  self.assertTrue(self.page.evaluate('''()=>{const f=nativeApp.forms[0],r=f.nativeWindow;
   return f.node.isConnected && f.node.ownerDocument===r.doc && r.doc===r.win.document && r.doc.defaultView.opener===window;
  }'''))
  self.assertEqual(popup.locator('html').get_attribute('data-vb-theme'),'fluent-dark')
  popup.locator('[data-control="TextBox1"] input').fill('Still connected after navigation')
  self.assertEqual(self.page.evaluate('nativeApp.forms[0].controls.find(c=>c.model.name==="TextBox1").Text'),'Still connected after navigation')
  self.record(stableDocumentAfterLoad=True,quirksMode=False,liveControlEvents=True,noExtraDocumentFetch=True)
 def test_theme_captions_and_native_client_dimensions(self):
  popup,options=self.native();self.assertEqual(options['captionMode'],'application')
  self.assertEqual(options['width'],408);self.assertEqual(options['height'],226)
  text=popup.locator('[data-control="TextBox1"] input');text.fill('Retained live input')
  for theme in THEMES:
   self.page.evaluate('t=>nativeApp.setTheme(t)',theme)
   self.assertTrue(popup.locator('.vb-form-title').is_visible())
   self.assertEqual(popup.locator('html').get_attribute('data-vb-theme'),theme)
   self.assertEqual(self.page.evaluate('[nativeApp.forms[0].props.ClientWidth,nativeApp.forms[0].props.ClientHeight]'),[6000,3000])
   self.assertEqual(popup.locator('.vb-form-content').evaluate('e=>[e.clientWidth,e.clientHeight]'),[400,200])
   self.assertEqual(popup.locator('.vb-form-title').evaluate('e=>getComputedStyle(e).fontSize'),'11px')
   self.assertNotIn('Courier',popup.locator('.vb-form-title').evaluate('e=>getComputedStyle(e).fontFamily'))
   self.assertTrue(self.page.evaluate('nativeApp.vm===originalVM'));self.assertEqual(text.input_value(),'Retained live input')
   popup.screenshot(path=str(REPORT/(theme+'-native-caption.png')))
  self.record(themes=THEMES,client=[400,200],vmRetained=True)
 def test_system_caption_choice_and_legacy_host_fallback(self):
  for system,legacy in [(True,False),(False,True)]:
   with self.subTest(system=system,legacy=legacy):
    popup,options=self.native(system=system,legacy=legacy)
    self.assertEqual(options['captionMode'],'system');self.assertFalse(popup.locator('.vb-form-title').is_visible())
    self.assertEqual(options['width'],400);self.assertEqual(options['height'],200)
    self.assertEqual(popup.locator('.vb-form-content').evaluate('e=>[e.clientWidth,e.clientHeight]'),[400,200])
    self.page.evaluate('nativeApp.dispose()')
  self.record(systemCaption=True,olderV1Host=True)
 def test_os_state_updates_restore_buttons_activation_and_empty_title(self):
  popup,_=self.native();title=popup.locator('.vb-form-title');maxi=title.locator('[data-caption-action="maximize"]')
  self.emit(2,True);self.assertEqual(maxi.get_attribute('aria-label'),'Restore')
  self.emit(0,False);self.assertEqual(maxi.get_attribute('aria-label'),'Maximize');self.assertTrue(popup.locator('.vb-inactive').count())
  self.emit(1,False);self.assertEqual(title.locator('[data-caption-action="minimize"]').get_attribute('aria-label'),'Restore')
  self.emit(0,True);self.assertFalse(popup.locator('.vb-inactive').count())
  self.page.evaluate('()=>{const f=nativeApp.forms[0];f.props.Caption="";f.refresh();}')
  self.assertEqual(popup.title(),'');self.assertEqual(title.locator('.caption').text_content(),'')
  self.record(nativeStateMirrored=True,emptyCaption=True)
 def test_caption_close_preserves_queryunload_cancellation(self):
  popup,_=self.native();close=popup.locator('[data-caption-action="close"]')
  close.click();self.page.wait_for_function('nativeBridge.commands.some(c=>c[1]==="cancel-close")')
  self.assertFalse(popup.is_closed());self.assertTrue(self.page.evaluate('nativeApp.forms[0].instance.loaded'))
  close.click();self.page.wait_for_function('nativeBridge.commands.some(c=>c[0]==="controller"&&c[1]==="quit")')
  self.record(queryUnloadCancel=True,finalQuit=True)
 def test_native_inputbox_uses_theme_and_own_document_keyboard_focus(self):
  self.native('fluent-dark')
  dialog=self.gesture_popup('()=>{void nativeApp.inputBox("Type a value","Native input","Initial").then(v=>window.dialogResult=v);}')
  field=dialog.get_by_role('textbox');field.wait_for();field.fill('Edited in popup')
  self.assertTrue(field.evaluate('e=>e.ownerDocument.activeElement===e'))
  for theme in ['macos26-dark','x11','classic']:
   self.page.evaluate('t=>nativeApp.setTheme(t)',theme);self.assertEqual(dialog.locator('html').get_attribute('data-vb-theme'),theme)
   self.assertTrue(dialog.locator('.vb-form-title').is_visible());self.assertEqual(field.input_value(),'Edited in popup')
  dialog.keyboard.press('Tab');self.assertTrue(dialog.locator('.vb-dialog').evaluate('e=>e.contains(e.ownerDocument.activeElement)'))
  dialog.get_by_role('button',name='OK',exact=True).click();self.page.wait_for_function('window.dialogResult==="Edited in popup"')
  self.record(dialogThemeChanges=True,popupFocus=True,inputResult=True)
 def test_native_dialog_without_cancel_rejects_os_close_and_escape(self):
  self.native('macos26')
  popup=self.gesture_popup('()=>{void nativeApp.msgBox("Choose","4","Native choice").then(v=>window.choiceResult=v);}')
  popup.get_by_role('button',name='Yes',exact=True).wait_for()
  self.assertTrue(popup.get_by_role('button',name='Close dialog').is_disabled())
  popup.keyboard.press('Escape');self.assertIsNone(self.page.evaluate('window.choiceResult??null'))
  self.page.evaluate('()=>{const [id]=[...nativeBridge.records].at(-1);nativeBridge.emit({id,type:"close-request"});}')
  self.page.wait_for_function('nativeBridge.commands.at(-1)[1]==="cancel-close"')
  popup.get_by_role('button',name='No',exact=True).click();self.page.wait_for_function('window.choiceResult===7')
  self.record(nonCancelableDialog=True,returnValue=7)
 def test_caption_title_is_centered_and_does_not_overlap_controls(self):
  popup,_=self.native('macos26')
  for theme in ['macos26','macos26-dark','x11','x11-dark']:
   self.page.evaluate('t=>nativeApp.setTheme(t)',theme)
   geometry=popup.locator('.vb-form-title').evaluate('''e=>{const r=e.getBoundingClientRect(),c=e.querySelector('.caption').getBoundingClientRect();return{delta:(c.left+c.right-r.left-r.right)/2,clear:[...e.querySelectorAll('button:not([hidden])')].every(b=>{const q=b.getBoundingClientRect();return q.right<=c.left||q.left>=c.right;})};}''')
   self.assertLessEqual(abs(geometry['delta']),1);self.assertTrue(geometry['clear'])
  self.record(centered=True,controlsClear=True)
if __name__=='__main__':unittest.main(verbosity=2)
