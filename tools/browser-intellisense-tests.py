#!/usr/bin/env python3
"""Real standalone-IDE IntelliSense regression tests. No native VB6 pixel claim."""
from pathlib import Path
import json, os, sys, time, traceback
import functools, http.server, threading
from contextlib import contextmanager
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'validation';OUT.mkdir(exist_ok=True)
HTML=(ROOT/'dist/VB6-Studio-Web.html').read_text()
RESULTS=[]
CUSTOMER={'id':'customer','name':'Customer','kind':'class','code':'Public Name As String\nPublic Parent As Customer\nPrivate Secret As Long\nPublic Function Clone() As Customer\nEnd Function'}

def check(value, message='Assertion failed'):
    if not value: raise AssertionError(str(message))

def setup(p, source, controls=None, others=None):
    p.evaluate('''({source,controls,others})=>{
      const pr=VB6StudioAPI.newProject('IntelliSenseLab');pr.id='intel-lab';pr.modules[0].id='main';pr.modules[0].code=source;
      for(const c of controls||[])pr.modules[0].form.controls.push(VB6StudioAPI.createControl(c.type,c.name));
      pr.modules.push(...(others||[]));vb6Studio.loadProject(pr);vb6Studio.openDocument('main','code');
      const e=vb6Studio.editor;e.selectGlobal(source.length);e.input.focus();
    }''',{'source':source,'controls':controls,'others':others})

def names(p):return p.evaluate('vb6Studio.editor.completionItems||[]')
def put(p, text):p.keyboard.insert_text(text)
def escaped(p):p.keyboard.press('Escape')
def shot(p,name):p.screenshot(path=str(OUT/('intellisense-'+os.environ.get('VB6_BROWSER','chromium')+'-'+os.environ.get('VB6_INTELLISENSE_ORIGIN','inline')+'-'+name+'.png')),caret='hide')

def automatic(p):
    setup(p,'Private Sub Form_Load()\n    Text1',[{'name':'Text1','type':'TextBox'}]);put(p,'.')
    p.wait_for_selector('.completion-list');check('SelStart' in names(p),names(p));check('Nodes' not in names(p))
    put(p,'SelSt')
    # Firefox may acknowledge text insertion before the input-driven list
    # refresh completes. Observe the exact filtered state, not two racy reads.
    p.wait_for_function('!!vb6Studio.editor.completion && vb6Studio.editor.completionItems.length===1 && vb6Studio.editor.completionItems[0]==="SelStart"')
    check(names(p)==['SelStart'],names(p));p.keyboard.press('Tab')
    check(p.evaluate('vb6Studio.editor.text.endsWith("Text1.SelStart")'))
    check(not p.locator('.completion-list').count())

def enter_and_undo(p):
    setup(p,'Private Sub Form_Load()\n    Text1',[{'name':'Text1','type':'TextBox'}]);put(p,'.');put(p,'SelSt');p.keyboard.press('Enter')
    check(p.evaluate('vb6Studio.editor.text.endsWith("Text1.SelStart\\n    ")'))
    p.evaluate('vb6Studio.command("undo")');check(p.evaluate('vb6Studio.editor.text.endsWith("Text1.SelSt")'))

def punctuation(p):
    setup(p,'Private Sub Form_Load()\n    Dim customer As Customer\n    customer',[ ],[CUSTOMER]);put(p,'.');put(p,'Par');p.keyboard.press('.')
    check(p.evaluate('vb6Studio.editor.text.endsWith("customer.Parent.")'));check('Name' in names(p));shot(p,'members')

def suffix(p):
    source='Private Sub Form_Load()\n    Text1.SelStale';setup(p,source,[{'name':'Text1','type':'TextBox'}])
    p.evaluate('vb6Studio.editor.selectGlobal(vb6Studio.editor.text.indexOf("SelStale")+5)');p.keyboard.press('Control+Space')
    check(p.evaluate('vb6Studio.editor.text.endsWith("Text1.SelStart")'),p.evaluate('vb6Studio.editor.text'))

