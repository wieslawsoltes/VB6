#!/usr/bin/env python3
"""Actual source-lab DOM workflows. Inline mode is explicit and not URL-origin coverage."""
from pathlib import Path
import functools, http.server, json, os, sys, threading
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reports'/'ocx-browser';OUT.mkdir(parents=True,exist_ok=True)
def require(value, label):
    if not value: raise AssertionError(label)
def exercise(page):
    page.wait_for_function('!!window.ocxLab')
    require(page.locator('#readout').inner_text()=='25%', 'source InitProperties child label')
    page.locator('#value').fill('61');page.locator('#apply').click()
    page.wait_for_function("document.getElementById('readout').textContent==='61%'")
    require(page.evaluate('ocxLab.control.Dirty') is True,'source dirty notification')
    page.locator('#cancel').check();page.locator('#value').fill('80');page.locator('#apply').click()
    page.wait_for_function("document.getElementById('events').textContent.includes('Cancelled by the host.')")
    require(page.locator('#readout').inner_text()=='61%','source Boolean ByRef cancellation')
    page.locator('#freeze').check();page.locator('#value').fill('80');page.locator('#apply').click()
    page.wait_for_function("document.getElementById('readout').textContent==='80%'")
    page.locator('#save').click();page.wait_for_function("document.getElementById('events').textContent.includes('Saved portable state.')")
    state=json.loads(page.locator('#state').input_value());require(state['properties'][0]['value']=={'t':'number','vt':3,'v':80},'VB Long persistence subtype')
    page.locator('#freeze').uncheck();page.locator('#cancel').uncheck();page.locator('#value').fill('10');page.locator('#apply').click()
    page.wait_for_function("document.getElementById('readout').textContent==='10%'");page.locator('#load').click()
    page.wait_for_function("document.getElementById('readout').textContent==='80%'")
    page.locator('#design').click();page.wait_for_function("document.getElementById('events').textContent.includes('requires explicit')")
    require(page.evaluate('ocxLab.control.Ambient.UserMode')==-1,'design consent barrier')
    page.locator('#consent').check();page.locator('#design').click();page.wait_for_function('ocxLab.control.Ambient.UserMode===0')
    box=page.locator('#surface').bounding_box();page.mouse.click(box['x']+76,box['y']+25);page.evaluate('ocxLab.ready')
    require(page.locator('#readout').inner_text()=='80%','design mode suppresses MouseDown code')
    page.locator('#design').click();page.wait_for_function('ocxLab.control.Ambient.UserMode===-1')
    page.mouse.click(box['x']+76,box['y']+25);page.wait_for_function("Number(document.getElementById('value').value)>=24&&Number(document.getElementById('value').value)<=26")
    page.locator('#locale').click();page.wait_for_function('ocxLab.control.Ambient.LocaleID===1045')
    require(page.evaluate("ocxLab.control.get('PaintCount')")>0,'source Paint event')
    page.evaluate('ocxLab.close()');require(page.evaluate('ocxLab.control.Closed') is True,'source cleanup')
    return ['source initialization','child control updates','ByRef cancellation','outgoing event freeze','typed persistence','save/load state','explicit design consent','design input suppression','VB mouse input','ambient locale','VB Paint dispatch','termination']
def main():
    kind=os.environ.get('VB6_BROWSER','chromium');origins=os.environ.get('VB6_OCX_LAB_ORIGINS','http,file').split(',');results=[]
    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
      with sync_playwright() as pw:
        browser=getattr(pw,kind).launch(**({'args':['--no-sandbox'],**({'executable_path':os.environ['VB6_CHROMIUM']} if os.environ.get('VB6_CHROMIUM') else {})} if kind=='chromium' else {}))
        for origin in origins:
          page=browser.new_page(viewport={'width':1240,'height':1000});page.set_default_timeout(12000);errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
          try:
            file=ROOT/'dist/OCX-Source-Control-Lab.html'
            if origin=='inline':page.set_content(file.read_text())
            else:page.goto(file.as_uri() if origin=='file' else f'http://127.0.0.1:{server.server_port}/dist/OCX-Source-Control-Lab.html')
            checks=exercise(page);require(not errors,str(errors));results.append({'origin':origin,'passed':True,'checks':checks});print('PASS',kind,origin,len(checks),'source-lab checks',flush=True)
            page.screenshot(path=str(OUT/f'{kind}-source-lab-{origin}.png'))
          except Exception as error:
            results.append({'origin':origin,'passed':False,'error':str(error),'pageErrors':errors});print('FAIL',kind,origin,error,flush=True)
            try:page.screenshot(path=str(OUT/f'{kind}-source-lab-{origin}-failed.png'))
            except Exception:pass
          finally:page.close()
        browser.close()
    finally:server.shutdown();server.server_close();thread.join()
    report={'browser':kind,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'tests':results};(OUT/f'{kind}-source-lab.json').write_text(json.dumps(report,indent=2)+'\n');return bool(report['failed'])
if __name__=='__main__':sys.exit(main())
