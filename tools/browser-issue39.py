#!/usr/bin/env python3
"""Issue #39: exact authored caption/chrome contracts and real IDE interactions.

The bitmaps describe authored 10px artwork, not a claim of native OS-font parity.
CI runs actual HTTP/file deployments; --inline is for restricted local review.
Each assertion remains enabled in each engine. Results/screenshots are retained.
"""
from __future__ import annotations
import argparse, functools, http.server, io, json, os, shutil, subprocess, threading, time, traceback
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ap=argparse.ArgumentParser();ap.add_argument('--engine',default='chromium',choices=['chromium','firefox','webkit']);ap.add_argument('--inline',action='store_true');ap.add_argument('--baseline',action='store_true');ap.add_argument('--out');ap.add_argument('--only');args=ap.parse_args()
OUT=Path(args.out or ROOT/'reports/issue39'/args.engine);OUT.mkdir(parents=True,exist_ok=True)
CSS=(ROOT/'dist/studio.css').read_text();FIDELITY=(ROOT/'src/theme/fidelity.css').read_text();IDE=(ROOT/'dist/VB6-Studio-Web.html').read_text()
if args.baseline:
    CSS=CSS.replace(FIDELITY,'');IDE=IDE.replace(FIDELITY,'').replace('this.select(state,state.rows.indexOf(entry),true);','this.select(state,state.rows.indexOf(entry),false);')
PATTERNS=json.loads((ROOT/'tests/fixtures/caption-glyphs.json').read_text())
BUNDLE=subprocess.check_output(['node','--input-type=module','-e',"import {bundle} from './tools/bundle.mjs';console.log(bundle(process.cwd()+'/tests/fixtures/issue39.mjs','Issue39'));"],cwd=ROOT,text=True)
CALCULATOR=json.loads((ROOT/'examples/calculator.vb6web').read_text())
RESULTS=[];ERRORS=[];STATS={}
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*_): pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
HTTP=f'http://127.0.0.1:{server.server_port}/dist/VB6-Studio-Web.html'
def check(value,message):
    if not value:raise AssertionError(message)
def diff(a,b):
    if isinstance(a,bytes):a=Image.open(io.BytesIO(a))
    a=a.convert('RGB');b=b.convert('RGB');check(a.size==b.size,f'Image dimensions {a.size} != {b.size}')
    d=ImageChops.difference(a,b);return a.width*a.height-ImageChops.lighter(ImageChops.lighter(d.getchannel('R'),d.getchannel('G')),d.getchannel('B')).histogram()[0]
def case(name,fn):
    if args.only and args.only not in name:return
    contexts=set(browser.contexts);start=time.monotonic()
    try:
        details=fn();RESULTS.append({'name':name,'passed':True,'details':details});print('PASS',name,flush=True)
    except Exception as ex:
        RESULTS.append({'name':name,'passed':False,'error':str(ex)});print('FAIL',name,str(ex),flush=True);traceback.print_exc(limit=2)
        for ci,context in enumerate(browser.contexts):
            if context not in contexts:
                for pi,p in enumerate(context.pages):
                    try:p.screenshot(path=OUT/f'failure-{len(RESULTS)}-{ci}-{pi}.png')
                    except Exception:pass
    finally:
        RESULTS[-1]['milliseconds']=round((time.monotonic()-start)*1000)
        for context in browser.contexts:
            if context not in contexts:context.close()
def page(dpr=1,size=(1100,800),forced=False):
    p=browser.new_page(viewport={'width':size[0],'height':size[1]},device_scale_factor=dpr,forced_colors='active' if forced else 'none')
    p.set_default_timeout(7000);p.errors=[];p.on('pageerror',lambda e:p.errors.append(str(e)));return p
def fixture(dpr=1,html='',forced=False):
    p=page(dpr,forced=forced)
    p.set_content('<!doctype html><meta charset="utf-8"><style>'+CSS+'\nhtml,body{margin:0;min-width:0;min-height:0;background:white;overflow:visible}</style>'+html)
    p.add_script_tag(content=BUNDLE);return p
