#!/usr/bin/env python3
"""Icon coverage, state, themes, scaling and offline launch. Not native VB6 goldens.
Run after npm run build. Use --launch all on unrestricted Chromium to additionally
exercise the real file:// standalone and HTTP split-file distribution.
"""
from __future__ import annotations
import argparse, contextlib, functools, http.server, json, os, shutil, subprocess, threading, time, traceback
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/icons'
OUT.mkdir(parents=True, exist_ok=True)
FIXTURES = json.loads(subprocess.check_output(['node', str(ROOT / 'tools/icon-fixtures.mjs')], text=True))
HTML = (ROOT / 'dist/VB6-Studio-Web.html').read_text()
CSS = (ROOT / 'dist/studio.css').read_text()
RESULTS = []

def check(value, message):
    if not value:
        raise AssertionError(message)

def case(name, fn):
    start = time.perf_counter()
    try:
        details = fn()
        RESULTS.append(dict(name=name, passed=True, seconds=round(time.perf_counter()-start, 3), details=details))
        print('PASS', name, flush=True)
    except Exception as error:
        RESULTS.append(dict(name=name, passed=False, error=str(error)))
        print('FAIL', name, str(error), flush=True)
        traceback.print_exc(limit=2)

@contextlib.contextmanager
def page_for(browser, *, ide=False, dpr=1, theme='classic', forced=False, url=None):
    page = browser.new_page(viewport={'width': 1730, 'height': 1000}, device_scale_factor=dpr, forced_colors='active' if forced else 'none')
    page.set_default_timeout(10000)
    errors, external = [], []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('request', lambda r: external.append(r.url) if r.url.startswith(('http:', 'https:')) and not r.url.startswith('http://127.0.0.1:') else None)
    try:
        if ide:
            if url:
                page.goto(url)
            else:
                page.set_content(HTML)
            page.wait_for_function('!!globalThis.vb6Studio')
            page.evaluate('t=>{vb6Studio.appearance.theme=t;vb6Studio.applyAppearance();}', theme)
        else:
            page.set_content('<!doctype html><html style="height:auto;overflow:visible" data-vb-theme="'+theme+'"><head><style>'+CSS+'</style></head><body style="height:auto;overflow:visible"></body></html>')
        page.add_script_tag(content=FIXTURES['script'])
        yield page
        check(not errors, 'Browser errors: '+str(errors))
        check(not external, 'Unexpected external requests: '+str(external))
    finally:
        page.close()

def gallery(browser, theme, dpr=1, forced=False):
    with page_for(browser, theme=theme, dpr=dpr, forced=forced) as page:
        counts = page.evaluate('''()=>{
          const {icon,controlIcon,ICON_NAMES,CONTROL_ICON_TYPES}=VB6Icons;
          const root=document.createElement('main');root.id='icon-gallery';
          root.style.cssText='padding:16px;background:var(--vb-face);color:var(--vb-text);font:12px Tahoma,Arial;';
          for(const [title,names,control] of [['IDE glyphs',ICON_NAMES,false],['Toolbox controls',CONTROL_ICON_TYPES,true]]){
            const heading=document.createElement('h2');heading.textContent=title;root.append(heading);
            const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(7,1fr);gap:8px';root.append(grid);
            for(const name of names){const card=document.createElement('div');card.style.cssText='border:1px solid var(--vb-shadow);padding:6px;min-height:56px';
              const label=document.createElement('div');label.textContent=name;label.style.marginBottom='5px';card.append(label);
              const enabled=document.createElement('button');enabled.setAttribute('aria-label',name);enabled.append(control?controlIcon(name):icon(name));
              const disabled=enabled.cloneNode(true);disabled.disabled=true;disabled.setAttribute('aria-label',name+' disabled');
              card.append(enabled,disabled);if(!control)card.append(icon(name,32));grid.append(card);
            }
          }document.body.append(root);
          return {icons:ICON_NAMES.length,controls:CONTROL_ICON_TYPES.length,missing:root.querySelectorAll('[data-missing-icon]').length};
        }''')
        check(counts == {'icons':111, 'controls':39, 'missing':0}, counts)
        check(page.locator('.control-icon svg').first.evaluate('(n)=>n.getBoundingClientRect().width') == 16, 'Toolbox is not native 16px')
        check(page.locator('.icon-art').first.evaluate('(n)=>getComputedStyle(n).display') != 'none', 'Enabled artwork hidden')
        check(page.locator('button:disabled .icon-art').first.evaluate('(n)=>getComputedStyle(n).display') == 'none', 'Disabled artwork still colored')
        check(page.locator('button:disabled .icon-disabled').first.evaluate('(n)=>getComputedStyle(n).display') != 'none', 'Etched disabled artwork hidden')
        page.locator('#icon-gallery').screenshot(path=str(OUT/f'gallery-{theme}-{dpr}x{"-forced" if forced else ""}.png'))
        return counts

