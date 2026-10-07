"""Diagnostic only: no acceptance assertions, reference pixels or app styles are replaced."""
import functools,http.server,io,json,threading
from pathlib import Path
from PIL import Image,ImageChops
from playwright.sync_api import sync_playwright
root=Path.cwd();out=root/'reports/pr21-native-probe';out.mkdir(parents=True,exist_ok=True)
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=root));threading.Thread(target=server.serve_forever,daemon=True).start()
results=[]
def delta(a,b):
 a,b=(Image.open(io.BytesIO(x)).convert('RGB') for x in (a,b));d=ImageChops.difference(a,b);h=d.getbbox()
 return {'bounds':h,'changed':sum(bool(r or g or b) for r,g,b in d.getdata())}
try:
 with sync_playwright() as pw:
  flags=['--no-sandbox','--enable-gpu','--enable-unsafe-webgpu','--enable-unsafe-swiftshader','--use-angle=swiftshader','--use-vulkan=swiftshader','--disable-partial-raster','--run-all-compositor-stages-before-draw','--enable-features=Vulkan','--ignore-gpu-blocklist']
  browser=pw.chromium.launch(headless=False,args=flags,ignore_default_args=['--hide-scrollbars'])
  variants=[('control',''),('viewport-transform-hint','.designer-scroll{will-change:transform}'),('viewport-isolation','.designer-scroll{isolation:isolate}'),('window-transform-hint','.mdi-window{will-change:transform}'),('viewport-transform','.designer-scroll{transform:translateZ(0)}'),('viewport-paint','.designer-scroll{contain:paint}')]
  for name,css in variants:
   page=browser.new_page(viewport={'width':1280,'height':800},device_scale_factor=1.25)
   page.goto(f'http://127.0.0.1:{server.server_port}/dist/VB6-Studio-Web.html');page.wait_for_function('window.vb6Studio?.rendering');page.evaluate('vb6Studio.rendering.ready');page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})')
   if css:page.add_style_tag(content=css)
   for theme in ['fluent','fluent-dark','macos26','macos26-dark','x11','x11-dark']:
    page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})');page.evaluate('theme=>{Object.assign(vb6Studio.appearance,{theme,reduceMotion:true});vb6Studio.applyAppearance();}',theme)
    for backend in ['html','canvas2d','webgpu']:
     page.evaluate('backend=>vb6Studio.setRenderingPolicy({backend,fallbacks:["html"],text:"native"})',backend)
     prior=None;diffs=[]
     for i in range(6):
      page.evaluate('async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')
      image=page.screenshot(caret='initial')
      if prior is not None:diffs.append(delta(prior,image))
      if i in [4,5]:(out/f'{name}-{theme}-{backend}-{i}.png').write_bytes(image)
      prior=image
     entry={'variant':name,'theme':theme,'backend':backend,'actual':page.evaluate('vb6Studio.rendering.backend'),'diffs':diffs}
     results.append(entry);print(json.dumps(entry),flush=True)
   page.context.close()
  browser.close()
finally:
 (out/'report.json').write_text(json.dumps(results,indent=2));server.shutdown()
