#!/usr/bin/env python3
"""Composited workspace paint acceptance; never qualify stale canvas as new DOM.
Shares the real IDE fixture/lifecycle with figma-browser-tests.py. Reports are
separate so the visual pass cannot overwrite the 22 authoring case results.
"""
import importlib.util
import base64
import io
import json
import unittest
from pathlib import Path
from PIL import Image
from ci.browser_partition import configured_shard, select_case_names

spec=importlib.util.spec_from_file_location('figma_authoring',Path(__file__).with_name('figma-browser-tests.py'))
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
REPORT=base.REPORT/'presentation'
base.REPORT=REPORT

class FigmaPresentation(base.FigmaWorkspace):
    def painted_theme(self,scheme,label,backend="canvas2d"):
        """Read actual composited screenshot pixels, not just computed DOM styles.
        No forced renderer paint, backend replacement or sleep occurs here.
        """
        probes=self.page.evaluate(r'''()=>{
          const point=(selector,x,y)=>{const r=document.querySelector(selector).getBoundingClientRect();return {x:r.x+x*r.width,y:r.y+y*r.height};};
          return {header:point('.figma-header',.5,.5),layers:point('.figma-layer-tree',.5,.9),
            canvas:point('.designer-scroll[data-figma-viewport]',.02,.02),
            design:point('.figma-design-inspector',.015,.05)};
        }''')
        png=self.page.screenshot(path=str(REPORT/(label+'.png')),caret='hide',timeout=10000)
        image=Image.open(io.BytesIO(png)).convert('RGB')
        expected={'header':(44,44,44) if scheme=='dark' else (255,255,255),
                  'layers':(44,44,44) if scheme=='dark' else (255,255,255),
                  'design':(44,44,44) if scheme=='dark' else (255,255,255),
                  'canvas':(30,30,30) if scheme=='dark' else (245,245,245)}
        actual={name:image.getpixel((int(p['x']),int(p['y']))) for name,p in probes.items()}
        stats=self.page.evaluate('vb6Studio.rendering.getStats()')
        # Evidence only: never repaint or replace a backend to satisfy a probe.
        evidence=self.page.evaluate(r'''points=>{
          const r=vb6Studio.rendering,scene=r.retained.scene;
          const contains=(b,p)=>b&&p.x>=b[0]&&p.y>=b[1]&&p.x<b[0]+b[2]&&p.y<b[1]+b[3];
          const selectors={header:'.figma-header',layers:'.figma-layer-tree',canvas:'.designer-scroll[data-figma-viewport]',design:'.figma-design-inspector'};
          return {hidden:document.hidden,canvases:[...document.querySelectorAll('[data-vb-render-layer]')].map(n=>({width:n.width,height:n.height,style:n.style.cssText,current:n===r.canvas})),
            probes:Object.fromEntries(Object.entries(points).map(([name,p])=>{
              const n=document.querySelector(selectors[name]),cs=getComputedStyle(n),box=n.getBoundingClientRect();
              return [name,{dom:{rect:[box.x,box.y,box.width,box.height],background:cs.backgroundColor,display:cs.display},snapshot:r.adapter.styles.get(n),
                covering:scene.commands.filter(c=>contains(c.rect,p)&&contains(c.clip,p)).map(c=>({rect:c.rect,clip:c.clip,color:c.color,hole:c.hole,page:!!c.page}))}];
            }))};
        }''',probes)
        (REPORT/(label+'.json')).write_text(json.dumps({'expected':expected,'actual':actual,'points':probes,'renderer':stats,'evidence':evidence},indent=2))
        self.assertEqual(stats['active'],backend,'The visual guard must retain the qualified backend')
        if actual!=expected:
            if backend=='canvas2d':self.capture_failed_canvas_frame(probes,label)
            else:self.capture_failed_webgl_frame(probes,label)
        self.assertEqual(actual,expected,'Native DOM and retained paint must publish the same workspace scheme')
    def capture_failed_canvas_frame(self,probes,label):
        """Discriminate raster, screenshot and compositor faults after failure.
        Keep the scene observed after failure and the buffer before mutations.
        None of these captures or redraws can replace the original verdict.
        """
        frame=None
        report=REPORT/(label+'-canvas-diagnostic.json')
        def save_bitmap(result,key,stage):
            data=result.pop(key)
            if not data.startswith('data:image/png;base64,'):
                raise ValueError('Canvas diagnostic did not produce a PNG')
            (REPORT/(label+'-canvas-'+stage+'.png')).write_bytes(base64.b64decode(data.split(',',1)[1],validate=True))
        def screenshot(stage):
            png=self.page.screenshot(path=str(REPORT/(label+'-diagnostic-'+stage+'.png')),caret='initial',timeout=10000)
            image=Image.open(io.BytesIO(png)).convert('RGB')
            return {name:image.getpixel((int(point['x']),int(point['y']))) for name,point in probes.items()}
        try:
            # Keep the scene observed after the failed screenshot without
            # storing test state in the app or reconstructing it after a redraw.
            frame=self.page.evaluate_handle('''()=>{const renderer=vb6Studio.rendering;
              return {renderer,painter:renderer.driver,scene:renderer.retained.scene};}''')
            result=frame.evaluate(r'''({renderer:r,painter:p,scene},points)=>{
              const ctx=p?.context;
              if(!ctx||r.backend!=='canvas2d')return {unavailable:'The failed frame is not Canvas2D'};
              const t=ctx.getTransform(),state={currentCanvas:p.canvas===r.canvas,
                width:p.canvas.width,height:p.canvas.height,lost:ctx.isContextLost?.()??false,
                transform:[t.a,t.b,t.c,t.d,t.e,t.f],alpha:ctx.globalAlpha,
                composite:ctx.globalCompositeOperation,filter:ctx.filter,
                smoothing:ctx.imageSmoothingEnabled,renderer:r.getStats()};
              const pixels=Object.fromEntries(Object.entries(points).map(([name,point])=>[name,
                [...ctx.getImageData(Math.floor(point.x*p.canvas.width/scene.width),
                  Math.floor(point.y*p.canvas.height/scene.height),1,1).data]]));
              return {state,beforeRedraw:pixels,originalBitmap:p.canvas.toDataURL('image/png')};
            }''',probes)
            if 'unavailable' in result:
                report.write_text(json.dumps(result,indent=2));return
            save_bitmap(result,'originalBitmap','before-redraw')
            report.write_text(json.dumps(result,indent=2))
            # Comparison only: caret='initial' avoids screenshot-injected styles.
            # Capture once; never poll pixels or retry a failing expected color.
            result['caretInitial']=screenshot('caret-initial')
            result['afterCaretInitial']=self.page.evaluate('vb6Studio.rendering.getStats()')
            report.write_text(json.dumps(result,indent=2))
            redraw=frame.evaluate(r'''({renderer:r,painter:p,scene},points)=>{
              if(r.driver!==p||!p.context)return {unavailable:'The failed Canvas2D painter was replaced'};
              const read=painter=>Object.fromEntries(Object.entries(points).map(([name,point])=>[name,
                [...painter.context.getImageData(Math.floor(point.x*painter.canvas.width/scene.width),
                  Math.floor(point.y*painter.canvas.height/scene.height),1,1).data]]));
              const result={sameScene:r.retained.scene===scene};
              r.renderNow({force:true});result.immediatePixels=read(p);
              result.redrawnBitmap=p.canvas.toDataURL('image/png');
              let separate;
              try {separate=new p.constructor(document.createElement('canvas'));separate.render(scene);
                result.independentPainter=read(separate);result.independentBitmap=separate.canvas.toDataURL('image/png');}
              catch(error){result.independentFailure=String(error);}finally{separate?.dispose();}
              return result;
            }''',probes)
            for key,stage in [('redrawnBitmap','after-redraw'),('independentBitmap','independent')]:
                if key in redraw:save_bitmap(redraw,key,stage)
            result['redraw']=redraw
            report.write_text(json.dumps(result,indent=2))
            result['afterRedraw']=screenshot('after-canvas-redraw')
            report.write_text(json.dumps(result,indent=2))
        except Exception as error:
            (REPORT/(label+'-canvas-diagnostic-error.txt')).write_text(str(error))
        finally:
            if frame is not None:
                try:frame.dispose()
                except Exception as error:
                    (REPORT/(label+'-canvas-diagnostic-cleanup-error.txt')).write_text(str(error))
    def capture_failed_webgl_frame(self,probes,label):
        """Post-failure diagnostics only. The original pixels/verdict are retained.
        Readback and diagnostic redraws must never qualify a failing screenshot.
        Compare staged CPU/GPU instances, immediate drawing-buffer pixels and an
        independent painter before investigating compositor layer invalidation.
        """
        try:
            result=self.page.evaluate(r'''points=>{
              const r=vb6Studio.rendering,p=r.driver,gl=p?.gl;
              if(!gl)return {unavailable:'The failed frame is not WebGL2'};
              const scene=r.retained.scene,glState={attributes:gl.getContextAttributes(),
                bufferSize:gl.getBufferParameter(gl.ARRAY_BUFFER,gl.BUFFER_SIZE),
                currentCanvas:p.canvas===r.canvas,version:gl.getParameter(gl.VERSION),
                viewport:[...gl.getParameter(gl.VIEWPORT)],scissor:gl.isEnabled(gl.SCISSOR_TEST),
                scissorBox:[...gl.getParameter(gl.SCISSOR_BOX)],colorMask:[...gl.getParameter(gl.COLOR_WRITEMASK)],
                framebuffer:gl.getParameter(gl.FRAMEBUFFER_BINDING)===null?'default':'custom',
                error:gl.getError()};
              const count=scene.commands.length*24,gpu=new Float32Array(count),binding=gl.getParameter(gl.ARRAY_BUFFER_BINDING);
              gl.bindBuffer(gl.ARRAY_BUFFER,p.buffer);gl.getBufferSubData(gl.ARRAY_BUFFER,0,gpu);gl.bindBuffer(gl.ARRAY_BUFFER,binding);
              const mismatches=[];let mismatchedFloats=0;
              for(let i=0;i<count;i++)if(!Object.is(gpu[i],p.data[i])){mismatchedFloats++;if(mismatches.length<32)mismatches.push({index:i,cpu:p.data[i],gpu:gpu[i]});}
              const read=painter=>{const g=painter.gl,c=painter.canvas;return Object.fromEntries(Object.entries(points).map(([name,point])=>{
                const pixel=new Uint8Array(4),x=Math.floor(point.x*c.width/scene.width),y=c.height-1-Math.floor(point.y*c.height/scene.height);
                g.readPixels(x,y,1,1,g.RGBA,g.UNSIGNED_BYTE,pixel);return [name,[...pixel]];
              }));};
              const result={glState,instances:{count,mismatchedFloats,mismatches},beforeRedraw:read(p)};
              r.renderNow({force:true});result.immediatePixels=read(p);result.afterRedrawError=gl.getError();
              const copy=document.createElement('canvas');copy.width=p.canvas.width;copy.height=p.canvas.height;
              const ctx=copy.getContext('2d');ctx.drawImage(p.canvas,0,0);
              result.canvasCopy=Object.fromEntries(Object.entries(points).map(([name,point])=>[name,[...ctx.getImageData(Math.floor(point.x),Math.floor(point.y),1,1).data]]));
              const canvas=document.createElement('canvas');let separate;
              try {separate=new p.constructor(canvas);separate.render(scene);result.independentPainter=read(separate);result.independentError=separate.gl.getError();}
              catch(error){result.independentFailure=String(error);}finally{separate?.dispose();}
              return result;
            }''',probes)
            (REPORT/(label+'-gpu-diagnostic.json')).write_text(json.dumps(result,indent=2))
            if 'unavailable' in result:return
            for stage,script in [
                ('after-readback',None),
                ('without-containment','vb6Studio.rendering.canvas.style.contain="none"'),
                ('promoted-layer','vb6Studio.rendering.canvas.style.transform="translateZ(0)"')]:
                if script:self.page.evaluate(script)
                self.page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                png=self.page.screenshot(path=str(REPORT/(label+'-diagnostic-'+stage+'.png')),caret='hide',timeout=10000)
                image=Image.open(io.BytesIO(png)).convert('RGB')
                result[stage]={name:image.getpixel((int(point['x']),int(point['y']))) for name,point in probes.items()}
                (REPORT/(label+'-gpu-diagnostic.json')).write_text(json.dumps(result,indent=2))
        except Exception as error:
            (REPORT/(label+'-gpu-diagnostic-error.txt')).write_text(str(error))

    def test_presentation_default_backend_theme_pixels(self):
        # Qualify the actual shipped policy rather than assuming the project's
        # legacy renderer preference selects the IDE-global canvas backend.
        self.page.evaluate('vb6Studio.rendering.ready')
        initial=self.page.evaluate('vb6Studio.rendering.getStats()')
        (REPORT/'default-startup.json').write_text(json.dumps(initial,indent=2))
        backend=initial['active']
        self.assertIn(backend,['webgpu','webgl2','canvas2d'],'Default policy must select a working canvas in this matrix')
        self.enable(True);self.select(['frame']);before=self.snapshot()
        for index,scheme in enumerate(['light','dark','light','dark']):
            self.page.evaluate('scheme=>vb6Studio.figmaMode.configure({mode:"figma",scheme,units:"px"})',scheme)
            self.painted_theme(scheme,'default-'+str(index)+'-'+scheme,backend)
            self.assertEqual(self.snapshot(),before)
        self.done()

    def test_presentation_composited_theme_pixels(self):
        self.page.evaluate('vb6Studio.setRenderingPolicy({backend:"canvas2d",fallbacks:["html"],text:"native"})')
        painter=self.page.evaluate_handle('vb6Studio.rendering.driver')
        self.addCleanup(painter.dispose)
        settings=painter.evaluate('p=>({requested:p.stats.readbackRequested,actual:p.context.getContextAttributes?.()??null})')
        self.assertTrue(settings['requested'],'The retained layer must request its storage policy before drawing')
        if settings['actual'] is not None:
            self.assertTrue(settings['actual']['willReadFrequently'],'The browser must retain the requested context settings')
        self.enable(True);before=self.snapshot()
        for index,scheme in enumerate(['dark','light','dark','light']):
            self.page.evaluate('scheme=>vb6Studio.figmaMode.configure({mode:"figma",scheme,units:"px"})',scheme)
            self.painted_theme(scheme,'published-'+str(index)+'-'+scheme)
            self.assertEqual(self.snapshot(),before)
            self.assertTrue(painter.evaluate('p=>p===vb6Studio.rendering.driver'),'Theme changes must retain the original painter')
        self.done()
    def test_presentation_system_idle_restore(self):
        self.page.evaluate('vb6Studio.setRenderingPolicy({backend:"canvas2d",fallbacks:["html"],text:"native"})')
        self.enable();self.page.evaluate('vb6Studio.figmaMode.configure({mode:"figma",scheme:"system",units:"px"})')
        self.page.emulate_media(color_scheme='dark')
        self.page.wait_for_function('document.documentElement.dataset.figmaScheme==="dark"')
        self.page.evaluate('vb6Studio.figmaMode.presentationReady')
        self.painted_theme('dark','system-dark-publication')
        self.page.emulate_media(color_scheme='light')
        self.page.wait_for_function('document.documentElement.dataset.figmaScheme==="light"')
        self.page.evaluate('vb6Studio.figmaMode.presentationReady')
        self.painted_theme('light','system-light-publication')
        self.page.wait_for_timeout(350)
        before=self.page.evaluate('vb6Studio.rendering.metrics.frames')
        self.page.wait_for_timeout(300)
        self.assertEqual(self.page.evaluate('vb6Studio.rendering.metrics.frames'),before,'No perpetual workspace paint loop at idle')
        self.page.evaluate('vb6Studio.figmaMode.configure({mode:"classic"})')
        self.assertIsNone(self.page.locator('html').get_attribute('data-ide-workspace'))
        self.assertEqual(self.page.evaluate('vb6Studio.rendering.getStats().active'),'canvas2d')
        self.assertEqual(self.page.locator('.figma-header').count(),0);self.done()


def load_tests(loader,standard_tests,pattern):
    names=[name for name in sorted(FigmaPresentation.__dict__) if name.startswith('test_presentation_')]
    names=select_case_names(names,configured_shard('figma-authoring'))
    return unittest.TestSuite(FigmaPresentation(name) for name in names)

if __name__=='__main__':unittest.main(verbosity=2)
