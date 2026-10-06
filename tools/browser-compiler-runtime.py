#!/usr/bin/env python3
"""Compiler recovery integration, using emitted IDE/SDK/export bytes.
--http serves the actual files over loopback and fails if navigation is blocked.
Default inline mode is useful in restricted runners; it is not a launch test.
"""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright
import argparse, json, os, shutil, sys, time, traceback
ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports/compiler-runtime'
REPORT.mkdir(parents=True, exist_ok=True)
ARGS = argparse.ArgumentParser()
ARGS.add_argument('--http', action='store_true')
OPTIONS = ARGS.parse_args()
RESULTS = []
SERVER = None
BROWSER = None
HTML = (ROOT / 'dist/VB6-Studio-Web.html').read_text()
URL = ''
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_): pass

def check(value, message='Assertion failed'):
    if not value: raise AssertionError(str(message))

def boot():
    context = BROWSER.new_context(viewport={'width':1360,'height':900}, accept_downloads=True)
    page = context.new_page(); page.set_default_timeout(10000)
    page._errors=[]
    page.on('pageerror', lambda e: page._errors.append(str(e)))
    if OPTIONS.http: page.goto(URL + '/dist/VB6-Studio-Web.html')
    else: page.set_content(HTML)
    page.wait_for_function('!!globalThis.vb6Studio?.syntaxDiagnostics')
    return page

def source(p, code, extra=None):
    p.evaluate('''({code,extra})=>{const pr=VB6StudioAPI.newProject('CompilerRuntime');pr.startup='Sub Main';pr.modules=[{id:'main',kind:'module',name:'MainModule',code}];if(extra)pr.modules.push({id:'other',kind:'module',name:'Other',code:extra});vb6Studio.loadProject(pr);vb6Studio.openDocument('main','code');}''', {'code':code,'extra':extra})

def idle(p):
    p.wait_for_function('!vb6Studio.syntaxDiagnostics.pending', timeout=20000)

def exported(p, code):
    source(p, code)
    with p.expect_download() as download:
        p.evaluate("()=>{vb6Studio.command('exportHTML');}")
    data=Path(download.value.path()).read_text()
    check('vb6Studio=' not in data, 'Export unexpectedly contains IDE bootstrap')
    q=p.context.new_page();q.set_default_timeout(10000);q._errors=[]
    q.on('pageerror',lambda e:q._errors.append(str(e)))
    if OPTIONS.http:
        path=REPORT/'downloaded-compiler-app.html';path.write_text(data)
        q.goto(URL+'/reports/compiler-runtime/downloaded-compiler-app.html')
    else:q.set_content(data)
    q.wait_for_function('!!globalThis.vb6Application?.vm')
    check(not q._errors,q._errors)
    value=q.evaluate('vb6Application.vm.instances.get("mainmodule").fields.get("result").get()')
    q.close()
    return value

def program(body, declarations=''):
    return 'Option Explicit\nPublic Result As String\n'+declarations+'\nSub Main()\n'+body+'\nEnd Sub'

def decimal(p):
    value=exported(p,program('Dim x, y\nx = CDec("79228162514264337593543950335")\ny = CDec("0.1") + CDec("0.2")\nResult = CStr(x) & "|" & CStr(y) & "|" & VarType(y)'))
    check(value=='79228162514264337593543950335|0.3|14',value)
    return {'result':value}

def financial(p):
    value=exported(p,program('Dim a(5 To 6) As Double\na(5)=-100\na(6)=110\nResult = CStr(Round(IRR(a()), 6)) & "|" & PMT(pv:=1000, rate:=0, nper:=10) & "|" & DDB(10000,1000,5,1)'))
    check(value=='0.1|-100|4000',value);return {'result':value}

def constants(p):
    value=exported(p,program('Dim x As State\nx = State.Second\nOn x - Base GoTo First, Second\nResult="wrong"\nExit Sub\nFirst:\nResult="first"\nExit Sub\nSecond:\nResult=CStr(x)', 'Const Base = 40\nEnum State\nFirst = Base + 1\nSecond\nEnd Enum'))
    check(value=='42',value)

def errors(p):
    value=exported(p,program('On Error GoTo Handler\n100 Error 11\nDone:\nResult=Result & "|" & Erl & "|" & Err.Number\nExit Sub\nHandler:\nResult=CStr(Erl) & "|" & Err.Description\nResume Done'))
    check(value=='100|Division by zero|0|0',value)

