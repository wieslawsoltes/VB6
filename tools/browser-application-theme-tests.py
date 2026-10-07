#!/usr/bin/env python3
"""Owned application/control/icon theme regressions; no accounts or external assets.
VB6_BROWSER selects Chromium/Firefox/WebKit. MEMORY mode explicitly lacks origins.
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
REPORT=ROOT/'reports'/'application-themes'/ENGINE
FIXTURE=ROOT/'reports'/'application-themes'/'fixtures'
THEMES=['fluent','fluent-dark','macos26','macos26-dark','x11','x11-dark']
BOUNDS='''()=>{const root=vb6Application.forms[0].node,r=root.getBoundingClientRect();return [...root.querySelectorAll('.vb-control')].map(e=>{const b=e.getBoundingClientRect(),s=getComputedStyle(e);return [e.dataset.control,...[b.x-r.x,b.y-r.y,b.width,b.height].map(n=>Math.round(n*100)/100),s.fontFamily,s.fontSize,s.fontWeight];});}'''
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
class ApplicationThemes(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  subprocess.run(['node','tools/build-theme-fixtures.mjs'],cwd=ROOT,check=True)
  REPORT.mkdir(parents=True,exist_ok=True);cls.results=[]
  cls.project=json.loads((FIXTURE/'gallery.json').read_text());cls.palettes=json.loads((FIXTURE/'palettes.json').read_text())
  cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
  threading.Thread(target=cls.server.serve_forever,daemon=True).start();cls.base=f'http://127.0.0.1:{cls.server.server_port}/'
  cls.pw=sync_playwright().start();options={}
  if ENGINE=='chromium':
   path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
   if path:options['executable_path']=path
   options['args']=['--no-sandbox']
  cls.browser=getattr(cls.pw,ENGINE).launch(**options)
 @classmethod
 def tearDownClass(cls):
  (REPORT/'results.json').write_text(json.dumps(cls.results,indent=2));cls.browser.close();cls.pw.stop();cls.server.shutdown();cls.server.server_close()
 def setUp(self):
  self.context=self.browser.new_context(viewport={'width':1440,'height':1700},color_scheme='light');self.context.set_default_timeout(10000);self.errors=[];self.requests=[]
  self.context.on('page',lambda p:p.on('pageerror',lambda e:self.errors.append(str(e))))
  self.context.on('request',lambda r:self.requests.append(r.url))
  self.page=self.context.new_page();self.load(FIXTURE/'gallery.html');self.page.wait_for_function('typeof vb6Application==="object"');self.page.wait_for_timeout(100)
 def tearDown(self):
  self.context.close();self.assertEqual(self.errors,[],'Uncaught browser errors')
  external=[url for url in self.requests if url.startswith(('http:','https:')) and not url.startswith(self.base)]
  self.assertEqual(external,[],'No third-party requests from themes/icons')
 def load(self,path,page=None):
  page=page or self.page
  if MEMORY:
   # set_content keeps the JS realm; mimic navigation for the idempotent exporter.
   page.evaluate('()=>{globalThis.vb6Application?.dispose();delete globalThis.vb6Application;delete globalThis.vb6ApplicationReady;delete globalThis.vb6ApplicationStatus;}')
   page.set_content(path.read_text())
  else:page.goto(self.base+str(path.relative_to(ROOT)))
 def record(self,case,**detail):self.results.append({'test':self._testMethodName,'case':case,'engine':ENGINE,'transport':'memory' if MEMORY else 'http/file',**detail})
 def theme(self,theme,options=None):
  self.page.evaluate('([t,o])=>{vb6Application.setTheme(t,o||{});}',[theme,options]);self.page.wait_for_timeout(110)
 def css(self,selector,prop):return self.page.locator(selector).first.evaluate('(e,p)=>getComputedStyle(e)[p]',prop)
 def active_pack(self,node):return node.evaluate('e=>[...e.querySelectorAll(".theme-icon-layer")].filter(g=>getComputedStyle(g).display!=="none").map(g=>g.dataset.iconPack)')
 def rgb(self,value):return 'rgb('+', '.join(str(int(value[i:i+2],16)) for i in (1,3,5))+')'
 def test_all_palettes_control_bounds_fonts_and_authored_rgb(self):
  baseline=self.page.evaluate(BOUNDS);project=self.page.evaluate('JSON.stringify(vb6Application.project)')
  self.page.evaluate('window.savedControls=[...document.querySelectorAll("#app .vb-control")]')
  self.assertGreaterEqual(len(baseline),70)
  for theme in THEMES:
   self.theme(theme);self.assertEqual(self.page.evaluate(BOUNDS),baseline,theme)
   self.assertTrue(self.page.evaluate('savedControls.every((n,i)=>n===document.querySelectorAll("#app .vb-control")[i])'))
   self.assertEqual(self.page.evaluate('JSON.stringify(vb6Application.project)'),project)
   self.assertEqual(self.css('[data-control="TextBox1"] input','backgroundColor'),self.rgb(self.palettes[theme]['colors']['window']))
   self.assertEqual(self.css('[data-control="cmdRGB"]','backgroundColor'),'rgb(153, 102, 51)')
   self.assertEqual(self.css('[data-control="cmdRGB"]','color'),'rgb(255, 255, 255)')
   self.assertEqual(self.css('[data-control="OptionButton1"] input','borderRadius'),'0px' if theme.startswith('x11') else '50%')
   self.assertEqual(self.page.locator('.vb-form-icon').first.evaluate('e=>getComputedStyle(e,"::after").display'),'none')
   self.assertEqual(set(self.active_pack(self.page.locator('.vb-tree').first)),{theme.removesuffix('-dark')})
   self.page.screenshot(path=str(REPORT/(theme+'-application.png')))
   self.record(theme,controlNodes=len(baseline),geometryAndFontsUnchanged=True,authoredRGBUnchanged=True,identityRetained=True)
  self.theme('classic');self.assertEqual(self.page.evaluate(BOUNDS),baseline)
 def test_control_values_selection_and_keyboard_survive_switches(self):
  text=self.page.locator('[data-control="TextBox1"] input');text.fill('Edited value');text.evaluate('e=>e.setSelectionRange(2,7)')
  check=self.page.locator('[data-control="CheckBox1"] input');check.uncheck()
  for theme in THEMES:
   self.theme(theme);self.assertEqual(text.input_value(),'Edited value');self.assertFalse(check.is_checked())
   self.assertEqual(text.evaluate('e=>[e.selectionStart,e.selectionEnd]'),[2,7])
  self.page.locator('[data-control="CommandButton1"]').click();self.page.wait_for_function('document.querySelector("[data-control=Label1]").textContent==="Clicked"')
  self.record('theme switch keeps edited state and real VB Click execution')
 def test_dynamic_controls_and_canvas_system_colors(self):
  self.theme('fluent-dark')
  self.page.evaluate('''()=>{const host=vb6Application,form=host.forms[0],template=structuredClone(form.controls.find(c=>c.model.name==='PictureBox1').model);template.id='dynamic-surface';template.name='DynamicSurface';Object.assign(template.properties,{Name:template.name,Left:13500,Top:21000,Width:1500,Height:900,BackColor:-2147483643});
    const c=new VB6Runtime.RuntimeAPI.BrowserControl(template,{form,backend:'canvas2d'});form.content.append(c.node);window.dynamicControl=c;c.ensureSurface().resize();}''')
  self.page.wait_for_timeout(100)
  for theme in THEMES:
   self.theme(theme)
   self.assertEqual(self.page.evaluate('dynamicControl.surface.theme'),theme)
   self.assertEqual(self.page.evaluate('''()=>{const p=dynamicControl.surface.rasterize().getContext('2d').getImageData(5,5,1,1).data;return [...p].slice(0,3);}'''),[int(self.palettes[theme]['colors']['window'][i:i+2],16) for i in (1,3,5)])
   self.record(theme,dynamicCanvasTheme=True)
  self.page.evaluate('dynamicControl.dispose()')
 def test_menu_and_combo_portals_follow_only_their_application(self):
  self.theme('fluent-dark');self.page.get_by_role('menuitem',name='File',exact=True).click()
  menu=self.page.locator('.runtime-popup').first;self.assertTrue(menu.is_visible())
  for theme in THEMES:
   self.theme(theme);self.assertEqual(menu.get_attribute('data-vb-theme'),theme)
   packs=self.active_pack(menu);self.assertTrue(packs);self.assertEqual(set(packs),{theme.removesuffix('-dark')})
  self.page.keyboard.press('Escape')
  self.page.locator('[data-control="ComboBox1"] .vb-combo-arrow').click();popup=self.page.locator('.vb-combo-popup:not(.simple-list)')
  for theme in THEMES:
   self.theme(theme);self.assertEqual(popup.get_attribute('data-vb-theme'),theme)
   self.assertEqual(self.css('.vb-combo-popup:not(.simple-list)','backgroundColor'),self.rgb(self.palettes[theme]['colors']['window']))
  popup.get_by_text('Beta',exact=True).click();self.assertEqual(self.page.locator('[data-control="ComboBox1"] input').input_value(),'Beta')
  self.record('menus and lists stay live across all platform themes and commit selection')
 def test_dialog_palette_icons_focus_and_button_results(self):
  self.page.evaluate('()=>{void vb6Application.msgBox("Theme dialog",65,"Theme check").then(value=>window.dialogResult=value);}')
  dialog=self.page.get_by_role('dialog',name='Theme check');self.assertTrue(dialog.is_visible())
  for theme in THEMES:
   self.theme(theme);self.assertEqual(dialog.evaluate('e=>getComputedStyle(e).backgroundColor'),self.rgb(self.palettes[theme]['colors']['face']))
   self.assertEqual(set(self.active_pack(dialog)),{theme.removesuffix('-dark')})
   self.assertTrue(dialog.evaluate('e=>e.contains(document.activeElement)'))
   self.page.keyboard.press('Tab');self.assertTrue(dialog.evaluate('e=>e.contains(document.activeElement)'))
  dialog.get_by_role('button',name='OK',exact=True).click();self.page.wait_for_function('dialogResult===1');self.assertFalse(self.page.locator('.vb-app-stage').evaluate('e=>e.inert'))
  self.record('dialog result and focus remain usable')
 def test_two_nested_application_boundaries_are_independent(self):
  self.theme('macos26-dark')
  self.page.evaluate('''()=>{const api=VB6Runtime.RuntimeAPI;const node=document.createElement('section');node.id='nested';node.style.cssText='position:absolute;left:5px;top:5px;width:350px;height:250px;z-index:50000';document.querySelector('#app').append(node);const controller=new api.ApplicationThemeController(node);controller.apply({theme:'classic'});const model=structuredClone(vb6Application.project.modules[0].form);model.controls=model.controls.filter(c=>c.name==='CommandButton1');Object.assign(model.properties,{ClientWidth:4500,ClientHeight:2400});Object.assign(model.controls[0].properties,{Left:120,Top:120});const form=new api.BrowserForm(model,{design:true,backend:'canvas2d'});node.append(form.node);window.nested={controller,form,node};}''')
  nested=self.page.locator('#nested');button=nested.locator('.vb-command');classic=button.evaluate('e=>({color:getComputedStyle(e).color,shadow:getComputedStyle(e).boxShadow,round:getComputedStyle(e).borderRadius})')
  for theme in THEMES:
   self.theme(theme);self.assertEqual(button.evaluate('e=>({color:getComputedStyle(e).color,shadow:getComputedStyle(e).boxShadow,round:getComputedStyle(e).borderRadius})'),classic)
   self.assertEqual(self.active_pack(nested),[])
  self.page.evaluate('nested.controller.apply({theme:"fluent"})');self.assertEqual(self.page.locator('#app').get_attribute('data-vb-theme'),'x11-dark');self.assertEqual(set(self.active_pack(nested)),{'fluent'})
  self.page.evaluate('nested.form.dispose();nested.controller.dispose();nested.node.remove()');self.record('nested Classic restores styles and icons without affecting parent')
 def test_system_preferences_and_effect_reduction(self):
  for theme in ['fluent','macos26','x11']:
   self.theme(theme,{'followSystemTheme':True});self.page.emulate_media(color_scheme='dark');self.page.wait_for_function('t=>document.querySelector("#app").dataset.vbTheme===t',arg=theme+'-dark')
   self.assertEqual(self.page.evaluate('vb6Application.themeController.appearance.theme'),theme)
   self.page.emulate_media(color_scheme='light');self.page.wait_for_function('t=>document.querySelector("#app").dataset.vbTheme===t',arg=theme)
  self.theme('macos26',{'reduceTransparency':True,'reduceMotion':True})
  self.assertEqual(self.css('.vb-form-title','backdropFilter'),'none');self.assertEqual(self.css('[data-control="CommandButton1"]','transitionDuration'),'0s')
  self.theme('macos26');self.page.emulate_media(reduced_motion='reduce');self.assertEqual(self.css('[data-control="CommandButton1"]','transitionDuration'),'0s')
  self.record('system pairs and reduced effects remain independent of saved project')
 def test_forced_colors_and_real_keyboard_check_activation(self):
  self.page.emulate_media(forced_colors='active')
  supported=self.page.evaluate("matchMedia('(forced-colors:active)').matches")
  if not supported:self.skipTest('Engine lacks forced-colors emulation')
  for theme in THEMES:
   self.theme(theme);checkbox=self.page.locator('[data-control="CheckBox1"] input');checkbox.focus();self.page.keyboard.press('Shift+Tab');self.page.keyboard.press('Tab')
   self.assertTrue(checkbox.evaluate('e=>e===document.activeElement'))
   before=checkbox.is_checked();self.page.keyboard.press('Space');self.assertNotEqual(checkbox.is_checked(),before)
   self.assertGreater(float(checkbox.evaluate('e=>parseFloat(getComputedStyle(e).outlineWidth)')),0)
   self.record(theme,forcedColorKeyboardActivation=True)
  self.page.screenshot(path=str(REPORT/'forced-colors-application.png'))
 def test_saved_export_initial_appearance_and_classic_effect_reset(self):
  self.load(FIXTURE/'saved.html');self.page.wait_for_function('typeof vb6Application==="object"')
  self.assertEqual(self.page.locator('#app').get_attribute('data-vb-theme'),'macos26-dark')
  self.assertEqual(self.css('.vb-form-title','backdropFilter'),'none')
  self.assertEqual(self.css('[data-control="CommandButton1"]','transitionDuration'),'0s')
  self.assertTrue(self.page.evaluate('vb6Application.project.settings.themeOptions.reduceTransparency'))
  self.theme('classic');classic=self.css('.vb-form-title','backgroundImage')
  self.theme('classic',{'reduceTransparency':True,'reduceMotion':True})
  self.assertEqual(self.css('.vb-form-title','backgroundImage'),classic)
  self.assertEqual(self.page.locator('.vb-form-icon').first.evaluate('e=>getComputedStyle(e,"::after").display'),'block')
  self.record('saved export starts in selected appearance; Classic ignores optional glass effects')
 def test_mdi_children_keep_identity_content_and_window_commands(self):
  self.load(FIXTURE/'mdi.html');self.page.wait_for_function('typeof vb6Application==="object"&&vb6Application.mdi.children.filter(c=>c.shown).length===2')
  self.page.wait_for_timeout(150)
  text=self.page.locator('.vb-mdi-child:visible [data-control="txtDocument"] textarea').first;text.fill('Retained MDI document')
  self.page.evaluate('window.mdiNodes=vb6Application.mdi.children.map(c=>c.node)')
  for theme in THEMES:
   self.theme(theme);self.assertTrue(self.page.evaluate('mdiNodes.every((n,i)=>n===vb6Application.mdi.children[i].node)'))
   self.assertEqual(text.input_value(),'Retained MDI document')
   self.assertEqual(set(self.active_pack(self.page.locator('.vb-mdi-parent'))),{theme.removesuffix('-dark')})
   self.record(theme,mdiIdentityAndContent=True)
  self.page.get_by_role('menuitem',name='File',exact=True).click();self.page.get_by_role('menuitem',name='New document',exact=True).click()
  self.page.wait_for_function('vb6Application.mdi.children.filter(c=>c.shown).length===3')
  self.page.evaluate('vb6Application.mdi.arrange(1)')
  self.assertTrue(self.page.evaluate('vb6Application.mdi.children.filter(c=>c.shown).every(c=>c.node.getBoundingClientRect().width>60&&c.node.getBoundingClientRect().height>30)'))
  self.assertEqual(set(self.active_pack(self.page.locator('.vb-mdi-child').last)),{'x11'})
  self.page.screenshot(path=str(REPORT/'mdi-themed-children.png'))
 def open_ide(self):
  page=self.context.new_page();self.load(ROOT/'dist'/'VB6-Studio-Web.html',page);page.wait_for_function('typeof vb6Studio==="object"');return page
 def options(self,page):
  page.evaluate('()=>{void vb6Studio.command("options");}');page.get_by_role('tab',name='General',exact=True).click()
 def test_options_cancel_commit_undo_and_independent_ide_palette(self):
  ide=self.open_ide();ide.evaluate('p=>vb6Studio.loadProject(p)',self.project)
  ide.evaluate('()=>{vb6Studio.appearance.theme="macos26-dark";vb6Studio.applyAppearance();window.originalControls=[...document.querySelectorAll(".designer-form .vb-control")];}')
  original=ide.evaluate('JSON.stringify(vb6Studio.project)');undo=ide.evaluate('vb6Studio.history.undoStack.length')
  self.options(ide);ide.get_by_label('Application theme',exact=True).select_option('fluent-dark');ide.get_by_label('Application: reduce motion',exact=True).check()
  self.assertEqual(ide.locator('.application-theme-preview').get_attribute('data-vb-theme'),'fluent-dark');self.assertEqual(ide.locator('.designer-scroll[data-vb-theme]').first.get_attribute('data-vb-theme'),'classic')
  ide.locator('.ide-dialog').get_by_role('button',name='Cancel',exact=True).click();self.assertEqual(ide.evaluate('JSON.stringify(vb6Studio.project)'),original)
  self.options(ide);ide.get_by_label('Application theme',exact=True).select_option('fluent-dark');ide.get_by_label('Application: reduce motion',exact=True).check();ide.locator('.ide-dialog').get_by_role('button',name='OK',exact=True).click()
  self.assertEqual(ide.locator('html').get_attribute('data-ide-theme'),'macos26-dark');self.assertEqual(ide.locator('.designer-scroll[data-vb-theme]').first.get_attribute('data-vb-theme'),'fluent-dark')
  self.assertTrue(ide.evaluate('originalControls.every((node,i)=>node===document.querySelectorAll(".designer-form .vb-control")[i])'))
  self.assertEqual(ide.evaluate('vb6Studio.history.undoStack.length'),undo+1)
  ide.evaluate('()=>{void vb6Studio.command("undo");}');self.assertEqual(ide.evaluate('vb6Studio.project.settings.theme'),'classic');self.assertEqual(ide.locator('html').get_attribute('data-ide-theme'),'macos26-dark')
  self.record('Options previews, commits once, preserves control identity and supports Undo')
 def test_ide_pack_switches_existing_and_new_icons_without_replacing_controls(self):
  ide=self.open_ide();ide.evaluate('window.iconNodes=[...document.querySelectorAll("[data-command] .pixel-icon,.toolbox .pixel-icon")]')
  self.assertGreater(ide.evaluate('iconNodes.length'),10)
  for theme in THEMES:
   ide.evaluate('t=>{vb6Studio.appearance.theme=t;vb6Studio.applyAppearance();}',theme)
   self.assertTrue(ide.evaluate('iconNodes.every(n=>n.isConnected)'))
   packs=ide.evaluate('iconNodes.flatMap(e=>[...e.querySelectorAll(".theme-icon-layer")].filter(n=>getComputedStyle(n).display!=="none").map(n=>n.dataset.iconPack))')
   self.assertEqual(set(packs),{theme.removesuffix('-dark')})
   ide.evaluate('()=>{void vb6Studio.command("objectBrowser");}')
   panel=ide.locator('.classic-object-browser');self.assertTrue(panel.is_visible());self.assertEqual(set(self.active_pack(panel)),{theme.removesuffix('-dark')})
   self.record(theme,existingAndNewIcons=True)
  ide.screenshot(path=str(REPORT/'ide-matching-icons.png'))
 def test_running_ide_application_changes_theme_without_restarting_vm(self):
  ide=self.open_ide();ide.evaluate('p=>{vb6Studio.loadProject(p);void vb6Studio.command("run");}',self.project)
  iframe=ide.locator('iframe[title="Running Visual Basic application"]').element_handle();frame=iframe.content_frame()
  frame.wait_for_function('typeof vb6Application==="object"')
  frame.evaluate('window.originalVM=vb6Application.vm;window.runningControls=vb6Application.forms[0].controls.slice()')
  text=frame.locator('[data-control="TextBox1"] input');text.fill('Unsaved runtime text')
  ide.evaluate('vb6Studio.runtimeFrame.contentWindow.postMessage({channel:"vb6-ide",token:"incorrect",command:"applicationAppearance",theme:"fluent-dark"},"*")')
  ide.wait_for_timeout(100);self.assertEqual(frame.locator('#app').get_attribute('data-vb-theme'),'classic')
  self.options(ide);ide.get_by_label('Application theme',exact=True).select_option('fluent-dark');ide.locator('.ide-dialog').get_by_role('button',name='OK',exact=True).click()
  frame.wait_for_function('document.querySelector("#app").dataset.vbTheme==="fluent-dark"')
  self.assertTrue(frame.evaluate('originalVM===vb6Application.vm&&runningControls.every((c,i)=>c===vb6Application.forms[0].controls[i])'))
  self.assertEqual(text.input_value(),'Unsaved runtime text');self.assertEqual(ide.locator('html').get_attribute('data-ide-theme'),'classic')
  ide.evaluate('()=>vb6Studio.stop(false)');self.record('authenticated live Options bridge keeps VM and controls; wrong token ignored')
 def test_detached_ide_icons_follow_the_owner(self):
  ide=self.open_ide()
  with ide.expect_popup() as opened:ide.get_by_label('Float Properties in Browser Window',exact=True).click()
  popup=opened.value;popup.wait_for_selector('.property-tabs')
  for theme in THEMES:
   ide.evaluate('t=>{vb6Studio.appearance.theme=t;vb6Studio.applyAppearance();}',theme)
   popup.wait_for_function('t=>document.documentElement.dataset.ideTheme===t',arg=theme)
   packs=self.active_pack(popup.locator('body'));self.assertTrue(packs);self.assertEqual(set(packs),{theme.removesuffix('-dark')})
   self.record(theme,detachedIcons=True)
  popup.screenshot(path=str(REPORT/'detached-themed-icons.png'));popup.close();ide.wait_for_function('vb6Studio.browserWindows.windows.size===0')
 def test_icon_contact_sheets_complete_selected_disabled_and_large(self):
  self.load(FIXTURE/'icons.html');self.assertEqual(self.page.locator('.glyph').count(),151)
  for theme in THEMES:
   self.page.evaluate('t=>document.documentElement.setAttribute("data-vb-theme",t)',theme)
   layers=self.active_pack(self.page.locator('main'));self.assertEqual(len(layers),151);self.assertEqual(set(layers),{theme.removesuffix('-dark')})
   self.page.locator('.glyph').nth(2).evaluate('e=>e.setAttribute("aria-disabled","true")')
   self.page.locator('.glyph').nth(3).evaluate('e=>e.classList.add("selected")')
   self.page.locator('.glyph').nth(4).evaluate('e=>{e.classList.add("selected");e.setAttribute("aria-disabled","true");}')
   for index,color in [(2,self.palettes[theme]['colors']['gray']),(3,self.palettes[theme]['colors']['selectionText']),(4,self.palettes[theme]['colors']['gray'])]:
    painted=self.page.locator('.glyph').nth(index).evaluate('e=>{const layer=[...e.querySelectorAll(".theme-icon-layer")].find(n=>getComputedStyle(n).display!=="none");return getComputedStyle(layer.querySelector(".icon-pack-body")).color;}')
    self.assertEqual(painted,self.rgb(color),theme+' icon state '+str(index))
   for scaled in self.page.locator('.scaled').all():
    size=int(scaled.get_attribute('data-size'));self.assertEqual(scaled.locator('svg').evaluate('e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height]'),[size,size])
   self.page.screenshot(path=str(REPORT/(theme+'-icon-pack.png')));self.record(theme,completeIcons=151,vectorSizes=[12,16,24,32,48,64],selectedDisabledColor=True)
 @unittest.skipIf(MEMORY,'Real origin storage/reload requires HTTP; covered by CI')
 def test_project_application_appearance_persists_in_saved_workspace(self):
  ide=self.open_ide();ide.evaluate('p=>{vb6Studio.loadProject(p);vb6Studio.project.settings.theme="x11-cde-dark";vb6Studio.project.settings.themeOptions={followSystemTheme:false,reduceMotion:true,reduceTransparency:false};vb6Studio.persist();}',self.project)
  ide.reload();ide.wait_for_function('vb6Studio.project.settings.theme==="x11-dark"');self.assertTrue(ide.evaluate('vb6Studio.project.settings.themeOptions.reduceMotion'));self.record('workspace reload migrates legacy CDE and retains effect preferences')
 @unittest.skipIf(MEMORY,'Standalone file navigation requires real file origin; covered by CI')
 def test_standalone_file_export_contains_all_themes_without_network(self):
  self.page.goto((FIXTURE/'gallery.html').as_uri());self.page.wait_for_function('typeof vb6Application==="object"')
  for theme in THEMES:self.theme(theme);self.assertEqual(self.page.locator('#app').get_attribute('data-vb-theme'),theme)
  self.record('file startup and six runtime palettes')
 def test_caption_geometry_actions_and_restore_identity(self):
  title=self.page.locator('.vb-form-title').first
  close=title.locator('[data-caption-action="close"]');mini=title.locator('[data-caption-action="minimize"]');maxi=title.locator('[data-caption-action="maximize"]')
  self.theme('classic');self.assertEqual(mini.evaluate('e=>[e.offsetWidth,e.offsetHeight]'),[16,14])
  for theme in ['macos26','macos26-dark']:
   self.theme(theme);self.page.evaluate('document.activeElement?.blur()');self.page.mouse.move(1400,1650)
   for button,color in [(close,'rgb(255, 95, 87)'),(mini,'rgb(254, 188, 46)'),(maxi,'rgb(40, 200, 64)')]:
    self.assertEqual(button.evaluate('e=>[e.offsetWidth,e.offsetHeight]'),[13,13]);self.assertEqual(button.evaluate('e=>getComputedStyle(e).backgroundColor'),color)
    self.assertEqual(button.locator('.icon').evaluate('e=>getComputedStyle(e).opacity'),'0')
   self.assertLess(close.bounding_box()['x'],mini.bounding_box()['x']);self.assertLess(mini.bounding_box()['x'],maxi.bounding_box()['x'])
   mini.click();self.assertEqual(mini.get_attribute('aria-label'),'Restore');self.assertEqual(mini.get_attribute('data-caption-action'),'minimize')
   self.assertEqual(mini.evaluate('e=>getComputedStyle(e).backgroundColor'),'rgb(254, 188, 46)');mini.click()
   maxi.click();self.assertEqual(maxi.get_attribute('aria-label'),'Restore');self.assertEqual(maxi.get_attribute('data-caption-action'),'maximize')
   self.assertEqual(maxi.evaluate('e=>getComputedStyle(e).backgroundColor'),'rgb(40, 200, 64)');maxi.click()
   self.page.mouse.move(1400,1650);self.page.screenshot(path=str(REPORT/(theme+'-caption-refinement.png')))
   self.record(theme,captionPixels=[13,13],closeMinimizeMaximizeOrder=True,restoreActionIdentity=True)
 def test_fluent_caption_hover_pressed_and_keyboard_ink(self):
  for theme in ['fluent','fluent-dark']:
   self.theme(theme);close=self.page.locator('.vb-form-title [data-caption-action="close"]').first
   close.hover();self.assertEqual(close.evaluate('e=>getComputedStyle(e).backgroundColor'),'rgb(196, 43, 28)')
   self.assertEqual(close.evaluate('e=>getComputedStyle(e).color'),'rgb(255, 255, 255)')
   self.assertEqual(close.locator('.icon').evaluate('e=>getComputedStyle(e,"::after").backgroundColor'),'rgb(255, 255, 255)')
   self.page.mouse.down();self.assertEqual(close.evaluate('e=>getComputedStyle(e).backgroundColor'),'rgb(169, 34, 22)')
   self.page.mouse.move(1400,1650);self.page.mouse.up()
   close.focus();self.page.keyboard.press('Tab');self.page.keyboard.press('Shift+Tab')
   self.assertTrue(close.evaluate('e=>e.matches(":focus-visible")'));self.assertEqual(close.evaluate('e=>getComputedStyle(e).outlineStyle'),'solid')
   self.record(theme,whiteCloseGlyphOnRedHover=True,pressedFeedback=True,keyboardFocus=True)
 def test_chrome_flags_and_inactive_controls_do_not_reappear(self):
  self.theme('macos26');title=self.page.locator('.vb-form-title').first
  self.page.evaluate('()=>{const f=vb6Application.forms[0];f.props.MinButton=0;f.props.MaxButton=0;f.refresh();}')
  for action in ['minimize','maximize']:
   button=title.locator('[data-caption-action="'+action+'"]');self.assertTrue(button.is_disabled())
   self.assertNotIn(button.evaluate('e=>getComputedStyle(e).backgroundColor'),['rgb(254, 188, 46)','rgb(40, 200, 64)'])
  for border in [3,4,5]:
   self.page.evaluate('b=>{const f=vb6Application.forms[0];f.props.BorderStyle=b;f.refresh();}',border)
   self.assertFalse(title.locator('[data-caption-action="minimize"]').is_visible());self.assertFalse(title.locator('[data-caption-action="maximize"]').is_visible())
  self.page.evaluate('()=>{const f=vb6Application.forms[0];f.props.ControlBox=0;f.refresh();}')
  self.assertFalse(title.locator('[data-caption-action="close"]').is_visible());self.record('disabled, fixed dialog, tool window and ControlBox chrome flags')
 def test_composite_edges_and_scrollbar_tokens_are_platform_local(self):
  baseline=self.page.evaluate(BOUNDS)
  for theme in ['classic',*THEMES]:
   self.theme(theme);self.assertEqual(self.page.evaluate(BOUNDS),baseline)
   edges=self.page.locator('.vb-tree').first.evaluate('e=>{const s=getComputedStyle(e);return [s.borderTopColor,s.borderRightColor,s.borderTopWidth];}')
   self.assertEqual(edges[2],'2px')
   if theme=='classic' or theme.startswith('x11'):self.assertNotEqual(edges[0],edges[1])
   else:self.assertEqual(edges[0],edges[1])
   root=self.page.locator('#app');self.assertEqual(root.evaluate('e=>getComputedStyle(e).getPropertyValue("--detail-scrollbar-radius").trim()'),'0px' if theme=='classic' or theme.startswith('x11') else '8px')
   self.record(theme,compositeBoundsUnchanged=True,platformEdges=True)
 def test_legacy_x11_runtime_theme_uses_canonical_palette_and_caption(self):
  for legacy,current in [('x11-cde','x11'),('x11-cde-dark','x11-dark')]:
   self.theme(legacy);self.assertEqual(self.page.locator('#app').get_attribute('data-vb-theme'),current)
   self.assertEqual(set(self.active_pack(self.page.locator('.vb-tree').first)),{'x11'})
   self.assertEqual(self.css('.vb-form-title','backgroundColor'),self.rgb(self.palettes[current]['colors']['title']))
   self.record(legacy,canonical=current,captionContrast=True)
if __name__=='__main__':unittest.main(verbosity=2)