def ide(dpr=1,size=(1312,966),mode=None):
    mode=mode or ('inline' if args.inline else 'http')
    p=page(dpr,size)
    if mode=='inline':p.set_content(IDE)
    else:p.goto(HTTP if mode=='http' else (ROOT/'dist/VB6-Studio-Web.html').as_uri())
    p.wait_for_function('window.vb6Studio')
    p.evaluate('p=>{vb6Studio.loadProject(p);vb6Studio.openDocument(p.modules[0].id,"code");vb6Studio.showDebug("Immediate");}',CALCULATOR)
    p.evaluate('()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');return p
COLORS={'face':(192,192,192),'dark':(0,0,0),'light':(255,255,255),'shadow':(128,128,128),'highlight':(223,223,223),'text':(0,0,0),'gray':(128,128,128)}
def staircase(w,h,dpr,pressed=False,sunken=False):
    image=Image.new('RGB',(w*dpr,h*dpr),COLORS['face']);draw=ImageDraw.Draw(image);W,H=image.size
    layers=[(2,'highlight','tl'),(2,'shadow','br'),(1,'light','tl'),(1,'dark','br')]
    if pressed:layers=[(2,'shadow','tl'),(2,'highlight','br'),(1,'dark','tl'),(1,'light','br')]
    if sunken:layers=[(2,'dark','tl'),(2,'highlight','br'),(1,'shadow','tl'),(1,'light','br')]
    for t,c,edge in layers:
        t*=dpr;c=COLORS[c]
        if edge=='tl':draw.rectangle((0,0,W-1,t-1),fill=c);draw.rectangle((0,0,t-1,H-1),fill=c)
        else:draw.rectangle((0,H-t,W-1,H-1),fill=c);draw.rectangle((W-t,0,W-1,H-1),fill=c)
    return image

def captions(dpr):
    p=fixture(dpr,html='<div id="canvas"></div>')
    data=p.evaluate('''()=>{
      const root=document.querySelector('#canvas'),names=['close','maximize','minimize','restore','detach','help'];let i=0;
      for(const family of ['application','document','tool','runtime','floating']){
        const row=document.createElement('div');row.className=family==='application'?'app-title':family==='document'?'document-title':family==='tool'?'tool-caption':family==='runtime'?'vb-form-title':'floating-fixture';
        row.style.cssText=`position:absolute;left:20px;top:${20+i*38}px;width:300px;height:24px;display:flex;gap:12px;padding:2px`;
        for(const name of names){if(family==='floating'&&name!=='close')continue;if(['tool','runtime'].includes(family)&&['detach','help'].includes(name))continue;
          const wrap=document.createElement('span');wrap.className=['application','document'].includes(family)?'window-buttons':'';
          const b=document.createElement('button');b.id=family+'-'+name;b.dataset.glyph=name;b.dataset.family=family;b.type='button';b.setAttribute('aria-label',name);
          if(family==='runtime')b.className='vb-window-button';if(family==='floating'){b.className='command-floating-close';b.style.position='relative';b.style.top='0';b.style.right='0';}
          if(name==='detach'){b.dataset.browserDetach='';b.textContent='↗'}else if(name==='help'){b.title='About this application';b.textContent='?';if(family==='document')continue;}else b.append(Issue39.icon(name,['tool','application'].includes(family)?12:16));
          if(['application','document'].includes(family)){wrap.append(b);row.append(wrap);}else row.append(b);
        }root.append(row);i++;
      }
      return [...root.querySelectorAll('button')].map(b=>{const r=b.getBoundingClientRect(),i=b.querySelector('.icon')?.getBoundingClientRect();return {id:b.id,name:b.dataset.glyph,w:r.width,h:r.height,ix:i?i.x-r.x:(r.width-10)/2,iy:i?i.y-r.y:(r.height-10)/2,iw:i?.width??10,ih:i?.height??10}})
    }''')
    for item in data:
        b=p.locator('#'+item['id']);w,h=round(item['w']),round(item['h']);ix,iy=round(item['ix']),round(item['iy'])
        check(item['iw']==10 and item['ih']==10,f"{item['id']}: general atlas is still clipped/scaled: {item}")
        check(item['ix']==ix and item['iy']==iy,f"{item['id']}: fractional mask origin {item}")
        check(ix>=2 and iy>=2 and ix+10<=w-2 and iy+10<=h-2,f"{item['id']}: glyph overlaps bevel")
        for state in ['normal','pressed','disabled']:
            p.mouse.move(500,600);b.evaluate('(b)=>{b.disabled=false;b.blur()}')
            if state=='pressed':b.hover();p.mouse.down()
            elif state=='disabled':b.evaluate('(b)=>b.disabled=true')
            shot=b.screenshot(animations='disabled');expected=staircase(w,h,dpr,state=='pressed');draw=ImageDraw.Draw(expected)
            dx,dy=ix+(state=='pressed'),iy+(state=='pressed')
            if state=='disabled':
                for y,line in enumerate(PATTERNS[item['name']]):
                    for x,v in enumerate(line):
                        if v=='#':draw.rectangle(((dx+x+1)*dpr,(dy+y+1)*dpr,(dx+x+2)*dpr-1,(dy+y+2)*dpr-1),fill=COLORS['light'])
            for y,line in enumerate(PATTERNS[item['name']]):
                for x,v in enumerate(line):
                    if v=='#':draw.rectangle(((dx+x)*dpr,(dy+y)*dpr,(dx+x+1)*dpr-1,(dy+y+1)*dpr-1),fill=COLORS['gray' if state=='disabled' else 'text'])
            # A disabled embossed glyph is clipped at the authored button edge.
            try:changed=diff(shot,expected)
            except AssertionError as e:raise AssertionError(f"{item['id']} {state}: {e}; actual={b.bounding_box()}") from e
            if state=='pressed':p.mouse.up()
            if changed:
                (OUT/f'{item["id"]}-{state}-{dpr}-actual.png').write_bytes(shot);expected.save(OUT/f'{item["id"]}-{state}-{dpr}-expected.png')
            check(changed==0,f"{item['id']} {state} DPR {dpr}: {changed} different pixels")
    p.screenshot(path=OUT/f'captions-{dpr}.png');check(not p.errors,str(p.errors));return {'dpr':dpr,'buttons':len(data),'states':3,'pixelDifferences':0}

