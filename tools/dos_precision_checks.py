"""Real canvas retry pixels and strict reference-runner tests.

All expected PNGs here are synthetic test data, never native vendor goldens.
A passing test qualifies recovery/comparison behavior, not native visual parity.
"""
import hashlib
import io
import json
import tempfile
from pathlib import Path
from PIL import Image
from tui_reference import compare_png, run


def reference_checks():
    def png(image):
        data = io.BytesIO(); image.save(data, format='PNG'); return data.getvalue()

    results = []
    with tempfile.TemporaryDirectory(prefix='tui-comparison-') as temporary:
        root = Path(temporary); refs = root / 'reference'; refs.mkdir()
        actual = root / 'actual'; actual.mkdir()
        expected = Image.new('RGBA', (17, 33), (14, 1, 7, 255))
        source = png(expected)
        for name, color in [('rgb-same-alpha', (15, 1, 7, 255)), ('alpha-only', (14, 1, 7, 254))]:
            changed = expected.copy(); changed.putpixel((16, 32), color)
            result = compare_png(source, png(changed), {'width': 8, 'height': 16}, root / (name + '.png'))
            assert result['changedPixels'] == 1 and result['changedCells'] == 1, result
            assert result['firstCells'] == [[2, 2]] and not result['equal'], result
            results.append(name)
        transparent = Image.new('RGBA', (8, 16), (0, 0, 0, 0)); changed = transparent.copy()
        changed.putpixel((0, 0), (1, 0, 0, 0))
        assert compare_png(png(transparent), png(changed), {'width': 8, 'height': 16}, root / 'transparent.png')['changedPixels'] == 1
        results.append('transparent-rgb')
        assert compare_png(source, png(Image.new('RGB', (16, 32))), {'width': 8, 'height': 16}, root / 'size.png')['reason'] == 'dimensions'
        results.append('dimensions-rejected-without-rescaling')
        (refs / 'synthetic.png').write_bytes(source); (actual / 'fixture.png').write_bytes(source)
        value = {'version': 1, 'fixtures': [{'id': 'fixture', 'state': 'synthetic exact-comparison test',
            'reference': {'path': 'synthetic.png', 'sha256': hashlib.sha256(source).hexdigest(), 'width': 17, 'height': 33},
            'cell': {'width': 8, 'height': 16},
            'provenance': {'product': 'synthetic fixture', 'version': '1', 'platform': 'Pillow',
                           'method': 'authored flat image', 'source': 'not a vendor reference'}}]}
        manifest = refs / 'manifest.json'; manifest.write_text(json.dumps(value))
        report = run(manifest, actual, root / 'report', 'synthetic-test-only')
        assert report['passed'] and report['exact'], report
        value['fixtures'][0]['reference']['sha256'] = '0' * 64
        manifest.write_text(json.dumps(value))
        report = run(manifest, actual, root / 'rejected', 'synthetic-test-only')
        assert not report['passed'] and 'digest mismatch' in report['fixtures'][0]['error'], report
        assert (refs / 'synthetic.png').read_bytes() == source
        results.extend(['pinned-identical-pair', 'tamper-rejected-no-reference-update'])
    return results