def with_split(p):
    source='Private Sub Form_Load()\nDim customer As Customer\nWith customer\n    With .Parent\n        .\n    End With\nEnd With\nEnd Sub'
    setup(p,source,others=[CUSTOMER]);p.evaluate('''()=>{const e=vb6Studio.editor;e.toggleSplit(true,.5);e.activatePane(e.secondary);e.setViewMode('procedure');e.selectGlobal(e.text.indexOf('        .')+9);e.complete();}''')
    check('Name' in names(p));check(p.evaluate('vb6Studio.editor.completion.parentElement===vb6Studio.editor.secondary.viewport'));p.keyboard.press('n');p.keyboard.press('Tab')
    check('        .Name\n' in p.evaluate('vb6Studio.editor.text'));check(p.evaluate('vb6Studio.editor.primary.input.value.includes(".Name")'))

def constants(p):
    setup(p,'Private Sub Form_Load()\n    MsgBox "Choose",');put(p,' ')
    check('vbYesNo' in names(p),names(p));check('vbRed' not in names(p));p.keyboard.press('Control+Shift+i')
    check(p.locator('.source-info strong').inner_text().startswith('[buttons'),p.locator('.source-info').inner_text());check(p.evaluate('()=>{const e=vb6Studio.editor,a=e.info.getBoundingClientRect(),b=e.viewport.getBoundingClientRect();return a.left>=b.left&&a.right<=b.right&&e.info.scrollWidth<=e.info.clientWidth+1;}'),p.evaluate('()=>{const e=vb6Studio.editor;return JSON.stringify({info:e.info.getBoundingClientRect(),pane:e.viewport.getBoundingClientRect(),scrollWidth:e.info.scrollWidth,clientWidth:e.info.clientWidth});}'));shot(p,'constants-parameters')

def nested_info(p):
    setup(p,'Private Sub Form_Load()\n    MsgBox Format(123, ')
    p.keyboard.press('Control+i');check(p.evaluate('vb6Studio.editor.lastInfo.name')=='Format')
    p.keyboard.press('Control+Shift+i');check(p.evaluate('vb6Studio.editor.lastInfo.name')=='MsgBox')
    escaped(p);check(p.locator('.source-info').count()==0)

def literals(p):
    for text in ['\' Text1','Rem Text1','x = "Text1']:
        setup(p,text,[{'name':'Text1','type':'TextBox'}]);put(p,'.');check(p.locator('.completion-list').count()==0,text)
        p.keyboard.press('Control+j');check(p.locator('.completion-list').count()==0,text)

def types(p):
    setup(p,'Private Sub Form_Load()\n    Dim connection As');put(p,' ');check('Long' in names(p));put(p,'ADO');check('ADODB' in names(p));p.keyboard.press('.')
    check('Connection' in names(p),names(p));put(p,'Conne');p.keyboard.press('Tab');check(p.evaluate('vb6Studio.editor.text.endsWith("As ADODB.Connection")'))

def escape_options(p):
    setup(p,'Private Sub Form_Load()\n    Text1',[{'name':'Text1','type':'TextBox'}]);put(p,'.');escaped(p);p.wait_for_timeout(200);check(not p.locator('.completion-list').count())
    p.evaluate('()=>{vb6Studio.appearance.autoListMembers=false;vb6Studio.appearance.autoQuickInfo=false;vb6Studio.applyAppearance();}')
    put(p,'Sel');check(not p.locator('.completion-list').count());p.keyboard.press('Control+j');check('SelStart' in names(p));escaped(p)
    p.evaluate('vb6Studio.editor.setReadOnly(true)');p.keyboard.press('Control+j');check(not p.locator('.completion-list').count())

def accessibility(p):
    setup(p,'Private Sub Form_Load()\n');p.keyboard.press('Control+j');check(len(names(p))>150)
    p.keyboard.press('End');check(p.evaluate('vb6Studio.editor.completionIndex===vb6Studio.editor.completionItems.length-1'))
    check(p.evaluate('!!document.getElementById(vb6Studio.editor.input.getAttribute("aria-activedescendant"))'))
    p.keyboard.press('PageUp');check(p.locator('.completion-item').count()<=13);p.keyboard.press('Home');check(p.evaluate('vb6Studio.editor.completionIndex')==0)
    escaped(p);check(p.evaluate('!vb6Studio.editor.input.hasAttribute("aria-controls")'))

