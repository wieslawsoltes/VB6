#!/usr/bin/env python3
"""Classic CSS pixel and retained-HTML regression suite. No network required.

Integer-DPI bevels are compared against independently drawn pixel staircases,
not just another copy of the same CSS. Fractional DPI preserves box geometry.
List checks exercise the production implementation and its retained DOM contract.
"""
from __future__ import annotations
import argparse, io, json, os, platform, shutil, subprocess, time, traceback
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--engine',choices=['chromium','firefox','webkit'],default='chromium')
parser.add_argument('--out',default=str(ROOT/'reports/classic-html'))
args=parser.parse_args()
OUT=Path(args.out);OUT.mkdir(parents=True,exist_ok=True)
CSS=(ROOT/'dist/studio.css').read_text();BEVEL=(ROOT/'src/theme/bevels.css').read_text()
RUNTIME=(ROOT/'dist/vb6-controls.css').read_text()
IDE=(ROOT/'dist/VB6-Studio-Web.html').read_text()
BASE=CSS.replace(BEVEL,'')
BUNDLE=subprocess.check_output(['node','--input-type=module','-e',"import {bundle} from './tools/bundle.mjs'; console.log(bundle(process.cwd()+'/src/ide/virtual-list.js','ListTest'));"],cwd=ROOT,text=True)
RESULTS=[];METRICS={}
def check(value,message):
    if not value:raise AssertionError(message)
def pixels(a,b):
    if isinstance(a,bytes):a=Image.open(io.BytesIO(a))
    if isinstance(b,bytes):b=Image.open(io.BytesIO(b))
    a=a.convert('RGB');b=b.convert('RGB')
    check(a.size==b.size,f'Image sizes differ: {a.size} {b.size}')
    diff=ImageChops.difference(a,b)
    return sum(any(p) for p in diff.getdata())
def case(name,fn):
    contexts=set(browser.contexts);start=time.perf_counter()
    try:
        details=fn();RESULTS.append(dict(name=name,passed=True,details=details,ms=round((time.perf_counter()-start)*1000,2)));print('SKIP' if isinstance(details,dict) and details.get('skipped') else 'PASS',name,flush=True)
    except Exception as e:
        RESULTS.append(dict(name=name,passed=False,error=str(e)));print('FAIL',name,str(e),flush=True);traceback.print_exc(limit=3)
    finally:
        for ctx in browser.contexts:
            if ctx not in contexts:ctx.close()
def page(dpr=1,css=CSS,html='',forced=False):
    p=browser.new_page(viewport={'width':1100,'height':800},device_scale_factor=dpr,forced_colors='active' if forced else 'none')
    p.set_default_timeout(5000);p.errors=[];p.on('pageerror',lambda e:p.errors.append(str(e)))
    p.set_content('<!doctype html><html><head><meta charset="utf-8"><style>'+css+'\nhtml,body{margin:0;min-width:0;min-height:0;background:white;overflow:visible}</style></head><body>'+html+'</body></html>')
    return p
COLORS={
 'classic':dict(face='#c0c0c0',dark='#000000',light='#ffffff',shadow='#808080',highlight='#dfdfdf'),
 'standard':dict(face='#d4d0c8',dark='#404040',light='#ffffff',shadow='#808080',highlight='#e9e7e3')
}
def golden(w,h,scale,c,pressed=False):
    image=Image.new('RGB',(w*scale,h*scale),c['face']);draw=ImageDraw.Draw(image)
    # Paint nested L-shaped strips back-to-front. The first listed CSS shadow
    # is on top: the bottom/right corner owns each step (no diagonal triangles).
    layers=[(2,c['shadow'],'tl'),(2,c['highlight'],'br'),(1,c['dark'],'tl'),(1,c['light'],'br')] if pressed else [(2,c['highlight'],'tl'),(2,c['shadow'],'br'),(1,c['light'],'tl'),(1,c['dark'],'br')]
    W,H=image.size
    for thick,color,corner in layers:
        t=thick*scale
        if corner=='tl':draw.rectangle((0,0,W-1,t-1),fill=color);draw.rectangle((0,0,t-1,H-1),fill=color)
        else:draw.rectangle((0,H-t,W-1,H-1),fill=color);draw.rectangle((W-t,0,W-1,H-1),fill=color)
    return image