def run_precision_checks(browser, root, report):
    page = browser.new_page(viewport={'width': 800, 'height': 600})
    errors = []; page.on('pageerror', lambda error: errors.append(str(error)))
    try:
        page.set_content('<!doctype html><html><body></body></html>')
        page.add_script_tag(content=(root / 'dist/vb6-runtime.js').read_text())
        cases = page.evaluate('''() => {
          const {CellBuffer,CanvasCellRenderer,FrameCellRenderer}=VB6Runtime.RuntimeAPI.TUI;
          const results=[],check=(value,message)=>{if(!value)throw Error(message);};
          const pixels=canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data);
          const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
          for(const dpr of [1,1.25,2])for(const opaque of [true,false]){
            const canvas=document.createElement('canvas'),painter=new CanvasCellRenderer(canvas,{cellWidth:9,cellHeight:18,opaque});
            const buffer=new CellBuffer(10,4);buffer.text(0,0,'RETAINED');painter.render(buffer,dpr);
            buffer.put(1,0,'X',15,1,3);buffer.put(2,2,'Y',14,3,4);
            const context=canvas.getContext('2d'),draw=context.drawImage;let calls=0,failed=false;
            context.drawImage=function(...args){if(++calls===2)throw Error('intentional partial draw');return draw.apply(this,args);};
            try{painter.render(buffer,dpr);}catch(error){check(error.message==='intentional partial draw','wrong failure');failed=true;}
            finally{context.drawImage=draw;}
            check(failed&&painter.key==='','failure was not retained');painter.render(buffer,dpr);
            const reference=document.createElement('canvas'),fresh=new CanvasCellRenderer(reference,{cellWidth:9,cellHeight:18,opaque});
            buffer.invalidate();fresh.render(buffer,dpr);
            check(equal(pixels(canvas),pixels(reference)),'retry differs from complete paint');
            const before=canvas.toDataURL();painter.render(buffer,dpr);check(canvas.toDataURL()===before,'idle paint changed pixels');
            results.push({kind:'canvas-retry',dpr,opaque,exact:true});painter.dispose();fresh.dispose();
          }
          for(const dpr of [1,1.25,2]){
            const root=document.createElement('div'),painter=new FrameCellRenderer(root,{cellWidth:9,cellHeight:18}),buffer=new CellBuffer(27,8);
            painter.setExtent(239,137);buffer.frame(0,0,27,8);painter.render(buffer,dpr);
            const before=painter.strips.map(pixels);buffer.frame(0,0,27,8,{double:true});
            const context=painter.strips[0].getContext('2d'),draw=context.drawImage;let failed=false;
            context.drawImage=()=>{throw Error('intentional frame draw');};
            try{painter.render(buffer,dpr);}catch(error){check(error.message==='intentional frame draw','wrong frame error');failed=true;}
            finally{context.drawImage=draw;}
            check(failed&&painter.key==='','frame failure reused key');buffer.frame(0,0,27,8);painter.render(buffer,dpr);
            check(painter.strips.every((canvas,i)=>equal(pixels(canvas),before[i])),'restored frame has stale or clipped pixels');
            results.push({kind:'frame-retry',dpr,exact:true});painter.dispose();
          }
          for(const dpr of [1,1.25,2])for(const opaque of [true,false]){
            const buffer=new CellBuffer(16,3);buffer.frame(0,0,16,3);buffer.put(2,1,'A',14,1,3);
            const full=document.createElement('canvas'),clipped=document.createElement('canvas');
            const a=new CanvasCellRenderer(full,{cellWidth:9,cellHeight:18,opaque}),b=new CanvasCellRenderer(clipped,{cellWidth:9,cellHeight:18,opaque});
            a.render(buffer,dpr);buffer.invalidate();b.setExtent(137,43);b.render(buffer,dpr);
            check(clipped.width===Math.round(137*dpr)&&clipped.height===Math.round(43*dpr),'viewport extent differs');
            const expected=Array.from(full.getContext('2d').getImageData(0,0,clipped.width,clipped.height).data);
            check(equal(pixels(clipped),expected),'partial viewport stretched its cell lattice');
            results.push({kind:'viewport-crop',dpr,opaque,exact:true});a.dispose();b.dispose();
          }
          return results;
        }''')
        checks = reference_checks()
        assert not errors, errors
        result = {'passed': True, 'canvasCases': cases, 'comparisonChecks': checks, 'errors': errors,
                  'scope': 'Synthetic recovery/reference-runner tests; no vendor-pixel certification.'}
        (report / 'precision.json').write_text(json.dumps(result, indent=2))
        return result
    finally:
        page.close()
