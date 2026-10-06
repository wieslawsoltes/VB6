#!/usr/bin/env python3
"""GDI boundary contracts using real Canvas, window hit testing and GPU readback.
Local offline mode is explicit; release CI never enables it or skips a case.
"""
import json, os, shutil, threading
from pathlib import Path
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/win32-boundaries';REPORT.mkdir(parents=True,exist_ok=True)
OFFLINE=os.environ.get('VB6_OFFLINE')=='1';GPU=os.environ.get('VB6_REQUIRE_GPU')=='1'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}';results=[]
# Package/SDK probes need an origin, not the IDE and its diagnostics workers.
# Full IDE lifecycle coverage remains in the compatibility/services suites.
PROBE_HOST='/tests/fixtures/win32-boundaries-host.html'
def check(ok,message):
    if not ok: raise AssertionError(message)
GPU_PROBE=r'''async()=>{
 const api=await import('/packages/win32-browser/src/index.js');
 if(!navigator.gpu)throw new Error('Required WebGPU API missing');
 const adapter=await navigator.gpu.requestAdapter();if(!adapter)throw new Error('Required WebGPU adapter missing');
 const device=await adapter.requestDevice(),errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const presenter=await api.GPURasterPresenter.create(device,'rgba8unorm');
 const source=document.createElement('canvas');source.width=8;source.height=4;const c=source.getContext('2d');
 c.fillStyle='rgb(255,0,0)';c.fillRect(0,0,4,4);c.fillStyle='rgb(0,255,0)';c.fillRect(4,0,4,4);
 let target=device.createTexture({size:[16,8],format:'rgba8unorm',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
 const context={getCurrentTexture:()=>target};
 const read=async(width,height)=>{
   const buffer=device.createBuffer({size:256*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
   try{const encoder=device.createCommandEncoder();encoder.copyTextureToBuffer({texture:target},{buffer,bytesPerRow:256},[width,height]);device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);return new Uint8Array(buffer.getMappedRange()).slice();}finally{buffer.destroy();}
 };
 const check=(ok,message)=>{if(!ok)throw new Error(message);};
 try{
   device.pushErrorScope('validation');presenter.render(context,source,1,16,8);const texture=presenter.texture,first=await read(16,8);
   for(let y=0;y<8;y++)for(let x=0;x<16;x++){const p=y*256+x*4;check(first[p]===(x<8?255:0)&&first[p+1]===(x<8?0:255)&&first[p+2]===0&&first[p+3]===255,'GPU high-DPI texel mismatch');}
   presenter.render(context,source,1,16,8);check(presenter.texture===texture,'unchanged texture was reallocated');
   source.width=4;source.height=4;c.fillStyle='rgb(0,0,255)';c.fillRect(0,0,4,4);presenter.render(context,source,2,16,8);check(presenter.texture!==texture,'resize did not replace texture');
   const resized=await read(16,8);check(resized[2]===255&&resized[0]===0,'resized upload');
   const validation=await device.popErrorScope();check(!validation,validation?.message);await device.queue.onSubmittedWorkDone();check(errors.length===0,errors.join('\n'));
   return {case:'webgpu-real-texture-readback',passed:true,adapter:adapter.info?.description||adapter.info?.device||'WebGPU adapter',validatedPixels:128};
 }finally{presenter.dispose();target.destroy();device.destroy();check(presenter.device===null,'presenter not disposed');}
}'''
PAINT_PROBE=r'''async project=>{
 const api=globalThis.VB6Runtime||await import('/src/runtime/entry.js');
 project=structuredClone(project);project.modules[0].code=`Option Explicit
 Private Type RECT
   l As Long
   t As Long
   r As Long
   b As Long
 End Type
 Private Type PAINTSTRUCT
   hdc As Long
   erase As Long
   area As RECT
   restore As Long
   update As Long
   reserved(0 To 31) As Byte
 End Type
 Private count As Long
 Private Declare Function InvalidateRect Lib "user32" (ByVal hwnd As Long, ByVal rect As Long, ByVal erase As Long) As Long
 Private Declare Function UpdateWindow Lib "user32" (ByVal hwnd As Long) As Long
 Private Declare Function BeginPaint Lib "user32" (ByVal hwnd As Long, ps As PAINTSTRUCT) As Long
 Private Declare Function EndPaint Lib "user32" (ByVal hwnd As Long, ps As PAINTSTRUCT) As Long
 Private Declare Function SetPixel Lib "gdi32" (ByVal dc As Long, ByVal x As Long, ByVal y As Long, ByVal color As Long) As Long
 Private Sub Form_Load()
   InvalidateRect picCanvas.hWnd, 0, 1
   UpdateWindow picCanvas.hWnd
 End Sub
 Private Sub picCanvas_Paint()
   Dim ps As PAINTSTRUCT, dc As Long
   dc = BeginPaint(picCanvas.hWnd, ps)
   If dc = 0 Then Err.Raise 5, , "BeginPaint failed"
   SetPixel dc, 4, 4, RGB(255, 0, 0)
   If EndPaint(picCanvas.hWnd, ps) = 0 Then Err.Raise 5, , "EndPaint failed"
   count = count + 1
   lblStatus.Caption = "Paint count: " & CStr(count)
 End Sub`;
 const mount=document.createElement('div');document.body.replaceChildren(mount);
 const host=await api.mountApplication(project,mount,{persist:false,graphics:'canvas2d'});
 try{
   await new Promise((resolve,reject)=>{let tries=0;const tick=()=>{if(host.vm.lastError)return reject(new Error(host.vm.lastError.message));if(!host.vm.processing&&host.forms[0].controlMap.get('lblstatus').Caption==='Paint count: 1')return resolve();if(++tries>200)return reject(new Error('Queued VB Paint did not finish '+JSON.stringify({caption:host.forms[0].controlMap.get('lblstatus').Caption,state:host.vm.state,processing:host.vm.processing,stack:host.vm.stack.length,events:host.vm.eventQueue.length,update:host.vm.win32?.api.handles.entries.size,window:host.vm.win32?.api.handles.get(host.forms[0].controlMap.get('piccanvas').hWnd,'window').gdiPaint,rect:host.forms[0].controlMap.get('piccanvas').node.getBoundingClientRect().toJSON(),client:host.vm.win32?.api.handles.get(host.forms[0].controlMap.get('piccanvas').hWnd,'window').getClientRect(),last:host.vm.win32?.api.lastError})));setTimeout(tick,10);};tick();});
   const c=host.forms[0].controlMap.get('piccanvas'),w=host.vm.win32.api,pixel=Array.from(c.surface.readPixels(4,4,1,1).data);
   if(pixel.join(',')!=='255,0,0,255'||w.memory.used!==0||[...w.handles.entries.values()].some(e=>e.type==='dc'))throw new Error('VB Paint pixels/marshalling cleanup failed');
   return {case:'vb6-paint-event-and-paintstruct',passed:true,pixel,memory:w.memory.used};
 }finally{host.dispose();mount.remove();}
}'''
try:
 with sync_playwright() as pw:
    name=os.environ.get('VB6_BROWSER','chromium');kwargs={'headless':True}
    if name=='chromium':
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
        if executable: kwargs['executable_path']=executable
        kwargs['args']=['--no-sandbox','--disable-dev-shm-usage']
        if GPU: kwargs['args']+=['--enable-unsafe-webgpu','--use-angle=swiftshader','--enable-features=Vulkan','--use-vulkan=swiftshader']
    browser=getattr(pw,name).launch(**kwargs);errors=[]
    page=browser.new_page(viewport={'width':1100,'height':760});page.set_default_timeout(10000)
    page.on('pageerror',lambda e:errors.append(str(e)))
    if GPU:
        check(not OFFLINE,'GPU validation requires secure HTTP origin; do not mark offline results GPU-certified')
        page.goto(base+PROBE_HOST);results.append(page.evaluate(GPU_PROBE))
        page.goto(base+'/dist/examples/win32.html');page.wait_for_function('vb6Application?.vm?.state === "running"')
        page.wait_for_function('document.querySelector(\'[data-control="txtValue"] input\')?.value === "Hello from kernel32 and user32!"')
        page.locator('[data-control="cmdAdvanced"]').click()
        page.wait_for_function('vb6Application.forms[0].controlMap.get("lblstatus").Caption.startsWith("Affine path")')
        page.wait_for_function('vb6Application.forms[0].controlMap.get("piccanvas").surface.renderingBackend === "WebGPU · GDI texture"')
        result=page.evaluate(r'''async()=>{
          const s=vb6Application.forms[0].controlMap.get('piccanvas').surface,d=s.device;
          await s.rasterPending;s.render();const tex=s.gpuContext.getCurrentTexture();
          const row=Math.ceil(s.gpuCanvas.width*4/256)*256,buffer=d.createBuffer({size:row*s.gpuCanvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
          const e=d.createCommandEncoder();e.copyTextureToBuffer({texture:tex},{buffer,bytesPerRow:row},[s.gpuCanvas.width,s.gpuCanvas.height]);d.queue.submit([e.finish()]);await buffer.mapAsync(GPUMapMode.READ);
          const raw=new Uint8Array(buffer.getMappedRange()).slice(),i=20*row+30*4,logical=Array.from(s.readPixels(30,20,1,1).data),shown=Array.from(raw.slice(i,i+4));if(s.gpuFormat.startsWith('bgra'))[shown[0],shown[2]]=[shown[2],shown[0]];buffer.destroy();if(shown.join(',')!==logical.join(','))throw new Error('Actual GPU canvas mismatch');
          const presenter=s.rasterPresenter;s.clear();if(presenter.device!==null)throw new Error('Cls leaked GDI GPU resources');return {case:'exported-vb6-gpu-presentation',passed:true,logical,shown};
        }''');results.append(result)
        page.screenshot(path=str(REPORT/'gpu-export.png'))
    else:
      for scale in [1,2]:
        context=browser.new_context(device_scale_factor=scale);probe=context.new_page()
        probe.on('pageerror',lambda e:errors.append(str(e)))
        if OFFLINE: probe.set_content('<!doctype html><body>')
        else: probe.goto(base+PROBE_HOST)
        probe.add_script_tag(content=(ROOT/'dist/win32-browser.js').read_text());probe.add_script_tag(content=(ROOT/'tests/fixtures/win32-advanced-browser.js').read_text())
        result=probe.evaluate('runWin32BoundaryProbe(Win32Compat)');results.extend({**r,'scale':scale} for r in result['results']);context.close()
      for mode in ['http','file']:
        if OFFLINE and mode=='file': results.append({'case':'export-file','skipped':True,'reason':'Local navigation policy; release CI requires this case'});continue
        if OFFLINE: page.set_content((ROOT/'dist/examples/win32.html').read_text())
        else: page.goto(base+'/dist/examples/win32.html' if mode=='http' else (ROOT/'dist/examples/win32.html').as_uri())
        page.wait_for_function('document.querySelector(\'[data-control="txtValue"] input\')?.value === "Hello from kernel32 and user32!"')
        for _ in range(3):
          page.locator('[data-control="cmdAdvanced"]').click();page.wait_for_function('!vb6Application.vm.processing && vb6Application.vm.stack.length===0')
          value=page.evaluate('''()=>{const c=vb6Application.forms[0].controlMap,s=c.get('piccanvas').surface,w=vb6Application.vm.win32.api;return {caption:c.get('lblstatus').Caption,memory:w.memory.used,commands:s?.commands.length,live:[...w.handles.entries.values()].filter(e=>['dc','bitmap','region'].includes(e.type)).length,pixel:Array.from(s.readPixels(30,20,1,1).data)}}''')
          check(value['caption'].startswith('Affine path') and value['memory']==0 and value['commands']==1 and value['live']==0 and value['pixel']==[224,240,255,255],str(value))
        results.append({'case':'vb6-paths-fonts-export-'+mode,'passed':True});page.screenshot(path=str(REPORT/('export-'+mode+'.png')))
      if OFFLINE:
        page.set_content('<!doctype html><body>');page.add_script_tag(content=(ROOT/'dist/vb6-runtime.js').read_text())
      else: page.goto(base+PROBE_HOST)
      project=json.loads((ROOT/'examples/win32.vb6web').read_text());results.append(page.evaluate(PAINT_PROBE,project))
      if not OFFLINE:
        page.goto(base+PROBE_HOST)
        worker=page.evaluate(r'''()=>new Promise((resolve,reject)=>{
          const code=`import {createWin32} from '${location.origin}/packages/win32-browser/src/index.js';const w=createWin32();try{const g=(n,...a)=>w.invoke('gdi32',n,a),d=g('CreateCompatibleDC',0),b=g('CreateBitmap',128,32,1,32,0),old=g('SelectObject',d,b);g('SetTextColor',d,16777215);const rendered=g('TextOutW',d,0,0,'Worker',6),entry=w.handles.get(b,'bitmap'),data=w.memory.bytes(entry.ptr,entry.size);const visible=data.some((x,i)=>i%4!==3&&x);g('SelectObject',d,old);g('DeleteObject',b);g('DeleteDC',d);postMessage({rendered,visible,memory:w.memory.used});}finally{w.dispose();}`;
          const url=URL.createObjectURL(new Blob([code],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});
          const end=()=>{worker.terminate();URL.revokeObjectURL(url);};worker.onmessage=e=>{end();resolve(e.data);};worker.onerror=e=>{end();reject(new Error(e.message));};
        })''')
        check(worker=={'rendered':1,'visible':True,'memory':0},str(worker));results.append({'case':'worker-offscreen-font-rendering','passed':True})
      else: results.append({'case':'worker-offscreen-font-rendering','skipped':True,'reason':'Local navigation policy; release CI requires this case'})
    check(not errors,str(errors));browser.close()
finally:
 server.shutdown();(REPORT/'results.json').write_text(json.dumps(results,indent=2)+'\n')
print(json.dumps(results,indent=2))
