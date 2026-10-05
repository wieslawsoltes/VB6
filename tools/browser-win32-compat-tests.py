#!/usr/bin/env python3
"""Real browser tests for the standalone package, exported app, SDK and classic IDE."""
import json, os, shutil, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/win32-browser'
REPORT.mkdir(parents=True, exist_ok=True)
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        # A real HTML origin for SDK/import/worker checks. Extensionless files
        # such as LICENSE are application/octet-stream and start a download.
        if self.path == '/__win32-test-host.html':
            body = b'<!doctype html><html><head><meta charset="utf-8"><title>Win32 package host</title></head><body></body></html>'
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()
server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
threading.Thread(target=server.serve_forever, daemon=True).start()
base = f'http://127.0.0.1:{server.server_port}'
OFFLINE=os.environ.get("VB6_OFFLINE")=="1"
results=[]
GDI_PROBE="(library)=>{const w=library.createWin32(),m=w.memory,call=(name,...a)=>w.invoke('gdi32',name,a);\nconst header=m.alloc(40),out=m.alloc(4),v=m.view(header,40);v.setUint32(0,40,true);v.setInt32(4,2,true);v.setInt32(8,-1,true);v.setUint16(12,1,true);v.setUint16(14,32,true);\nconst bitmap=call('CreateDIBSection',0,header,0,out,0,0),bits=m.readU32(out);m.bytes(bits,8).set([0,0,128,128,200,0,0,255]);\nconst dc=call('CreateCompatibleDC',0),old=call('SelectObject',dc,bitmap);\nconst alpha=w.invoke('msimg32','AlphaBlend',[dc,1,0,1,1,dc,0,0,1,1,0x01ff0000]);\nconst result={alpha,pixel:call('GetPixel',dc,1,0),bytes:Array.from(m.bytes(bits+4,4)),exports:w.manifest().length};\ncall('SelectObject',dc,old);call('DeleteObject',bitmap);call('DeleteDC',dc);m.free(header);m.free(out);result.remaining=m.used;w.dispose();return result;}"
REGION_PROBE="(library)=>{\n const w=library.createWin32(),m=w.memory,g=(n,...a)=>w.invoke('gdi32',n,a);\n try{\n  const info=m.alloc(40),out=m.alloc(4),v=m.view(info,40);v.setUint32(0,40,true);v.setInt32(4,8,true);v.setInt32(8,-8,true);v.setUint16(12,1,true);v.setUint16(14,32,true);\n  const bitmap=g('CreateDIBSection',0,info,0,out,0,0),bits=m.readU32(out),dc=g('CreateCompatibleDC',0),old=g('SelectObject',dc,bitmap);\n  const a=g('CreateRectRgn',0,0,8,8),b=g('CreateRectRgn',2,2,6,6);g('CombineRgn',a,a,b,4);const selected=g('SelectClipRgn',dc,a);g('DeleteObject',a);g('DeleteObject',b);\n  const brush=g('CreateSolidBrush',0xc08020),oldBrush=g('SelectObject',dc,brush),paint=g('PatBlt',dc,0,0,8,8,0xf00021);\n  const result={selected,paint,inside:g('GetPixel',dc,0,0),hole:Array.from(m.bytes(bits+(3*8+3)*4,4)),regions:[...w.handles.entries.values()].filter(e=>e.type==='region').length};\n  g('SelectObject',dc,oldBrush);g('DeleteObject',brush);g('SelectObject',dc,old);g('DeleteObject',bitmap);g('DeleteDC',dc);m.free(info);m.free(out);result.memory=m.used;return result;\n }finally{w.dispose();}\n}"
def check(value, message):
    if not value:
        raise AssertionError(message)

def click_control(page, name):
    page.locator(f'[data-control="{name}"]').click()
    # Declare buffers can be zero between awaited VB statements. Observe the
    # entire input/procedure queue draining before checking retained resources.
    page.wait_for_function("""()=>{const v=vb6Application.vm;return !v.processing && v.stack.length===0 && v.eventQueue.length===0;}""")

