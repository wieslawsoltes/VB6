#!/usr/bin/env python3
"""WinUI source-resource/state/geometry contracts, NOT native screenshot goldens.

Default transport is real HTTP. VB6_TEST_TRANSPORT=memory permits restricted
local runs and labels that limitation explicitly. Existing application-theme
suites retain their independent HTTP persistence and file-launch requirements.
"""
import base64
import functools
import re
from io import BytesIO
from PIL import Image
import http.server
import json
import sys
import os
from pathlib import Path
import shutil
import subprocess
import threading
import unittest
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ENGINE = os.environ.get('VB6_BROWSER', 'chromium')
TRANSPORT = os.environ.get('VB6_TEST_TRANSPORT', 'http')
if TRANSPORT not in {'http', 'file', 'memory'}:
 raise ValueError('VB6_TEST_TRANSPORT must be http, file, or memory')
MEMORY = TRANSPORT == 'memory'
REPORT = ROOT / 'reports' / 'winui' / ENGINE
FIXTURE = ROOT / 'reports' / 'application-themes' / 'fixtures' / 'gallery.html'
RESOURCE = {
 'fluent': {'fill':'#ffffffb3','hover':'#f9f9f980','pressed':'#f9f9f94d','disabled':'#f9f9f94d','ink':'#000000e4','pressedInk':'#0000009e','disabledInk':'#0000005c','accent':'#0067b8','accentInk':'#fff','accentPressedInk':'#ffffffb3','accentDisabled':'#00000037','accentDisabledInk':'#fff','inputActive':'#fff','focus':'#000000e4','check':'#00000006','checkHover':'#0000000f','checkPressed':'#00000018'},
 'fluent-dark': {'fill':'#ffffff0f','hover':'#ffffff15','pressed':'#ffffff08','disabled':'#ffffff0b','ink':'#fff','pressedInk':'#ffffffc5','disabledInk':'#ffffff5d','accent':'#80caff','accentInk':'#000','accentPressedInk':'#00000080','accentDisabled':'#ffffff28','accentDisabledInk':'#ffffff87','inputActive':'#1e1e1eb3','focus':'#fff','check':'#00000019','checkHover':'#ffffff0b','checkPressed':'#ffffff12'}
}
class Handler(http.server.SimpleHTTPRequestHandler):
 def log_message(self, *args): pass

