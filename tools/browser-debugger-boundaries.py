#!/usr/bin/env python3
"""Deployed modular HTTP, standalone HTTP/file DOM/runtime workflows.
Explicit VB6_DEBUGGER_ORIGINS=inline is a restricted local mode, not origin coverage.
Native UI uses a labelled transport fixture;
real CDB/Windows behavior is tested independently by native-debugger-smoke.mjs.
"""
from pathlib import Path
import importlib.util
import json
import os
import shutil
import traceback
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from playwright.sync_api import sync_playwright, expect

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('debugger_runtime',ROOT/'tools/browser-debugger-runtime.py')
base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
REPORT=ROOT/'reports/debugger-boundaries';REPORT.mkdir(parents=True,exist_ok=True)
TOKEN='native-ui-test-token-never-persisted-0123456789'


def versioned(page):
    code='Sub Main()\nWorker\nWorker\nEnd Sub\nSub Worker()\nDebug.Print 1\nDebug.Print 2\nEnd Sub'
    base.project(page,code)
    page.evaluate('vb6Studio.breakpoints=[{module:"M",line:6}];vb6Studio.syncBreakpoints()')
    base.command(page,'run');base.paused(page)
    page.evaluate("""()=>{const input=vb6Studio.editor.input;input.value=input.value.replace('Debug.Print 1\\n','');input.dispatchEvent(new Event('input',{bubbles:true}));}""")
    page.wait_for_function('vb6Studio.pendingEdits')
    page.keyboard.press('F8');base.paused(page,2)
    page.wait_for_function('vb6Studio.stack.at(-1)?.retained')
    source=page.get_by_label('Retained executing source',exact=True)
    base.check(source.input_value()==code)
    base.check(page.evaluate('vb6Studio.stack.at(-1).line')==7)
    base.check(page.evaluate('vb6Studio.stack.at(-1).revision')==0)
    base.check(source.get_attribute('readonly') is not None)
    page.screenshot(path=str(REPORT/'retained-source.png'))
    page.evaluate('vb6Studio.breakpoints=[];vb6Studio.syncBreakpoints()')
    base.command(page,'run')
    page.wait_for_function('vb6Studio.output.filter(x=>x==="2").length===2')
    base.check(page.evaluate('vb6Studio.output')==['1','2','2'])
    base.command(page,'stop');page.wait_for_function('vb6Studio.runState==="design"')


def event_project(page):
    page.evaluate("""()=>{
      const p=VB6StudioAPI.newProject('Immediate events'),form=p.modules[0];
      const button=VB6StudioAPI.createControl('CommandButton','Command1',300,300);button.properties.Caption='Click event';
      const timer=VB6StudioAPI.createControl('Timer','Timer1',300,900);timer.properties.Interval=40;timer.properties.Enabled=0;
      form.form.controls=[button,timer];
      form.code='Private Sub Form_Initialize()\\nDebug.Print "initialize"\\nEnd Sub\\nPrivate Sub Form_Load()\\nDebug.Print "load"\\nEnd Sub\\nPrivate Sub Command1_Click()\\nDebug.Print "clicked"\\nTimer1.Enabled = True\\nEnd Sub\\nPrivate Sub Timer1_Timer()\\nTimer1.Enabled = False\\nDebug.Print "timer"\\nEnd Sub';
      p.modules.unshift({id:'m',kind:'module',name:'M',code:'Sub Main()\\nDebug.Print "startup"\\nEnd Sub\\nSub Scratch()\\nOpen "/scratch.txt" For Output As #1\\nPrint #1, "temporary"\\nClose #1\\nEnd Sub'});
      p.startup='Sub Main';vb6Studio.loadProject(p);vb6Studio.openDocument('m','code');globalThis.debugPauses=[];vb6Studio.on('pause',e=>debugPauses.push(e));
    }""")