def menu_navigation(mode):
    p=ide(mode=mode);p.locator('.menubar [data-menu=Tools]').click();p.keyboard.press('ArrowDown')
    item=p.locator('.classic-menu [data-command=addProcedure]');item.hover()
    def state():return p.locator('.classic-menu').first.evaluate('''n=>{const rows=[...n.querySelectorAll('.popup-menu-item')];return {selected:rows.filter(r=>r.classList.contains('menu-selected')).map(r=>r.dataset.command),blue:rows.filter(r=>getComputedStyle(r).backgroundColor==='rgb(0, 0, 128)').map(r=>r.dataset.command),focus:document.activeElement.dataset.command}}''')
    s=state();check(s=={'selected':['addProcedure'],'blue':['addProcedure'],'focus':'addProcedure'},s)
    p.keyboard.press('ArrowDown');s=state();check(len(s['blue'])==1 and s['blue']==s['selected'] and s['focus']==s['selected'][0] and s['focus']!='addProcedure',s)
    p.screenshot(path=OUT/f'menu-one-highlight-{mode}.png');p.keyboard.press('Escape');check(p.evaluate('document.activeElement.dataset.menu')=='Tools','Focus not restored')
    p.locator('.menubar [data-menu=Format]').click();p.locator('.classic-menu').first.get_by_role('menuitem',name='Align',exact=True).hover();p.wait_for_function('document.querySelectorAll(".classic-menu").length===2')
    p.keyboard.press('ArrowRight');p.keyboard.press('ArrowDown')
    check(p.locator('.classic-menu').evaluate_all('ns=>ns.every(n=>n.querySelectorAll(".menu-selected").length===1)'),'Nested menus have multiple highlights')
    p.keyboard.press('Escape');p.keyboard.press('Escape');check(p.locator('.classic-menu').count()==0,'Menu session leaked')
    check(not p.errors,str(p.errors));return {'mode':mode,'pointerKeyboardHandoff':True,'nested':True}

