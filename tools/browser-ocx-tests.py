#!/usr/bin/env python3
"""Classic IDE component workflows; no native-binary or licensed-control certification."""
from pathlib import Path
import functools, http.server, json, os, sys, threading, traceback
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reports'/'ocx-browser';OUT.mkdir(parents=True,exist_ok=True)
SETUP=r'''()=>{
 const A=VB6StudioAPI;window.ocxLog=[];window.deferPages=false;
 const factory=(model,options)=>{const c=new A.BrowserControl(model,options),refresh=c.refresh.bind(c);c.refresh=()=>{refresh();c.node.textContent='Gauge: '+c.props.Value;};c.ocxLifecycle={initProperties(){ocxLog.push('init');},readProperties(b){c.Value=b.ReadProperty('Value',0);ocxLog.push('read');},writeProperties(b){b.WriteProperty('Value',c.Value);ocxLog.push('write');},terminate(){ocxLog.push('terminate');}};c.refresh();return c;};
 window.ocxRegistry=new A.ControlAdapterRegistry().register('Acme.Gauge.1',{designer:factory,runtime:factory,lifecycle:true,metadata:{baseName:'Gauge',displayName:'Acme Gauge',properties:[{name:'Value',default:25,description:'Current instrument reading.'},{name:'Mode',default:0,choices:[{value:0,label:'Automatic'},{value:1,label:'Manual'}]},{name:'Serial',default:'ABC',readOnly:true}],events:[{name:'Changing',params:[{name:'Value',type:'Long'},{name:'Cancel',type:'Boolean',byRef:true}]}],defaultEvent:'Changing'},propertyPages:()=>deferPages?new Promise(resolve=>{window.resolvePages=resolve;}):{Value:75,Mode:1}});
 vb6Studio.loadProject(A.newProject('OcxLab'));vb6Studio.installControlAdapters(ocxRegistry);vb6Studio.toolboxMode='extended';vb6Studio.renderToolbox();
}'''
def check(value,message='Assertion failed'):
    if not value:raise AssertionError(str(message))
def model(page):return page.evaluate('vb6Studio.activeModule.form.controls[0]')
def add(page):page.get_by_role('button',name='Acme.Gauge.1',exact=True).dblclick()
def toolbox(page):
    add(page);c=model(page);check(c['name']=='Gauge1',c);check(c['properties']['Value']==25,c)
    page.evaluate('()=>{vb6Studio.componentsDialog();}');check('Acme Gauge' in page.locator('.ide-modal-cover').inner_text());page.get_by_role('button',name='Close',exact=True).last.click()
def inspector(page):
    add(page);page.get_by_label('Mode',exact=True).select_option('1');check(model(page)['properties']['Mode']==1)
    check(page.get_by_label('Serial',exact=True).is_disabled());page.evaluate('vb6Studio.inspector.setReadOnly(true);vb6Studio.inspector.setReadOnly(false)');check(page.get_by_label('Serial',exact=True).is_disabled())
    error=page.evaluate("()=>{try{vb6Studio.setProperty('Serial','tampered');return '';}catch(e){return e.message;}}")
    check('read-only' in error,error);check(model(page)['properties']['Serial']=='ABC')
    page.get_by_label('Value',exact=True).focus();check('Current instrument reading.' in page.locator('.property-description').inner_text())
def pages(page):
    add(page);page.get_by_role('button',name='Property Pages…',exact=True).click();page.wait_for_function('vb6Studio.activeModule.form.controls[0].properties.Value===75')
    check(model(page)['properties']['Mode']==1);page.evaluate('vb6Studio.command("undo")');check(model(page)['properties']['Value']==25)
def stale(page):
    add(page);page.evaluate("()=>{deferPages=true;window.pageResult=vb6Studio.showControlPropertyPages().then(()=>'',e=>e.message);}")
    page.evaluate("vb6Studio.setProperty('Value',50);resolvePages({Value:999})")
    error=page.evaluate('pageResult');check('changed' in error,error);check(model(page)['properties']['Value']==50)
def event_handler(page):
    add(page);page.evaluate("vb6Studio.setProperty('Index',2);vb6Studio.command('defaultEvent')")
    code=page.evaluate('vb6Studio.editor.text');check('Private Sub Gauge1_Changing(Index As Integer, ByVal Value As Long, ByRef Cancel As Boolean)' in code,code)
    page.evaluate("vb6Studio.editor.objects.value='Gauge1';vb6Studio.editor.selectedObject='Gauge1';vb6Studio.editor.updateSelectors(false,true)")
    check('Changing' in page.evaluate('vb6Studio.editor.procedures.textContent'))
def lifecycle(page):
    data=page.evaluate("""()=>{const m=VB6StudioAPI.createControl('Acme.Gauge.1','RuntimeGauge'),c=ocxRegistry.create(m);c.Value=91;m.ocxState=ocxRegistry.save(c);const snapshot=JSON.parse(JSON.stringify(m));c.dispose();const other=ocxRegistry.create(snapshot);const value=other.Value,mode=VB6StudioAPI.ocxControlSite(other).Ambient.UserMode;other.dispose();return {value,mode,log:ocxLog};}""")
    check(data['value']==91,data);check(data['mode']==-1,data);check(data['log']==['init','write','terminate','read','terminate'],data)
CASES=[toolbox,inspector,pages,stale,event_handler,lifecycle]
class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
def main():
    kind=os.environ.get('VB6_BROWSER','chromium');origins=os.environ.get('VB6_OCX_ORIGINS','modular,http,file').split(',');results=[]
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT)));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    try:
      with sync_playwright() as pw:
        browser=getattr(pw,kind).launch(**({'args':['--no-sandbox'],**({'executable_path':os.environ['VB6_CHROMIUM']} if os.environ.get('VB6_CHROMIUM') else {})} if kind=='chromium' else {}));version=browser.version
        for origin in origins:
          url=(ROOT/'dist/VB6-Studio-Web.html').as_uri() if origin=='file' else f'http://127.0.0.1:{server.server_port}/dist/'+('index.html' if origin=='modular' else 'VB6-Studio-Web.html')
          for case in CASES:
            page=browser.new_page(viewport={'width':1440,'height':960});errors=[];page.on('pageerror',lambda error:errors.append(str(error)));page.set_default_timeout(12000)
            try:
              page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text()) if origin=='inline' else page.goto(url,wait_until='load');page.wait_for_function('!!globalThis.vb6Studio?.editor');page.evaluate(SETUP);case(page);check(not errors,errors)
              results.append({'origin':origin,'name':case.__name__,'passed':True});print('PASS',origin,case.__name__,flush=True)
              if case==inspector:page.screenshot(path=str(OUT/f'{kind}-{origin}-inspector.png'),caret='hide')
            except Exception as error:
              results.append({'origin':origin,'name':case.__name__,'passed':False,'error':str(error),'pageErrors':errors});print('FAIL',origin,case.__name__,error,flush=True);traceback.print_exc(limit=2)
              try:page.screenshot(path=str(OUT/f'{kind}-{origin}-{case.__name__}-failed.png'))
              except Exception:pass
            finally:page.close()
        browser.close()
    finally:server.shutdown();server.server_close();thread.join()
    report={'browser':kind,'version':version,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'tests':results};(OUT/f'{kind}.json').write_text(json.dumps(report,indent=2)+'\n');return bool(report['failed'])
if __name__=='__main__':sys.exit(main())