def events(page):
    event_project(page)
    page.evaluate('vb6Studio.breakpoints=[{module:"Form1",line:12}];vb6Studio.syncBreakpoints()')
    base.command(page,'immediateEvents')
    page.wait_for_function('vb6Studio.designImmediate.promoted&&vb6Studio.runState==="running"')
    base.check('startup' not in page.evaluate('vb6Studio.output'))
    page.evaluate('vb6Studio.executeImmediate("Form1.Show")')
    frame=page.locator('iframe[title="Design-mode Immediate runtime"]').element_handle().content_frame()
    frame.get_by_role('button',name='Click event',exact=True).click()
    info=base.paused(page)
    base.check(info['procedure']=='Timer1_Timer',info)
    base.check(page.evaluate('vb6Studio.output')==['initialize','load','clicked'])
    page.keyboard.press('F8');base.paused(page,2)
    page.evaluate('vb6Studio.breakpoints=[];vb6Studio.syncBreakpoints()')
    base.command(page,'run');base.output(page,'timer')
    page.evaluate('vb6Studio.executeImmediate("Scratch")')
    base.command(page,'stop');page.wait_for_function('vb6Studio.runState==="design"&&!vb6Studio.runtimeFrame')
    base.check(page.locator('.design-immediate-window').count()==0)
    base.check('/scratch.txt' not in page.evaluate('JSON.stringify(vb6Studio.project.vfs)'))
    base.command(page,'run');base.output(page,'startup')
    base.check(page.evaluate('vb6Studio.output.filter(x=>x==="startup").length')==1)


def event_replace(page):
    event_project(page);base.command(page,'immediateEvents');page.wait_for_function('vb6Studio.designImmediate.promoted')
    page.evaluate('vb6Studio.executeImmediate("Form1.Show")')
    base.project(page,'Sub Main()\nDebug.Print "replacement"\nEnd Sub')
    page.wait_for_function('!vb6Studio.runtimeFrame&&vb6Studio.runState==="design"')
    base.check(page.locator('.runtime-window').count()==0)
    base.command(page,'run');base.output(page,'replacement')


class NativeTransportFixture:
    def __init__(self,page):
        self.calls=[];self.delay_step=False;self.step_reply=None;self.step_polled=False;self.state={'id':'test-session','state':'paused','stateRevision':2,'pid':1234,'pauseId':1,'breakpoints':[],'stepMode':'assembly'}
        page.route('http://127.0.0.1:8767/debugger',self.handle)
    def handle(self,route):
        req=route.request
        headers={'Content-Type':'application/json','Access-Control-Allow-Origin':req.headers.get('origin','null'),'Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Allow-Methods':'POST','Access-Control-Allow-Private-Network':'true'}
        if req.method=='OPTIONS':route.fulfill(status=204,headers=headers,body='');return
        base.check(req.headers.get('authorization')=='Bearer '+TOKEN,req.headers)
        value=json.loads(req.post_data);method=value['method'];args=value['params'];self.calls.append(value)
        result={}
        if method=='capabilities':result={'version':1,'engine':'CDB','interpreterFrames':False}
        elif method=='listProcesses':result={'processes':[{'pid':1234,'name':'NativeFixture'}]}
        elif method in ('attach','status'):result=dict(self.state)
        elif method=='events':
            if self.step_polled and self.delay_step:return  # deliberately hold later polls
            if self.step_reply:self.step_polled=True
            result={'events':[],'cursor':0,'dropped':False,'status':dict(self.state)}
        elif method=='stack':
            symbol='NativeFixture!AfterStep' if self.step_polled else 'NativeFixture!Tick'
            result={'frames':[{'index':0,'returnAddress':'0x1001','symbol':symbol}],'text':symbol}
        elif method=='registers':result={'registers':{'rip':'0x1000','rax':'0x5'}}
        elif method in ('stepInto','stepOver','stepOut'):
            result={**self.state,'state':'running','stateRevision':self.state['stateRevision']+1}
            self.state['pauseId']+=1;self.state['stateRevision']+=2
            if self.delay_step:self.step_reply=(route,headers,result);return
        elif method=='setRegister':self.state['pauseId']+=1;result={'registers':{'rip':'0x1000','rax':args['value']}}
        elif method=='threads':result={'threads':[{'index':0,'pid':1234,'tid':99,'current':True,'details':'Unfrozen'}]}
        elif method=='processes':result={'processes':[{'index':0,'pid':1234,'name':'NativeFixture','current':True}]}
        elif method in ('setBreakpoint','setDataBreakpoint'):
            item={'id':len(self.state['breakpoints'])+1,'location':args.get('location',args.get('address')),'enabled':True}
            if method=='setDataBreakpoint':item.update(kind='data',access=args['access'],size=args['size'])
            self.state['breakpoints'].append(item);result=item
        elif method=='enableBreakpoint':
            next(bp for bp in self.state['breakpoints'] if bp['id']==args['id'])['enabled']=args['enabled'];result=dict(self.state)
        elif method=='removeBreakpoint':
            self.state['breakpoints']=[bp for bp in self.state['breakpoints'] if bp['id']!=args['id']];result=dict(self.state)
        elif method=='detach':result={**self.state,'state':'closed'}
        elif method=='evaluate':result={'text':'Evaluate expression: 42 = 00000000`0000002a'}
        elif method=='readMemory':result={'address':args['address'],'bytes':[1,None,3,4],'unreadableBytes':1}
        elif method=='writeMemory':self.state['pauseId']+=1;result={'address':args['address'],'bytes':args['bytes'],'unreadableBytes':0,'pauseId':self.state['pauseId']}
        elif method=='stepMode':self.state['stepMode']=args['mode'];result={'mode':args['mode']}
        elif method=='allProcessStacks':self.state['pauseId']+=1;result={'pauseId':self.state['pauseId'],'processes':[{'process':{'pid':1234,'name':'NativeFixture'},'text':'NativeFixture!Tick'}]}
        else:result={'text':method}
        route.fulfill(status=200,headers=headers,body=json.dumps({'result':result}))