with sync_playwright() as pw:
    options={'headless':True}
    if args.engine=='chromium':options.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or pw.chromium.executable_path,args=['--no-sandbox'])
    browser=getattr(pw,args.engine).launch(**options)
    METRICS.update(browser=browser.version,engine=args.engine,platform=platform.platform(),physicalGPUPerformanceQualified=False)
    for dpr in [1,2,3,4]:
        def bevel_pixels(dpr=dpr):
            p=page(dpr,html='<div data-vb-theme="classic"><button id="raised" class="classic-bevel-raised" aria-label="test button" style="position:absolute;left:16px;top:16px;width:40px;height:24px;padding:0;background:var(--vb-face);appearance:none"></button></div>')
            shot=p.locator('#raised').screenshot();expected=golden(40,24,dpr,COLORS['classic']);changed=pixels(shot,expected)
            (OUT/f'raised-{dpr}.png').write_bytes(shot);expected.save(OUT/f'expected-raised-{dpr}.png')
            check(changed==0,f'{changed} pixels differ from independent staircase reference')
            p.locator('#raised').hover();p.mouse.down();shot=p.locator('#raised').screenshot();changed=pixels(shot,golden(40,24,dpr,COLORS['classic'],True));p.mouse.up()
            (OUT/f'pressed-{dpr}.png').write_bytes(shot);check(changed==0,f'{changed} pressed pixels differ')
            p.locator('#raised').evaluate('(b)=>b.disabled=true');shot=p.locator('#raised').screenshot()
            check(pixels(shot,expected)==0,'Disabled bevel became pressed')
            # The container variant preserves real border metrics and uses an
            # equivalent border-box staircase. Compare to the same independent
            # pixel oracle, including corner ownership, not another CSS sample.
            p=page(dpr,html='<div class="vb-form" style="left:16px;top:16px;width:40px;height:24px;min-width:0"></div>')
            shot=p.locator('.vb-form').screenshot();(OUT/f'form-staircase-{dpr}.png').write_bytes(shot)
            check(pixels(shot,expected)==0,'Container staircase differs from the independent reference')
            return {'dpr':dpr,'containerChangedPixels':0,'normalChangedPixels':0,'pressedChangedPixels':0,'disabledChangedPixels':0}
        case(f'independent normal/pressed/disabled staircase pixels at DPR {dpr}',bevel_pixels)
    FIXTURE='''<div data-vb-theme="classic">
    <div class="vb-form" style="left:10px;top:10px;width:250px"><div class="vb-form-title"><span class="caption" data-geometry>Form1</span><button class="vb-window-button" aria-label="Close"><span data-geometry>X</span></button></div><div class="vb-form-content" data-geometry style="height:40px"></div></div>
    <div class="vb-control" style="left:10px;top:90px;width:100px;height:26px"><input class="vb-text-input" value="Hello" data-geometry></div>
    <button class="vb-control vb-command" style="left:130px;top:90px;width:100px;height:26px" data-geometry><span data-geometry>OK</span></button>
    <div class="ide-dialog" style="position:absolute;left:300px;top:10px;width:350px"><div class="vb-form-title" data-geometry>Options</div><div class="ide-dialog-body" data-geometry>Settings</div><div class="ide-dialog-footer"><button data-geometry><span data-geometry>OK</span></button></div></div>
    <div class="classic-menu" style="left:10px;top:160px"><button class="popup-menu-item" data-geometry>Open</button><button class="popup-menu-item" data-geometry>Save</button></div>
    <div class="window-buttons" style="position:absolute;left:400px;top:180px"><button data-geometry><span data-geometry>X</span></button></div>
    <div class="vb-form vb-borderless" style="left:10px;top:260px;width:120px"><div class="vb-form-content" data-geometry style="height:20px">No border</div></div>
    <div class="vb-control vb-classic-combo" style="left:10px;top:320px;width:160px;height:24px;display:flex"><input class="vb-combo-field" data-geometry value="Item"><button class="vb-combo-arrow" data-geometry><i></i></button></div>
    </div>'''
    for dpr in [1,1.25,1.5,1.75,2]:
        def geometry(dpr=dpr):
            p=page(dpr,BASE,FIXTURE)
            measure='''()=>[...document.querySelectorAll('[data-geometry]')].map(n=>{const r=n.getBoundingClientRect();return {class:n.className,rect:[r.x,r.y,r.width,r.height]}})'''
            before=p.evaluate(measure);p.add_style_tag(content=BEVEL);after=p.evaluate(measure)
            diffs=[{'before':a,'after':b} for a,b in zip(before,after) if a!=b]
            check(not diffs,'Authored box/content geometry changed: '+json.dumps(diffs))
            check(p.locator('.vb-borderless').evaluate('(n)=>getComputedStyle(n).boxShadow')=='none','Borderless form acquired chrome')
            p.screenshot(path=OUT/f'controls-{dpr}.png')
            return {'dpr':dpr,'rectangles':len(before),'changedRectangles':len(diffs)}
        case(f'HTML authored bounds and content origins at DPR {dpr}',geometry)
    def themes():
        p=page(html='<div data-vb-theme="contrast"><div data-vb-theme="classic"><button class="classic-bevel-raised" id="nested">OK</button></div></div>')
        shadow=p.locator('#nested').evaluate('(n)=>getComputedStyle(n).boxShadow')
        check('rgb(128, 128, 128)' in shadow and 'rgb(223, 223, 223)' in shadow,'Nested theme inherited resolved parent bevel colors: '+shadow)
        p.locator('#nested').focus();check(p.locator('#nested').evaluate('(n)=>getComputedStyle(n).outlineStyle')=='dotted','Keyboard focus ring lost')
        p.locator('#nested').evaluate('(n)=>n.parentElement.dataset.vbTheme="standard"')
        second=p.locator('#nested').evaluate('(n)=>getComputedStyle(n).boxShadow')
        check(shadow!=second,'Theme changes did not repaint bevel')
        return {'classic':shadow,'standard':second}
    case('nested theme tokens and keyboard focus',themes)
    def forced_colors():
        p=page(html=FIXTURE,forced=True)
        if not p.evaluate("matchMedia('(forced-colors: active)').matches"):
            return {'skipped':'This browser does not support forced-colors emulation; no forced-colors pass is claimed'}
        info=p.locator('.vb-command').evaluate('(n)=>{const s=getComputedStyle(n);return {border:s.borderTopWidth,shadow:s.boxShadow}}')
        check(info['border']=='1px','Forced colors lost the real button border')
        check(info['shadow']=='none','Forced-colors shadow suppression not respected')
        p.screenshot(path=OUT/'forced-colors.png');return info
    case('forced-colors uses real borders',forced_colors)
    def lists():
        p=page(html='<div id="lists" style="display:flex;gap:20px;padding:16px"></div>');p.add_script_tag(content=BUNDLE)
        result=p.evaluate('''async()=>{
          const check=(x,m)=>{if(!x)throw Error(m)};
          const list=new ListTest.ToolList('Retained items');list.root.style.cssText='position:relative;overflow:auto;width:260px;height:190px;flex:none';document.querySelector('#lists').append(list.root);
          const items=Array.from({length:10000},(_,i)=>({key:String(i),label:'Item '+String(i).padStart(5,'0'),glyph:'▣'}));list.set(items);list.cancelPaint();
          const initial=[...list.layer.children];const observer=new MutationObserver(()=>{});observer.observe(list.root,{subtree:true,childList:true,attributes:true,characterData:true});
          for(let i=0;i<100;i++)list.paint();const unchanged=observer.takeRecords();check(unchanged.length===0,'Unchanged paints wrote '+unchanged.length+' DOM mutations');check(initial.every((n,i)=>n===list.layer.children[i]),'Unchanged paint replaced visible rows');
          list.select(1);check(initial.every((n,i)=>n===list.layer.children[i]),'Selection replaced rows');check(list.root.getAttribute('aria-activedescendant')===list.id+'-1','Active descendant incorrect');
          check(list.layer.querySelectorAll('[aria-selected=true]').length===1,'Selection flags incorrect');
          items[1].label='<unsafe & label>';items[1].glyph='◇';list.paint();check(list.rows.get(1).labelNode.textContent==='<unsafe & label>','Label update lost/treated as markup');check(list.rows.get(1).glyphNode.querySelector('[data-icon=method]'),'Icon update missing');
          list.root.focus();list.root.dispatchEvent(new KeyboardEvent('keydown',{key:'End',bubbles:true}));check(list.selected===9999,'End navigation failed');check(list.rows.size<=16,'Visible node count not bounded');check(list.root.querySelector('[aria-posinset="10000"]').getAttribute('aria-setsize')==='10000','ARIA item position/size wrong');
          list.root.dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}));check(list.selected===0,'Home navigation failed');
          list.set(items.slice(0,2));check(list.rows.size===2,'Shrinking list retained stale rows');list.set([]);check(list.layer.children.length===0&&!list.root.hasAttribute('aria-activedescendant'),'Empty list retained rows/selection');
          const frame=document.createElement('iframe');document.body.append(frame);frame.contentDocument.body.append(list.root);list.transferDocument();list.set(items.slice(0,20));list.select(5);check(list.rows.get(5).node.ownerDocument===frame.contentDocument,'Retained row was not adopted');check(list.observerWindow===frame.contentWindow,'Observer remained in previous window');list.dispose();check(list.rows.size===0,'Disposed list retained cache');observer.disconnect();frame.remove();
          return {items:10000,unchangedPaints:100,unchangedMutations:unchanged.length,visibleRows:initial.length,detachedDocumentAdoption:true};
        }''')
        check(not p.errors,str(p.errors));return result
    case('retained list identity, sparse updates, ARIA, navigation and adoption',lists)
    def ide_smoke():
        p=page();p.set_content(IDE);p.wait_for_function('window.vb6Studio')
        p.evaluate('vb6Studio.optionsDialog();undefined')
        p.get_by_role('button',name='Cancel',exact=True).click()
        p.screenshot(path=OUT/'ide.png');check(not p.errors,str(p.errors));return {'startup':True,'optionsCancel':True}
    case('standalone IDE startup and classic Options interaction',ide_smoke)
    browser.close()
summary={'passed':0,'failed':0,'skipped':0}
for result in RESULTS:
    skipped=isinstance(result.get('details'),dict) and bool(result['details'].get('skipped'))
    summary['skipped' if skipped else 'passed' if result['passed'] else 'failed']+=1
(OUT/'report.json').write_text(json.dumps(dict(summary=summary,results=RESULTS,metrics=METRICS),indent=2))
print(json.dumps(summary),flush=True)
raise SystemExit(bool(summary['failed']))