def editor_and_tabs(dpr):
    p=ide(dpr);p.evaluate('()=>{const e=vb6Studio.editor;e.objects.value="Form";e.objects.dispatchEvent(new Event("change"));}')
    bounds=p.locator('.mdi-window.mdi-active .code-selectors').evaluate('''n=>{const r=n.getBoundingClientRect();return {height:r.height,bottom:r.bottom,children:[...n.querySelectorAll('select')].map(s=>{const q=s.getBoundingClientRect();const c=getComputedStyle(s);return {bottom:q.bottom,height:q.height,shadow:c.boxShadow}})}}''')
    check(bounds['height']==25,f'Selector row geometry changed {bounds}')
    check(all(n['bottom']<=bounds['bottom']-2 and n['height']==21 and 'inset' in n['shadow'] for n in bounds['children']),f'Selector bottom bevel clipped {bounds}')
    for label in ['Categorized','Alphabetic']:
        tab=p.get_by_role('tab',name=label,exact=True);tab.click();check(tab.get_attribute('aria-selected')=='true','Property tab did not activate')
        info=tab.evaluate('''n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n,'::after');return {bottom:r.bottom,height:s.height,offset:s.bottom,bg:s.backgroundColor,content:s.content}}''')
        check(info['height']=='1px' and info['offset']=='-2px' and info['bg']=='rgb(192, 192, 192)',f'Extra tab seam {info}')
    check(p.locator('input[data-property=Caption]').is_visible(),'Tab seam obscures property fields')
    p.screenshot(path=OUT/f'ide-selectors-tabs-{dpr}.png');check(not p.errors,str(p.errors));return {'dpr':dpr,'row':bounds,'tabSeam':'one pixel, no data-row overlap'}

def chrome_pixels(dpr):
    p=fixture(dpr,html=''.join(f'<div id="frame{i}" class="{c}" style="position:absolute;left:20px;top:{20+i*50}px;width:120px;height:40px;min-width:0;min-height:0"></div>' for i,c in enumerate(['mdi-window','dock-group','vb-form'])))
    for i in range(3):
        shot=p.locator(f'#frame{i}').screenshot();want=staircase(120,40,dpr);changed=diff(shot,want)
        if changed:(OUT/f'frame{i}-{dpr}.png').write_bytes(shot)
        check(changed==0,f'Frame {i}, {changed} non-staircase pixels')
    # Isolate the empty select so text/OS popup arrow pixels cannot mask edges.
    p=fixture(dpr,html='<div class="code-selectors" style="position:absolute;left:20px;top:20px;width:120px"><select aria-label="Object"><option></option></select></div>')
    shot=Image.open(io.BytesIO(p.locator('select').screenshot())).convert('RGB');w,h=shot.size
    shot.save(OUT/f'selector-edge-{dpr}.png')
    check(all(shot.getpixel((x,h-1))==COLORS['light'] for x in range(w)), 'Select is missing its outer bottom edge')
    check(all(shot.getpixel((x,h-dpr-1))==COLORS['highlight'] for x in range(2*dpr,w-dpr)), 'Select is missing its inner bottom edge')
    return {'dpr':dpr,'frames':3,'bottomSelectorEdges':2,'pixelDifferences':0}

def native_selector_behavior():
    p=fixture(html='<div class="code-selectors" style="width:240px"><select aria-label="Object"><option>First</option><option>Second</option><option>Third</option></select><select aria-label="Procedure"><option>One</option><option>Two</option></select></div>')
    select=p.get_by_role('combobox',name='Object',exact=True)
    info=select.evaluate("n=>({tag:n.tagName,appearance:getComputedStyle(n).appearance,arrow:getComputedStyle(n).backgroundImage})")
    check(info['tag']=='SELECT' and info['appearance']=='none' and 'linear-gradient' in info['arrow'], f'Not a native select with authored chrome: {info}')
    p.evaluate("window.selectorChanges=[];document.querySelector('select').addEventListener('change',e=>selectorChanges.push(e.target.value))")
    select.focus();p.keyboard.press('End');p.keyboard.press('Enter')
    check(select.input_value()=='Third','Native keyboard selection stopped working')
    check(p.evaluate("selectorChanges.includes('Third')"),'Native change event was lost')
    # Enter may open or confirm a native popup, depending on the engine. Close
    # that popup before asserting document-level Tab navigation.
    p.keyboard.press('Escape');p.keyboard.press('Tab')
    check(p.get_by_role('combobox',name='Procedure',exact=True).evaluate('n=>n===document.activeElement'),'Native tab navigation was lost')
    p.emulate_media(forced_colors='active')
    forced=p.evaluate('matchMedia("(forced-colors: active)").matches')
    if forced:
        check(select.evaluate("n=>getComputedStyle(n).appearance")!='none','Forced colors did not restore native appearance')
        check(select.evaluate('n=>parseFloat(getComputedStyle(n).borderBottomWidth)>0'),'Forced colors lost a real selector border')
    check(not p.errors,str(p.errors))
    return {'nativeKeyboardAndChange':True,'nativeTabOrder':True,'forcedColorsSupported':forced}