def ide_bars(browser, dpr=1):
    with page_for(browser, ide=True, dpr=dpr) as page:
        page.evaluate('()=>{for(const b of vb6Studio.commandBars.model.bars)b.visible=true;vb6Studio.commandBars.render();}')
        buttons = page.locator('[data-command-bar] button[data-command]').evaluate_all('(nodes)=>nodes.map(n=>({id:n.dataset.command,icon:n.querySelector("[data-icon]")?.dataset.icon,label:n.getAttribute("aria-label")}))')
        commands = {c['id']:c for c in FIXTURES['commands']}
        for button in buttons:
            check(button['icon'] == commands[button['id']]['icon'], button)
            check(bool(button['label']), 'Missing accessible command label')
        check(len(buttons) == FIXTURES['barCommands'], 'Not all four toolbars were rendered')
        check(page.locator('[data-missing-icon]').count() == 0, 'Unexpected fallback in the real IDE')
        page.mouse.move(1,1)
        page.screenshot(path=str(OUT/f'ide-all-toolbars-{dpr}x.png'))
        page.locator('[data-menu=Debug]').click()
        check(page.locator('.popup-menu-item[data-command=stepInto] [data-icon]').get_attribute('data-icon') == 'step-into', 'Menu/toolbar Step Into mismatch')
        check(page.locator('.popup-menu-item[data-command=stepOver] [data-icon]').get_attribute('data-icon') == 'step-over', 'Missing Step Over menu glyph')
        page.keyboard.press('Escape')
        page.evaluate('()=>{vb6Studio.appearance.largeToolbarIcons=true;vb6Studio.applyAppearance();}')
        sizes=page.locator('[data-command-bar=standard] [data-icon]').first.evaluate('(n)=>[n.getBoundingClientRect().width,n.firstElementChild.getBoundingClientRect().width]')
        check(sizes == [24,24], 'Large icon container clips its SVG: '+str(sizes))
        page.evaluate('()=>vb6Studio.command("objectBrowser")')
        check(page.locator('.member-kind [data-icon]').count()>0, 'Object Browser symbols missing')
        check(page.locator('[data-missing-icon]').count()==0, 'Object Browser uses unknown icon')
        return dict(buttons=len(buttons), largeSize=sizes)