class WinUI(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  subprocess.run(['node','tools/build-theme-fixtures.mjs'],cwd=ROOT,check=True)
  REPORT.mkdir(parents=True,exist_ok=True);cls.results=[]
  cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)))
  threading.Thread(target=cls.server.serve_forever,daemon=True).start()
  cls.base=f'http://127.0.0.1:{cls.server.server_port}/'
  cls.pw=sync_playwright().start();options={}
  if ENGINE=='chromium':
   executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
   if executable:options['executable_path']=executable
   options['args']=['--no-sandbox']
  cls.browser=getattr(cls.pw,ENGINE).launch(**options)
 @classmethod
 def tearDownClass(cls):
  (REPORT/'results.json').write_text(json.dumps({'engine':ENGINE,'transport':TRANSPORT,'nativePixelCertification':False,'cases':cls.results},indent=2))
  cls.browser.close();cls.pw.stop();cls.server.shutdown();cls.server.server_close()
 def setUp(self):
  self.context=self.browser.new_context(viewport={'width':1440,'height':1700},reduced_motion='reduce')
  self.context.set_default_timeout(10000);self.errors=[];self.requests=[]
  self.context.on('page',lambda page:page.on('pageerror',lambda error:self.errors.append(str(error))))
  self.context.on('request',lambda request:self.requests.append(request.url))
  self.page=self.context.new_page();self.load(self.page,FIXTURE)
  self.page.wait_for_function('typeof vb6Application === "object"')
 def settle_document(self,page):
  # Test the rendered IDE only after its initial/current syntax job has reached
  # a terminal state. Do not replace a document during an unrelated deferred
  # Blob-worker startup, or silence any pageerror caused by navigation/close.
  # The existing timeout still fails on a stuck scheduler.
  page.wait_for_function('()=>{const s=globalThis.vb6Studio?.syntaxDiagnostics;return !s||(!s.pending&&!s.busy&&!s.timer)}')
 def tearDown(self):
  try:self.settle_document(self.page)
  finally:self.context.close()
  self.assertEqual(self.errors,[])
  self.assertEqual([u for u in self.requests if u.startswith(('http:','https:')) and not u.startswith(self.base)],[])
 def load(self,page,path):
  if MEMORY:page.set_content(path.read_text())
  elif TRANSPORT == 'file':page.goto(path.as_uri())
  else:page.goto(self.base+str(path.relative_to(ROOT)))
 def park_pointer(self):
  # Keep press/release and hit testing inside the viewport. Two distinct
  # interior movements send a real pointer transition even when already parked;
  # callers re-park after enabling a control before measuring its normal state.
  viewport=self.page.viewport_size
  self.page.mouse.move(viewport['width']-16,viewport['height']-16)
  self.page.mouse.move(viewport['width']-8,viewport['height']-8)
 def theme(self,theme):
  self.page.evaluate('t=>vb6Application.setTheme(t,{reduceMotion:true})',theme)
  self.park_pointer()
 def node(self,name):return self.page.locator(f'[data-control="{name}"]')
 def set(self,name,key,value):
  # BrowserControl coalesces refresh into rAF. Observe the completed refresh, not
  # a timing-dependent intermediate model/DOM state.
  self.page.evaluate('async ([n,k,v])=>{vb6Application.forms[0].controls.find(c=>c.model.name===n).set(k,v);await new Promise(requestAnimationFrame);}',[name,key,value])
 def color(self,value):return self.page.evaluate('v=>{const n=document.createElement("span");n.style.color=v;document.body.append(n);const c=getComputedStyle(n).color;n.remove();return c;}',value)
 def css(self,node,key):return node.evaluate('(n,k)=>getComputedStyle(n)[k]',key)
 def expect_color(self,node,key,value):
  # Pointer/style/compositor updates are asynchronous in WebKit. Keep exact
  # channel values and the existing timeout, but observe the requested state
  # instead of sampling one arbitrary frame (including an in-flight transition).
  property_name=re.sub(r'[A-Z]',lambda m:'-'+m[0].lower(),key)
  expect(node).to_have_css(property_name,self.color(value),timeout=10000)
 def record(self,**values):self.results.append({'test':self._testMethodName,**values})
 def pixel(self,node,x,y):
  image=Image.open(BytesIO(node.screenshot(animations='disabled'))).convert('RGBA')
  return image.getpixel((x,y))
 def test_late_form_and_picture_drawing_remain_below_controls_after_zorder(self):
  # A DOM-visible/clickable control can still be completely painted over by a
  # pointer-events:none canvas. Check the actual composited screenshot pixels.
  self.page.evaluate("""async()=>{
   const f=vb6Application.forms[0],find=n=>f.controls.find(c=>c.model.name===n);
   const c=find('CommandButton1'),p=find('PictureBox1'),t=f.Controls.Add('TextBox','PaintText',p);
   c.set('BackColor',0x336699);c.set('Default',0);t.set('BackColor',0x563412);
   // Exercise the real PictureBox container API, not only a reparented DOM node.
   t.set('Visible',-1);t.Move(300,300,1800,420);
   await new Promise(requestAnimationFrame);
   globalThis.paintControls={f,c,p,t};globalThis.paintBounds=[c,p,t].map(x=>[x.props.Left,x.props.Top,x.props.Width,x.props.Height]);
   f.draw('rect',[0,0,100000,100000],0x00ff00,true);
   p.draw('rect',[0,0,100000,100000],0x0000ff,true);
   await new Promise(requestAnimationFrame);
  }""")
  command=self.node('CommandButton1');picture=self.node('PictureBox1');text=self.node('PaintText')
  self.assertEqual(text.evaluate('n=>n.parentNode.dataset.control'),'PictureBox1')
  for theme in ['classic','standard','contrast','fluent','fluent-dark','macos26','macos26-dark','x11','x11-dark']:
   self.theme(theme)
   for z in [1,0,1]:
    self.page.evaluate('z=>{paintControls.c.ZOrder(z);paintControls.t.ZOrder(z);}',z)
    self.assertEqual(self.pixel(command,15,12),(153,102,51,255),f'{theme}: command covered at ZOrder {z}')
    self.assertEqual(self.pixel(text,90,12),(18,52,86,255),f'{theme}: nested text covered at ZOrder {z}')
    self.assertEqual(self.pixel(picture,240,90),(255,0,0,255),f'{theme}: PictureBox drawing hidden')
    self.assertEqual(self.pixel(self.page.locator('.vb-form-content').first,1180,1540),(0,255,0,255),f'{theme}: form drawing hidden')
   self.assertTrue(self.page.evaluate('JSON.stringify(paintBounds)===JSON.stringify([paintControls.c,paintControls.p,paintControls.t].map(x=>[x.props.Left,x.props.Top,x.props.Width,x.props.Height]))'))
   self.record(theme=theme,lateFormAndPictureDrawing=True,zOrders=[1,0,1],compositedPixels=True)
  command.click()
  self.page.wait_for_function('vb6Application.forms[0].controls.find(c=>c.model.name==="Label1").get("Caption")==="Clicked"')
  self.page.screenshot(path=str(REPORT/'drawing-behind-controls.png'))
 def test_gpu_overlay_dom_order_is_retained_inside_isolated_drawing_hosts(self):
  # Synthetic two-plane composition tests the CSS contract, not GPU execution.
  # Real WebGPU/WebGL2 execution stays in the separate required CI matrix.
  self.page.evaluate("""()=>{
   const host=document.createElement('div');host.id='paint-planes';host.className='vb-picture';
   host.style.cssText='position:fixed;left:20px;top:20px;width:120px;height:100px;border:0;border-radius:0;background:#ffff00;z-index:9999';
   const control=document.createElement('div');control.className='vb-control';control.style.cssText='left:10px;top:10px;width:20px;height:20px;background:#0000ff';host.append(control);
   const gpu=document.createElement('canvas'),overlay=document.createElement('canvas');
   for(const c of [gpu,overlay]){c.width=120;c.height=100;c.className='graphics-surface';c.style.cssText='position:absolute;inset:0;width:120px;height:100px;pointer-events:none';}
   gpu.getContext('2d').fillStyle='#00ff00';gpu.getContext('2d').fillRect(0,0,120,100);
   overlay.style.zIndex='1';overlay.getContext('2d').fillStyle='#ff0000';overlay.getContext('2d').fillRect(60,0,60,100);
   host.append(gpu,overlay);document.body.append(host);
   // Simulate the same operation as VB ZOrder-to-back after both planes exist.
   host.prepend(control);
  }""")
  host=self.page.locator('#paint-planes')
  self.assertEqual(self.pixel(host,20,20),(0,0,255,255))
  self.assertEqual(self.pixel(host,40,50),(0,255,0,255))
  self.assertEqual(self.pixel(host,80,50),(255,0,0,255))
  self.assertEqual(host.locator('canvas').evaluate_all('nodes=>nodes.map(n=>getComputedStyle(n).zIndex)'),['-1','-1'])
  self.record(simulatedGpuOverlay=True,transparentOverlayPreservesBase=True,controlPaintsAboveBoth=True)
 def test_standard_and_accent_command_state_brushes(self):
  button=self.node('CommandButton1')
  for theme,r in RESOURCE.items():
   for accent in [False,True]:
    self.theme(theme);self.set('CommandButton1','Default',-1 if accent else 0);self.set('CommandButton1','Enabled',-1);self.park_pointer()
    self.page.wait_for_function("!document.querySelector('[data-control=CommandButton1]').matches(':hover')")
    self.expect_color(button,'backgroundColor',r['accent' if accent else 'fill']);self.expect_color(button,'color',r['accentInk' if accent else 'ink'])
    self.assertEqual(self.css(button,'borderTopWidth'),'1px');self.assertEqual(self.css(button,'padding'),'5px 11px 6px')
    button.hover();self.expect_color(button,'backgroundColor',f'color-mix(in srgb, {r["accent"]} 90%, transparent)' if accent else r['hover'])
    self.page.mouse.down()
    try:
     self.expect_color(button,'backgroundColor',f'color-mix(in srgb, {r["accent"]} 80%, transparent)' if accent else r['pressed'])
     self.expect_color(button,'color',r['accentPressedInk' if accent else 'pressedInk'])
     self.assertEqual(self.css(button,'padding'),'5px 11px 6px','pressed state must not move authored text')
    finally:self.park_pointer();self.page.mouse.up()
    self.set('CommandButton1','Enabled',0)
    self.expect_color(button,'backgroundColor',r['accentDisabled' if accent else 'disabled']);self.expect_color(button,'color',r['accentDisabledInk' if accent else 'disabledInk'])
    self.record(theme=theme,accent=accent,states=['normal','hover','pressed','disabled'])
 def test_hover_resets_after_cancelled_press_disable_and_live_palette_change(self):
  button=self.node('CommandButton1')
  caption=self.page.evaluate('vb6Application.forms[0].controls.find(c=>c.model.name==="Label1").get("Caption")')
  for cycle in range(2):
   for theme,r in RESOURCE.items():
    self.theme(theme);self.set('CommandButton1','Enabled',-1);self.set('CommandButton1','Default',0)
    button.hover();self.assertTrue(button.evaluate('e=>e.matches(":hover")'))
    self.page.mouse.down()
    try:self.expect_color(button,'backgroundColor',r['pressed'])
    finally:self.park_pointer();self.page.mouse.up()
    self.park_pointer()
    self.page.wait_for_function("!document.querySelector('[data-control=CommandButton1]').matches(':hover,:active')")
    self.set('CommandButton1','Enabled',0)
    self.theme('fluent-dark' if theme=='fluent' else 'fluent')
    self.theme(theme);self.set('CommandButton1','Enabled',-1);self.park_pointer()
    self.page.wait_for_function("!document.querySelector('[data-control=CommandButton1]').matches(':hover,:active')")
    self.expect_color(button,'backgroundColor',r['fill'])
    self.expect_color(button,'color',r['ink'])
    self.assertEqual(self.page.evaluate('vb6Application.forms[0].controls.find(c=>c.model.name==="Label1").get("Caption")'),caption,'Releasing outside must not execute the VB Click handler')
    self.record(theme=theme,cycle=cycle,cancelledPress=True,hoverResetAfterReenable=True)
 def test_text_input_states_preserve_live_text_selection_and_host_alpha(self):
  text=self.node('TextBox1').locator('input')
  for theme,r in RESOURCE.items():
   self.theme(theme);self.set('TextBox1','Enabled',-1);self.page.evaluate('document.activeElement.blur()')
   self.expect_color(self.node('TextBox1'),'backgroundColor','transparent')
   self.expect_color(text,'backgroundColor',r['fill']);text.hover();self.expect_color(text,'backgroundColor',r['hover'])
   text.fill('WinUI state editing');text.evaluate('e=>e.setSelectionRange(2,7)')
   self.expect_color(text,'backgroundColor',r['inputActive'])
   self.assertIn('0px -2px',self.css(text,'boxShadow'))
   self.theme('classic');self.theme(theme)
   self.assertEqual(text.input_value(),'WinUI state editing');self.assertEqual(text.evaluate('e=>[e.selectionStart,e.selectionEnd]'),[2,7])
   self.set('TextBox1','Enabled',0);self.expect_color(text,'backgroundColor',r['disabled'])
   self.expect_color(text,'color','#fefefe5d' if theme.endswith('dark') else r['disabledInk'])
   self.record(theme=theme,textAndSelectionRetained=True)
 def test_authored_rgb_fonts_and_outer_geometry_are_not_rewritten(self):
  command=self.node('cmdRGB');text=self.node('TextBox1').locator('input')
  self.set('TextBox1','BackColor',0x336699);self.set('TextBox1','ForeColor',0xffffff)
  snapshot='e=>{const r=e.getBoundingClientRect(),s=getComputedStyle(e);return [r.width,r.height,s.fontFamily,s.fontSize,s.fontWeight]}'
  baseline=command.evaluate(snapshot);original=self.page.evaluate('JSON.stringify(vb6Application.project)')
  for theme in RESOURCE:
   self.theme(theme)
   for node in [command,text]:
    self.expect_color(node,'backgroundColor','#996633');self.expect_color(node,'color','#fff');node.hover()
    self.page.mouse.down()
    try:self.expect_color(node,'backgroundColor','#996633');self.expect_color(node,'color','#fff')
    finally:self.park_pointer();self.page.mouse.up()
   self.assertEqual(command.evaluate(snapshot),baseline)
   self.assertEqual(self.page.evaluate('JSON.stringify(vb6Application.project)'),original)
   self.record(theme=theme,authoredValuesPreserved=True)
 def test_check_radio_and_indeterminate_geometry_and_states(self):
  check=self.node('CheckBox1').locator('input');radio=self.node('OptionButton1').locator('input')
  for theme,r in RESOURCE.items():
   self.theme(theme);self.set('CheckBox1','Enabled',-1);self.set('CheckBox1','Value',0)
   for node in [check,radio]:self.assertEqual(node.evaluate('e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height]'),[20,20])
   self.expect_color(check,'backgroundColor',r['check']);check.hover();self.expect_color(check,'backgroundColor',r['checkHover'])
   self.page.mouse.down()
   try:self.expect_color(check,'backgroundColor',r['checkPressed'])
   finally:self.park_pointer();self.page.mouse.up()
   self.set('CheckBox1','Value',1);self.expect_color(check,'backgroundColor',r['accent'])
   self.assertEqual(check.evaluate('e=>[getComputedStyle(e,"::after").width,getComputedStyle(e,"::after").height]'),['12px','12px'])
   self.set('CheckBox1','Value',2);self.assertTrue(check.evaluate('e=>e.indeterminate'))
   self.assertEqual(check.evaluate('e=>[getComputedStyle(e,"::after").width,getComputedStyle(e,"::after").height]'),['12px','2px'])
   self.set('CheckBox1','Enabled',0);self.expect_color(check,'backgroundColor',r['accentDisabled'])
   self.set('OptionButton1','Value',-1);radio.hover();self.assertEqual(radio.evaluate('e=>getComputedStyle(e,"::after").top'),'2px')
   self.page.mouse.down()
   try:self.assertEqual(radio.evaluate('e=>getComputedStyle(e,"::after").top'),'4px')
   finally:self.park_pointer();self.page.mouse.up()
   self.record(theme=theme,checkSize=20,mixedGlyph=[12,2],radioInsets=[3,2,4])
 def test_keyboard_focus_is_separate_from_default_state(self):
  button=self.node('CommandButton1')
  for theme,r in RESOURCE.items():
   self.theme(theme);self.page.evaluate('document.activeElement.blur()')
   self.assertEqual(self.css(button,'outlineStyle'),'none')
   self.page.keyboard.press('Tab');button.focus()
   self.assertTrue(button.evaluate('e=>e.matches(":focus-visible")'));self.expect_color(button,'outlineColor',r['focus'])
   self.assertEqual(self.css(button,'outlineWidth'),'2px')
   self.assertEqual(button.evaluate('e=>getComputedStyle(e,"::after").content'),'none')
   self.record(theme=theme,keyboardFocus=True)
 def test_radio_glyph_uses_primary_ink_even_when_pressed_or_disabled(self):
  radio=self.node('OptionButton1').locator('input')
  for theme,r in RESOURCE.items():
   self.theme(theme);self.set('OptionButton1','Enabled',-1);self.set('OptionButton1','Value',-1)
   expected=self.color(r['accentInk'])
   self.assertEqual(radio.evaluate('e=>getComputedStyle(e,"::after").backgroundColor'),expected)
   radio.hover();self.page.mouse.down()
   try:self.assertEqual(radio.evaluate('e=>getComputedStyle(e,"::after").backgroundColor'),expected)
   finally:self.park_pointer();self.page.mouse.up()
   self.set('OptionButton1','Enabled',0)
   self.assertEqual(radio.evaluate('e=>getComputedStyle(e,"::after").backgroundColor'),expected)
   self.record(theme=theme,radioPrimaryInkRetained=True)
 def test_keyboard_focus_retains_both_rings_during_hover_and_press(self):
  button=self.node('CommandButton1')
  for theme,r in RESOURCE.items():
   self.theme(theme);self.page.evaluate('document.activeElement.blur()')
   before=button.evaluate('e=>{const r=e.getBoundingClientRect();return [r.width,r.height]}')
   self.page.keyboard.press('Tab');button.focus()
   expected='rgba(0, 0, 0, 0.7)' if theme.endswith('dark') else 'rgba(255, 255, 255, 0.7)'
   for state in ['focus','hover','pressed']:
    if state=='hover':button.hover()
    elif state=='pressed':self.page.keyboard.down('Space')
    try:
     self.assertTrue(button.evaluate('e=>e.matches(":focus-visible")'))
     self.assertEqual(self.css(button,'boxShadow'),expected+' 0px 0px 0px 1px')
     self.assertEqual(self.css(button,'outlineWidth'),'2px')
     self.expect_color(button,'outlineColor',r['focus'])
     self.assertEqual(before,button.evaluate('e=>{const r=e.getBoundingClientRect();return [r.width,r.height]}'))
    finally:
     if state=='pressed':self.page.keyboard.up('Space')
   button.evaluate('e=>e.blur()');self.assertEqual(self.css(button,'boxShadow'),'none')
   self.record(theme=theme,focusRings=[2,1],focusRetainedAcrossStates=True)
 def test_ide_focus_ring_and_disabled_radio_are_resource_backed(self):
  for theme,r in RESOURCE.items():
   self.ide(theme)
   button=self.page.locator('.ide-dialog-footer').get_by_role('button',name='Cancel',exact=True)
   self.page.keyboard.press('Tab');button.focus()
   self.assertTrue(button.evaluate('e=>e.matches(":focus-visible")'))
   expected='rgba(0, 0, 0, 0.7)' if theme.endswith('dark') else 'rgba(255, 255, 255, 0.7)'
   self.assertEqual(self.css(button,'boxShadow'),expected+' 0px 0px 0px 1px')
   self.page.keyboard.down('Space')
   try:self.assertEqual(self.css(button,'boxShadow'),expected+' 0px 0px 0px 1px')
   finally:button.evaluate('e=>e.blur()');self.page.keyboard.up('Space')
   # Exercise the real IDE skin on an inert radio fixture without assuming an
   # unrelated settings tab currently exposes a radio-button group.
   self.page.locator('.ide-dialog').evaluate('e=>{const r=document.createElement("input");r.type="radio";r.checked=true;r.disabled=true;r.dataset.winuiFixture="radio";e.appendChild(r)}')
   radio=self.page.locator('[data-winui-fixture="radio"]')
   self.assertEqual(radio.evaluate('e=>getComputedStyle(e,"::after").backgroundColor'),self.color(r['accentInk']))
   self.record(theme=theme,ideSecondaryFocusRing=True,ideRadioPrimaryInk=True)
 def test_non_fluent_component_sheet_fallbacks_are_identical(self):
  full=(ROOT/'dist/vb6-controls.css').read_text();sheet=(ROOT/'src/theme/winui-controls.css').read_text()
  self.assertEqual(full.count(sheet),1);without=full.replace(sheet,'')
  fields=['color','backgroundColor','backgroundImage','borderTopColor','borderRightColor','borderBottomColor','borderLeftColor','borderTopWidth','borderRadius','boxShadow','padding','width','height','outline','font','transition']
  sample='(e,keys)=>[...e.querySelectorAll(".vb-control,.vb-control *, .vb-form-title, .vb-form-title *")].map(n=>Object.fromEntries(keys.map(k=>[k,getComputedStyle(n)[k]])))'
  for theme in ['classic','standard','contrast','macos26','macos26-dark','x11','x11-dark']:
   self.theme(theme)
   for checked in [0,1,2]:
    self.set('CheckBox1','Value',checked)
    data=[]
    for css in [without,full]:
     self.page.locator('head style').first.evaluate('(e,css)=>e.textContent=css',css)
     data.append(self.page.locator('#app').evaluate(sample,fields))
    differences=[(i,{k:(a[k],b[k]) for k in fields if a[k]!=b[k]}) for i,(a,b) in enumerate(zip(*data)) if a!=b]
    self.assertEqual(len(data[0]),len(data[1]));self.assertEqual(differences,[],theme+' state '+str(checked))
   self.record(theme=theme,otherFamiliesUnchanged=True)
 def test_disabled_glyphs_retain_other_family_paint(self):
  full=(ROOT/'dist/vb6-controls.css').read_text();sheet=(ROOT/'src/theme/winui-controls.css').read_text()
  without=full.replace(sheet,'')
  for theme in ['classic','standard','contrast','macos26','macos26-dark','x11','x11-dark']:
   self.theme(theme);self.set('CheckBox1','Enabled',0);self.set('OptionButton1','Enabled',0)
   for checked in [0,1,2]:
    self.set('CheckBox1','Value',checked)
    samples=[]
    for css in [without,full]:
     self.page.locator('head style').first.evaluate('(e,css)=>e.textContent=css',css)
     samples.append(self.page.locator('.vb-check input').evaluate_all('''nodes=>nodes.map(e=>{const s=getComputedStyle(e,"::after");return [s.content,s.backgroundColor,s.width,s.height,s.clipPath];})'''))
    self.assertEqual(*samples,theme+' disabled state '+str(checked))
   self.record(theme=theme,disabledGlyphsUnchanged=True)
 def ide(self,theme):
  # Exercise a real live palette switch instead of reloading an 11-MB IDE for
  # every color scheme. Cancel the previous draft through its real UI first.
  if self.page.evaluate('typeof vb6Studio === "object"'):
   self.page.locator('.ide-dialog-footer').get_by_role('button',name='Cancel',exact=True).click()
   self.page.wait_for_selector('.ide-dialog',state='detached')
  else:
   self.load(self.page,ROOT/'dist/VB6-Studio-Web.html')
   self.page.wait_for_function('typeof vb6Studio === "object"')
   self.page.evaluate('globalThis.winuiFixtureIdentity={studio:vb6Studio,project:vb6Studio.project}')
  self.page.evaluate('t=>{Object.assign(vb6Studio.appearance,{theme:t,reduceMotion:true});vb6Studio.applyAppearance();void vb6Studio.command("options");}',theme)
  self.page.wait_for_selector('.ide-dialog')
  self.settle_document(self.page)
  self.assertTrue(self.page.evaluate('vb6Studio===winuiFixtureIdentity.studio&&vb6Studio.project===winuiFixtureIdentity.project'),'Theme changes must retain the IDE and project identities')
 def test_ide_dialog_command_brushes_density_and_disabled_precedence(self):
  for theme,r in RESOURCE.items():
   self.ide(theme)
   for accent in [False,True]:
    button=self.page.locator('.ide-dialog-footer').get_by_role('button',name='OK' if accent else 'Cancel',exact=True)
    self.park_pointer()
    self.expect_color(button,'backgroundColor',r['accent' if accent else 'fill'])
    self.expect_color(button,'color',r['accentInk' if accent else 'ink'])
    self.assertEqual(button.evaluate('e=>e.getBoundingClientRect().height'),32)
    self.assertEqual(self.css(button,'padding'),'5px 11px 6px')
    button.hover();self.expect_color(button,'backgroundColor',f'color-mix(in srgb, {r["accent"]} 90%, transparent)' if accent else r['hover'])
    self.page.mouse.down()
    try:
     self.expect_color(button,'backgroundColor',f'color-mix(in srgb, {r["accent"]} 80%, transparent)' if accent else r['pressed'])
     self.expect_color(button,'color',r['accentPressedInk' if accent else 'pressedInk'])
    finally:self.park_pointer();self.page.mouse.up()
    button.evaluate('e=>e.disabled=true')
    button.hover(force=True)
    self.expect_color(button,'backgroundColor',r['accentDisabled' if accent else 'disabled'])
    self.expect_color(button,'color',r['accentDisabledInk' if accent else 'disabledInk'])
    button.evaluate('e=>e.disabled=false')
    self.record(theme=theme,ide=True,accent=accent,controlHeight=32,states=['normal','hover','pressed','disabled-hover'])
   self.park_pointer();self.page.screenshot(path=str(REPORT/f'{theme}-ide-options.png'))
 def test_ide_check_and_radio_state_metrics_do_not_leak_into_designer(self):
  for theme,r in RESOURCE.items():
   self.ide(theme)
   check=self.page.locator('.ide-dialog input[type=checkbox]:visible').first
   check.uncheck();self.park_pointer()
   self.assertEqual(check.evaluate('e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height]'),[20,20])
   self.expect_color(check,'backgroundColor',r['check'])
   check.check();self.park_pointer();self.expect_color(check,'backgroundColor',r['accent'])
   self.assertEqual(check.evaluate('e=>[getComputedStyle(e,"::after").width,getComputedStyle(e,"::after").height]'),['12px','12px'])
   check.evaluate('e=>{e.checked=false;e.indeterminate=true;}')
   self.expect_color(check,'backgroundColor',r['accent'])
   self.assertEqual(check.evaluate('e=>[getComputedStyle(e,"::after").width,getComputedStyle(e,"::after").height]'),['12px','2px'])
   check.evaluate('e=>e.disabled=true');self.expect_color(check,'backgroundColor',r['accentDisabled'])
   self.assertEqual(check.evaluate('e=>getComputedStyle(e,"::after").backgroundColor'),self.color(r['accentDisabledInk']))
   root=self.page.locator('.designer-scroll')
   self.assertEqual(root.get_attribute('data-vb-theme'),'classic')
   self.assertEqual(root.evaluate('e=>getComputedStyle(e).getPropertyValue("--winui-CheckSize").trim()'),'')
   self.record(theme=theme,ideCheckSize=20,nestedClassicReset=True)
 def test_native_capture_samples_actual_png_at_fractional_display_scales(self):
  # Exercise the exact Electron smoke sampler in a browser, without Electron
  # IPC privileges. This tests PNG decoding/coordinate mapping, NOT WinUI goldens.
  functions=json.loads(subprocess.check_output(['node','-e',
   'const h=require("./desktop/smoke.cjs");console.log(JSON.stringify({oracle:h.nativePaintOracle.toString(),sample:h.sampleCapturedPng.toString()}))'],cwd=ROOT))
  for dpr in [1,1.25,2]:
   context=self.browser.new_context(viewport={'width':1440,'height':1700},device_scale_factor=dpr,reduced_motion='reduce')
   try:
    page=context.new_page();page.on('pageerror',lambda e:self.errors.append(str(e)))
    self.load(page,FIXTURE);page.wait_for_function('typeof vb6Application === "object"')
    # The smoke fixture names its TextBox Text1; reuse the real gallery control.
    page.locator('[data-control="TextBox1"]').evaluate('e=>e.dataset.control="Text1"')
    prior=None
    for theme in ['classic','standard','contrast','fluent','fluent-dark','macos26','macos26-dark','x11','x11-dark']:
     face=page.evaluate("""async t=>{
      vb6Application.setTheme(t,{reduceMotion:true});
      vb6Application.forms[0].draw('rect',[5,5,60,40],255,true);
      await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);
      return VB6Runtime.RuntimeAPI.THEMES[t].colors.face;
     }""",theme)
     oracle=page.evaluate(functions['oracle'],face)
     sample='args=>('+functions['sample']+')(args[0],args[1])'
     png=page.screenshot(animations='disabled');encoded=base64.b64encode(png).decode('ascii')
     points=page.evaluate(sample,[encoded,oracle])
     self.assertTrue(points);self.assertTrue(all(p['expected']==p['actual'] for p in points),str(points))
     if theme=='fluent-dark':
      # Negative proof: a previous Light frame must not pass the Dark oracle.
      stale=page.evaluate(sample,[prior,oracle])
      self.assertTrue(any(p['expected']!=p['actual'] for p in stale),'stale frame accepted')
      # A canvas can hide controls without changing their computed styles.
      page.locator('[data-control="Text1"]').evaluate('e=>{const c=document.createElement("div");c.id="occlude-input";c.style.cssText="position:absolute;inset:0;background:#ff00ff;z-index:99;pointer-events:none";e.append(c)}')
      covered=page.evaluate(sample,[base64.b64encode(page.screenshot(animations='disabled')).decode('ascii'),oracle])
      self.assertTrue(any(p['name']=='unobscured text control' and p['expected']!=p['actual'] for p in covered),'occluded input accepted')
      page.locator('#occlude-input').evaluate('e=>e.remove()')
     prior=encoded
     self.record(theme=theme,dpr=dpr,nativeSamplerExactPixels=True,nativeReference=False)
   finally:context.close()
 def test_fractional_dpi_border_captures_are_repeatable(self):
  for dpr in [1,1.25,1.5,2]:
   context=self.browser.new_context(viewport={'width':1440,'height':1700},device_scale_factor=dpr,reduced_motion='reduce')
   try:
    page=context.new_page();self.load(page,FIXTURE);page.wait_for_function('typeof vb6Application === "object"')
    for theme in RESOURCE:
     page.evaluate('t=>vb6Application.setTheme(t,{reduceMotion:true})',theme)
     button=page.locator('[data-control="CommandButton1"]')
     first=button.screenshot(animations='disabled');second=button.screenshot(animations='disabled')
     self.assertEqual(first,second,f'{theme} DPR {dpr}: repeat capture')
     (REPORT/f'{theme}-button-{dpr}.png').write_bytes(first)
     self.record(theme=theme,dpr=dpr,repeatCaptureIdentical=True,nativeReference=False)
   finally:context.close()

if __name__=='__main__':
 program=unittest.main(verbosity=2,exit=False)
 result=program.result
 # A test can pass its paint assertions but fail in teardown. Retain the actual
 # runner outcome, not just the per-state records written by the test bodies.
 REPORT.mkdir(parents=True,exist_ok=True)
 (REPORT/'results.json').write_text(json.dumps({
  'engine':ENGINE,'transport':TRANSPORT,'nativePixelCertification':False,
  'summary':{'successful':result.wasSuccessful(),'testsRun':result.testsRun,
   'failures':len(result.failures),'errors':len(result.errors),'skipped':len(result.skipped)},
  'failures':[{'test':str(test),'traceback':trace} for test,trace in result.failures],
  'errors':[{'test':str(test),'traceback':trace} for test,trace in result.errors],
  'cases':getattr(WinUI,'results',[])
 },indent=2))
 sys.exit(0 if result.wasSuccessful() else 1)