DISPLAYED_PIXELS="""async(s,points)=>{
  if(s.rasterPending)await s.rasterPending;s.render();
  const dpr=devicePixelRatio||1;
  if(s.renderingBackend!=='WebGPU · GDI texture'){
    const ctx=s.canvas.getContext('2d');return points.map(([x,y])=>Array.from(ctx.getImageData(Math.floor(x*dpr),Math.floor(y*dpr),1,1).data));
  }
  const device=s.device,row=Math.ceil(s.gpuCanvas.width*4/256)*256,buffer=device.createBuffer({size:row*s.gpuCanvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{const e=device.createCommandEncoder();e.copyTextureToBuffer({texture:s.gpuContext.getCurrentTexture()},{buffer,bytesPerRow:row},[s.gpuCanvas.width,s.gpuCanvas.height]);device.queue.submit([e.finish()]);await buffer.mapAsync(GPUMapMode.READ);const bytes=new Uint8Array(buffer.getMappedRange());return points.map(([x,y])=>{const i=Math.floor(y*dpr)*row+Math.floor(x*dpr)*4,pixel=Array.from(bytes.slice(i,i+4));if(s.gpuFormat.startsWith('bgra'))[pixel[0],pixel[2]]=[pixel[2],pixel[0]];return pixel;});}finally{buffer.destroy();}
}"""

def verify_app(page):
    page.wait_for_function('globalThis.vb6Application?.vm?.state === "running"')
    page.evaluate('source=>globalThis.win32DisplayedPixels=eval("("+source+")")',DISPLAYED_PIXELS)
    # VM state becomes running before asynchronous Form_Load has finished.
    # Wait for its observable output, not a fixed delay or only the VM state.
    page.wait_for_function('''vb6Application.vm.lastError || document.querySelector('[data-control="txtValue"] input')?.value === "Hello from kernel32 and user32!"''')
    check(page.evaluate('vb6Application.vm.lastError?.message || null') is None, 'Runtime error')
    check(page.locator('[data-control="txtValue"] input').input_value() == 'Hello from kernel32 and user32!', 'INI output buffer did not reach textbox')
    click_control(page, 'cmdText')
    page.wait_for_function('vb6Application.forms[0].controlMap.get("txtvalue").Text === "Text changed by user32.SetWindowTextA"')
    click_control(page, 'cmdToggle')
    page.wait_for_function('vb6Application.forms[0].controlMap.get("txtvalue").Enabled === 0')
    click_control(page, 'cmdToggle')
    page.wait_for_function('vb6Application.forms[0].controlMap.get("txtvalue").Enabled !== 0')
    click_control(page, 'cmdDraw')
    page.wait_for_function('vb6Application.forms[0].controlMap.get("piccanvas").surface?.commands.length === 2')
    check(page.evaluate('vb6Application.win32 === undefined'), 'Unexpected host-global compatibility state')
    check(page.evaluate('vb6Application.vm.win32.api.memory.used') == 0, 'Transient Declare memory leaked')
    check(page.evaluate('vb6Application.vm.lastError?.message || null') is None, 'GDI or window operation failed')
    # Drawn surface pixel in Canvas2D fallback or GPU screenshot: preserve commands.
    check(page.evaluate('vb6Application.forms[0].controlMap.get("piccanvas").surface.commands[0].color') == 11829830, 'COLORREF changed')

    click_control(page, 'cmdBitmap')
    page.wait_for_function('vb6Application.forms[0].controlMap.get("lblstatus").Caption.startsWith("Writable DIB")')
    page.wait_for_function('vb6Application.vm.win32.api.memory.used === 0')
    raster=page.evaluate("""async()=>{
      const c=vb6Application.forms[0].controlMap.get('piccanvas'),s=c.surface,w=vb6Application.vm.win32.api;
      s.render();const points=[[20,20],[300,20],[20,70],[300,70]];
      const pixels=points.map(([x,y])=>Array.from(s.readPixels(x,y,1,1).data));
      const first=c.hDC,second=c.hDC,readOnly=!Reflect.set(c,'hDC',7);
      w.invoke('user32','ReleaseDC',[c.hWnd,first]);const replacement=c.hDC;
      w.invoke('user32','ReleaseDC',[c.hWnd,replacement]);
      const displayed=await win32DisplayedPixels(s,points);
      return {pixels,displayed,readOnly,stable:first===second,recreated:first!==replacement,
        memory:w.memory.used,bitmapCount:[...w.handles.entries.values()].filter(e=>e.type==='bitmap').length,
        commandCount:s.commands.length,backend:vb6Application.backend};
    }""")
    colors=[[255,0,0,255],[0,255,0,255],[0,0,255,255],[255,255,255,255]]
    check(raster['pixels']==colors and raster['displayed']==colors,'DIB/window pixel mismatch: '+str(raster))
    check(raster['readOnly'] and raster['stable'] and raster['recreated'],'hDC lifetime/read-only failure: '+str(raster))
    check(raster['memory']==0 and raster['bitmapCount']==0,'Bitmap resources leaked: '+str(raster))
    # Repeated same-region writes must coalesce instead of retaining frames forever.
    for _ in range(3):
        click_control(page, 'cmdBitmap')
        page.wait_for_function('vb6Application.vm.win32.api.memory.used === 0')
    check(page.evaluate('vb6Application.forms[0].controlMap.get("piccanvas").surface.commands.length')==raster['commandCount'],'Bitmap repaint command growth')
    check(page.evaluate('vb6Application.vm.lastError?.message || null') is None,'Bitmap declarations failed')

    click_control(page, 'cmdRegions')
    page.wait_for_function('vb6Application.forms[0].controlMap.get("lblstatus").Caption.startsWith("Complex region:")')
    page.wait_for_function('vb6Application.vm.win32.api.memory.used === 0')
    def region_pixels():
        return page.evaluate("""async()=>{
          const s=vb6Application.forms[0].controlMap.get('piccanvas').surface,w=vb6Application.vm.win32.api;s.render();
          const points=[[20,20],[200,40],[480,20]],d=devicePixelRatio||1,ctx=s.canvas.getContext('2d');
          return {logical:points.map(([x,y])=>Array.from(s.readPixels(x,y,1,1).data)),
            displayed:await win32DisplayedPixels(s,points),
            regions:[...w.handles.entries.values()].filter(e=>e.type==='region').length,memory:w.memory.used,
            commands:s.commands.length,caption:vb6Application.forms[0].controlMap.get('lblstatus').Caption};
        }""")
    region=region_pixels()
    expected=[[32,128,192,255],[255,255,255,255],[255,255,255,255]]
    check(region['logical']==expected and region['displayed']==expected,'Complex clip pixels: '+str(region))
    check(region['regions']==0 and region['memory']==0 and '96 bytes' in region['caption'],'Region resource lifetime: '+str(region))
    for _ in range(3):
        click_control(page, 'cmdRegions')
        page.wait_for_function('vb6Application.vm.win32.api.memory.used === 0')
    again=region_pixels()
    check(again==region,'Repeated region repaint changed pixels or leaked retained commands: '+str(again))