def renderer(browser):
    with page_for(browser) as page:
        result=page.evaluate('''()=>{
          const {icon,controlIcon}=VB6Icons,a=icon('save'),b=icon('save');
          a.querySelector('path').setAttribute('fill','red');
          const pristine=b.querySelector('path').getAttribute('fill')!=='red';
          icon('missing');const missing=icon('not-a-command'),bad=controlIcon('<img src=x onerror=alert(1)>');
          const root=document.createElement('div');document.body.append(root);
          const button=document.createElement('button');button.append(b);root.append(button);
          const state=()=>[getComputedStyle(b.querySelector('.icon-art')).display,getComputedStyle(b.querySelector('.icon-disabled')).display];
          const enabled=state();button.disabled=true;const disabled=state();button.disabled=false;const restored=state();
          root.setAttribute('aria-disabled','true');const aria=state();root.removeAttribute('aria-disabled');
          return {pristine,enabled,disabled,restored,aria,missing:missing.dataset.missingIcon,bad:bad.dataset.missingIcon,unsafe:!!bad.querySelector('img'),focusable:b.querySelector('svg').getAttribute('focusable')};
        }''')
        check(result['pristine'] and result['enabled']==result['restored'], result)
        check(result['disabled']==result['aria'] and result['disabled'][0]=='none' and result['disabled'][1]!='none',result)
        check(result['missing']=='true' and result['bad']=='true' and not result['unsafe'] and result['focusable']=='false',result)
        return result

def nested_themes(browser):
    with page_for(browser, theme='contrast') as page:
        result=page.evaluate('''()=>{const outer=VB6Icons.icon('run'),inner=VB6Icons.icon('run'),scope=document.createElement('div');scope.dataset.vbTheme='classic';scope.append(inner);document.body.append(outer,scope);return {outer:getComputedStyle(outer.querySelector('path')).fill,inner:getComputedStyle(inner.querySelector('path')).fill,filter:getComputedStyle(inner).filter};}''')
        check(result['outer']=='rgb(0, 255, 255)' and result['inner']=='rgb(0, 0, 128)' and result['filter']=='none',result)
        return result

def launch(browser, url):
    with page_for(browser, ide=True, url=url) as page:
        check(page.locator('[data-command=properties] [data-icon=properties]').count()>0,'Built icons not loaded')
        check(page.locator('[data-missing-icon]').count()==0,'Missing icons in actual distribution')
        return {'url':url,'icons':page.locator('.pixel-icon').count()}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--launch',choices=['inline','all'],default='inline');args=parser.parse_args()
    executable=os.environ.get('CHROMIUM') or shutil.which('chromium') or shutil.which('chromium-browser') or shutil.which('google-chrome')
    with sync_playwright() as pw:
        kwargs={'headless':True,'args':['--no-sandbox']}
        if executable:kwargs['executable_path']=executable
        browser=pw.chromium.launch(**kwargs)
        for theme in ['classic','standard','contrast']:
            case('glyph gallery '+theme,lambda t=theme:gallery(browser,t))
        case('glyph gallery HiDPI',lambda:gallery(browser,'classic',2))
        case('forced colors',lambda:gallery(browser,'classic',forced=True))
        for dpr in [1,2]:case('IDE toolbars, menus and large icons '+str(dpr)+'x',lambda d=dpr:ide_bars(browser,d))
        case('renderer cache isolation, missing icons and disabled states',lambda:renderer(browser))
        case('independent nested theme colors',lambda:nested_themes(browser))
        if args.launch=='all':
            case('file standalone launch',lambda:launch(browser,(ROOT/'dist/VB6-Studio-Web.html').as_uri()))
            handler=functools.partial(http.server.SimpleHTTPRequestHandler,directory=str(ROOT/'dist'))
            with http.server.ThreadingHTTPServer(('127.0.0.1',0),handler) as server:
                thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
                try:case('HTTP split distribution launch',lambda:launch(browser,'http://127.0.0.1:'+str(server.server_port)+'/index.html'))
                finally:server.shutdown();thread.join()
        browser.close()
    report={'passed':sum(r['passed'] for r in RESULTS),'failed':sum(not r['passed'] for r in RESULTS),'launch':args.launch,'nativeGoldenComparison':False,'cases':RESULTS}
    (OUT/'validation.json').write_text(json.dumps(report,indent=2))
    print(json.dumps({k:v for k,v in report.items() if k!='cases'}))
    return 1 if report['failed'] else 0

if __name__=='__main__':
    raise SystemExit(main())