def tab_seam_pixels(dpr):
    p=fixture(dpr,html='<div style="position:absolute;left:20px;top:20px;width:240px"><div class="property-tabs"><button class="active">Alphabetic</button><button>Categorized</button></div><div class="property-grid" style="height:50px;flex:none"></div></div>')
    info=p.locator('.property-tabs .active').evaluate('n=>{const r=n.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom}}')
    image=Image.open(io.BytesIO(p.screenshot())).convert('RGB');y=round(info['bottom']*dpr)
    for x in range(round((info['x']+2)*dpr),round((info['right']-2)*dpr)):
        check(image.getpixel((x,y))==COLORS['face'],'Active tab has an extra bottom bevel pixel')
    return {'dpr':dpr,'activeTabSeamDifferences':0}

def detached_caption(mode):
    p=ide(mode=mode)
    with p.expect_popup() as opened:p.locator('.mdi-window.mdi-active [data-browser-detach]').click()
    popup=opened.value;popup.wait_for_selector('.browser-window-root[data-ready="true"]')
    # Same live document, same shared theme stylesheet; not a screenshot copy.
    mask=popup.locator('.window-buttons .icon[data-icon=close]').first
    info=mask.evaluate('n=>({w:getComputedStyle(n).width,mask:getComputedStyle(n,"::after").maskImage})')
    check(info['w']=='10px' and 'data:image/svg+xml' in info['mask'],f'Detached caption lost local CSS: {info}')
    popup.screenshot(path=OUT/f'detached-caption-{mode}.png')
    popup.close();p.wait_for_function('document.querySelector(".mdi-window.mdi-active .source-editor")')
    check(not p.errors,str(p.errors));return {'mode':mode,'liveDocumentReturned':True,'maskWidth':info['w']}

def toolbar(dpr,width):
    p=ide(dpr,size=(width,800));bar=p.locator('[data-command-bar=standard]')
    info=bar.evaluate('''n=>{const r=n.getBoundingClientRect();return {x:r.x,right:r.right,bottom:r.bottom,width:r.width,height:r.height,cw:n.clientWidth,ch:n.clientHeight,sw:n.scrollWidth,sh:n.scrollHeight,overflow:getComputedStyle(n).overflowX,children:[...n.children].filter(c=>c.getClientRects().length&&getComputedStyle(c).display!=='none').map(c=>{const q=c.getBoundingClientRect();return {left:q.left,right:q.right,bottom:q.bottom,top:q.top}})}}''')
    check(info['overflow']=='clip' and info['sw']<=info['cw'] and info['sh']<=info['ch'],f'Scrollbar/overflow {info}')
    check(all(c['left']>=info['x'] and c['right']<=info['right']+0.02 and c['bottom']<=info['bottom'] for c in info['children']),f'Wrapped command became inaccessible {info}')
    if width==1312:check(info['height']==29,f'Fitting desktop toolbar height changed: {info}')
    else:check(info['height']>29,'Narrow toolbar did not wrap')
    first=bar.locator('button:not([disabled])').first;first.focus();p.keyboard.press('End');check(p.evaluate('document.activeElement.closest("[data-command-bar=standard]")!==null'),'Toolbar keyboard navigation lost')
    # Side and floating toolbar modes retain real scrolling when required.
    p.evaluate('vb6Studio.commandBars.dock("standard","left")');check(p.locator('[data-command-bar=standard]').evaluate('n=>getComputedStyle(n).overflowY')=='auto','Vertical scroll removed')
    p.evaluate('vb6Studio.commandBars.dock("standard","float")');check(p.locator('[data-command-bar=standard]').evaluate('n=>getComputedStyle(n).overflowY')=='auto','Floating toolbar scroll removed')
    p.evaluate('vb6Studio.commandBars.dock("standard","top")');p.screenshot(path=OUT/f'toolbar-{width}-{dpr}.png');check(not p.errors,str(p.errors));return {'dpr':dpr,'width':width,'height':info['height'],'allCommandsAccessible':True}