def native_connect(page):
    fixture=NativeTransportFixture(page);base.command(page,'nativeDebugger')
    pane=page.get_by_label('Native Debugger Window',exact=True)
    pane.get_by_role('button',name='Connect…',exact=True).click()
    page.get_by_label('Native debugger token',exact=True).fill(TOKEN)
    page.get_by_role('dialog',name='Native Debugger Connection',exact=True).get_by_role('button',name='Connect',exact=True).click()
    page.wait_for_function('document.querySelector("[aria-label=\\"Native debugger state\\"]").textContent.startsWith("Connected")')
    pane.get_by_role('button',name='Attach…',exact=True).click()
    page.get_by_label('Windows process to attach',exact=True).select_option('1234')
    page.get_by_role('dialog',name='Attach to Process',exact=True).get_by_role('button',name='Attach',exact=True).click()
    page.wait_for_function('document.querySelector("[aria-label=\\"Native debugger state\\"]").textContent.includes("PID 1234")')
    expect(pane.get_by_label('Native debugger result',exact=True)).to_contain_text('NativeFixture!Tick')
    return fixture,pane


def native_steps(page):
    fixture,pane=native_connect(page)
    base.check('NativeFixture!Tick' in pane.get_by_label('Native debugger result',exact=True).inner_text())
    pane.get_by_role('button',name='Step Into',exact=True).click()
    page.wait_for_function('document.querySelector("[aria-label=\\"Native debugger state\\"]").textContent.includes("pause 2")')
    base.check(next(x for x in fixture.calls if x['method']=='stepInto')['params']['pauseId']==1)
    pane.get_by_label('Native debugger view',exact=True).select_option('Registers')
    page.wait_for_function('document.querySelector("[aria-label=\\"Native debugger result\\"]").textContent.includes("rax")')
    pane.get_by_label('Native expression',exact=True).fill('6 * 7')
    pane.get_by_label('Native expression',exact=True).press('Enter')
    page.wait_for_function('document.querySelector("[aria-label=\\"Native debugger result\\"]").textContent.includes("42")')
    page.screenshot(path=str(REPORT/'native-debugger.png'))
    pane.get_by_role('button',name='Disconnect',exact=True).click()
    page.wait_for_function('document.querySelector("[aria-label=\\"Native debugger state\\"]").textContent==="Disconnected"')
    base.check(any(x['method']=='detach' for x in fixture.calls))
    base.check(TOKEN not in page.evaluate('JSON.stringify(vb6Studio.project)'))
    base.check(TOKEN not in page.evaluate('JSON.stringify(vb6Studio.layoutSnapshot())'))
    base.check(page.get_by_label('Native debugger token',exact=True).count()==0)