def strings(p):
    value=exported(p,program('Result = CStr(InStr(string1:="aBc", string2:="B")) & "|" & Join(Split("a,b,c", ",", 2), "|") & "|" & Replace("a.a", ".", "$&")'))
    check(value=='2|a|b,c|a$&a',value)

def binary(p):
    value=exported(p,program('Dim x,y\nx=CDec("-79228162514264337593543950335")\nOpen "value.bin" For Binary As #1\nPut #1, , x\nGet #1, 1, y\nClose\nResult=CStr(y) & "|" & VarType(y)'))
    check(value=='-79228162514264337593543950335|14',value)

def worker(p):
    source(p,'Public Const N = Other.K + 1\nSub Main()\nEnd Sub','Public Const K = 41')
    idle(p);check(p.evaluate('vb6Studio.syntaxDiagnostics.mode')=='worker','No real diagnostic worker')
    check(p.evaluate('vb6Studio.diagnostics.length')==0)
    p.evaluate('''()=>{vb6Studio.project.modules[1].code='Public Const K = MainModule.N';vb6Studio.markDirty();}''')
    idle(p);check(p.evaluate('vb6Studio.diagnostics.some(d=>/Circular/.test(d.message))'))
    hits=p.evaluate('vb6Studio.syntaxDiagnostics.metrics.cacheHits');check(hits>0,'Unchanged module cache was not exercised')
    p.evaluate('''()=>{vb6Studio.project.modules[1].code='Public Const K = 42';vb6Studio.markDirty();}''')
    idle(p);check(p.evaluate('vb6Studio.diagnostics.length')==0)
    check(p.evaluate('VB6StudioAPI.compileProject(vb6Studio.project).modules.get("mainmodule").constantBindings.get("n")')==43)
    return {'cacheHits':hits,'mode':'worker'}

def reject(p):
    source(p,'Const N = F()\nFunction F()\nDebug.Print "must not execute"\nEnd Function\nSub Main()\nEnd Sub')
    idle(p);check(p.evaluate('vb6Studio.diagnostics.some(d=>/cannot invoke/.test(d.message))'))
    p.evaluate('()=>{vb6Studio.run();}')
    check(p.evaluate('vb6Studio.runState')=='design')
    check(p.locator('iframe[title="Running Visual Basic application"]').count()==0)

def preview(p):
    source(p,program('Result=CStr(CDec("0.1") + CDec("0.2"))\nDebug.Print Result'))
    p.keyboard.press('F5')
    p.wait_for_function('!!vb6Studio.runtimeFrame')
    frame=p.locator('iframe[title="Running Visual Basic application"]').element_handle().content_frame()
    frame.wait_for_function('!!globalThis.vb6Application?.vm')
    check(frame.evaluate('vb6Application.vm.instances.get("mainmodule").fields.get("result").get()')=='0.3')
    check(p.locator('iframe').first.get_attribute('sandbox')=='allow-scripts allow-downloads allow-modals')
    p.evaluate('()=>vb6Studio.stop()')
    check(p.evaluate('vb6Studio.runState')=='design')

def sdk(p):
    q=p.context.new_page();q.set_default_timeout(10000)
    sdk=(ROOT/'dist/vb6-runtime.js').read_text()
    q.set_content('<!doctype html><html><body><script>'+sdk.replace('</script','<\\/script')+'</script></body></html>')
    value=q.evaluate('''async()=>{const A=VB6Runtime.RuntimeAPI;const compiled=A.compileProject({name:'SDK',startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:'Sub Main()\\nDebug.Print CDec("0.1") + CDec("0.2"), PMT(0,10,1000)\\nEnd Sub'}]});if(!compiled.valid)throw Error(JSON.stringify(compiled.diagnostics));const output=[];const vm=new A.VirtualMachine(compiled,{print:s=>output.push(s)});await vm.start();return {output,ide:typeof globalThis.vb6Studio};}''')
    q.close();check(value=={'output':['0.3 -100'],'ide':'undefined'},value);return value

def scalar_values(p):
    value=exported(p,program('Dim b As Byte, i As Integer, f As Single, v\nb=255: i=32767: f=1.25\nv=b\nResult=TypeName(v) & "|" & TypeName(i + CVar(1)) & "|" & TypeName(f + CLng(1)) & "|" & CStr(True) & "|" & CStr(CByte(True))'))
    check(value=='Byte|Long|Double|True|255',value);return {'result':value}