def stale(p):
    setup(p,'Private Sub Form_Load()\nDim customer As Customer\n    customer.',others=[CUSTOMER]);p.keyboard.press('Control+j');check('Name' in names(p))
    p.evaluate('vb6Studio.project.modules[1].code="Public Updated As Long"');p.keyboard.press('Tab')
    check(p.evaluate('vb6Studio.editor.text.endsWith("customer.")'))

def large(p):
    source="' padding\n"*49995+'Private Sub Form_Load()\nDim localAlpha As Long, localBeta As Long\nlocal\nEnd Sub'
    setup(p,source);data=p.evaluate('''()=>{const e=vb6Studio.editor;e.goToLine(49998,6);const begin=performance.now();e.complete();return {milliseconds:performance.now()-begin,virtual:e.activePane.virtualizer.active,rows:e.input.value.split('\\n').length};}''')
    check(data['virtual']);check(data['rows']<=256);check('localAlpha' in names(p));scan=p.evaluate('vb6Studio.editor.intelligence.scanCount')
    p.keyboard.press('A');check(p.evaluate('vb6Studio.editor.intelligence.scanCount')==scan,'Prefix filter rescanned the large module')
    p.keyboard.press('Tab');check(p.evaluate('vb6Studio.editor.lines[49997]')=='localAlpha');check(p.locator('.completion-item').count()==0)
    return data

def data_tip(p):
    text='Private Sub Form_Load()\nDim values(0 To 1) As Long\nvalues(0) = 42\nDebug.Print values(0)\nEnd Sub'
    setup(p,text);p.evaluate('()=>{vb6Studio.breakpoints=[{module:vb6Studio.activeModule.name,line:4}];vb6Studio.run();}');p.wait_for_function('vb6Studio.runState==="paused"',timeout=15000)
    p.evaluate('vb6Studio.openDocument("main","code")');result=p.evaluate('vb6Studio.editor.assistance.showAt(vb6Studio.editor.text.lastIndexOf("values")+3)')
    check(result is not None,result);check('Long' in result.get('type',''),result);shot(p,'debug-data-tip')
    p.evaluate('vb6Studio.command("stop")');p.wait_for_function('vb6Studio.runState==="design"');check(not p.locator('.source-data-tip').count())

def immediate(p):
    setup(p,'Private Sub Form_Load()\nEnd Sub',[{'name':'Text1','type':'TextBox'}])
    p.evaluate('vb6Studio.command("immediate")');field=p.locator('.immediate-input');field.fill('? Text1');field.focus();put(p,'.')
    p.wait_for_selector('.completion-list');put(p,'SelSt');p.keyboard.press('Enter')
    check(field.input_value()=='? Text1.SelStart',field.input_value());check(p.evaluate('vb6Studio.immediateOutput.length')==0,'Completion executed an Immediate command')
    check(not p.locator('.completion-list').count());shot(p,'immediate')

def reference_import(p):
    setup(p,'Private Sub Form_Load()\nDim client As Custom.Client\nclient.')
    p.evaluate('void vb6Studio.command("references")')
    metadata={'name':'Custom','types':[{'name':'Client','members':[{'name':'Title','type':'String'},{'name':'Ready','type':'Boolean'}]}]}
    p.locator('input[aria-label="Import type-library metadata"]').set_input_files({'name':'custom.json','mimeType':'application/json','buffer':json.dumps(metadata).encode()})
    p.wait_for_function('document.querySelector(".ide-dialog [role=status]")?.textContent.includes("Loaded Custom")');shot(p,'references')
    p.get_by_role('button',name='OK',exact=True).click()
    check(p.evaluate('vb6Studio.project.references.length')==0);check(p.evaluate('vb6Studio.project.typeLibraries[0].name')=='Custom')
    p.evaluate('()=>{const e=vb6Studio.editor;e.selectGlobal(e.text.length);e.input.focus();e.complete();}');check(set(names(p))=={'Ready','Title'},names(p));escaped(p)
    p.evaluate('vb6Studio.command("objectBrowser")');check(p.evaluate('vb6Studio.documents.tools.get("tool:object-browser").catalog.some(c=>c.library==="Custom"&&c.members.some(m=>m.name==="Title"))'))