def native_memory(page):
    fixture,pane=native_connect(page)
    pane.get_by_role('button',name='Breakpoint…',exact=True).click()
    page.get_by_role('dialog',name='Native Breakpoint',exact=True).locator('input').fill('NativeFixture!Tick')
    page.get_by_role('dialog',name='Native Breakpoint',exact=True).get_by_role('button',name='OK',exact=True).click()
    page.wait_for_function('document.querySelector("[aria-label=\\"Native debugger result\\"]").textContent.includes("NativeFixture!Tick")')
    pane.get_by_role('button',name='Memory…',exact=True).click()
    page.get_by_label('Native memory address',exact=True).fill('0x1000')
    dialog=page.get_by_role('dialog',name='Native Memory',exact=True)
    dialog.get_by_role('button',name='Read',exact=True).click()
    page.wait_for_function('document.querySelector(".ide-dialog pre")?.textContent.includes("??")')
    page.get_by_label('Native memory bytes to write',exact=True).fill('2a 00')
    dialog.get_by_role('button',name='Write Bytes',exact=True).click()
    page.wait_for_function('document.querySelector(".ide-dialog pre")?.textContent.includes("2a 00")')
    base.check(next(x for x in fixture.calls if x['method']=='writeMemory')['params']['bytes']==[42,0])
    dialog.get_by_role('button',name='Close',exact=True).click()
    expect(pane.get_by_label('Native debugger state',exact=True)).to_contain_text('pause 2')
    pane.get_by_role('button',name='Step Into',exact=True).click()
    expect(pane.get_by_label('Native debugger state',exact=True)).to_contain_text('pause 3')
    base.check(next(x for x in fixture.calls if x['method']=='stepInto')['params']['pauseId']==2)
    pane.get_by_role('button',name='Detach',exact=True).click()


def native_data_breakpoint(page):
    fixture,pane=native_connect(page)
    pane.get_by_role('button',name='Data Breakpoint…',exact=True).click()
    dialog=page.get_by_role('dialog',name='Native Data Breakpoint',exact=True)
    dialog.get_by_label('Data breakpoint address',exact=True).fill('0x2000')
    dialog.get_by_label('Data breakpoint size',exact=True).select_option('4')
    dialog.get_by_label('Data breakpoint access',exact=True).select_option('readWrite')
    dialog.get_by_role('button',name='Add',exact=True).click()
    expect(pane.get_by_label('Native debugger result',exact=True)).to_contain_text('readWrite (4 bytes)')
    request=next(x for x in fixture.calls if x['method']=='setDataBreakpoint')
    base.check(request['params']=={'session':'test-session','pauseId':1,'address':'0x2000','access':'readWrite','size':4},request)
    pane.get_by_role('button',name='Remove',exact=True).click()
    expect(pane.get_by_label('Native debugger result',exact=True)).not_to_contain_text('readWrite')
    base.check(not fixture.state['breakpoints'])
    pane.get_by_role('button',name='Detach',exact=True).click()


def native_poll_race(page):
    fixture,pane=native_connect(page);fixture.delay_step=True
    pane.get_by_role('button',name='Step Into',exact=True).click()
    for _ in range(100):
        if fixture.step_polled:break
        page.wait_for_timeout(25)
    base.check(fixture.step_polled,'A real poll must observe the new stop while the command is pending')
    route,headers,result=fixture.step_reply
    route.fulfill(status=200,headers=headers,body=json.dumps({'result':result}))
    expect(pane.get_by_role('button',name='Step Into',exact=True)).to_be_enabled()
    expect(pane.get_by_label('Native debugger state',exact=True)).to_contain_text('paused — pause 2')
    expect(pane.get_by_label('Native debugger result',exact=True)).to_contain_text('NativeFixture!AfterStep')
    base.check(any(x['method']=='stack' and x['params']['pauseId']==2 for x in fixture.calls))