try:
    with sync_playwright() as p:
        name=os.environ.get('VB6_BROWSER','chromium')
        browser_type=getattr(p,name)
        kwargs={'headless':True}
        if name=='chromium':
            executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if executable: kwargs['executable_path']=executable
            kwargs['args']=['--no-sandbox','--disable-dev-shm-usage']
        browser=browser_type.launch(**kwargs)
        page=browser.new_page(viewport={'width':1100,'height':760})
        page.set_default_timeout(6000)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        for mode,url in [('export-http',base+'/dist/examples/win32.html'),('export-file',(ROOT/'dist/examples/win32.html').as_uri())]:
            if OFFLINE and mode=='export-file':
                results.append({'case':mode,'skipped':True,'reason':'Local file navigation disabled by browser policy; tested in CI.'})
                continue
            if OFFLINE and mode=='export-http':
                mode='export-inline-offline'
                page.set_content((ROOT/'dist/examples/win32.html').read_text())
            else:
                page.goto(url)
            verify_app(page)
            page.screenshot(path=str(REPORT/(mode+'.png')))
            check(not errors,str(errors))
            results.append({'case':mode,'passed':True})
        if OFFLINE:
            page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text())
        else:
            page.goto(base+'/dist/index.html')
        page.wait_for_function('globalThis.vb6Studio')
        project=json.loads((ROOT/'examples/win32.vb6web').read_text())
        page.evaluate('project=>vb6Studio.loadProject(project)',project)
        page.locator('[data-command="run"]').first.click()
        page.wait_for_function('vb6Studio.runState !== "design"')
        frame=page.frames[1]
        verify_app(frame)
        page.screenshot(path=str(REPORT/'ide-win32.png'))
        page.locator('[data-command="stop"]').first.click()
        page.wait_for_function('vb6Studio.runState === "design"')
        check(not errors,str(errors))
        results.append({'case':'classic-ide-run-stop','passed':True})
        if OFFLINE:
            page.set_content('<html><body></body></html>')
            page.add_script_tag(content=(ROOT/'dist/win32-browser.js').read_text())
        else:
            page.goto(base+'/__win32-test-host.html')
            page.add_script_tag(url=base+'/dist/win32-browser.js')
        state=page.evaluate('''async()=>{const w=Win32Compat.createWin32();const p=w.memory.alloc(16);w.memory.putString(p,'€',16);const result={exports:w.manifest().length,text:w.memory.string(p)};w.dispose();return result;}''')
        check(state['text']=='€' and state['exports']>=230,'Standalone global bundle failed')
        results.append({'case':'independent-global-bundle','passed':True,**state})
        raster=page.evaluate('('+GDI_PROBE+')(Win32Compat)')
        check(raster['alpha']==1 and raster['bytes']==[100,0,128,255] and raster['remaining']==0,'Global bitmap probe failed: '+str(raster))
        results.append({'case':'global-dib-alpha-blend','passed':True,**raster})
        region=page.evaluate('('+REGION_PROBE+')(Win32Compat)')
        check(region=={'selected':3,'paint':1,'inside':12615712,'hole':[0,0,0,0],'regions':0,'memory':0},'Global region probe: '+str(region))
        results.append({'case':'global-complex-regions','passed':True,**region})
        if not OFFLINE:
            state=page.evaluate('''async()=>{const api=await import('/src/runtime/entry.js');const project=await (await fetch('/examples/win32.vb6web')).json();document.body.replaceChildren();const host=await api.mountApplication(project,document.body,{persist:false});await host.vm.dispatch(host.forms[0].instance,'cmdBitmap_Click',[]);const c=host.forms[0].controlMap.get('piccanvas');await host.vm.dispatch(host.forms[0].instance,'cmdRegions_Click',[]);const result={regionPixel:Array.from(c.surface.readPixels(200,40,1,1).data),state:host.vm.state,handle:host.forms[0].hWnd,pixel:Array.from(c.surface.readPixels(20,20,1,1).data),error:host.vm.lastError?.message||null};host.dispose();return result;}''')
            check(state['state']=='running' and state['handle']>0 and state['error'] is None and state['pixel']==[32,128,192,255] and state['regionPixel']==[255,255,255,255],'ESM SDK integration failed: '+str(state))
            results.append({'case':'modular-runtime-sdk','passed':True})
            state=page.evaluate('''()=>new Promise((resolve,reject)=>{const source="import {createWin32} from '"+location.origin+"/packages/win32-browser/src/index.js';const w=createWin32();postMessage(w.invoke('kernel32','MulDiv',[7,3,2]));w.dispose();";const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));const worker=new Worker(url,{type:'module'});worker.onmessage=e=>{worker.terminate();URL.revokeObjectURL(url);resolve(e.data);};worker.onerror=e=>{worker.terminate();URL.revokeObjectURL(url);reject(new Error(e.message));};})''')
            check(state==11,'Worker-compatible package failed')
            raster=page.evaluate('''probe=>new Promise((resolve,reject)=>{const source="import {createWin32} from '"+location.origin+"/packages/win32-browser/src/index.js';postMessage(("+probe+")({createWin32}));";const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});worker.onmessage=e=>{worker.terminate();URL.revokeObjectURL(url);resolve(e.data);};worker.onerror=e=>{worker.terminate();URL.revokeObjectURL(url);reject(new Error(e.message));};})''',GDI_PROBE)
            check(raster['alpha']==1 and raster['bytes']==[100,0,128,255] and raster['remaining']==0,'Worker bitmap probe failed: '+str(raster))
            results.append({'case':'worker-dib-alpha-blend','passed':True,**raster})
            results.append({'case':'module-worker','passed':True})
            region=page.evaluate('''probe=>new Promise((resolve,reject)=>{const source="import {createWin32} from '"+location.origin+"/packages/win32-browser/src/index.js';postMessage(("+probe+")({createWin32}));";const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});worker.onmessage=e=>{worker.terminate();URL.revokeObjectURL(url);resolve(e.data);};worker.onerror=e=>{worker.terminate();URL.revokeObjectURL(url);reject(new Error(e.message));};})''',REGION_PROBE)
            check(region=={'selected':3,'paint':1,'inside':12615712,'hole':[0,0,0,0],'regions':0,'memory':0},'Worker region probe: '+str(region))
            results.append({'case':'worker-complex-regions','passed':True,**region})

        else:
            results.append({'case':'modular-runtime-sdk-and-module-worker','skipped':True,'reason':'Local HTTP navigation is disabled by browser policy; tested in CI.'})
        high=browser.new_context(device_scale_factor=2,viewport={'width':1100,'height':760})
        hp=high.new_page();hp.set_default_timeout(6000);hp.on('pageerror',lambda error:errors.append(str(error)))
        if OFFLINE: hp.set_content((ROOT/'dist/examples/win32.html').read_text())
        else: hp.goto(base+'/dist/examples/win32.html')
        verify_app(hp);hp.screenshot(path=str(REPORT/'regions-dpr2.png'));high.close()
        results.append({'case':'regions-dpr2-export','passed':True})
        check(not errors,str(errors))
        browser.close()
finally:
    server.shutdown()
    (REPORT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