def frame_expression(p):
    source='Private Sub Form_Load()\nDim rs As ADODB.Recordset\nSet rs = New ADODB.Recordset\nStop\nEnd Sub'
    setup(p,source);p.evaluate('vb6Studio.run()');p.wait_for_function('vb6Studio.runState==="paused"',timeout=15000)
    p.evaluate('''()=>{const original=vb6Studio.sendRuntime.bind(vb6Studio);window.intelliSenseInvocations=[];vb6Studio.sendRuntime=(command,...args)=>{if(['debugInspect','debugEvaluate','immediate'].includes(command))intelliSenseInvocations.push(command);return original(command,...args);};vb6Studio.command('immediate');}''')
    field=p.locator('.immediate-input');field.fill('? rs.Fields(0)');field.focus();put(p,'.');p.wait_for_selector('.completion-list');check('Value' in p.locator('.completion-list').inner_text());put(p,'Val');p.keyboard.press('Tab');check(field.input_value()=='? rs.Fields(0).Value',field.input_value());check(p.evaluate('intelliSenseInvocations.length')==0)
    p.evaluate('vb6Studio.command("stop")');p.wait_for_function('vb6Studio.runState==="design"')

def composition_resume(p):
    setup(p,'Private Sub Form_Load()\n    Text1',[{'name':'Text1','type':'TextBox'}]);put(p,'.');p.wait_for_selector('.completion-list')
    p.evaluate("""()=>{const e=vb6Studio.editor,input=e.input;input.dispatchEvent(new CompositionEvent('compositionstart'));if(e.completion)throw Error('List remained visible during composition');input.setRangeText('SelSt',input.selectionStart,input.selectionEnd,'end');input.dispatchEvent(new InputEvent('input',{data:'SelSt',inputType:'insertCompositionText',isComposing:true,bubbles:true}));input.dispatchEvent(new CompositionEvent('compositionend',{data:'SelSt'}));}""")
    p.wait_for_function('vb6Studio.editor.completionItems.length===1&&vb6Studio.editor.completionItems[0]==="SelStart"&&!!vb6Studio.editor.completion')
    p.keyboard.press('Tab');check(p.evaluate('vb6Studio.editor.text.endsWith("Text1.SelStart")'))

def composition_commit_before_timer(p):
    setup(p,'Private Sub Form_Load()\n    Text1',[{'name':'Text1','type':'TextBox'}]);put(p,'.');p.wait_for_selector('.completion-list')
    # Do not yield to the timer: a fast Tab must commit the freshly composed
    # prefix, not indent because composition temporarily hid the list.
    result=p.evaluate("""()=>{const e=vb6Studio.editor,input=e.input;
      input.dispatchEvent(new CompositionEvent('compositionstart'));
      input.setRangeText('SelSt',input.selectionStart,input.selectionEnd,'end');
      input.dispatchEvent(new InputEvent('input',{data:'SelSt',inputType:'insertCompositionText',isComposing:true,bubbles:true}));
      input.dispatchEvent(new CompositionEvent('compositionend',{data:'SelSt'}));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',code:'Tab',bubbles:true,cancelable:true}));
      return {text:e.text,open:!!e.completion};}""")
    check(result['text'].endswith('Text1.SelStart'),result);check(not result['open'],result)
    p.wait_for_timeout(30);check(not p.locator('.completion-list').count(),'Composition timer reopened a committed list')
    p.evaluate('vb6Studio.command("undo")');check(p.evaluate('vb6Studio.editor.text.endsWith("Text1.SelSt")'))