def native_bad_endpoint(page):
    fixture=NativeTransportFixture(page);base.command(page,'nativeDebugger');pane=page.get_by_label('Native Debugger Window',exact=True)
    pane.get_by_role('button',name='Connect…',exact=True).click()
    page.get_by_label('Native debugger endpoint',exact=True).fill('https://example.com/debugger')
    page.get_by_label('Native debugger token',exact=True).fill(TOKEN)
    page.get_by_role('dialog',name='Native Debugger Connection',exact=True).get_by_role('button',name='Connect',exact=True).click()
    page.wait_for_function('document.querySelector("[aria-label=\\"Native debugger result\\"]").textContent.includes("local bridge URL")')
    base.check(not fixture.calls)


def main():
    cases=[('Versioned Edit and Continue exposes retained source without replay',versioned),('Event-driven Immediate debugs actual timer and button callbacks',events),('Replacing a promoted Immediate project disposes the runtime',event_replace),('Native debugger classic controls and private connection token (transport fixture)',native_steps),('Native breakpoint and explicit memory UI (transport fixture)',native_memory),('Native hardware data-breakpoint dialog and removal (transport fixture)',native_data_breakpoint),('Native poll wins over delayed command reply and refreshes retained stop',native_poll_race),('Native connection refuses non-loopback destinations',native_bad_endpoint)]
    origins=os.environ.get('VB6_DEBUGGER_ORIGINS','modular,standalone,file').split(',')
    if any(origin not in ('modular','standalone','file','inline') for origin in origins):raise ValueError('Invalid debugger test origin')
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self,*args):pass
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(base.ROOT)))
    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    prefix='http://127.0.0.1:'+str(server.server_port)
    urls={'modular':prefix+'/dist/index.html','standalone':prefix+'/dist/VB6-Studio-Web.html','file':(base.ROOT/'dist/VB6-Studio-Web.html').as_uri()}
    for origin,relative in [('modular','dist/index.html'),('modular','dist/studio.js'),('modular','dist/studio.css'),('standalone','dist/VB6-Studio-Web.html'),('file','dist/VB6-Studio-Web.html')]:
        if origin in origins and not (base.ROOT/relative).is_file():
            server.shutdown();server.server_close();thread.join(timeout=5)
            raise FileNotFoundError('Debugger test entry point is missing: '+relative)
    results=[]
    try:
        with sync_playwright() as pw:
            engine=os.environ.get('VB6_BROWSER','chromium');launch={'headless':True}
            if engine=='chromium':launch.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),args=['--no-sandbox'])
            browser=getattr(pw,engine).launch(**launch)
            for origin in origins:
                for name,case in cases:
                    page=browser.new_page(viewport={'width':1440,'height':1000});page.set_default_timeout(10000);errors=[]
                    page.on('pageerror',lambda e:errors.append(str(e)))
                    try:
                        if origin=='inline':page.set_content(base.HTML)
                        else:page.goto(urls[origin],wait_until='load')
                        page.wait_for_function('!!globalThis.vb6Studio?.debuggerWindows')
                        case(page);base.check(not errors,errors)
                        results.append({'origin':origin,'name':name,'passed':True});print('PASS',origin,name,flush=True)
                    except Exception as e:
                        results.append({'origin':origin,'name':name,'passed':False,'error':str(e),'pageErrors':errors});print('FAIL',origin,name,str(e),flush=True);traceback.print_exc(limit=5)
                        try:page.screenshot(path=str(REPORT/('failure-'+origin+'-'+str(len(results))+'.png')))
                        except Exception as capture_error:results[-1]['screenshotError']=str(capture_error)
                    finally:page.close()
            report={'browser':engine,'version':browser.version,'origins':origins,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'tests':results};browser.close()
        (REPORT/(engine+'.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='tests'}));raise SystemExit(1 if report['failed'] else 0)
    finally:server.shutdown();server.server_close();thread.join(timeout=5)

if __name__=='__main__':main()
