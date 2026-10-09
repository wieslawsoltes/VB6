#!/usr/bin/env python3
"""Opt-in acceptance with real Monaco and the bundled language worker.
Default transport: HTTP. VB6_TEST_TRANSPORT=file tests the offline artifact;
'memory' loads that exact artifact with set_content in constrained environments.
Memory results are explicitly labelled and never reported as HTTP acceptance.
"""
import functools,http.server,json,os,shutil,threading,time,unittest
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
ENGINE=os.environ.get('VB6_BROWSER','chromium')
TRANSPORT=os.environ.get('VB6_TEST_TRANSPORT','http')
REPORT=ROOT/'reports'/'advanced-editor'/ENGINE/TRANSPORT
FIXTURE=r'''()=>{const A=VB6StudioAPI,p=A.newProject('EditorTest'),m=p.modules[0];p.id='editor-test';p.settings.xaml=true;p.settings.renderer='canvas2d';m.id='form';m.name='Form1';m.form.name='Form1';m.form.properties.Name='Form1';
const button=A.createControl('CommandButton','Button1',300,300);button.id='button';button.properties.Caption='Original';m.form.controls=[button];
m.code='Option Explicit\nPublic total As Long\nPrivate Sub Button1_Click()\n    total = Add(1, 2)\nEnd Sub\n';
p.modules.push({id:'math',name:'Math',kind:'module',code:'Option Explicit\nPublic Function Add(ByVal left As Long, ByVal right As Long) As Long\n    Add = left + right\nEnd Function\n'});p.startup='Form1';vb6Studio.loadProject(p);vb6Studio.openDocument('form','code');return true;}'''
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
class AdvancedEditorAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        REPORT.mkdir(parents=True,exist_ok=True);cls.results=[]
        cls.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(ROOT)))
        threading.Thread(target=cls.server.serve_forever,daemon=True).start();cls.base=f'http://127.0.0.1:{cls.server.server_port}'
        cls.pw=sync_playwright().start();options={'headless':True}
        if ENGINE=='chromium':options.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),args=['--no-sandbox'])
        cls.browser=getattr(cls.pw,ENGINE).launch(**options)
    @classmethod
    def tearDownClass(cls):
        cls.browser.close();cls.pw.stop();cls.server.shutdown();cls.server.server_close()
        (REPORT/'results.json').write_text(json.dumps({'browser':ENGINE,'transport':TRANSPORT,'results':cls.results},indent=2))
    def setUp(self):
        self.started=time.perf_counter();self.errors=[];self.requests=[];self.passed=False
        self.context=self.browser.new_context(viewport={'width':1500,'height':1000});self.context.set_default_timeout(15000)
        self.page=self.context.new_page();self.page.on('pageerror',lambda e:self.errors.append(str(e)));self.page.on('request',lambda r:self.requests.append(r.url))
        if TRANSPORT=='memory':self.page.set_content((ROOT/'dist/VB6-Studio-Web-Advanced.html').read_text())
        elif TRANSPORT=='file':self.page.goto((ROOT/'dist/VB6-Studio-Web-Advanced.html').as_uri())
        else:self.page.goto(self.base+'/dist/index.html')
        self.page.wait_for_function('globalThis.vb6Studio?.advancedEditor');self.page.evaluate(FIXTURE)
    def tearDown(self):
        self.results.append({'name':self._testMethodName,'passed':self.passed and not self.errors,'pageErrors':self.errors,'milliseconds':round((time.perf_counter()-self.started)*1000,2)})
        if not self.passed:self.page.screenshot(path=str(REPORT/(self._testMethodName+'.png')))
        self.context.close();self.assertEqual(self.errors,[])
    def enable(self):
        self.assertTrue(self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:true})'))
        self.page.evaluate('()=>{globalThis.r=vb6Studio.advancedEditor.runtime;globalThis.s=r.surfaces.get(vb6Studio.editor);s.focus();return true;}')
        self.page.wait_for_function('s.view.getLayoutInfo().width>100')
    def done(self):self.passed=True
    def text(self):return self.page.evaluate('vb6Studio.project.modules.find(m=>m.id==="form").code')
    def test_default_off_options_cancel_and_strict_gate(self):
        self.assertFalse(self.page.evaluate('!!globalThis.VB6AdvancedMonaco'))
        self.assertFalse(any('/advanced-editor/' in u for u in self.requests))
        self.page.evaluate('()=>{void vb6Studio.advancedEditor.options();}')
        dialog=self.page.get_by_role('dialog',name='Advanced Editor Options');dialog.get_by_role('checkbox',name='Enable advanced code editor (experimental)',exact=True).check()
        dialog.get_by_role('button',name='Cancel',exact=True).click()
        self.assertFalse(self.page.evaluate('!!globalThis.VB6AdvancedMonaco'))
        for enabled in ['true',1,None]:self.assertFalse(self.page.evaluate('enabled=>vb6Studio.advancedEditor.configure({enabled})',enabled))
        self.assertEqual(self.page.locator('.advanced-editor-surface').count(),0);self.done()
    def test_toggle_preserves_selection_and_does_not_create_edits(self):
        self.page.evaluate('vb6Studio.editor.selectGlobal(17,22)');before=self.text();self.enable()
        self.assertEqual(self.page.evaluate('s.selection()'),{'start':17,'end':22})
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),0)
        for _ in range(3):
            self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:false})')
            self.assertEqual(self.page.evaluate('VB6AdvancedMonaco.monaco.editor.getModels().length'),0)
            self.assertEqual(self.page.evaluate('vb6Studio.editor.selectionBounds()'),{'start':17,'end':22});self.enable()
        self.assertEqual(self.text(),before);self.done()
    def test_real_typing_and_both_undo_entry_points_share_history(self):
        self.enable();before=self.text();self.page.evaluate('s.select(s.record.model.getValueLength())');self.page.keyboard.insert_text("' Zażółć 😀\n")
        self.assertTrue(self.text().endswith("' Zażółć 😀\n"));self.assertTrue(self.page.evaluate('s.record.model.getValue()===vb6Studio.editor.text&&s.record.client.documents.get(s.record.uri).text===s.record.model.getValue()'))
        self.page.keyboard.press('Control+z');self.assertEqual(self.text(),before)
        self.page.keyboard.press('Control+y');self.assertTrue(self.text().endswith("' Zażółć 😀\n"))
        self.page.evaluate('s.view.trigger("test","undo",null)');self.assertEqual(self.text(),before)
        self.assertEqual(self.page.evaluate('vb6Studio.history.redoStack.length'),1);self.done()
    def test_multicursor_and_snippets_are_real_editor_edits(self):
        self.enable();self.page.evaluate('()=>{const M=VB6AdvancedMonaco.monaco;s.view.setSelections([new M.Selection(2,1,2,1),new M.Selection(4,1,4,1)]);}')
        self.page.keyboard.insert_text("'");lines=self.text().splitlines();self.assertTrue(lines[1].startswith("'Public"));self.assertTrue(lines[3].startswith("'    total"))
        self.page.keyboard.press('Control+z');self.assertTrue(self.text().splitlines()[1].startswith('Public'))
        self.page.evaluate(r'''()=>{s.select(s.record.model.getValueLength());s.insertSnippet('Private Sub ${1:Extra}()\n\t$0\nEnd Sub');}''')
        self.assertIn('Private Sub Extra()',self.text());self.done()
    def test_worker_completion_and_cross_document_definition(self):
        self.enable()
        result=self.page.evaluate('async()=>{const c=s.record.client,u=s.record.uri;return {completion:await c.request("textDocument/completion",{textDocument:{uri:u},position:{line:3,character:7}}),definition:await c.request("textDocument/definition",{textDocument:{uri:u},position:{line:3,character:13}})};}')
        self.assertTrue(any(i['label']=='total' for i in result['completion']['items']));self.assertIn('/Math.bas',result['definition'][0]['uri'])
        self.page.evaluate('()=>{s.view.setPosition({lineNumber:4,column:14});return s.view.getAction("editor.action.revealDefinition").run();}')
        self.page.wait_for_function('vb6Studio.activeModule.id==="math"');self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().line'),2);self.done()
    def test_minimap_folding_and_tokenization(self):
        self.enable();self.assertGreater(self.page.locator('.advanced-editor-surface .minimap canvas').count(),0)
        tokens=self.page.evaluate(r'''VB6AdvancedMonaco.monaco.editor.tokenize("Dim value As Long\nvalue = &HFF ' hello",'vb6')''')
        self.assertTrue(any('keyword' in t['type'] for t in tokens[0]))
        self.page.evaluate('s.view.getAction("editor.foldAll").run()');self.page.wait_for_timeout(250)
        self.assertEqual(self.page.locator('.advanced-editor-surface .view-line').filter(has_text='total = Add').count(),0)
        self.page.evaluate('s.view.getAction("editor.unfoldAll").run()');self.done()
    def test_breakpoint_and_execution_decorations_keep_real_source_coordinates(self):
        self.enable();self.page.evaluate('vb6Studio.toggleBreakpoint("Form1",4);vb6Studio.editor.setExecution({module:"Form1",line:4});s.decorate();')
        self.page.wait_for_timeout(150);self.assertGreater(self.page.locator('.advanced-breakpoint').count(),0);self.assertGreater(self.page.locator('.advanced-execution-arrow').count(),0)
        self.assertEqual(self.page.evaluate('vb6Studio.breakpoints[0].line'),4)
        self.page.evaluate('vb6Studio.editor.setExecution(null);vb6Studio.toggleBreakpoint("Form1",4);s.decorate()')
        self.page.wait_for_timeout(150);self.assertEqual(self.page.locator('.advanced-breakpoint').count(),0);self.done()
    def test_read_only_running_guard_blocks_typing_and_api_edits(self):
        self.enable();before=self.text();self.page.evaluate('vb6Studio.runState="running";vb6Studio.documents.readOnly();s.select(0)')
        self.page.keyboard.insert_text('blocked');self.page.evaluate('vb6Studio.editor.replaceGlobal("blocked",0,0)')
        self.assertEqual(self.text(),before);self.page.evaluate('vb6Studio.runState="design";vb6Studio.documents.readOnly()');self.done()
    def test_xaml_typing_updates_designer_and_shared_undo(self):
        self.enable();self.page.evaluate('()=>{const tool=vb6Studio.xaml.open("form");globalThis.xs=r.surfaces.get(tool.editor);xs.focus();}')
        self.page.evaluate(r'''()=>{const text=xs.record.model.getValue(),at=text.indexOf('Caption="Original"')+9;xs.replace('Changed',at,at+8);}''')
        self.assertEqual(self.page.evaluate('vb6Studio.project.modules[0].form.controls[0].properties.Caption'),'Changed')
        self.page.evaluate('vb6Studio.command("undo")')
        self.assertEqual(self.page.evaluate('vb6Studio.project.modules[0].form.controls[0].properties.Caption'),'Original')
        self.assertIn('Caption="Original"',self.page.evaluate('xs.record.model.getValue()'));self.done()
    def test_versioned_rename_and_stale_edit_rejection(self):
        self.enable();result=self.page.evaluate('async()=>{const c=s.record.client,edit=await c.request("textDocument/rename",{textDocument:{uri:s.record.uri},position:{line:3,character:7},newName:"sum"});return await r.applyEdit(c,edit,"Rename total",false);}');self.assertTrue(result['applied']);self.assertIn('Public sum As Long',self.text())
        result=self.page.evaluate(r'''async()=>{const c=s.record.client,u=s.record.uri,d=c.documents.get(u),edit={documentChanges:[{textDocument:{uri:u,version:d.version},edits:[{range:d.range(0,0),newText:'bad'}]}]};s.replace('\n',s.record.model.getValueLength(),s.record.model.getValueLength());return r.applyEdit(c,edit,'stale',false);}''')
        self.assertFalse(result['applied']);self.assertFalse(self.text().startswith('bad'));self.done()
    def test_disconnect_keeps_editing_and_reconfigure_reconnects(self):
        self.enable();self.page.evaluate(r'''s.record.client.peer.close(new Error('test disconnect'));s.replace("\n'after disconnect",s.record.model.getValueLength(),s.record.model.getValueLength())''')
        self.assertTrue(self.text().endswith('after disconnect'));self.enable();self.assertEqual(self.page.evaluate('s.record.client.state'),'ready');self.done()
    def test_project_replacement_releases_previous_models(self):
        self.enable();old=self.page.evaluate('[...r.records.keys()]');self.page.evaluate('()=>{const p=VB6StudioAPI.newProject("Other");p.id="other-project";vb6Studio.loadProject(p);vb6Studio.openDocument(p.modules[0].id,"code");}')
        self.page.wait_for_function('[...r.records.keys()].every(u=>u.includes("other-project"))')
        self.assertFalse(any(u in old for u in self.page.evaluate('[...r.records.keys()]')));self.assertEqual(self.page.evaluate('VB6AdvancedMonaco.monaco.editor.getModels().length'),1);self.done()
if __name__=='__main__':unittest.main(verbosity=2)
