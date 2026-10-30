#!/usr/bin/env python3
"""Disabled-browser regression and exact Canvas2D state-reuse oracle.

The negative profile really disables browser GPU APIs; it does not mock adapters
or waive the separate required-GPU acceptance suite. Timings are CPU-only local
submission samples, not physical-device performance or presentation latency.
"""
import argparse, functools, http.server, json, os, shutil, threading, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/rendering/disabled'
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--headed', action='store_true')
parser.add_argument('--offline', action='store_true', help='Inline bundles; report the missing secure-context coverage explicitly')
args = parser.parse_args()
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
threading.Thread(target=server.serve_forever, daemon=True).start()
url = f'http://127.0.0.1:{server.server_port}/'
# Negative-test flags only. Never injected into a deployed IDE or host.
flags = ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--use-gl=disabled']
results = []
def check(value, message):
    if not value: raise AssertionError(message)
def load(page, ide=False):
    if args.offline: page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text() if ide else '<!doctype html><body></body>')
    else: page.goto(url+('dist/VB6-Studio-Web.html' if ide else 'tests/fixtures/rendering.html'))
    page.add_script_tag(content=(ROOT/'dist/vb6-rendering.js').read_text())

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or p.chromium.executable_path,
        headless=not args.headed, args=flags, ignore_default_args=['--hide-scrollbars'])
    def case(name, action):
        context=browser.new_context(viewport={'width':1280,'height':1000},accept_downloads=True)
        page=context.new_page();errors=[]
        page.on('pageerror',lambda error: errors.append(str(error)))
        try:
            details=action(page);check(not errors,str(errors))
            results.append({'name':name,'passed':True,'details':details});print('PASS',name,flush=True)
        except Exception as error:
            results.append({'name':name,'passed':False,'error':str(error)});traceback.print_exc();print('FAIL',name,flush=True)
        finally: context.close()
    def disabled_apis(page):
        load(page)
        details=page.evaluate('''async()=>{
          const {WebGPUPainter,WebGLPainter}=VB6Rendering, result={secureContext:isSecureContext,webgpuAPI:!!navigator.gpu};
          for(const [name,Painter] of [['webgpu',WebGPUPainter],['webgl2',WebGLPainter]]) {
            const canvas=document.createElement('canvas');let painter;
            try {painter=name==='webgpu'?await Painter.create(canvas):new Painter(canvas);throw Error('Disabled API unexpectedly succeeded');}
            catch(error){if(error.message==='Disabled API unexpectedly succeeded')throw error;result[name]={code:error.code,reason:error.message,attempts:error.attempts};}
            finally{painter?.dispose();}
          }
          return result;
        }''')
        check(details['webgl2']['code']=='BROWSER_GRAPHICS_DISABLED',str(details))
        check(len(details['webgl2']['attempts'])==1,'power hints retried after disabled GL proof')
        if not args.offline:
            check(details['secureContext'] and details['webgpuAPI'],'HTTP test must reproduce exposed but unusable WebGPU API')
            check(details['webgpu']['code']=='WEBGPU_ACQUISITION_FAILED',str(details))
            check(len(details['webgpu']['attempts'])==4,'all adapter options must actually fail')
        return details
    case('real browser-disabled WebGPU and WebGL2 are not advertised as working',disabled_apis)

    def canvas_pixels(page):
        load(page)
        return page.evaluate('''()=>{
          const {PaintScene,CanvasPainter}=VB6Rendering;
          // Independent one-command-at-a-time Canvas contract. No run caching,
          // shared color state or reuse of the implementation being tested.
          function reference(canvas,scene){
            const w=Math.round(scene.width*scene.dpr),h=Math.round(scene.height*scene.dpr);
            if(canvas.width!==w)canvas.width=w;if(canvas.height!==h)canvas.height=h;const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,w,h);ctx.setTransform(w/scene.width,0,0,h/scene.height,0,0);ctx.imageSmoothingEnabled=false;
            const css=c=>`rgba(${c[0]*255},${c[1]*255},${c[2]*255},${c[3]})`;
            for(const c of scene.commands){ctx.save();ctx.beginPath();ctx.rect(...c.clip);ctx.clip();
              if(c.hole)ctx.clearRect(...c.rect);
              else if(c.page)ctx.drawImage(c.page.canvas,c.uv[0]*c.page.width,c.uv[1]*c.page.height,c.uv[2]*c.page.width,c.uv[3]*c.page.height,...c.rect);
              else{if(c.color!==c.color2){const[x,y,w,h]=c.rect,g=ctx.createLinearGradient(x,y,c.vertical?x:x+w,c.vertical?y+h:y);g.addColorStop(0,css(c.color));g.addColorStop(1,css(c.color2));ctx.fillStyle=g;}else ctx.fillStyle=css(c.color);ctx.fillRect(...c.rect);}ctx.restore();}
            return ctx;
          }
          const result=[];
          for(const dpr of [1,1.25,1.5,1.75,2,3,4]){
            const actual=document.createElement('canvas'),expected=document.createElement('canvas'),painter=new CanvasPainter(actual),source=document.createElement('canvas');source.width=source.height=4;
            const image={canvas:source,width:4,height:4,revision:0},ic=source.getContext('2d');
            for(let frame=0;frame<2;frame++){
              ic.clearRect(0,0,4,4);ic.fillStyle=frame?'#00ff00':'#ff00ff';ic.fillRect(0,0,4,4);ic.clearRect(1,1,1,1);image.revision++;
              const s=new PaintScene(frame?107:100,frame?73:70,{dpr,pixelSnap:false});
              for(let i=0;i<20;i++){
                const x=(i*11)%80+.3,y=(i*7)%40+.4,clip=i%4<2?[0.2,0.3,90.1,60.1]:[7.7,5.1,50.9,40.7];
                s.add([x,y,17.3,19.1],[.2,.4,.8,.45],{clip});
                if(i%3===0)s.add([x+2,y,12,8],[1,.5,0,.6],{clip,color2:[0,.2,1,.8],vertical:!!(i%2)});
                if(i%4===0)s.native([x+1,y+3,2.2,3.1],clip);
                if(i%5===0)s.add([x,y+1,6,5],[1,1,1,1],{clip,page:image,uv:[0,0,.75,1]});
              }
              s.add([3.5,4.2,9.1,7.6],[1,0,0,.5],{color2:[1,0,0,.5]});s.seal();painter.render(s);const ctx=reference(expected,s);
              const a=actual.getContext('2d').getImageData(0,0,actual.width,actual.height).data,b=ctx.getImageData(0,0,expected.width,expected.height).data;
              if(a.length!==b.length||a.some((value,i)=>value!==b[i]))throw Error('Canvas pixel mismatch at DPR '+dpr+' frame '+frame);
              result.push({dpr,frame,channelsChecked:a.length,clipChanges:painter.stats.clipChanges});
            }
            painter.dispose();
          }
          // Same workload and alternating order; never gate correctness on timing.
          const scene=new PaintScene(512,512);for(let i=0;i<10000;i++)scene.add([(i%100)*5,Math.floor(i/100)*5,4,4],[.2,.4,.8,1]);scene.seal();
          const a=document.createElement('canvas'),b=document.createElement('canvas'),painter=new CanvasPainter(a),before=[],after=[];
          for(let i=0;i<28;i++){
            const run=(kind)=>{const start=performance.now();kind?painter.render(scene):reference(b,scene);const elapsed=performance.now()-start;if(i>=3)(kind?after:before).push(elapsed);};
            run(i%2);run(1-i%2);
          }
          // Both paths resize only when needed and clear/transform each frame.
          // Operation-count reduction is exact; timing is reported, not gated.
          if(painter.stats.clipChanges!==1||painter.stats.fillStyleChanges!==1)throw Error('same-clip workload not reused');
          const summary=a=>({p50Ms:[...a].sort((a,b)=>a-b)[12],samples:a});const timing={reference:summary(before),reused:summary(after),clipChanges:1,fillStyleChanges:1,note:'CPU submission only, same resize/clear behavior. No timing threshold, presentation latency or hardware speed claim.'};painter.dispose();
          return {pixels:result,timing};
        }''')
    case('Canvas2D exactly preserves clips, gradients, holes, alpha, textures and resize at seven DPRs',canvas_pixels)

    def options_report(page):
        load(page,ide=True);page.wait_for_function('window.vb6Studio?.rendering');page.evaluate('vb6Studio.rendering.ready')
        page.evaluate('''async()=>{await vb6Studio.setRenderingPolicy({backend:'webgpu',fallbacks:['html'],text:'gpu'});window.savedRenderingPolicy=JSON.stringify(vb6Studio.rendering.policy);window.savedExportRendering=JSON.stringify(vb6Studio.project.settings.rendering);vb6Studio.optionsDialog();}''')
        page.get_by_role('tab',name='Rendering',exact=True).click()
        page.get_by_role('button',name='Measure Rendering',exact=True).click()
        page.wait_for_function('!!vb6Studio.renderingMeasurement',timeout=30000)
        check('Browser graphics disabled' in page.locator('[data-renderer-diagnosis]').inner_text(),'measurement failure was lost')
        check('chrome://settings/system' in page.locator('[data-renderer-advice]').inner_text(),'no actionable settings address')
        with page.expect_download() as download: page.get_by_role('button',name='Save Diagnostics...',exact=True).click()
        report=json.loads(Path(download.value.path()).read_text());check(report['diagnosis']['code']=='BROWSER_GRAPHICS_DISABLED','diagnostic evidence omitted')
        check(report['diagnosis']['source']=='measurement','measurement misrepresented as active-driver evidence')
        check(report['renderer']['active']=='html' and report['renderer']['last'] is None,'stale canvas reported as current')
        check(report['candidates']==['webgpu','html'],'saved order missing');check(report['measurement']['results'][2]['available'],'Canvas2D measurement unavailable')
        page.get_by_role('button',name='Restore Default Backends',exact=True).click()
        check(page.evaluate('JSON.stringify(vb6Studio.rendering.policy)===savedRenderingPolicy'),'default restoration applied before OK')
        page.get_by_role('button',name='Cancel',exact=True).click();page.evaluate('() => { vb6Studio.optionsDialog(); }');page.get_by_role('tab',name='Rendering',exact=True).click()
        check(page.get_by_label('Rendering fallback 1',exact=True).input_value()=='','Cancel applied draft defaults')
        page.get_by_role('button',name='Restore Default Backends',exact=True).click();page.get_by_role('button',name='OK',exact=True).click()
        page.wait_for_function('!vb6Studio.rendering.getStats().initializing && vb6Studio.rendering.backend==="html"')
        check(page.evaluate('JSON.stringify(vb6Studio.project.settings.rendering)===savedExportRendering'),'default restoration modified exported application settings')
        page.evaluate('() => { vb6Studio.optionsDialog(); }');page.get_by_role('tab',name='Rendering',exact=True).click()
        check('HTML / CSS' in page.locator('[data-renderer-status]').inner_text(),'not showing actual fallback')
        page.screenshot(path=str(OUT/('options-headed.png' if args.headed else 'options-headless.png')))
        page.get_by_role('button',name='Cancel',exact=True).click()
        page.evaluate('''()=>{const input=document.createElement('input');input.id='disabled-gpu-input';input.setAttribute('data-vb-native','');input.style='position:fixed;top:100px;left:200px;z-index:2000000';document.body.append(input);}''')
        page.locator('#disabled-gpu-input').fill('native input works');check(page.locator('#disabled-gpu-input').input_value()=='native input works','fallback broke input')
        page.evaluate('vb6Studio.rendering.retry()');check(page.evaluate('vb6Studio.rendering.backend')=='html','retry did not retain the default HTML fallback')
        page.evaluate("vb6Studio.setRenderingPolicy({backend:'canvas2d'})")
        check(page.evaluate('vb6Studio.rendering.backend')=='canvas2d','explicit Canvas2D selection was ignored')
        page.evaluate('() => { vb6Studio.optionsDialog(); }');page.get_by_role('tab',name='Rendering',exact=True).click()
        page.get_by_role('button',name='Use HTML / CSS',exact=True).click()
        check(page.evaluate('vb6Studio.rendering.backend')=='canvas2d','HTML choice applied before OK')
        page.get_by_role('button',name='Cancel',exact=True).click()
        check(page.evaluate('vb6Studio.rendering.backend')=='canvas2d','Cancel changed the active backend')
        page.evaluate('() => { vb6Studio.optionsDialog(); }');page.get_by_role('tab',name='Rendering',exact=True).click()
        page.get_by_role('button',name='Use HTML / CSS',exact=True).click();page.get_by_role('button',name='OK',exact=True).click()
        page.wait_for_function('vb6Studio.rendering.backend==="html"')
        check(page.evaluate('vb6Studio.rendering.driver===null'),'HTML retained a canvas driver')
        return {'report':report,'recoveredFallback':page.evaluate('vb6Studio.rendering.backend')}
    case('disabled-graphics Options preserve evidence, restore fallback drafts and keep native input usable',options_report)
    report={'schema':1,'browser':browser.version,'flags':flags,'fixtureTransport':'inline-local-bundles' if args.offline else 'http','physicalHardwareQualified':False,'results':results}
    (OUT/('headed.json' if args.headed else 'headless.json')).write_text(json.dumps(report,indent=2))
    browser.close()
server.shutdown()
raise SystemExit(0 if all(r['passed'] for r in results) else 1)
