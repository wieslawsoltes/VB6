#!/usr/bin/env python3
"""Rendering integration and real-backend readback tests.

--require-webgpu / --require-webgl2 reject backend fallbacks and normally serve
localhost. --offline uses set_content without removing backend requirements.
Without required backends, unavailable APIs are explicitly skipped. Reports distinguish functional correctness,
pixel parity with our HTML path, CPU timing and physical-hardware qualification.
"""
from __future__ import annotations
import argparse, base64, functools, http.server, io, json, os, platform, shlex, shutil, subprocess, threading, time, traceback
from pathlib import Path
from PIL import Image, ImageChops
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/rendering'
RESULTS, METRICS, VISUAL = [], {}, []
ARGS = argparse.ArgumentParser()
ARGS.add_argument('--require-webgpu', action='store_true')
ARGS.add_argument('--require-webgl2', action='store_true')
ARGS.add_argument('--headed', action='store_true')
ARGS.add_argument('--offline', action='store_true', help='Load fixtures with set_content instead of HTTP; required backend checks remain enabled')
ARGS.add_argument('--software-gpu', action='store_true', help='Explicit CI software adapter, never physical-GPU qualification')
args = ARGS.parse_args()
REQUIRED = [name for name, enabled in [('webgpu', args.require_webgpu), ('webgl2', args.require_webgl2)] if enabled]
OUT.mkdir(parents=True, exist_ok=True)
BUNDLE = (ROOT / 'dist/vb6-rendering.js').read_text()
IDE = (ROOT / 'dist/VB6-Studio-Web.html').read_text()
CONTROL_FIXTURE = subprocess.check_output(['node','--input-type=module','-e',"import {bundle} from './tools/bundle.mjs';process.stdout.write(bundle('./tests/fixtures/rendering-controls.mjs','RenderControls'));"],cwd=ROOT,text=True)
URL = None
if REQUIRED and not args.offline:
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args): pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    URL = f'http://127.0.0.1:{server.server_port}/'

def check(ok, message):
    if not ok: raise AssertionError(message)

def case(name, fn):
    start = time.perf_counter()
    existing_contexts = set(browser.contexts)
    try:
        details = fn()
        RESULTS.append({'name': name, 'passed': True, 'details': details, 'ms': round((time.perf_counter()-start)*1000, 2)})
        print('SKIP' if isinstance(details, dict) and details.get('skipped') else 'PASS', name, flush=True)
    except Exception as e:
        RESULTS.append({'name': name, 'passed': False, 'error': str(e)})
        traceback.print_exc(limit=3)
        print('FAIL', name, str(e), flush=True)
    finally:
        # A failed assertion must not exhaust the browser's context/GPU budget.
        for context in browser.contexts:
            if context not in existing_contexts: context.close()

def new_page(browser, dpr=1, ide=False):
    page = browser.new_page(viewport={'width': 1280, 'height': 800}, device_scale_factor=dpr)
    page.errors = []
    page.on('pageerror', lambda error: page.errors.append(str(error)))
    page.on('console', lambda message: METRICS.setdefault('browserWarnings', []).append(message.text) if message.type in ('warning', 'error') and len(METRICS.get('browserWarnings', [])) < 100 else None)
    if URL: page.goto(URL + ('dist/VB6-Studio-Web.html' if ide else 'tests/fixtures/rendering.html'))
    if ide:
        if not URL: page.set_content(IDE)
        page.wait_for_function('window.vb6Studio?.rendering')
        page.evaluate('vb6Studio.rendering.ready')
    elif not URL:
        page.set_content('<!doctype html><html><head><style>html,body{margin:0;background:white}</style></head><body></body></html>')
    page.add_script_tag(content=BUNDLE)
    return page

from rendering_pixels import compare_pixels as pixels