def scalar_files(p):
    value=exported(p,program('Dim values(0 To 2), restored(0 To 2), a, b, c\nvalues(0)=CByte(1): values(1)=CSng(2): values(2)=True\nOpen "tagged.bin" For Binary As #1\nPut #1, , values()\nGet #1, 1, restored()\nClose #1\nOpen "input.txt" For Output As #1\nWrite #1, True, Null, CVErr(5)\nClose #1\nOpen "input.txt" For Input As #1\nInput #1, a\nInput #1, b\nInput #1, c\nClose #1\nResult=TypeName(restored(0)) & "|" & TypeName(restored(1)) & "|" & TypeName(restored(2)) & "|" & VarType(a) & "|" & VarType(b) & "|" & VarType(c)'))
    check(value=='Byte|Single|Boolean|11|1|10',value);return {'result':value}

def scalar_byref(p):
    code=program('Dim n As Long, count As Byte\nn=5\nCall Change(n)\nResult=n & "|"\nChange (n)\nFor count=1 To 2\nResult=Result & TypeName(count) & ":" & count & ";"\nNext\nResult=Result & n')+'\nSub Change(ByRef value As Long)\nvalue=value+1\nEnd Sub'
    value=exported(p,code);check(value=='6|Byte:1;Byte:2;6',value);return {'result':value}

def scalar_data(p):
    code=program('Dim rs As Object\nSet rs=CreateObject("ADODB.Recordset")\nrs.Fields.Append "B",17\nrs.Fields.Append "Flag",11\nrs.Open\nrs.AddNew\nrs.Fields("B").Value=4\nrs.Fields("Flag").Value=True\nrs.Update\nResult=TypeName(rs.Fields("B").Value) & "|" & TypeName(rs.Fields("Flag").Value) & "|" & rs.Fields("Flag").Value\nrs.Close')
    value=exported(p,code);check(value=='Byte|Boolean|True',value);return {'result':value}

def scalar_worker(p):
    source(p,'Public Const N = Other.K\nSub Main()\nEnd Sub','Public Const K = 1%')
    idle(p);check(p.evaluate('vb6Studio.syntaxDiagnostics.mode')=='worker')
    check(p.evaluate('VB6StudioAPI.compileProject(vb6Studio.project).modules.get("mainmodule").constantScalars.get("n").type')=='integer')
    p.evaluate('''()=>{vb6Studio.project.modules[1].code='Public Const K = 1!';vb6Studio.markDirty();}''')
    idle(p);check(p.evaluate('vb6Studio.diagnostics.length')==0)
    check(p.evaluate('VB6StudioAPI.compileProject(vb6Studio.project).modules.get("mainmodule").constantScalars.get("n").type')=='single')
    check(p.evaluate('vb6Studio.syntaxDiagnostics.metrics.cacheHits')>0)

def scalar_controls(p):
    p.evaluate('''()=>{const A=VB6StudioAPI,project=A.newProject('ScalarControls');project.settings.renderer='canvas2d';const form=project.modules[0];form.form.controls=[A.createControl('Label','Result',300,300),A.createControl('CheckBox','Flag',300,750)];form.code='Private Sub Form_Load()\\nResult.Caption=TypeName(Me.hWnd) & "|" & TypeName(Result.Visible) & "|" & TypeName(Result.Width) & "|" & TypeName(Flag.Value)\\nEnd Sub';vb6Studio.loadProject(project);}''')
    text=p.evaluate('VB6StudioAPI.exportApplication(vb6Studio.project,{persist:false})')
    q=p.context.new_page();q.set_default_timeout(10000);errors=[];q.on('pageerror',lambda e:errors.append(str(e)))
    if OPTIONS.http:
        (REPORT/'scalar-controls.html').write_text(text);q.goto(URL+'/reports/compiler-runtime/scalar-controls.html')
    else:q.set_content(text)
    q.wait_for_function('globalThis.vb6Application?.forms[0]?.controlMap.get("result")?.Caption.includes("|")')
    result=q.locator('[data-control="Result"]').inner_text();check(result=='Long|Boolean|Single|Integer',result);check(not errors,errors);q.close();return {'result':result}