def themes_and_disabled():
    p=fixture(html='<div class="tool-caption" id="theme"><button id="close" aria-label="Close"></button></div>');p.evaluate('document.querySelector("#close").append(Issue39.icon("close",12))')
    for theme in ['classic','standard','contrast']:
        p.locator('#theme').evaluate('(n,t)=>n.dataset.vbTheme=t',theme)
        colors=p.locator('#close .icon').evaluate('n=>({ink:getComputedStyle(n,"::after").backgroundColor,text:({classic:"rgb(0, 0, 0)",standard:"rgb(0, 0, 0)",contrast:"rgb(255, 255, 255)"})[n.closest("[data-vb-theme]").dataset.vbTheme]})')
        check(colors['ink']==colors['text'],'Caption failed to use theme ink '+theme+': '+str(colors))
    p.locator('#close').focus();check(p.locator('#close').evaluate('n=>getComputedStyle(n).outlineStyle')=='dotted','Keyboard focus ring removed')
    p.emulate_media(forced_colors='active')
    if p.evaluate('matchMedia("(forced-colors:active)").matches'):
        check(p.locator('#close').evaluate('n=>getComputedStyle(n).boxShadow')=='none','Forced-color shadow not suppressed')
        check(p.locator('#close').evaluate('n=>parseFloat(getComputedStyle(n).borderTopWidth)>0'),'Forced-color real border lost')
    p.screenshot(path=OUT/'theme-forced.png');return {'nestedThemeChanges':3,'forcedColorsSupported':p.evaluate('matchMedia("(forced-colors:active)").matches')}

def mdi_commands(mode):
    p=ide(mode=mode);win=p.locator('.mdi-window.mdi-active');key=win.get_attribute('data-mdi-key')
    win.get_by_role('button',name='Maximize document',exact=True).click();check(win.locator('[data-icon=restore]').count()==1,'Maximize did not change to restore mask')
    win.get_by_role('button',name='Restore document',exact=True).click();check(win.locator('[data-icon=maximize]').count()==1,'Restore did not change back')
    win.get_by_role('button',name='Minimize document',exact=True).click();check(win.evaluate('n=>n.classList.contains("mdi-minimized")'),'Minimize lost')
    p.evaluate('(k)=>vb6Studio.documents.mdi.restore(k)',key)
    win.get_by_role('button',name='Close current document',exact=True).click();check(p.locator(f'[data-mdi-key="{key}"]').count()==0,'Close lost')
    check(not p.errors,str(p.errors));return {'mode':mode,'maximizeRestoreMinimizeClose':True}

with sync_playwright() as pw:
    options={'headless':True}
    if args.engine=='chromium':options.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or pw.chromium.executable_path,args=['--no-sandbox'])
    browser=getattr(pw,args.engine).launch(**options);STATS={'engine':args.engine,'version':browser.version,'inline':args.inline,'baseline':args.baseline}
    for dpr in [1,2,3,4]:case(f'caption pixels, normal/pressed/disabled DPR {dpr}',lambda dpr=dpr:captions(dpr))
    for dpr in [1,2]:
        case(f'frame and selector edge pixels DPR {dpr}',lambda dpr=dpr:chrome_pixels(dpr))
        case(f'active property tab seam pixels DPR {dpr}',lambda dpr=dpr:tab_seam_pixels(dpr))
    for dpr in [1,1.25,1.5,2]:
        case(f'actual editor and property tab DPR {dpr}',lambda dpr=dpr:editor_and_tabs(dpr))
        for width in [1312,390]:case(f'actual toolbar {width}px DPR {dpr}',lambda dpr=dpr,width=width:toolbar(dpr,width))
    case('caption themes, focus and forced colors',themes_and_disabled)
    case('native selector keyboard and forced colors',native_selector_behavior)
    for mode in (['inline'] if args.inline else ['http','file']):
        case('actual IDE menu pointer/keyboard '+mode,lambda mode=mode:menu_navigation(mode))
        case('actual MDI caption commands '+mode,lambda mode=mode:mdi_commands(mode))
        case('detached caption stylesheet '+mode,lambda mode=mode:detached_caption(mode))
    browser.close()
server.shutdown()
summary={'passed':sum(r['passed'] for r in RESULTS),'failed':sum(not r['passed'] for r in RESULTS),'skipped':0}
(OUT/'results.json').write_text(json.dumps({'summary':summary,'environment':STATS,'results':RESULTS},indent=2));print(summary,flush=True)
raise SystemExit(bool(summary['failed']))