with sync_playwright() as playwright:
    executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or playwright.chromium.executable_path
    # Browser flags belong to this test runner, never the shipped IDE/runtime.
    # Source: https://developer.chrome.com/blog/supercharge-web-ai-testing
    launch_flags = ['--no-sandbox']
    if args.software_gpu:
        # Full native raster/compositor completion is a screenshot precondition:
        # partial-raster tile reuse can change fractional HTML edge coverage even
        # with the overlay removed. Do not mask those pixels or widen tolerances.
        # These oracle switches apply ONLY to the explicit software test profile,
        # never the shipped application or the default hardware measurement path.
        # Source: https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md#rendering--gpu
        launch_flags += ['--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--use-vulkan=swiftshader', '--disable-partial-raster', '--run-all-compositor-stages-before-draw']
    launch_flags += shlex.split(os.environ.get('RENDERING_BROWSER_FLAGS', ''))
    # Playwright's headless profile adds --hide-scrollbars. Remove only that
    # presentation shortcut: native scrollbar geometry and input must be tested
    # in BOTH modes, rather than passing pixels with all scrollbars absent.
    # https://playwright.dev/python/docs/api/class-browsertype#browser-type-launch-option-ignore-default-args
    browser = playwright.chromium.launch(executable_path=executable, headless=not args.headed, args=launch_flags, ignore_default_args=['--hide-scrollbars'])
    METRICS.update(requiredBackends=REQUIRED, browser=browser.version, platform=platform.platform(), flags=launch_flags, physicalHardwareQualified=False, headed=args.headed, softwareGpuRequested=args.software_gpu, fixtureTransport="http" if URL else "set_content", ignoredDefaultBrowserArgs=["--hide-scrollbars"])

    def backend_execution():
        page = new_page(browser)
        # The initial capability case starts the software driver and JIT on a
        # cold hosted runner. Give that explicit test profile a bounded budget;
        # production renderer startup and all later cases retain their defaults.
        # WebGPU requestAdapter/requestDevice are asynchronous, not frame-budget operations:
        # https://gpuweb.github.io/gpuweb/#dom-gpu-requestadapter
        timeout = 15000 if args.software_gpu else 3000
        outcome = page.evaluate('''async timeout=>{const result={};for(const backend of ['webgpu','webgl2','canvas2d']){const c=document.createElement('canvas');document.body.append(c);let p;const start=performance.now();try{p=await VB6Rendering.createPainter(backend,c,{timeout});const s=new VB6Rendering.PaintScene(20,20);s.add([0,0,20,20],[1,0,0,1]);p.render(s);if(p.device)await p.device.queue.onSubmittedWorkDone();result[backend]={available:true,initializationMs:performance.now()-start,timeoutMs:timeout,adapter:p.adapterInfo||null,outputVerified:p.stats.outputVerified??null};}catch(e){result[backend]={available:false,initializationMs:performance.now()-start,timeoutMs:timeout,reason:e.message};}finally{p?.dispose();c.remove();}}return result}''',timeout)
        METRICS['backends'] = outcome
        check(outcome['canvas2d']['available'], 'Canvas2D missing')
        for backend in REQUIRED:
            check(outcome[backend]['available'], 'REAL '+backend+' required, no fallback accepted: ' + str(outcome))
        METRICS['backends'] = outcome; page.close(); return outcome
    case('real backend initialization and shader execution', backend_execution)

    for dpr in [1, 1.25, 1.5, 2, 3, 4]:
        def primitive_parity(dpr=dpr):
            page = new_page(browser, dpr)
            images, info = {}, {}
            for backend in ['canvas2d', 'webgl2', 'webgpu']:
                if not METRICS.get('backends', {}).get(backend, {}).get('available'): continue
                info[backend] = page.evaluate('''async({backend,dpr})=>{
                  window.painter?.dispose();document.querySelector('canvas.fixture')?.remove();
                  const canvas=document.createElement('canvas');canvas.className='fixture';canvas.style.cssText='display:block;width:256px;height:128px';document.body.append(canvas);
                  const p=window.painter=await VB6Rendering.createPainter(backend,canvas),s=new VB6Rendering.PaintScene(256,128,{dpr});
                  s.add([0,0,256,128],[0,0,0,1]);s.add([0,0,128,64],[1,0,0,1]);s.add([128,0,128,64],[0,1,0,1]);
                  s.add([0,64,128,64],[0,0,1,1]);s.add([128,64,128,64],[1,1,1,1]);
                  s.add([16,16,64,32],[1,1,0,1],{clip:[32,16,32,32]});s.native([4,4,4,4],s.clip);
                  const image=document.createElement('canvas');image.width=image.height=16;const c=image.getContext('2d');c.fillStyle='#00ffff';c.fillRect(0,0,16,8);c.fillStyle='#ff00ff';c.fillRect(0,8,16,8);
                  s.add([160,16,16,16],[1,1,1,1],{page:{canvas:image,width:16,height:16,revision:1}});
                  // Test the production submission independently from readback.
                  // Reading/mapping a swapchain texture is diagnostic work, not
                  // a prerequisite for presenting a normal low-level draw.
                  window.primitiveScene=s;
                  await new Promise((resolve,reject)=>requestAnimationFrame(()=>{
                    try {p.render(s);resolve();} catch(error) {reject(error);}
                  }));
                  return {name:p.name,width:canvas.width,height:canvas.height,stats:{...p.stats}};
                }''', {'backend': backend, 'dpr': dpr})
                # Capture the production draw BEFORE requesting any framebuffer
                # mapping. The readback below is a separate diagnostic submission
                # of the identical scene, checked against the same fixed reference.
                # Sources: https://gpuweb.github.io/gpuweb/#canvas-context
                # https://gpuweb.github.io/gpuweb/#automatic-expiry-task-source
                page.evaluate('async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')
                images[backend] = page.screenshot(clip={'x':0,'y':0,'width':256,'height':128}, caret='initial')
                (OUT / f'primitives-{backend}-{dpr}.png').write_bytes(images[backend])
                if backend == 'webgpu':
                    raw = page.evaluate('''async()=>{
                      const image=await painter.render(primitiveScene,{readback:true}),rgba=image.data;
                      let text='';for(let i=0;i<rgba.length;i+=8192)text+=String.fromCharCode(...rgba.subarray(i,i+8192));
                      return btoa(text);
                    }''')
                    rgba = Image.frombytes('RGBA', (info[backend]['width'],info[backend]['height']), base64.b64decode(raw))
                    displayed = Image.new('RGBA', rgba.size, (255,255,255,255));displayed.alpha_composite(rgba)
                    encoded = io.BytesIO();displayed.convert('RGB').save(encoded, format='PNG')
                    (OUT / f'framebuffer-{backend}-{dpr}.png').write_bytes(encoded.getvalue())
                    comparison = pixels(images['canvas2d'], encoded.getvalue())
                    METRICS.setdefault('gpuFramebufferReadback', []).append({'backend':backend,'dpr':dpr,**comparison})
                    check(comparison['changedPixels']==0, 'GPU diagnostic framebuffer differs: '+str(comparison))
                check(info[backend]['width'] == round(256*dpr), 'DPR was capped or ignored')
            check('canvas2d' in images, 'Reference backend did not execute')
            for backend in REQUIRED: check(backend in images, 'Required '+backend+' did not execute')
            comparisons = {backend: pixels(images['canvas2d'], image) for backend, image in images.items() if backend != 'canvas2d'}
            if not comparisons:
                page.close();return {'skipped':'No second renderer available for a cross-backend pixel comparison','info':info}
            METRICS.setdefault('presentationPixels', []).extend({'backend':backend,'dpr':dpr,**comparison} for backend,comparison in comparisons.items())
            for backend, comparison in comparisons.items():
                check(comparison['changedPixels'] == 0, f'{backend} solid/clip/texture pixel mismatch at DPR {dpr}: {comparison}')
            check(not page.errors, str(page.errors)); page.close(); return {'info': info, 'comparisons': comparisons}
        case(f'exact solid, clip, hole and texture pixels at DPR {dpr}', primitive_parity)

    def ide_workflow():
        page = new_page(browser, ide=True); renderer = 'vb6Studio.rendering'
        check(page.evaluate(renderer+'.policy.backend') == 'webgpu', 'WebGPU is not default')
        if args.require_webgpu: check(page.evaluate(renderer+'.backend') == 'webgpu', 'IDE fallback: ' + json.dumps(page.evaluate(renderer+'.getStats()')))
        page.evaluate('vb6Studio.optionsDialog();undefined');page.get_by_role('tab', name='Rendering', exact=True).click()
        page.get_by_label('UI rendering backend').select_option('html');page.get_by_role('button', name='Cancel', exact=True).click()
        check(page.evaluate(renderer+'.policy.backend') == 'webgpu', 'Cancel changed policy')
        page.evaluate('vb6Studio.optionsDialog();undefined');page.get_by_role('tab', name='Rendering', exact=True).click()
        page.get_by_label('UI rendering backend').select_option('html');page.get_by_label('Use these settings in exported applications').check()
        page.get_by_role('button', name='OK', exact=True).click(); page.wait_for_function(renderer+'.backend === "html"')
        check(page.locator('[data-vb-render-layer]').count() == 0, 'HTML retained a rendering overlay')
        check(page.evaluate('vb6Studio.project.settings.rendering.backend') == 'html', 'Export policy not stored')
        page.evaluate('vb6Studio.setRenderingPolicy({backend:"canvas2d",fallbacks:["html"]})')
        page.wait_for_function(renderer+'.backend === "canvas2d"')
        # Allow pending activation/focus/resize invalidations to settle, then
        # enforce no further submissions across a separate idle interval.
        page.evaluate('''async()=>{const r=vb6Studio.rendering;let last=r.metrics.frames,stable=0;for(let i=0;i<30;i++){await new Promise(done=>setTimeout(done,50));const now=r.metrics.frames;stable=now===last?stable+1:0;last=now;if(stable>=4)return;}throw Error('Renderer did not reach quiescence')}''')
        # Background IDE analysis may finish after the settings dialog closes.
        # A draw caused by real DOM changes is not idle. Conversely, canvas-layer
        # writes are excluded so a self-triggered render loop still fails.
        idle=page.evaluate('''async()=>{
          const r=vb6Studio.rendering;await document.fonts.ready;
          let changes=[];
          const observer=new MutationObserver(records=>changes.push(...records));
          observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});
          let busyIntervals=0;
          try {
            for(let i=0;i<20;i++) {
              // Let pending invalidations settle; retain delivered records instead
              // of losing them in an empty MutationObserver callback.
              await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
              changes=[];observer.takeRecords();const frames=r.metrics.frames;
              await new Promise(done=>setTimeout(done,350));
              const records=[...changes,...observer.takeRecords()].filter(change=>{
                const n=change.target.nodeType===1?change.target:change.target.parentElement;
                return !n?.closest('[data-vb-render-layer]');
              });
              if(records.length){busyIntervals++;continue;}
              return {busyIntervals,idleFrames:r.metrics.frames-frames};
            }
            throw Error('IDE remained busy for every observation interval');
          } finally {observer.disconnect();}
        }''')
        check(idle['idleFrames']==0,'Idle UI continuously redraws: '+str(idle))
        METRICS['idleObservation']=idle
        page.evaluate('vb6Studio.optionsDialog();undefined');page.get_by_role('tab', name='Rendering', exact=True).click();page.screenshot(path=OUT/'options.png')
        page.get_by_role('button', name='Cancel', exact=True).click()
        check(not page.errors, str(page.errors)); stats=page.evaluate(renderer+'.getStats()');page.close();return stats
    case('classic Options cancel/apply/export and idle scheduling', ide_workflow)

    def fallback_lifecycle():
        page = new_page(browser)
        result = page.evaluate('''async()=>{
          let lost, disposed=0;const attempts=[];
          const factory=async(name,canvas,options)=>{attempts.push(name);if(name==='webgpu')throw Error('denied adapter');if(name==='webgl2'){lost=options.onLost;return {name,stats:{},render(){canvas.width=10;canvas.height=10},dispose(){disposed++}};}return VB6Rendering.createPainter(name,canvas,options)};
          const r=new VB6Rendering.UIRenderer(document,{fallbacks:['webgl2','canvas2d','html']},{factory});await r.ready;
          const first=r.backend;lost('simulated loss');await r.ready;const second=r.backend;
          await r.setOptions({backend:'html'});const clean=document.querySelectorAll('[data-vb-render-layer]').length===0;
          r.dispose();r.dispose();return {first,second,clean,disposed,attempts};
        }''')
        check(result == {'first':'webgl2','second':'canvas2d','clean':True,'disposed':1,'attempts':['webgpu','webgl2','canvas2d']}, 'Fallback lifecycle: '+str(result))
        # Asynchronous startup must never resurrect an obsolete backend.
        race = page.evaluate('''async()=>{let resolve,disposed=0;const r=new VB6Rendering.UIRenderer(document,{backend:'webgpu'},{factory:()=>new Promise(done=>{resolve=()=>done({render(){},dispose(){disposed++},stats:{}})})});const pending=r.ready;await r.setOptions({backend:'html'});resolve();await pending;const result={active:r.backend,canvases:document.querySelectorAll('[data-vb-render-layer]').length,disposed};r.dispose();return result}''')
        check(race == {'active':'html','canvases':0,'disposed':1}, 'Stale initialization won: '+str(race));page.close();return {'loss':result,'race':race}
    case('ordered failure, context loss, cleanup and stale-start race', fallback_lifecycle)

    def live_gpu_loss():
        if not METRICS.get('backends',{}).get('webgpu',{}).get('available'):
            check('webgpu' not in REQUIRED, 'Required WebGPU loss test cannot execute')
            return {'skipped':'WebGPU unavailable; required in the separate WebGPU CI job'}
        page=new_page(browser)
        result=page.evaluate('''async()=>{
          const r=window.r=new VB6Rendering.UIRenderer(document,{fallbacks:['webgl2','canvas2d','html']});
          await r.ready;if(r.backend!=='webgpu')throw Error(JSON.stringify(r.getStats()));
          r.driver.device.destroy();
          await new Promise(resolve=>setTimeout(resolve,250));await r.ready;
          return r.getStats();
        }''')
        expected='webgl2' if METRICS['backends'].get('webgl2',{}).get('available') else 'canvas2d'
        check(result['active']==expected,'Device loss did not choose first available fallback: '+str(result))
        page.evaluate('r.dispose()');page.close();return result
    case('actual GPUDevice destruction and ordered available fallback',live_gpu_loss)

    def live_gl_loss():
        if not METRICS.get('backends',{}).get('webgl2',{}).get('available'):
            check('webgl2' not in REQUIRED,'Required WebGL2 loss test cannot execute')
            return {'skipped':'WebGL2 unavailable; required in the separate WebGL2 CI job'}
        page=new_page(browser)
        page.evaluate('''async()=>{
          const r=window.r=new VB6Rendering.UIRenderer(document,{backend:'webgl2',fallbacks:['canvas2d','html']});
          await r.ready;if(r.backend!=='webgl2')throw Error(JSON.stringify(r.getStats()));
          const extension=r.driver.gl.getExtension('WEBGL_lose_context');
          if(!extension)throw Error('WEBGL_lose_context missing');extension.loseContext();
        }''')
        page.wait_for_function('r.backend === "canvas2d"');result=page.evaluate('r.getStats()');
        page.evaluate('r.dispose()');page.close();return result
    case('actual WebGL2 context loss and Canvas2D recovery',live_gl_loss)

    def reference_counts():
        page = new_page(browser)
        result=page.evaluate('''async()=>{const a=VB6Rendering.retainRenderer(document,{backend:'canvas2d'}),b=VB6Rendering.retainRenderer(document,{backend:'html'});await a.renderer.ready;const same=a.renderer===b.renderer;a.release();a.release();const alive=!b.renderer.disposed;b.release();return {same,alive,disposed:b.renderer.disposed,canvases:document.querySelectorAll('[data-vb-render-layer]').length}}''')
        check(result=={'same':True,'alive':True,'disposed':True,'canvases':0}, str(result));page.close();return result
    case('shared-document reference counts and idempotent cleanup', reference_counts)

    def stable_render_capture(page, name, backend, renderer="vb6Studio.rendering"):
        # Stabilize each backend independently, without looking at the expected
        # pixels. The HTML baseline remains fixed throughout comparison. Font-ready
        # and two rAF callbacks alone do not await asynchronous native raster /
        # initial MDI layout. Require three identical captures before
        # comparing; never retry a mismatch against the baseline until it passes.
        # This is the same stability prerequisite as Playwright screenshots:
        # https://playwright.dev/docs/api/class-pageassertions#page-assertions-to-have-screenshot-1
        import hashlib
        previous = None; consecutive = 0; samples = []; capture_errors = []
        accepted = False
        report_path = OUT/(name+'-reference.json')
        image_path = OUT/(name+'-'+backend+'.png')
        image_path.unlink(missing_ok=True)  # A failed rerun must not retain old evidence.
        def report():
            report_path.write_text(json.dumps({'backend':backend,'samples':samples,
                'stableCaptures':consecutive,'captureErrors':capture_errors,
                'accepted':accepted},indent=2))
        try:
            for attempt in range(30):
                check(page.evaluate(renderer+'.backend') == backend, 'Capture used an unexpected renderer')
                page.evaluate('async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')
                # Do not mutate every input's caret-color. Keep all actual pixels;
                # an unstable/wrong image still fails the unchanged strict gate.
                # https://playwright.dev/python/docs/api/class-page#page-screenshot-option-caret
                try:
                    current = page.screenshot(caret='initial')
                except PlaywrightTimeoutError as error:
                    # The browser's screenshot command can time out even after
                    # fonts/rAF and backend readiness completed. Retry only that
                    # command once per capture session, on the SAME page. Never
                    # retry a pixel mismatch, reload source, change a backend or
                    # accept prior pixels. The next iteration repeats readiness
                    # checks and must produce three NEW consecutive equal images.
                    capture_errors.append({'attempt':attempt,'error':str(error)})
                    previous = None; consecutive = 0
                    report()  # Preserve the first failure even if recovery fails.
                    if len(capture_errors) > 1:
                        raise
                    continue
                check(page.evaluate(renderer+'.backend') == backend, 'Capture used an unexpected renderer')
                difference = pixels(previous, current) if previous is not None else None
                samples.append({'attempt': attempt, 'sha256': hashlib.sha256(current).hexdigest(), 'difference': difference})
                consecutive = consecutive + 1 if difference and difference['changedPixels'] == 0 else 1
                if consecutive == 3:
                    image_path.write_bytes(current)
                    accepted = True
                    return current
                if len(samples) == 1: (OUT/(name+'-startup.png')).write_bytes(current)
                previous = current
            raise AssertionError('Renderer never reached stable pixels; no capture accepted')
        finally:
            report()

    def stable_html_reference(page, name):
        return stable_render_capture(page, name, 'html')

    for dpr in [1, 1.25, 1.5, 2]:
        def ide_visual(dpr=dpr):
            page=new_page(browser,dpr,ide=True)
            page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})');page.wait_for_timeout(250)
            baseline=stable_html_reference(page,f'ide-reference-{dpr}');(OUT/f'ide-html-{dpr}.png').write_bytes(baseline)
            for backend in ['canvas2d','webgl2','webgpu']:
                if not METRICS.get('backends',{}).get(backend,{}).get('available'):continue
                page.evaluate('backend=>vb6Studio.setRenderingPolicy({backend,fallbacks:["html"],text:"native"})',backend)
                check(page.evaluate('vb6Studio.rendering.backend')==backend, 'Visual case did not use '+backend)
                image=stable_render_capture(page,f'ide-settled-{backend}-{dpr}',backend);(OUT/f'ide-{backend}-{dpr}.png').write_bytes(image)
                comparison=pixels(baseline,image);comparison.update(backend=backend,dpr=dpr);VISUAL.append(comparison)
                if comparison['changedPixels']:
                    page.evaluate('vb6Studio.rendering.canvas.style.visibility="hidden"')
                    page.wait_for_timeout(150)
                    native=page.screenshot();(OUT/f'ide-native-after-{backend}-{dpr}.png').write_bytes(native)
                    (OUT/f'ide-failure-{backend}-{dpr}.json').write_text(json.dumps({
                        'composed':comparison,'nativeAfter':pixels(baseline,native),
                        'stats':page.evaluate('vb6Studio.rendering.getStats()')},indent=2))
                    page.evaluate('vb6Studio.rendering.canvas.style.visibility="visible"')
                # Exact reference fixture equality; never tolerate a blank GPU overlay.
                check(comparison['changedPixels']==0,'IDE pixels differ: '+str(comparison))
            comparisons = [v for v in VISUAL if v['dpr']==dpr]
            check(bool(comparisons), 'No visual backends executed')
            for backend in REQUIRED: check(any(v['backend']==backend for v in comparisons), backend+' visual comparison did not execute')
            check(not page.errors,str(page.errors));page.close();return comparisons
        case(f'HTML-vs-renderer visual evidence at DPR {dpr}',ide_visual)

    def studio_page_lifecycle():
        page = new_page(browser, ide=True)
        page.evaluate('vb6Studio.setRenderingPolicy({backend:"canvas2d",fallbacks:["html"]})')
        data=page.evaluate("""async()=>{
          const renderer=vb6Studio.rendering;
          for(let i=0;i<2;i++){
            dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
            if(renderer.disposed)throw Error('Studio released the persisted renderer');
            dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
            await vb6Studio.setRenderingPolicy({backend:'canvas2d',fallbacks:['html']});
            renderer.renderNow();
            if(renderer.backend!=='canvas2d'||renderer.disposed)throw Error('Studio renderer did not survive restoration');
          }
          dispatchEvent(new PageTransitionEvent('pagehide',{persisted:false}));
          return {restores:2,disposed:renderer.disposed,layers:document.querySelectorAll('[data-vb-render-layer]').length};
        }""")
        check(data=={'restores':2,'disposed':True,'layers':0},str(data))
        check(not page.errors,str(page.errors));page.close();return data
    case('Studio retained renderer survives persisted page lifecycle and releases on final pagehide',studio_page_lifecycle)

    def layered_background_edges():
        backend = REQUIRED[0] if REQUIRED else 'canvas2d'
        results=[]
        for dpr in [1,1.25,1.5,1.75,2,2.5,3,4]:
            page = new_page(browser,dpr)
            page.evaluate("""()=>{
              document.head.insertAdjacentHTML('beforeend',`<style>
                .edge-fixture{position:absolute;box-sizing:border-box;left:3px;top:7px;width:74px;height:91px;border:1px solid transparent;background-color:rgb(192,192,192);overflow:hidden;
                  background-image:linear-gradient(black,black),linear-gradient(black,black),linear-gradient(white,white),linear-gradient(white,white),linear-gradient(gray,gray),linear-gradient(gray,gray),linear-gradient(rgb(223,223,223),rgb(223,223,223)),linear-gradient(rgb(223,223,223),rgb(223,223,223));
                  background-size:1px 100%,100% 1px,1px 100%,100% 1px,2px 100%,100% 2px,2px 100%,100% 2px;
                  background-position:right top,left bottom,left top,left top,right top,left bottom,left top,left top;
                  background-origin:border-box;background-clip:border-box;background-repeat:no-repeat}
                .edge-fixture:nth-child(2){left:83.25px;top:7.5px;width:74.5px;height:91.25px}
                .edge-fixture:nth-child(3){left:163px;top:7px}
                .edge-fixture:nth-child(3) div{position:absolute;left:0;top:23px;width:90px;height:30px;background:rgb(0,255,0)}
              </style>`);
              document.body.innerHTML='<div class="edge-fixture"></div><div class="edge-fixture"></div><div class="edge-fixture"><div></div></div>';
              window.edgeRenderer=new VB6Rendering.UIRenderer(document,{backend:'html'});
            }""")
            page.wait_for_timeout(80);before=page.screenshot()
            page.evaluate('backend=>edgeRenderer.setOptions({backend,fallbacks:["html"]})',backend)
            check(page.evaluate('edgeRenderer.backend')==backend,'Background edge fixture fell back')
            page.wait_for_timeout(80);after=page.screenshot();comparison=pixels(before,after)
            (OUT/f'background-edges-{dpr}-html.png').write_bytes(before)
            (OUT/f'background-edges-{dpr}-{backend}.png').write_bytes(after)
            check(comparison['changedPixels']==0,'Internal background edge mismatch: '+str(dict(dpr=dpr,**comparison)))
            # The interior must still be painted, not replaced by a native
            # whole-element hole to obtain the matching screenshot.
            paints=page.evaluate("""()=>{
              let color=null;for(const c of edgeRenderer.adapter.scene.commands){
                if(30>=c.rect[0]&&50>=c.rect[1]&&30<c.rect[0]+c.rect[2]&&50<c.rect[1]+c.rect[3]&&30>=c.clip[0]&&50>=c.clip[1]&&30<c.clip[0]+c.clip[2]&&50<c.clip[1]+c.clip[3])color=c.hole?null:c.color;
              }return color;
            }""")
            check(paints and paints[3]==1 and abs(paints[0]-192/255)<1e-9,'Background interior stopped using selected painter')
            page.evaluate('edgeRenderer.dispose();undefined');check(not page.errors,str(page.errors));page.close()
            results.append(dict(dpr=dpr,backend=backend,**comparison))
        return {'comparisons':results,'opaqueInteriorsRetained':True}
    case('layered background inner edges preserve exact pixels and opaque interiors across eight DPRs',layered_background_edges)

    def optional_ide_themes():
        # Theme and backend choices are independent. Use the native HTML result
        # as the fixed reference for each optional theme; never regenerate it
        # after inspecting GPU output or tolerate native-island differences.
        page = new_page(browser, dpr=1.25, ide=True)
        themes = ['fluent', 'fluent-dark', 'macos26', 'macos26-dark',
                  'x11', 'x11-dark', 'x11-cde', 'x11-cde-dark']
        before = page.evaluate('JSON.stringify(vb6Studio.project)')
        undo = page.evaluate('vb6Studio.history.undoStack.length')
        comparisons = []
        for theme in themes:
            page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})')
            page.evaluate('theme=>{Object.assign(vb6Studio.appearance,{theme,reduceMotion:true});vb6Studio.applyAppearance();}', theme)
            check(page.evaluate('document.documentElement.dataset.ideTheme') == theme.replace('x11-cde', 'x11'), 'Optional theme did not apply')
            reference = stable_html_reference(page, 'optional-theme-'+theme)
            for backend in list(dict.fromkeys(['canvas2d'] + REQUIRED)):
                page.evaluate('backend=>vb6Studio.setRenderingPolicy({backend,fallbacks:["html"],text:"native"})', backend)
                check(page.evaluate('vb6Studio.rendering.backend') == backend, 'Theme comparison silently fell back')
                image = stable_render_capture(page, 'optional-theme-'+theme+'-'+backend, backend)
                comparison = pixels(reference, image)
                comparison.update(theme=theme, backend=backend, dpr=1.25)
                comparisons.append(comparison)
                check(comparison['changedPixels'] == 0, 'Optional IDE theme pixels differ: '+str(comparison))
            check(page.evaluate('JSON.stringify(vb6Studio.project)') == before, 'IDE theme modified the project')
            check(page.evaluate('vb6Studio.history.undoStack.length') == undo, 'IDE theme modified undo history')
        check(not page.errors, str(page.errors));page.close()
        return {'comparisons':comparisons, 'authoredProjectUnchanged':True, 'undoUnchanged':True}
    case('optional IDE themes preserve exact HTML pixels and independent project state', optional_ide_themes)

    def designer_scrollbar_input():
        page = new_page(browser, dpr=1.25, ide=True)
        page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})')
        page.evaluate("""()=>{
          const n=document.createElement('div');n.id='native-scrollbar-fixture';
          n.className='designer-scroll';n.dataset.vbTheme='classic';n.dataset.vbThemeFamily='classic';n.tabIndex=0;
          n.style.cssText='position:fixed;left:32px;top:32px;width:240px;height:180px;max-width:none;max-height:none;flex:none;overflow:scroll;padding:0;z-index:500000';
          const content=document.createElement('div');content.style.cssText='width:800px;height:600px';n.append(content);document.body.append(n);
        }""")
        dimensions = """()=>{const n=document.querySelector('#native-scrollbar-fixture'),r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,cw:n.clientWidth,ch:n.clientHeight,sw:n.scrollWidth,sh:n.scrollHeight}}"""
        geometry = page.evaluate(dimensions)
        check(geometry['w']-geometry['cw']==16 and geometry['h']-geometry['ch']==16, 'Native scrollbar gutters changed: '+str(geometry))
        paint = page.locator('#native-scrollbar-fixture').evaluate("""n=>{const s=getComputedStyle(n,'::-webkit-scrollbar-thumb');return {shadow:s.boxShadow,image:s.backgroundImage,border:s.borderTopWidth}}""")
        check(paint['shadow']=='none' and paint['border']=='0px' and paint['image'].count('linear-gradient(')==8,'Classic scrollbar did not use filled bevel layers: '+str(paint))
        # Real browser wheel, native increment button and native thumb drag. No
        # JS scrollbar implementation, event swallowing or invisible hit regions.
        page.mouse.move(geometry['x']+70,geometry['y']+60);page.mouse.wheel(80,80)
        page.wait_for_function("(()=>{const n=document.querySelector('#native-scrollbar-fixture');return n.scrollLeft>0&&n.scrollTop>0})()")
        page.evaluate("document.querySelector('#native-scrollbar-fixture').scrollTo(0,0)")
        page.mouse.click(geometry['x']+geometry['cw']-8,geometry['y']+geometry['h']-8)
        page.wait_for_function("document.querySelector('#native-scrollbar-fixture').scrollLeft>0")
        page.evaluate("document.querySelector('#native-scrollbar-fixture').scrollTo(0,0)")
        page.wait_for_timeout(100)
        page.mouse.move(geometry['x']+35,geometry['y']+geometry['h']-8);page.mouse.down()
        # Give the native scrollbar drag loop a display frame to acquire the
        # thumb before dispatching moves, as a physical press would.
        page.wait_for_timeout(150)
        page.mouse.move(geometry['x']+80,geometry['y']+geometry['h']-8,steps=8)
        page.wait_for_timeout(150);page.mouse.up()
        page.wait_for_function("document.querySelector('#native-scrollbar-fixture').scrollLeft>0")
        check(page.evaluate(dimensions)==geometry,'Paint or input changed the scrollport geometry')
        # The same native scrollport remains reachable through the pointer-
        # transparent rendering layer. Compare complete screenshots after scrolling.
        page.mouse.move(4,4)
        reference=stable_html_reference(page,'native-scrollbar-input')
        comparisons=[]
        for backend in list(dict.fromkeys(['canvas2d']+REQUIRED)):
            page.evaluate('b=>vb6Studio.setRenderingPolicy({backend:b,fallbacks:["html"]})',backend)
            check(page.evaluate('vb6Studio.rendering.backend')==backend,'Scrollbar test accepted fallback')
            image=stable_render_capture(page,'native-scrollbar-input-'+backend,backend)
            comparison=pixels(reference,image);comparisons.append(dict(backend=backend,**comparison))
            check(comparison['changedPixels']==0,'Native scrollport pixels differ: '+str(comparison))
        page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})')
        page.locator('#native-scrollbar-fixture').evaluate("n=>n.dataset.vbThemeFamily='fluent'")
        excluded=page.locator('#native-scrollbar-fixture').evaluate("n=>getComputedStyle(n,'::-webkit-scrollbar-thumb').backgroundImage")
        check(excluded.count('linear-gradient(')!=8,'Classic-only scrollbar rule leaked to a modern theme')
        page.locator('#native-scrollbar-fixture').evaluate("n=>n.dataset.vbThemeFamily='classic'")
        page.emulate_media(forced_colors='active')
        forced=page.locator('#native-scrollbar-fixture').evaluate("n=>getComputedStyle(n,'::-webkit-scrollbar-thumb').backgroundImage")
        check(forced.count('linear-gradient(')!=8,'Forced colors retained author-only scrollbar strips')
        check(not page.errors,str(page.errors));page.close()
        return {'geometry':geometry,'nativeWheel':True,'nativeArrow':True,'nativeThumbDrag':True,'comparisons':comparisons,'modernAndForcedColorsExcluded':True}
    case('classic designer native scrollbar geometry, input and exact backend pixels',designer_scrollbar_input)

    def mnemonic_stability():
        # Native automatic underline coverage used to drift even when the GPU
        # canvas was transparent. A single screenshot could pass by accident.
        # Compare every repeated switch, including the intervening HTML frames.
        page = new_page(browser, dpr=1.5, ide=True)
        page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})')
        page.evaluate('async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))}')
        measure = """()=>[...document.querySelectorAll('.menubar u,.classic-menu u,.vb-label u,.vb-command u,.vb-check u,.vb-option u,.vb-frame-legend u,.vb-form-title u')].map(n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height,n.textContent]})"""
        geometry = page.evaluate(measure)
        check(len(geometry)>10, 'Actual IDE mnemonic fixture is missing')
        reference = stable_html_reference(page, 'mnemonics')
        backends = list(dict.fromkeys(['canvas2d'] + REQUIRED))
        comparisons = []
        for backend in backends:
            for repeat in range(4):
                page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})');page.wait_for_timeout(100)
                # Submission completion is not compositor presentation. Apply
                # the same reference-independent stability prerequisite as the
                # whole-IDE tests to EVERY mode switch, not just the baseline.
                # A stable wrong image still fails the fixed zero-pixel oracle.
                native_image = stable_html_reference(page, f'mnemonics-native-{backend}-{repeat}')
                native = pixels(reference, native_image)
                if native['changedPixels']:
                    # Retain the actual failing frame, not just a passing
                    # baseline or the following GPU screenshot.
                    (OUT/f'mnemonics-native-{backend}-{repeat}-failure.png').write_bytes(native_image)
                    x, y = native['bounds'][:2]
                    details = page.evaluate('''([x,y])=>({stats:vb6Studio.rendering.getStats(),nodes:document.elementsFromPoint((x+.5)/devicePixelRatio,(y+.5)/devicePixelRatio).slice(0,6).map(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {tag:n.tagName,class:n.className,rect:r.toJSON(),border:s.border,shadow:s.boxShadow,opacity:s.opacity,transform:s.transform,isolation:s.isolation};})})''',[x,y])
                    (OUT/f'mnemonics-native-{backend}-{repeat}-failure.json').write_text(json.dumps(details,indent=2))
                check(native['changedPixels']==0, 'HTML mnemonic drift: '+str(native))
                page.evaluate('backend=>vb6Studio.setRenderingPolicy({backend,fallbacks:["html"],text:"native"})',backend)
                check(page.evaluate('vb6Studio.rendering.backend')==backend, 'Mnemonic test silently fell back')
                page.wait_for_timeout(100)
                image=stable_render_capture(page, f'mnemonics-switch-{backend}-{repeat}', backend)
                (OUT/f'mnemonics-{backend}.png').write_bytes(image)
                comparison=pixels(reference,image);comparison.update(backend=backend,repeat=repeat)
                comparisons.append(comparison)
                check(comparison['changedPixels']==0, 'Repeated mnemonic pixels differ: '+str(comparison))
                check(page.evaluate(measure)==geometry, 'Renderer switching moved mnemonic boxes')
        # Independently check scoping, larger fonts, disabled/currentColor and
        # high contrast. Neither global prose underlines nor layout may change.
        page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})')
        styles = page.evaluate("""()=>{
          const fixture=document.createElement('div');fixture.innerHTML='<p><u id="prose">prose</u></p><button class="vb-command" disabled><u id="disabled-mark">D</u></button><div class="vb-label" style="position:static;font-size:24px;color:rgb(20,30,40)"><u id="large-mark">W</u></div>';
          document.body.append(fixture);
          const large=fixture.querySelector('#large-mark'),box=n=>{const r=n.getBoundingClientRect();return [r.x,r.y,r.width,r.height]};
          const before=box(large);large.style.backgroundImage='none';large.style.textDecorationLine='underline';const after=box(large);large.removeAttribute('style');
          const data=id=>{const s=getComputedStyle(fixture.querySelector(id));return {decoration:s.textDecorationLine,image:s.backgroundImage,color:s.color}};
          return {before,after,prose:data('#prose'),disabled:data('#disabled-mark'),large:data('#large-mark')};
        }""")
        check(styles['before']==styles['after'], 'Paint-only mnemonic strip changed inline geometry')
        check(styles['prose']['decoration']=='underline' and styles['prose']['image']=='none','Prose decoration was overridden')
        for name in ['disabled','large']:
            check(styles[name]['decoration']=='none' and styles[name]['color'] in styles[name]['image'], 'Mnemonic did not inherit '+name+' color')
        page.emulate_media(forced_colors='active')
        check(page.evaluate("getComputedStyle(document.querySelector('#large-mark')).textDecorationLine")=='underline','Forced colors lost the mnemonic')
        check(page.evaluate("getComputedStyle(document.querySelector('#large-mark')).backgroundImage")=='none','Forced colors retained background-only mnemonic')
        check(not page.errors,str(page.errors));page.close()
        return {'mnemonics':len(geometry),'comparisons':comparisons,'styles':styles,'forcedColorsNativeUnderline':True}
    case('repeated fractional-DPI mnemonic pixels, layout, inherited colors and forced colors',mnemonic_stability)

    def live_invalidation():
        page = new_page(browser)
        backend = REQUIRED[0] if REQUIRED else 'canvas2d'
        result = page.evaluate('''async backend=>{
          document.body.innerHTML='<style id="s">#sample{position:absolute;left:20px;top:20px;width:40px;height:40px;background:rgb(255,0,0)}</style><div id="sample"></div>';
          const r=new VB6Rendering.UIRenderer(document,{backend,fallbacks:['html']});await r.ready;
          if(r.backend!==backend)throw Error(JSON.stringify(r.getStats()));
          const settle=()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));
          await settle();const before=r.metrics.frames,driverFrames=r.driver.stats.frames;
          const snapshot=r.retained.scene;
          for(let i=0;i<100;i++)r.renderNow();
          const stable={frames:r.metrics.frames-before,driverFrames:r.driver.stats.frames-driverFrames,identity:r.retained.scene===snapshot,skips:r.metrics.unchangedFrames};
          r.renderNow({force:true});const forced=r.metrics.frames-before;
          // CSSOM writes do not emit MutationObserver records. Inner-element
          // ResizeObserver tracking must catch this change without manual invalidation.
          document.querySelector('#s').sheet.cssRules[0].style.width='80px';
          await new Promise(done=>setTimeout(done,100));await settle();
          const resized=r.retained.scene.commands.some(c=>!c.hole&&c.color[0]===1&&c.rect[0]===20&&c.rect[2]===80);
          const rules=document.createElement('style');rules.textContent='@keyframes rendererProbe{from{background-color:rgb(255,0,0)}to{background-color:rgb(0,0,255)}}';document.head.append(rules);
          document.querySelector('#sample').style.animation='rendererProbe .16s linear forwards';
          await new Promise(done=>setTimeout(done,350));await settle();
          const animated=r.retained.scene.commands.some(c=>!c.hole&&c.rect[0]===20&&c.color[2]===1&&c.color[0]===0);
          const idleStart=r.metrics.frames;await new Promise(done=>setTimeout(done,100));const idleFrames=r.metrics.frames-idleStart;
          const targets=r.observedElements.size;
          await r.setOptions({backend:'html'});const clean=r.observedElements.size===0&&r.retained.scene===null;
          r.dispose();return {stable,forced,resized,animated,idleFrames,targets,clean};
        }''', backend)
        check(result['stable']['frames']==0 and result['stable']['driverFrames']==0 and result['stable']['identity'],str(result))
        check(result['forced']==1 and result['resized'] and result['animated'],str(result))
        check(result['idleFrames']==0 and result['targets']>0 and result['clean'],str(result))
        check(not page.errors,str(page.errors));page.close();return result
    case('retained live UI, CSSOM resize, animation completion and idle cleanup', live_invalidation)

    def observer_reentrant_render():
        page = new_page(browser)
        backend = REQUIRED[0] if REQUIRED else 'canvas2d'
        result = page.evaluate("""async backend=>{
          document.body.innerHTML='<div><div><div id="resize-source" style="width:40px;height:20px"></div></div></div>';
          const r=new VB6Rendering.UIRenderer(document,{backend,fallbacks:['html']});await r.ready;
          const pause=()=>new Promise(done=>setTimeout(done,100));await pause();
          let duringCallback=null,deliveries=0,panel=null;
          const external=new ResizeObserver(()=>{
            if(++deliveries!==1)return;
            panel=document.createElement('div');panel.id='inserted-panel';
            panel.style.cssText='position:absolute;left:100px;top:100px;width:80px;height:40px;background:rgb(0,0,255)';
            document.body.append(panel);r.renderNow();
            duringCallback=r.observedElements.has(panel);
          });
          external.observe(document.querySelector('#resize-source'));
          try{
            for(let i=0;i<20 && (!panel || !r.observedElements.has(panel));i++)await pause();
            const registered=!!panel && r.observedElements.has(panel);
            if(!panel)throw Error('External ResizeObserver did not execute');
            panel.style.width='120px';
            for(let i=0;i<20;i++){
              await pause();
              if(r.retained.scene.commands.some(c=>!c.hole && c.rect[0]===100 && c.rect[2]===120 && c.color[2]===1))break;
            }
            const resized=r.retained.scene.commands.some(c=>!c.hole && c.rect[0]===100 && c.rect[2]===120 && c.color[2]===1);
            const active=r.backend;external.disconnect();r.dispose();await pause();
            return {active,duringCallback,registered,resized,clean:r.observedElements.size===0 && !r.resizeTargetsTask && !r.pendingResizeTargets};
          }finally{external.disconnect();r.dispose();}
        }""",backend)
        check(result['active']==backend, 'Resize observer case silently fell back: '+str(result))
        check(result['duringCallback'] is False and result['registered'] and result['resized'] and result['clean'],str(result))
        check(not page.errors,str(page.errors));page.close();return result
    case('reentrant ResizeObserver rendering defers target registration and preserves resize cleanup',observer_reentrant_render)

    def replacement_texture():
        page = new_page(browser)
        backend = REQUIRED[0] if REQUIRED else 'canvas2d'
        result = page.evaluate('''async backend=>{
          const canvas=document.createElement('canvas');document.body.append(canvas);
          const painter=await VB6Rendering.createPainter(backend,canvas);
          const make=color=>{const c=document.createElement('canvas');c.width=c.height=2;const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,2,2);return c};
          const page={canvas:make('#ff0000'),width:2,height:2,revision:1};
          const scene=new VB6Rendering.PaintScene(32,32);scene.add([0,0,32,32],[1,1,1,1],{page});scene.seal();
          const read=async()=>{
            if(painter.device)return (await painter.render(scene,{readback:true})).data;
            painter.render(scene);const gl=painter.gl;
            if(gl){const data=new Uint8Array(32*32*4);gl.readPixels(0,0,32,32,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;}
            return painter.context.getImageData(0,0,32,32).data;
          };
          const exact=(data,color)=>{for(let i=0;i<data.length;i++)if(data[i]!==color[i%4])return false;return data.length===32*32*4};
          try{
            const red=exact(await read(),[255,0,0,255]);page.canvas=make('#00ff00');
            const green=exact(await read(),[0,255,0,255]);
            return {backend:painter.name,red,green,instanceUploads:painter.stats.instanceUploads};
          }finally{painter.dispose();canvas.remove();}
        }''',backend)
        check(result['backend']==backend and result['red'] and result['green'],str(result))
        if backend!='canvas2d': check(result['instanceUploads']==1,'Texture replacement unnecessarily uploaded sealed geometry: '+str(result))
        check(not page.errors,str(page.errors));page.close();return result
    case('replaced texture source has exact new pixels without geometry upload',replacement_texture)


    def script_style_activity():
        page = new_page(browser)
        backend = REQUIRED[0] if REQUIRED else 'canvas2d'
        result = page.evaluate('''async backend=>{
          document.body.innerHTML='<style id="rules">#target{position:absolute;left:16px;top:16px;width:80px;height:32px;background:rgb(255,0,0)}</style><div id="target"></div>';
          const target=document.querySelector('#target'),sheet=document.querySelector('#rules').sheet,rule=sheet.cssRules[0];
          const original={insert:CSSStyleSheet.prototype.insertRule,play:Animation.prototype.play,animate:Element.prototype.animate};
          const r=new VB6Rendering.UIRenderer(document,{backend,fallbacks:['html']});await r.ready;
          const settle=async()=>{for(let i=0;i<5;i++)await new Promise(requestAnimationFrame)};
          const fill=()=>r.retained.scene.commands.filter(c=>!c.hole&&c.rect[0]===16&&c.rect[1]===16&&c.rect[2]===80&&c.rect[3]===32).at(-1)?.color;
          const expect=async(color,label)=>{await settle();if(JSON.stringify(fill())!==JSON.stringify(color))throw Error(label+': '+JSON.stringify(fill()));};
          try{
            if(r.backend!==backend)throw Error('Required backend fell back');
            await expect([1,0,0,1],'initial');
            rule.style.backgroundColor='rgb(0,255,0)';await expect([0,1,0,1],'generated CSSOM property setter');
            rule.style.setProperty('background-color','rgb(0,0,255)');await expect([0,0,1,1],'CSSOM setProperty');
            sheet.insertRule('#target{background:rgb(255,0,0)}',1);await expect([1,0,0,1],'insertRule');
            sheet.deleteRule(1);await expect([0,0,1,1],'deleteRule');
            const adopted=new CSSStyleSheet();adopted.replaceSync('#target{background:rgb(0,255,0)}');document.adoptedStyleSheets=[adopted];await expect([0,1,0,1],'adopted sheet');
            const promise=adopted.replace('#target{background:rgb(255,0,0)}');await promise;await expect([1,0,0,1],'async replace');
            document.adoptedStyleSheets=[];await expect([0,0,1,1],'remove adopted sheet');
            const animation=target.animate([{background:'rgb(0,255,0)'},{background:'rgb(0,255,0)'}],{duration:50,fill:'forwards'});
            await animation.finished;await expect([0,1,0,1],'script animate final');
            animation.pause();animation.currentTime=0;animation.effect.setKeyframes([{background:'rgb(255,0,0)'},{background:'rgb(255,0,0)'}]);await expect([1,0,0,1],'paused scrub and keyframes');
            animation.cancel();await expect([0,0,1,1],'script cancel');
            const frames=r.metrics.frames;await new Promise(done=>setTimeout(done,100));if(r.metrics.frames!==frames)throw Error('CSSOM observer left an idle loop');
            await r.setOptions({backend:'html'});
            if(CSSStyleSheet.prototype.insertRule!==original.insert||Animation.prototype.play!==original.play||Element.prototype.animate!==original.animate)throw Error('Native APIs not restored on HTML fallback');
            return {backend,scriptCSSOM:true,adoptedSheets:true,scriptAnimation:true,pausedScrub:true,zeroIdleSubmissions:true,nativeDescriptorsRestored:true};
          }finally{r.dispose();document.adoptedStyleSheets=[];}
        }''',backend)
        check(not page.errors,str(page.errors));page.close();return result
    case('script CSSOM changes and Web Animations repaint without polling and restore native APIs',script_style_activity)

    def local_measurement():
        page = new_page(browser)
        backend = REQUIRED[0] if REQUIRED else 'canvas2d'
        report=page.evaluate('''async backend=>{
          const before=document.body.innerHTML;
          const report=await VB6Rendering.benchmarkRendering(document,{frames:4,quads:1000,backends:[backend]});
          if(document.body.innerHTML!==before)throw Error('Benchmark mutated the caller DOM');
          return report;
        }''',backend)
        item=report['results'][0]
        check(item['backend']==backend and item['available'],str(item))
        check(item['cpuSubmission']['count']==4,'CPU samples missing')
        if item['gpuPass'] is not None:
            check(item['gpuPass']['count']==4 and all(x>=0 for x in item['gpuPass']['samples']),'Invalid GPU timestamps')
        check(not report['claims']['wholeIDEPerformanceCompared'],'Primitive test falsely claims whole-IDE performance')
        METRICS['localBenchmark']=report
        check(not page.errors,str(page.errors));page.close();return item
    case('local adapter measurement preserves DOM and separates CPU from GPU pass timestamps',local_measurement)


    for theme,dpr,mobile in [('classic',1,False),('standard',1.5,False),('contrast',2,False),('classic',2,True)]:
        def control_states(theme=theme,dpr=dpr,mobile=mobile):
            page = new_page(browser,dpr)
            if mobile: page.set_viewport_size({'width':390,'height':760})
            page.add_style_tag(content=(ROOT/'dist/vb6-controls.css').read_text())
            page.add_script_tag(content=CONTROL_FIXTURE)
            page.evaluate("""({theme,mobile})=>{
              document.body.innerHTML='<div id="test" style="position:absolute;inset:0;overflow:auto"></div>';
              RenderControls.applyTheme(document.body,theme);
              const types=['CommandButton','TextBox','CheckBox','OptionButton','ComboBox','ListBox','HScrollBar','VScrollBar','ProgressBar','Label','Frame','UpDown','PictureBox','TabStrip','TreeView'];
              window.controls=types.map((type,i)=>{
                const columns=mobile?1:4,model=RenderControls.createControl(type,'Control'+i, (16+i%columns*224)*15,(16+Math.floor(i/columns)*100)*15);
                Object.assign(model.properties,{Width:196*15,Height:64*15,Text:'Edit text',Caption:type,Min:0,Max:100,Value:30,List:['First','Second']});
                const c=new RenderControls.BrowserControl(model,{backend:'canvas2d'});document.querySelector('#test').append(c.node);return c;
              });
              controls[12].draw('line',[0,0,1200,500],255);
              window.fixtureRenderer=new VB6Rendering.UIRenderer(document,{backend:'html'});
            }""",dict(theme=theme,mobile=mobile))
            backend = REQUIRED[0] if REQUIRED else 'canvas2d'
            comparisons=[]
            for phase in ['normal','changed','selection']:
                if phase=='changed': page.evaluate("controls[0].Enabled=0;controls[2].Value=1;controls[3].Value=-1;controls[4].ListIndex=1;controls[6].Value=60;controls[8].Value=70;controls[1].Text='Updated Unicode: αβ';undefined")
                if phase=='selection': page.evaluate("controls[1].input.focus();controls[1].input.setSelectionRange(0,7);undefined")
                page.evaluate('fixtureRenderer.setOptions({backend:"html"})')
                page.evaluate('async()=>{await document.fonts.ready;for(let i=0;i<5;i++)await new Promise(requestAnimationFrame)}')
                label=f'controls-{theme}-{dpr}-{mobile}-{phase}'
                # The controls fixture needs the same independent presentation
                # prerequisite as the IDE. Keep caret/selection pixels untouched;
                # the default screenshot hide/restore cycle mutates input styles.
                baseline=stable_render_capture(page,label+'-native','html','fixtureRenderer')
                page.evaluate('backend=>fixtureRenderer.setOptions({backend,fallbacks:["html"]})',backend)
                check(page.evaluate('fixtureRenderer.backend')==backend,'Control-state backend fell back')
                image=stable_render_capture(page,label+'-paint',backend,'fixtureRenderer')
                comparison=pixels(baseline,image)
                (OUT/(label+'-html.png')).write_bytes(baseline);(OUT/(label+'-'+backend+'.png')).write_bytes(image)
                comparisons.append(dict(phase=phase,**comparison))
                check(comparison['changedPixels']==0,'Control-state pixels differ: '+label+': '+str(comparison))
            # Native editing remains genuinely editable through the GPU layer.
            page.locator('[data-control="Control1"] input').fill('Keyboard works')
            check(page.evaluate('controls[1].Text')=='Keyboard works','Input model stopped updating')
            page.evaluate('fixtureRenderer.dispose();controls.forEach(c=>c.dispose());undefined')
            check(not page.errors,str(page.errors));page.close()
            return dict(backend=backend,theme=theme,dpr=dpr,mobile=mobile,controls=15,states=comparisons)
        case(f'runtime control states / theme {theme} / DPR {dpr} / mobile {mobile}',control_states)


    def detached_window():
        page=new_page(browser,1,ide=True)
        backend=REQUIRED[0] if REQUIRED else 'canvas2d'
        page.evaluate('backend=>vb6Studio.setRenderingPolicy({backend,fallbacks:["html"]})',backend)
        with page.expect_popup() as opened:
            page.get_by_label('Float Properties in Browser Window',exact=True).click()
        popup=opened.value;popup.wait_for_selector('.browser-window-root[data-ready="true"]')
        popup.on('pageerror',lambda error:page.errors.append(str(error)))
        page.wait_for_function('vb6Studio.browserWindows.windows.size === 1')
        state=page.evaluate("""async()=>{
          const record=[...vb6Studio.browserWindows.windows.values()][0],r=VB6Studio.rendererForDocument?.(record.doc);
          // The renderer belongs to the installer's bundle, not a second copy
          // injected into the popup. Query observable status through its owner.
          return {canvas:record.doc.querySelectorAll('[data-vb-render-layer]').length,main:vb6Studio.rendering.backend};
        }""")
        popup.wait_for_selector('[data-vb-render-layer]',state='attached')
        page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})')
        popup.wait_for_function('!document.querySelector("[data-vb-render-layer]")')
        page.evaluate('backend=>vb6Studio.setRenderingPolicy({backend,fallbacks:["html"]})',backend)
        popup.wait_for_selector('[data-vb-render-layer]',state='attached')
        popup.close();page.wait_for_function('vb6Studio.browserWindows.windows.size === 0')
        check(page.evaluate('vb6Studio.rendering.backend')==backend,'Closing detached owner disposed main renderer')
        check(state['main']==backend,str(state));check(not page.errors,str(page.errors));page.close()
        return dict(backend=backend,detached=True,liveSwitch=True,mainSurvived=True)
    case('real detached Properties window inherits live backend policy and releases independently',detached_window)

    def standalone_runtime():
        page=browser.new_page(viewport={'width':800,'height':600});page.errors=[]
        page.on('pageerror',lambda error:page.errors.append(str(error)))
        if URL: page.goto(URL+'dist/examples/calculator.html')
        else: page.set_content((ROOT/'dist/examples/calculator.html').read_text())
        page.wait_for_function('window.vb6Application?.renderer');page.evaluate('vb6Application.renderer.ready')
        backend=REQUIRED[0] if REQUIRED else 'canvas2d'
        page.evaluate('backend=>vb6Application.renderer.setOptions({backend,fallbacks:["html"]})',backend)
        check(page.evaluate('vb6Application.renderer.backend')==backend,'Standalone app did not activate required backend')
        check(page.evaluate('vb6Application.renderer.policy.backend')==backend,'Standalone rendering policy not applied')
        page.evaluate('vb6Application.renderer.setOptions({backend:"html"})');page.wait_for_timeout(100)
        before=page.screenshot()
        page.evaluate('backend=>vb6Application.renderer.setOptions({backend,fallbacks:["html"]})',backend);page.wait_for_timeout(100)
        after=page.screenshot();comparison=pixels(before,after)
        (OUT/'standalone-html.png').write_bytes(before);(OUT/('standalone-'+backend+'.png')).write_bytes(after)
        check(comparison['changedPixels']==0,'Standalone calculator differs: '+str(comparison))
        buttons=page.locator('.vb-command');check(buttons.count()>0,'Standalone has no controls');buttons.first.click()
        check(page.evaluate('vb6Application.vm.state')!='error','Standalone input produced a runtime error')
        page.evaluate('vb6Application.dispose();undefined');check(page.locator('[data-vb-render-layer]').count()==0,'Standalone teardown leaked a renderer')
        check(not page.errors,str(page.errors));page.close();return dict(backend=backend,pixels=comparison,executable=True,cleanup=True)
    case('shipped standalone calculator executes with required renderer and exact pixels',standalone_runtime)

    def paint_wakeups():
        page=new_page(browser)
        backend=REQUIRED[0] if REQUIRED else 'canvas2d'
        page.evaluate('''async backend=>{
          document.head.insertAdjacentHTML('beforeend',`<style id="activity-style">
            #activity-panel { position:absolute;left:16px;top:16px;width:240px;height:100px;background:rgb(255,0,0) }
            #activity-panel:has(input:valid) { background:rgb(0,255,0) }
            #activity-key { position:absolute;left:16px;top:130px;background:white;border:0;outline:none;width:120px;height:30px }
            #activity-key:active {background:rgb(0,0,255)}
            #activity-color {position:absolute;left:300px;top:16px;width:80px;height:80px;background:white}
            #activity-shadow {position:absolute;left:420px;top:16px;width:100px;height:60px;background:white}
          </style>`);
          document.body.innerHTML='<div id="activity-panel"><input required></div><button id="activity-key">Key</button><div id="activity-color"></div><div id="activity-shadow"></div><div id="activity-popover" popover>Native popover</div>';
          window.nativeRuleInsert=CSSStyleSheet.prototype.insertRule;
          window.activityRenderer=new VB6Rendering.UIRenderer(document,{backend,fallbacks:['html']});await activityRenderer.ready;
        }''',backend)
        check(page.evaluate('activityRenderer.backend')==backend,'Lifecycle backend fell back')
        page.locator('#activity-panel input').fill('Valid')
        page.wait_for_function("activityRenderer.adapter.style(document.querySelector('#activity-panel')).backgroundColor==='rgb(0, 255, 0)'")
        page.locator('#activity-key').focus();page.keyboard.down('Space')
        page.wait_for_function("activityRenderer.adapter.style(document.querySelector('#activity-key')).backgroundColor==='rgb(0, 0, 255)'")
        page.keyboard.up('Space')
        page.wait_for_function("activityRenderer.adapter.style(document.querySelector('#activity-key')).backgroundColor==='rgb(255, 255, 255)'")
        page.evaluate('''()=>{nativeRuleInsert.call(document.querySelector('#activity-style').sheet,'#activity-color{background:rgb(255,0,255)}',document.querySelector('#activity-style').sheet.cssRules.length);document.querySelector('#activity-style').dispatchEvent(new Event('load'));}''')
        page.wait_for_function("activityRenderer.adapter.style(document.querySelector('#activity-color')).backgroundColor==='rgb(255, 0, 255)'")
        page.evaluate('''()=>{const sheet=new CSSStyleSheet();sheet.replaceSync('#activity-color{background:rgb(0,255,255)}');window.adopted=document.adoptedStyleSheets;window.adoptedSheet=sheet;adopted.push(sheet)}''')
        page.wait_for_function("activityRenderer.adapter.style(document.querySelector('#activity-color')).backgroundColor==='rgb(0, 255, 255)'")
        page.evaluate('adopted.pop();undefined')
        page.wait_for_function("activityRenderer.adapter.style(document.querySelector('#activity-color')).backgroundColor==='rgb(255, 0, 255)'")
        page.evaluate('document.querySelector("#activity-popover").showPopover();undefined')
        page.wait_for_function('activityRenderer.adapter.elements.has(document.querySelector("#activity-popover"))')
        page.evaluate('document.querySelector("#activity-popover").hidePopover();undefined')
        page.wait_for_function('!activityRenderer.adapter.elements.has(document.querySelector("#activity-popover"))')
        page.evaluate('''()=>{const root=document.querySelector('#activity-shadow').attachShadow({mode:'closed'});root.innerHTML='<div style="background:#00ff00;height:60px">Closed root</div>';}''')
        page.wait_for_function('''()=>{const r=activityRenderer,host=document.querySelector('#activity-shadow'),s=r.adapter.style(host);return r.adapter.unsupported(host,s)==='native control, image or editor'}''')
        page.evaluate('dispatchEvent(new PageTransitionEvent("pagehide",{persisted:true}));undefined')
        check(not page.evaluate('activityRenderer.disposed'),'Persisted pagehide destroyed the live renderer')
        page.evaluate('dispatchEvent(new PageTransitionEvent("pageshow",{persisted:true}));undefined');page.evaluate('activityRenderer.ready')
        check(page.evaluate('activityRenderer.backend')==backend,'Persisted pageshow did not restore renderer')
        # Once detached from the renderer, adopted arrays retain ordinary native
        # mutators and current contents; observation never changes array identity.
        page.evaluate('activityRenderer.setOptions({backend:"html"})')
        check(page.evaluate('!Object.hasOwn(adopted,"push") && document.adoptedStyleSheets===adopted'),'Adopted-sheet observation leaked or replaced array identity')
        baseline=page.screenshot();page.evaluate('backend=>activityRenderer.setOptions({backend,fallbacks:["html"]})',backend)
        page.wait_for_timeout(100);rendered=page.screenshot();comparison=pixels(baseline,rendered)
        (OUT/'activity-html.png').write_bytes(baseline);(OUT/('activity-'+backend+'.png')).write_bytes(rendered)
        check(comparison['changedPixels']==0,'Lifecycle/shadow pixels differ: '+str(comparison))
        page.evaluate('activityRenderer.dispose();undefined');check(not page.errors,str(page.errors));page.close()
        return dict(backend=backend,inputValidity=True,keyboardActive=True,resourceEvent=True,adoptedSavedMutators=True,popover=True,closedShadow=True,persistedLifecycleEvents=True,pixels=comparison)
    case('pseudo-class, resource, adopted-sheet, shadow and persisted-page lifecycle invalidation',paint_wakeups)

    def options_measurement():
        page=new_page(browser,ide=True)
        before=page.evaluate('JSON.stringify({policy:vb6Studio.rendering.policy,settings:vb6Studio.project.settings})')
        page.evaluate('vb6Studio.optionsDialog();undefined');page.get_by_role('tab',name='Rendering',exact=True).click()
        # Invoke both real button handlers in one task. On a fast software
        # adapter the complete measurement can finish before Playwright's next
        # actionability round; waiting to click a then-disabled Cancel is a race.
        page.evaluate('''()=>{const buttons=[...document.querySelectorAll('button')];buttons.find(n=>n.textContent==='Measure Rendering').click();const cancel=buttons.find(n=>n.textContent==='Cancel Measurement');if(cancel.disabled)throw Error('Cancel was not enabled');cancel.click();}''')
        page.wait_for_function('!Array.from(document.querySelectorAll("button")).find(n=>n.textContent==="Measure Rendering").disabled')
        check('cancelled' in page.locator('pre[aria-live]').inner_text().lower(),'Measurement did not report cancellation')
        check(page.evaluate('JSON.stringify({policy:vb6Studio.rendering.policy,settings:vb6Studio.project.settings})')==before,'Measurement changed settings')
        page.get_by_role('button',name='Cancel',exact=True).click()
        check(page.evaluate('JSON.stringify({policy:vb6Studio.rendering.policy,settings:vb6Studio.project.settings})')==before,'Options Cancel changed measurement policy')
        check(not page.errors,str(page.errors));page.close();return {'cancelled':True,'settingsPreserved':True}
    case('classic Options measurement can cancel without changing renderer or export settings',options_measurement)

    def text_style_reuse():
        page = new_page(browser)
        backend = REQUIRED[0] if REQUIRED else 'canvas2d'
        page.evaluate('''async backend=>{
          document.body.innerHTML='<style>#label{font:16px monospace;width:160px;height:30px;background:rgb(10,20,30)}body:has(#label:empty) #peer{background:rgb(40,50,60)}#peer{width:30px;height:30px;background:rgb(70,80,90)}</style><div id="label">First</div><div id="peer"></div><div id="rtl" dir="auto">English</div>';
          window.r=new VB6Rendering.UIRenderer(document,{backend,fallbacks:['html']});await r.ready;
          for(let i=0;i<5;i++)await new Promise(requestAnimationFrame);
        }''',backend)
        # Keep the text-only measurement independent of pointer hit-test updates.
        # Replacing a Text node under the default (0,0) pointer may fire a new
        # boundary event after asynchronous GPU startup. Deliver real movement
        # before the baseline; do not suppress input or alter cached styles.
        # https://www.w3.org/TR/pointerevents3/#boundary-events-caused-by-layout-changes
        page.mouse.move(1000, 700)
        check(page.evaluate('document.elementFromPoint(1000,700)===document.documentElement'), 'Text-cache pointer is not over empty viewport space')
        # Cache identity is measured only after initial font/layout delivery.
        # Five RAFs alone need not drain deferred observer registration, notably
        # in the headless shell. The barrier never changes styles or references.
        startup = (ROOT / 'tests/fixtures/rendering-startup.mjs').read_text().replace('export default ', '', 1)
        initialization = page.evaluate('(' + startup + ')(window.r)')
        result=page.evaluate('''async()=>{
          const label=document.querySelector('#label'),peer=document.querySelector('#peer'),rtl=document.querySelector('#rtl');
          const settle=async()=>{for(let i=0;i<5;i++)await new Promise(requestAnimationFrame)};
          const sceneData=()=>JSON.stringify(r.retained.scene.commands.map(c=>({rect:c.rect,clip:c.clip,color:c.color,color2:c.color2,hole:c.hole})));
          const initial=r.adapter.style(label),start=r.metrics.textStyleReuses;
          const retained=[];
          for(let i=0;i<8;i++){
            if(i%2)label.firstChild.data=i%4===1?'Other':'First';else label.textContent=i%4===0?'First':'Other';
            await settle();retained.push(r.adapter.style(label)===initial);
          }
          const optimized=sceneData();r.invalidateStyles();await settle();const identical=optimized===sceneData();
          label.textContent='';await settle();const emptyColor=r.adapter.style(peer).backgroundColor;
          rtl.firstChild.data='עברית';await settle();const direction=r.adapter.style(rtl).direction;
          const output={active:r.backend,styleReuses:r.metrics.textStyleReuses-start,retained,identical,emptyColor,direction};r.dispose();return output;
        }''')
        check(result['active']==backend,str(result))
        check(result['styleReuses']==8 and all(result['retained']), 'Unchanged selector styles were reread: '+str(result))
        check(result['identical'],'Retained style scene differs from a complete resample')
        check(result['emptyColor']=='rgb(40, 50, 60)' and result['direction']=='rtl', 'Selector-sensitive text was not invalidated: '+str(result))
        check(not page.errors,str(page.errors));page.close();return {**result, 'initialization':initialization}
    case('text changes reuse computed styles while preserving replacement nodes, empty selectors and direction',text_style_reuse)

    def stationary_hover_retention():
        page = new_page(browser)
        backend = REQUIRED[0] if REQUIRED else 'canvas2d'
        page.evaluate("""async backend=>{
          document.body.innerHTML='<style>#hover-box{position:absolute;left:30px;top:30px;width:80px;height:30px;background:rgb(20,30,40)}#hover-box:hover{background:rgb(50,60,70)}</style><div id="hover-box">Label</div>';
          window.r=new VB6Rendering.UIRenderer(document,{backend,fallbacks:['html']});await r.ready;
          for(let i=0;i<5;i++)await new Promise(requestAnimationFrame);
        }""",backend)
        result=page.evaluate("""async()=>{
          const box=document.querySelector('#hover-box');let delivered=0;
          box.addEventListener('pointerover',()=>delivered++);
          const over=()=>box.dispatchEvent(new PointerEvent('pointerover',{pointerId:99,bubbles:true,composed:true}));
          over();for(let i=0;i<5;i++)await new Promise(requestAnimationFrame);
          const style=r.adapter.style(box),before=r.metrics.frames,skips=r.metrics.redundantPointerOvers||0;
          for(let i=0;i<100;i++)over();
          for(let i=0;i<5;i++)await new Promise(requestAnimationFrame);
          return {backend:r.backend,delivered,retained:r.adapter.style(box)===style,frames:r.metrics.frames-before,skips:(r.metrics.redundantPointerOvers||0)-skips};
        }""")
        check(result['backend']==backend,str(result))
        check(result['delivered']==101 and result['skips']==100,str(result))
        check(result['retained'] and result['frames']==0,'Duplicate boundary notifications discarded cached styles: '+str(result))
        # Real hit-test changes must still update hover colors. No input event is
        # stopped or prevented; only duplicate renderer invalidation is omitted.
        page.mouse.move(900,700)
        page.wait_for_function("r.adapter.style(document.querySelector('#hover-box')).backgroundColor==='rgb(20, 30, 40)'")
        page.mouse.move(50,40)
        page.wait_for_function("r.adapter.style(document.querySelector('#hover-box')).backgroundColor==='rgb(50, 60, 70)'")
        page.mouse.move(900,700)
        page.wait_for_function("r.adapter.style(document.querySelector('#hover-box')).backgroundColor==='rgb(20, 30, 40)'")
        page.evaluate('r.setOptions({backend:"html"})')
        check(page.evaluate('r.pointerTargets.size')==0,'HTML fallback retains hover nodes')
        check(not page.errors,str(page.errors));page.close();return {**result,'realHoverUpdates':True,'cleanup':True}
    case('stationary pointer events retain paint styles without suppressing real hover or application input',stationary_hover_retention)

    def same_backend_options():
        page=new_page(browser)
        backend=REQUIRED[0] if REQUIRED else 'canvas2d'
        result=page.evaluate("""async backend=>{
          const r=new VB6Rendering.UIRenderer(document,{backend,fallbacks:['html']},{sceneFactory:p=>{
            const s=new VB6Rendering.PaintScene(16,16,{dpr:1,pixelSnap:p.pixelSnap});
            s.add([.6,.6,5,5],[1,0,0,1]);return s;
          }});
          await r.ready;for(let i=0;i<5;i++)await new Promise(requestAnimationFrame);
          const driver=r.driver,draw=driver.render.bind(driver),reset=r.atlas.reset.bind(r.atlas);
          let renders=0,resets=0;driver.render=(...args)=>{renders++;return draw(...args)};
          r.atlas.reset=()=>{resets++;return reset()};
          try{
            await r.setOptions({...r.policy});const unchanged={renders,resets};
            await r.setOptions({...r.policy,pixelSnap:false});const unsnapped={renders,resets,x:r.retained.scene.commands[0].rect[0]};
            await r.setOptions({...r.policy,pixelSnap:true});const snapped={renders,resets,x:r.retained.scene.commands[0].rect[0]};
            await r.setOptions({...r.policy,text:'gpu'});const text={resets,policy:r.policy.text};
            return {backend:r.backend,sameDriver:r.driver===driver,unchanged,unsnapped,snapped,text};
          }finally{r.dispose()}
        }""",backend)
        check(result['backend']==backend and result['sameDriver'],str(result))
        check(result['unchanged']=={'renders':0,'resets':0},'Unchanged Options caused resource churn: '+str(result))
        check(result['unsnapped']=={'renders':1,'resets':0,'x':.6},'Options resolved before new paint: '+str(result))
        check(result['snapped']=={'renders':2,'resets':0,'x':1},'Pixel snapping did not apply immediately: '+str(result))
        check(result['text']=={'resets':1,'policy':'gpu'},'Text change did not invalidate the atlas exactly once: '+str(result))
        check(not page.errors,str(page.errors));page.close();return result
    case('same-backend Options complete paint before resolution and retain unchanged atlas resources',same_backend_options)

    def background_and_checkbox_edges():
        results=[]
        backend=REQUIRED[0] if REQUIRED else 'canvas2d'
        for dpr in [1,1.25,1.5,1.75,2]:
            page=new_page(browser,dpr)
            page.add_style_tag(content=(ROOT/'dist/vb6-controls.css').read_text())
            page.evaluate("""()=>{
              document.body.innerHTML='<div id="stairs" style="position:absolute;left:3px;top:9px;width:74px;height:91px;box-sizing:border-box;border:1px solid transparent;background-color:rgb(192,192,192);background-image:var(--vb-bevel-raised-image);background-size:1px 100%,100% 1px,1px 100%,100% 1px,2px 100%,100% 2px,2px 100%,100% 2px;background-position:right top,left bottom,left top,left top,right top,left bottom,left top,left top;background-origin:border-box;background-clip:border-box;background-repeat:no-repeat"></div><label class="vb-control vb-check" style="left:110px;top:9px;width:100px;height:91px"><input id="check" type="checkbox" aria-label="Retained native checkbox"><span>Choice</span></label>';
              window.r=new VB6Rendering.UIRenderer(document,{backend:'html'});
            }""")
            page.evaluate('r.ready')
            box=page.locator('#check').bounding_box()
            comparisons=[]
            for state in ['unchecked','checked','indeterminate']:
                page.evaluate('r.setOptions({backend:"html"})')
                if state=='checked':
                    page.locator('#check').focus();page.locator('#check').press('Space')
                    check(page.locator('#check').is_checked(),'Native checkbox Space interaction changed')
                if state=='indeterminate': page.evaluate('document.querySelector("#check").indeterminate=true')
                page.evaluate('async()=>{await document.fonts.ready;for(let i=0;i<5;i++)await new Promise(requestAnimationFrame)}')
                baseline=page.screenshot()
                page.evaluate('backend=>r.setOptions({backend,fallbacks:["html"]})',backend)
                page.evaluate('async()=>{for(let i=0;i<5;i++)await new Promise(requestAnimationFrame)}')
                check(page.evaluate('r.backend')==backend,'Fractional edge test silently fell back')
                image=page.screenshot();comparison=pixels(baseline,image)
                label=f'layer-checkbox-{dpr}-{state}'
                (OUT/(label+'-html.png')).write_bytes(baseline);(OUT/(label+'-'+backend+'.png')).write_bytes(image)
                check(comparison['changedPixels']==0,'Fractional layer/checkbox pixels differ: '+str(comparison))
                check(page.locator('#check').bounding_box()==box,'Checkbox input geometry changed')
                check(page.evaluate('(r.retained.scene.stats.gpuBackgroundLayers||0)>=8'),'All background paint was silently replaced by HTML')
                comparisons.append(dict(state=state,**comparison))
            page.emulate_media(forced_colors='active')
            page.wait_for_function('r.backend==="html"')
            forced=page.locator('#check').evaluate('(n)=>{const s=getComputedStyle(n);return {width:s.borderTopWidth,color:s.borderTopColor,image:s.backgroundImage}}')
            check(float(forced['width'].removesuffix('px'))>0 and forced['image']=='none','High contrast lost native checkbox borders: '+str(forced))
            results.append(dict(dpr=dpr,backend=backend,states=comparisons,nativeKeyboard=True,forcedColors=forced))
            page.evaluate('r.dispose();undefined');check(not page.errors,str(page.errors));page.close()
        return results
    case('fractional background-layer and checkbox edges preserve exact pixels, native keys and high contrast',background_and_checkbox_edges)

    def translucent_paint():
        page = new_page(browser, dpr=1.5)
        backend = REQUIRED[0] if REQUIRED else 'canvas2d'
        page.evaluate('''()=>{
          document.body.innerHTML='<style>body{margin:0;background:rgb(30,50,90)}.sample{position:absolute;width:90px;height:90px;top:20px}.alpha{left:20px;background:rgba(255,0,0,.5)}.border{left:140px;background:white;border:8px solid rgba(0,255,0,.5)}.gradient{left:280px;background:linear-gradient(90deg,rgba(255,0,0,.4),rgba(0,0,255,.8))}.shadow{left:420px;background:white;box-shadow:3px 3px rgba(0,0,0,.4)}</style><div class="sample alpha">Alpha</div><div class="sample border"></div><div class="sample gradient"></div><div class="sample shadow"></div>';
          window.r=new VB6Rendering.UIRenderer(document,{backend:'html'});
        }''')
        page.evaluate('document.fonts.ready');before=page.screenshot()
        page.evaluate('backend=>r.setOptions({backend,fallbacks:["html"]})',backend)
        page.wait_for_timeout(150);after=page.screenshot();comparison=pixels(before,after)
        (OUT/'translucent-html.png').write_bytes(before);(OUT/f'translucent-{backend}.png').write_bytes(after)
        check(page.evaluate('r.backend')==backend,'Alpha test silently fell back')
        check(comparison['changedPixels']==0,'CSS opacity applied twice: '+str(comparison))
        page.evaluate('r.dispose();undefined');check(not page.errors,str(page.errors));page.close();return comparison
    case('partial-alpha backgrounds, borders, gradients and shadows are not composited twice',translucent_paint)

    def benchmark():
        page=new_page(browser,ide=True)
        if REQUIRED: page.evaluate('backend=>vb6Studio.setRenderingPolicy({backend,fallbacks:["html"]})',REQUIRED[0])
        stats=page.evaluate('''()=>{const r=vb6Studio.rendering;r.metrics.builds=[];r.metrics.submissions=[];for(let i=0;i<50;i++)r.renderNow({force:true});return r.getStats()}''')
        METRICS['ideForcedRebuildCpu']=stats
        # Complete this workload before initializing a second renderer; otherwise
        # its bounded startup readback sits behind 50 queued full-IDE submissions.
        # The isolated library benchmark must not measure unrelated IDE work.
        page.evaluate('''async()=>{const device=vb6Studio.rendering.driver?.device;if(device)await device.queue.onSubmittedWorkDone();await vb6Studio.setRenderingPolicy({backend:'html'})}''')
        page.context.close()
        page=new_page(browser)
        # A reusable library workload: all opaque quads must batch to one draw.
        batch=page.evaluate('''async backend=>{let c=document.createElement('canvas');document.body.append(c);let p;let initializationError=null;try{p=await VB6Rendering.createPainter(backend,c)}catch(error){initializationError=String(error);c.remove();c=document.createElement('canvas');document.body.append(c);p=await VB6Rendering.createPainter('canvas2d',c)}const s=new VB6Rendering.PaintScene(1024,1024);for(let i=0;i<10000;i++)s.add([i%100*10,Math.floor(i/100)*10,8,8],[.2,.4,.8,1]);s.seal();const times=[];for(let i=0;i<60;i++){const t=performance.now();p.render(s);times.push(performance.now()-t);if(p.device&&(i+1)%4===0)await p.device.queue.onSubmittedWorkDone()}if(p.device)await p.device.queue.onSubmittedWorkDone();times.sort((a,b)=>a-b);const result={backend:p.name,initializationError,quads:10000,frames:60,cpuSubmitP50Ms:times[30],cpuSubmitP95Ms:times[57],stats:p.stats};p.dispose();c.remove();return result}''', REQUIRED[0] if REQUIRED else next((b for b in ['webgpu','webgl2','canvas2d'] if METRICS.get('backends',{}).get(b,{}).get('available')), 'canvas2d'))
        METRICS['batch10000Quads']=batch
        if REQUIRED: check(batch['backend']==REQUIRED[0], 'Batch workload silently fell back: '+str(batch))
        if batch['backend'] in ['webgpu','webgl2']:
            check(batch['stats']['drawCalls']==1,'Opaque quads were not batched')
            check(batch['stats']['bufferAllocations']==1,'Buffer was reallocated every frame')
            check(batch['stats']['instanceUploads']==1,'Sealed geometry was uploaded every frame')
            check(batch['stats']['geometryPacks']==1,'Sealed geometry was repacked every frame')
            check(batch['stats']['batchBuilds']==1,'Sealed draw batches were rebuilt every frame')
        METRICS['batch10000Quads']=batch;page.close();return {'ide':stats,'batch':batch}
    case('forced rebuild CPU metrics and retained 10,000-quad batching',benchmark)
    browser.close()

summary={'passed':0,'failed':0,'skipped':0}
for result in RESULTS:
    is_skip=isinstance(result.get('details'),dict) and bool(result['details'].get('skipped'))
    summary['skipped' if is_skip else 'passed' if result['passed'] else 'failed']+=1
report={'summary':summary,'results':RESULTS,'metrics':METRICS,'visual':VISUAL,'claims':{
 'physicalHardwarePerformanceConfirmed':False,
 'fullWebGPUWithoutDOMPainting':False,
 'zeroPixelDifferenceInTestedIDEImages':bool(VISUAL) and all(v['changedPixels']==0 for v in VISUAL),
 'nativeVB6WindowsGoldenComparison':False,
 'note':'Native input/editing/icons and unsupported CSS remain DOM-rendered. CPU measurements and software GPU tests do not establish hardware speedup.'}}
(OUT/'report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report['claims'],indent=2))
if URL: server.shutdown()
raise SystemExit(0 if all(result['passed'] for result in RESULTS) else 1)