def scalar_sdk_debug(p):
    q=p.context.new_page();q.set_default_timeout(10000)
    text=(ROOT/'dist/vb6-runtime.js').read_text()
    q.set_content('<!doctype html><script>'+text.replace('</script','<\\/script')+'</script>')
    result=q.evaluate('''async()=>{
      const A=VB6Runtime.RuntimeAPI, code='Sub Main()\\nDim b As Byte, v\\nb=5\\nv=b\\nb=b+1\\nEnd Sub\\nSub Change(ByRef value As Byte)\\nvalue=8\\nEnd Sub';
      const compiled=A.compileProject({name:'ScalarDebugger',startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code}]});
      if(!compiled.valid)throw Error(JSON.stringify(compiled.diagnostics));
      const vm=new A.VirtualMachine(compiled,{});vm.setBreakpoint('M',5);
      let ready;const stopped=new Promise(resolve=>ready=resolve);vm.on('pause',ready);const running=vm.start();
      try{await Promise.race([stopped,running.then(()=>{throw Error('Breakpoint missed');})]);
        const frame=vm.currentFrame;
        const raw=await vm.evaluate(A.parseExpression('b'),frame);
        const before=(await vm.evaluateScalar(A.parseExpression('v'),frame)).type;
        await vm.evaluateExplicit('Call Change(b)',{immediate:true});
        const after=await vm.evaluate(A.parseExpression('b'),frame);
        const scalar=await vm.evaluateScalar(A.parseExpression('b'),frame);
        return {raw,before,after,type:scalar.type,rawType:typeof raw,ide:typeof globalThis.vb6Studio};
      }finally{vm.breakpoints.clear();vm.resume();await running;}
    }''')
    q.close();check(result=={'raw':5,'before':'byte','after':8,'type':'byte','rawType':'number','ide':'undefined'},result);return result

TESTS=[('Exported Decimal magnitude and exact arithmetic',decimal),('Exported financial functions, named calls and whole arrays',financial),('Exported constant/enum binding and computed branches',constants),('Exported numbered errors and Resume state',errors),('Exported corrected string intrinsics',strings),('Exported Decimal binary file round trip',binary),('Real worker invalidates cross-module constant dependencies',worker),('IDE blocks invalid constants without executing source',reject),('F5 runs new compiler runtime inside isolated preview',preview),('Independent SDK runs without IDE globals',sdk)]
TESTS.extend([('Exported numeric tags, promotion and Boolean formatting',scalar_values),('Exported tagged binary arrays and sequential fields',scalar_files),('Exported ByRef Call and typed For loop state',scalar_byref),('Exported typed ADO field reads',scalar_data),('Worker rebinds changed constant subtypes',scalar_worker),('Standalone SDK debugger keeps internal tags and raw API',scalar_sdk_debug),('Exported control properties use declared subtypes',scalar_controls)])
try:
    if OPTIONS.http:
        SERVER=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT)))
        Thread(target=SERVER.serve_forever,daemon=True).start();URL='http://127.0.0.1:'+str(SERVER.server_address[1])
    with sync_playwright() as pw:
        executable=os.environ.get('CHROMIUM_PATH') or os.environ.get('CHROMIUM') or shutil.which('chromium') or pw.chromium.executable_path
        BROWSER=pw.chromium.launch(executable_path=executable,headless=True,args=['--no-sandbox','--disable-dev-shm-usage'])
        for name,fn in TESTS:
            p=None;start=time.perf_counter()
            try:
                p=boot();details=fn(p);check(not p._errors,p._errors)
                RESULTS.append({'name':name,'passed':True,'details':details,'milliseconds':round((time.perf_counter()-start)*1000,2)});print('PASS',name,flush=True)
            except Exception as e:
                RESULTS.append({'name':name,'passed':False,'error':str(e)});print('FAIL',name,str(e),flush=True);traceback.print_exc(limit=2)
                if p:
                    try:p.screenshot(path=str(REPORT/('failed-'+str(len(RESULTS))+'.png')))
                    except Exception:pass
            finally:
                if p:p.context.close()
        BROWSER.close()
finally:
    if SERVER:SERVER.shutdown();SERVER.server_close()
    report={'mode':'http' if OPTIONS.http else 'inline','passed':sum(t['passed'] for t in RESULTS),'failed':sum(not t['passed'] for t in RESULTS),'tests':RESULTS}
    (REPORT/('browser-http.json' if OPTIONS.http else 'browser-inline.json')).write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k!='tests'}))
sys.exit(0 if len(RESULTS)==len(TESTS) and not report['failed'] else 1)