def composition_escape_before_timer(p):
    setup(p,'Private Sub Form_Load()\n    Text1',[{'name':'Text1','type':'TextBox'}]);put(p,'.');p.wait_for_selector('.completion-list')
    p.evaluate("""()=>{const e=vb6Studio.editor,input=e.input;
      input.dispatchEvent(new CompositionEvent('compositionstart'));
      input.dispatchEvent(new CompositionEvent('compositionend'));
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
    }""")
    p.wait_for_timeout(30);check(not p.locator('.completion-list').count(),'Composition timer defeated Escape')

def composition_document_change_before_timer(p):
    setup(p,'Private Sub Form_Load()\n    Text1',[{'name':'Text1','type':'TextBox'}]);put(p,'.');p.wait_for_selector('.completion-list')
    p.evaluate("""()=>{const e=vb6Studio.editor,input=e.input;
      input.dispatchEvent(new CompositionEvent('compositionstart'));
      input.dispatchEvent(new CompositionEvent('compositionend'));
      e.setDocument({...e.module,id:'replacement',name:'Other',code:'Dim replacement As Long'},e.project);
    }""")
    p.wait_for_timeout(30);check(not p.locator('.completion-list').count(),'Composition timer crossed a document change')

CASES=[composition_commit_before_timer,composition_escape_before_timer,composition_document_change_before_timer,automatic,enter_and_undo,punctuation,suffix,with_split,constants,nested_info,literals,types,escape_options,accessibility,stale,large,data_tip,immediate,reference_import,frame_expression,composition_resume]

@contextmanager
def deployment():
    mode=os.environ.get('VB6_INTELLISENSE_ORIGIN','inline')
    if mode=='file':
        yield (ROOT/'dist/VB6-Studio-Web.html').as_uri();return
    if mode in ('http','modular'):
        class Handler(http.server.SimpleHTTPRequestHandler):
            def log_message(self,*args):pass
        server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Handler,directory=str(ROOT.parent)))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        try:
            tail='dist/index.html' if mode=='modular' else 'dist/VB6-Studio-Web.html'
            yield f'http://127.0.0.1:{server.server_port}/{ROOT.name}/{tail}'
        finally:server.shutdown();server.server_close();thread.join()
    elif mode=='inline':yield None
    else:raise ValueError('Unknown IntelliSense deployment mode: '+mode)

def main():
    kind=os.environ.get('VB6_BROWSER','chromium');mode=os.environ.get('VB6_INTELLISENSE_ORIGIN','inline');RESULTS.clear()
    with deployment() as url, sync_playwright() as pw:
        browser=getattr(pw,kind).launch(**({'args':['--no-sandbox'],**({'executable_path':os.environ['VB6_CHROMIUM']} if os.environ.get('VB6_CHROMIUM') else {})} if kind=='chromium' else {}));version=browser.version
        for fn in CASES:
            page=browser.new_page(viewport={'width':1440,'height':960});page.set_default_timeout(8000);errors=[];page.on('pageerror',lambda error:errors.append(str(error)));begin=time.perf_counter()
            try:
                if url:page.goto(url,wait_until='load')
                else:page.set_content(HTML)
                page.wait_for_function('!!globalThis.vb6Studio?.editor');details=fn(page);check(not errors,errors);RESULTS.append({'name':fn.__name__,'passed':True,'details':details,'ms':round((time.perf_counter()-begin)*1000,2)});print('PASS',fn.__name__,flush=True)
            except Exception as error:
                RESULTS.append({'name':fn.__name__,'passed':False,'error':str(error),'pageErrors':errors});print('FAIL',fn.__name__,str(error),flush=True);traceback.print_exc(limit=3)
                try:shot(page,'failed-'+fn.__name__)
                except Exception:pass
            finally:page.close()
        browser.close()
    report={'browser':kind,'version':version,'origin':mode,'url':url,'passed':sum(r['passed'] for r in RESULTS),'failed':sum(not r['passed'] for r in RESULTS),'tests':RESULTS}
    (OUT/('intellisense-'+kind+'-'+mode+'.json')).write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items() if k!='tests'}),flush=True)
    return bool(report['failed'])
if __name__=='__main__':sys.exit(main())
