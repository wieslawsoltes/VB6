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
IDE_STARTUP_TIMEOUT_MS=60000
FIXTURE=r'''()=>{const A=VB6StudioAPI,p=A.newProject('EditorTest'),m=p.modules[0];p.id='editor-test';p.settings.xaml=true;p.settings.renderer='canvas2d';m.id='form';m.name='Form1';m.form.name='Form1';m.form.properties.Name='Form1';
const button=A.createControl('CommandButton','Button1',300,300);button.id='button';button.properties.Caption='Original';m.form.controls=[button];
m.code='Option Explicit\nPublic total As Long\nPrivate Sub Button1_Click()\n    total = Add(1, 2)\nEnd Sub\n';
p.modules.push({id:'math',name:'Math',kind:'module',code:'Option Explicit\nPublic Function Add(ByVal left As Long, ByVal right As Long) As Long\n    Add = left + right\nEnd Function\n'});p.startup='Form1';vb6Studio.loadProject(p);vb6Studio.openDocument('form','code');return true;}'''
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
class AdvancedEditorTestResult(unittest.TextTestResult):
    """Keep the failure cause even if a later case or CI cancellation stops the suite."""
    def addError(self,test,error):
        super().addError(test,error)
        self.stream.writeln(self._exc_info_to_string(error,test));self.stream.flush()
    def addFailure(self,test,error):
        super().addFailure(test,error)
        self.stream.writeln(self._exc_info_to_string(error,test));self.stream.flush()
class AdvancedEditorTestRunner(unittest.TextTestRunner):
    resultclass=AdvancedEditorTestResult
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
        self.started=time.perf_counter();self.errors=[];self.errorStacks=[];self.requests=[];self.passed=False
        self.context=self.browser.new_context(viewport={'width':1500,'height':1000})
        try:
            self.context.set_default_timeout(15000)
            self.page=self.context.new_page();self.page.on('pageerror',lambda e:(self.errors.append(str(e)),self.errorStacks.append(e.stack)));self.page.on('request',lambda r:self.requests.append(r.url))
            # Parsing the standalone artifact and starting the IDE have a separate
            # bounded deadline; all subsequent interactions retain their 15s limit.
            if TRANSPORT=='memory':self.page.set_content((ROOT/'dist/VB6-Studio-Web-Advanced.html').read_text(),wait_until='domcontentloaded',timeout=IDE_STARTUP_TIMEOUT_MS)
            elif TRANSPORT=='file':self.page.goto((ROOT/'dist/VB6-Studio-Web-Advanced.html').as_uri(),wait_until='domcontentloaded',timeout=IDE_STARTUP_TIMEOUT_MS)
            else:self.page.goto(self.base+'/dist/index.html',wait_until='domcontentloaded',timeout=IDE_STARTUP_TIMEOUT_MS)
            self.page.wait_for_function('globalThis.vb6Studio?.advancedEditor',timeout=IDE_STARTUP_TIMEOUT_MS);self.page.evaluate(FIXTURE)
        except Exception:
            # unittest does not call tearDown after a failed setUp.
            try:self.context.close()
            except Exception:pass
            raise
    def tearDown(self):
        self.results.append({'name':self._testMethodName,'passed':self.passed and not self.errors,'pageErrors':self.errors,'pageErrorStacks':self.errorStacks,'milliseconds':round((time.perf_counter()-self.started)*1000,2)})
        if not self.passed:self.page.screenshot(path=str(REPORT/(self._testMethodName+'.png')))
        self.context.close();self.assertEqual(self.errors,[], '\n'.join(self.errorStacks))
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
        self.page.locator('.advanced-breakpoint').first.wait_for(state='visible');self.page.locator('.advanced-execution-arrow').first.wait_for(state='visible')
        lanes=self.page.evaluate('s.record.model.getAllDecorations().filter(d=>d.options.glyphMarginClassName?.startsWith("advanced-")).map(d=>d.options.glyphMargin.position)')
        self.assertEqual(len(set(lanes)),2)
        self.assertEqual(self.page.evaluate('vb6Studio.breakpoints[0].line'),4)
        self.page.evaluate('vb6Studio.editor.setExecution(null);vb6Studio.toggleBreakpoint("Form1",4);s.decorate()')
        self.page.locator('.advanced-breakpoint').wait_for(state='detached');self.assertEqual(self.page.locator('.advanced-execution-arrow').count(),0);self.done()
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
    def test_inline_peek_previews_shared_models_without_changing_active_document(self):
        self.enable();self.page.evaluate('()=>{s.view.setPosition({lineNumber:4,column:14});return s.view.getAction("editor.action.peekDefinition").run();}')
        self.page.wait_for_function('!!s.peek?.preview.getModel()')
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.id'),'form')
        self.assertTrue(self.page.evaluate('s.peek.preview.getModel()===r.records.get(s.peek.locations[0].uri).model'))
        self.assertIn('Math.bas',self.page.locator('.advanced-peek-locations').inner_text())
        self.page.locator('.advanced-peek').get_by_role('button',name='Open',exact=True).click()
        self.page.wait_for_function('vb6Studio.activeModule.id==="math"');self.assertEqual(self.page.locator('.advanced-peek').count(),0);self.done()
    def test_rename_widget_uses_one_undoable_project_transaction(self):
        self.enable();before=self.text();self.page.evaluate('s.view.setPosition({lineNumber:4,column:7});s.focus()')
        self.page.keyboard.press('F2')
        box=self.page.locator('.rename-box input').first;box.wait_for(state='visible');box.fill('sum');box.press('Enter')
        self.page.wait_for_function('vb6Studio.project.modules[0].code.includes("Public sum As Long")')
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),1)
        self.page.evaluate('vb6Studio.command("undo")');self.assertEqual(self.text(),before);self.done()
    def test_superseded_opt_in_does_not_leave_workers_or_models_mounted(self):
        results=self.page.evaluate('async()=>{const a=vb6Studio.advancedEditor;return await Promise.all([a.configure({enabled:true}),a.configure({enabled:false})]);}')
        self.assertEqual(results,[False,False]);self.assertEqual(self.page.locator('.advanced-editor-surface').count(),0)
        self.enable();self.assertEqual(self.page.evaluate('VB6AdvancedMonaco.monaco.editor.getModels().length'),3);self.done()
    def test_project_symbol_tool_navigates_and_cleans_up_on_opt_out(self):
        self.enable();self.page.evaluate('vb6Studio.command("advancedEditorSymbols")')
        query=self.page.get_by_role('searchbox',name='Search project symbols');query.fill('Add')
        self.page.wait_for_function('r.navigationTools.tools.get("symbols").roots.some(x=>x.item.name==="Add")')
        self.assertLess(self.page.locator('.advanced-navigation-row').count(),30)
        self.page.locator('.advanced-navigation-tool').get_by_role('button',name='Open',exact=True).click()
        self.page.wait_for_function('vb6Studio.activeModule.id==="math"')
        self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:false})')
        self.assertEqual(self.page.locator('.advanced-navigation-tool').count(),0)
        self.assertFalse(self.page.evaluate('[...vb6Studio.documents.tools.keys()].some(x=>x.startsWith("tool:advanced:"))'));self.done()
    def test_call_hierarchy_modeless_rows_sites_and_stale_refresh(self):
        self.enable();self.page.evaluate('s.view.setPosition({lineNumber:4,column:14});s.view.getAction("vb6.callHierarchy").run()')
        self.page.wait_for_function('r.navigationTools.tools.get("call").roots[0]?.children?.length===1')
        tool=self.page.locator('.advanced-navigation-tool')
        self.assertIn('Button1_Click',tool.inner_text())
        self.page.evaluate('r.navigationTools.tools.get("call").select(1)')
        tool.get_by_role('button',name='Call sites',exact=True).click()
        self.page.wait_for_function('!!s.peek');self.assertEqual(self.page.locator('.advanced-peek-locations [role=option]').count(),1)
        self.page.evaluate('s.peek.dispose();s.select(s.record.model.getValueLength());s.replace("\\n",s.selection().start,s.selection().end)')
        self.page.wait_for_function('r.navigationTools.tools.get("call").stale')
        self.assertIn('workspace changed',tool.inner_text())
        self.page.evaluate('vb6Studio.documents.closeTool("tool:advanced:call")')
        self.assertEqual(self.page.locator('.advanced-navigation-tool').count(),0);self.done()
    def test_type_hierarchy_expansion_and_implementation_navigation(self):
        self.page.evaluate(r'''()=>{const p=vb6Studio.project;p.modules.push({id:'interface',name:'IFoo',kind:'class',code:'Public Sub Ping()\nEnd Sub\n'},{id:'impl',name:'Worker',kind:'class',code:'Implements IFoo\nPrivate Sub IFoo_Ping()\nEnd Sub\n'});p.modules[0].code='Public Sub Run()\n  Dim x As IFoo\n  x.Ping\nEnd Sub\n';vb6Studio.loadProject(p);vb6Studio.openDocument('form','code');}''')
        self.enable();self.page.evaluate('s.view.setPosition({lineNumber:3,column:3});s.view.getAction("vb6.typeHierarchy").run()')
        self.page.wait_for_function('r.navigationTools.tools.get("type").roots[0]?.children?.[0]?.item.name==="Worker"')
        self.assertIn('Worker',self.page.locator('.advanced-navigation-tool').inner_text())
        self.page.evaluate('r.navigationTools.tools.get("type").select(1)')
        self.page.locator('.advanced-navigation-tool').get_by_role('button',name='Open',exact=True).click()
        self.page.wait_for_function('vb6Studio.activeModule.id==="impl"');self.done()
    def test_split_views_share_model_history_and_readonly_with_independent_carets(self):
        self.enable();before=self.text();self.page.evaluate('s.view.setPosition({lineNumber:2,column:1});s.setSplit(true)')
        self.assertEqual(self.page.locator('.advanced-editor-pane .monaco-editor').count(),2)
        self.assertTrue(self.page.evaluate('s.views[0].view.getModel()===s.views[1].view.getModel()'))
        self.page.evaluate('s.views[1].view.setPosition({lineNumber:4,column:1});s.views[1].view.focus()')
        self.page.keyboard.insert_text("'")
        self.assertTrue(self.text().splitlines()[3].startswith("'"))
        self.assertEqual(self.page.evaluate('s.views[0].view.getPosition().lineNumber'),2)
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().line'),4)
        self.page.keyboard.press('Control+z');self.assertEqual(self.text(),before)
        self.page.evaluate('vb6Studio.runState="running";s.updateReadOnly()')
        self.assertTrue(self.page.evaluate('s.views.every(v=>v.view.getOption(VB6AdvancedMonaco.monaco.editor.EditorOption.readOnly))'))
        self.page.keyboard.insert_text('bad');self.assertEqual(self.text(),before)
        self.page.evaluate('vb6Studio.runState="design";s.updateReadOnly()')
        splitter=self.page.get_by_role('separator',name='Resize split editor');splitter.focus();splitter.press('ArrowUp')
        self.assertEqual(splitter.get_attribute('aria-valuenow'),'45')
        self.page.evaluate('s.setSplit(false)');self.assertEqual(self.page.locator('.advanced-editor-pane .monaco-editor').count(),1)
        self.assertEqual(self.page.evaluate('s.view.getPosition().lineNumber'),4)
        self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:false})');self.assertEqual(self.page.evaluate('VB6AdvancedMonaco.monaco.editor.getModels().length'),0);self.done()
    def test_debugger_data_tip_uses_real_paused_frame_and_drops_after_resume(self):
        self.page.evaluate(r'''()=>{const p=VB6StudioAPI.newProject('DataTip');p.id='data-tip';p.modules=[{id:'form',name:'MainModule',kind:'module',code:'Public Sub Main()\n  Dim value As Long\n  value = 42\n  Stop\n  Debug.Print value\nEnd Sub\n'}];p.startup='Sub Main';vb6Studio.loadProject(p);vb6Studio.openDocument('form','code');}''')
        self.enable();self.page.evaluate('()=>{void vb6Studio.command("run");}')
        self.page.wait_for_function('vb6Studio.runState==="paused"&&vb6Studio.debuggerWindows.pauseId>0')
        self.page.wait_for_timeout(100)
        result=self.page.evaluate('()=>r.debugHover.provideHover(s.record.model,{lineNumber:5,column:16})')
        self.assertIn('value = 42',result['contents'][0]['value']);self.assertFalse(result['contents'][0]['isTrusted'])
        self.page.evaluate('s.view.setPosition({lineNumber:5,column:16});s.focus();s.view.getAction("editor.action.showHover").run()')
        self.page.locator('.monaco-hover').filter(has_text='value = 42').first.wait_for(state='visible')
        self.page.evaluate('()=>{void vb6Studio.command("run");}')
        self.page.wait_for_function('vb6Studio.output.includes("42")')
        self.assertIsNone(self.page.evaluate('()=>r.debugHover.provideHover(s.record.model,{lineNumber:5,column:16})'))
        self.page.evaluate('vb6Studio.stop(false)');self.done()
    def paused_inline_fixture(self):
        self.page.evaluate(r"""()=>{const p=VB6StudioAPI.newProject('InlineValues');p.id='inline-values';p.modules=[{id:'form',name:'MainModule',kind:'module',code:'Public Sub Main()\n  Dim value As Long\n  value = 42\n  Stop\n  Debug.Print value\nEnd Sub\n'}];p.startup='Sub Main';vb6Studio.loadProject(p);vb6Studio.openDocument('form','code');}""")
        self.enable();self.page.evaluate('()=>{void vb6Studio.command("run");}')
        self.page.wait_for_function('vb6Studio.runState==="paused"&&vb6Studio.debuggerWindows.pauseId>0')
    def test_inline_values_use_real_paused_storage_and_clear_on_resume_in_both_panes(self):
        self.paused_inline_fixture();before=self.text()
        self.page.wait_for_function('s.views[0].inlineValues.last.some(v=>v.text.includes("value = 42"))')
        self.page.locator('.advanced-inline-debug-value').filter(has_text='value = 42').first.wait_for(state='visible')
        self.assertEqual(self.text(),before);self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),0)
        self.page.evaluate('s.setSplit(true)')
        self.page.wait_for_function('s.views.length===2&&s.views.every(v=>v.inlineValues.last.some(x=>x.text.includes("value = 42")))')
        self.assertEqual(self.page.evaluate('r.inlineInspections.maxConcurrent'),2)
        self.page.evaluate('()=>{void vb6Studio.command("run");}')
        self.page.wait_for_function('vb6Studio.output.includes("42")&&s.views.every(v=>v.inlineValues.last.length===0)')
        self.assertEqual(self.page.locator('.advanced-inline-debug-value').count(),0);self.assertEqual(self.text(),before)
        self.page.evaluate('vb6Studio.stop(false)');self.done()
    def test_inline_values_option_and_composition_do_not_mutate_the_document(self):
        self.paused_inline_fixture();before=self.text()
        self.page.wait_for_function('s.views[0].inlineValues.last.length>0')
        self.page.evaluate('s.composing=true;s.refreshInlineValues()')
        self.assertEqual(self.page.evaluate('s.views[0].inlineValues.last.length'),0)
        self.page.evaluate('s.composing=false;s.refreshInlineValues()')
        self.page.wait_for_function('s.views[0].inlineValues.last.length>0')
        self.page.evaluate('()=>vb6Studio.advancedEditor.configure({enabled:true,inlineValues:false})')
        self.page.evaluate('globalThis.r=vb6Studio.advancedEditor.runtime;globalThis.s=r.surfaces.get(vb6Studio.editor)')
        self.assertFalse(self.page.evaluate('r.settings.inlineValues'));self.assertEqual(self.page.locator('.advanced-inline-debug-value').count(),0)
        self.assertEqual(self.text(),before);self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),0)
        self.page.evaluate('vb6Studio.stop(false)');self.done()
    def test_structural_folding_uses_matched_blocks_and_invalidates_on_edit(self):
        code="Option Explicit\n' #Region Helpers\nPrivate Sub Button1_Click()\n  For i=1 To 3\n    Wend\n  Next\nEnd Sub\n' #End Region\n"
        self.source_fixture(code);self.enable()
        folds=self.page.evaluate('()=>s.record.client.request("textDocument/foldingRange",{textDocument:{uri:s.record.uri}})')
        self.assertEqual([(r['startLine'],r['endLine']) for r in folds],[(1,7),(2,6),(3,5)])
        self.page.evaluate('s.replace("",s.record.model.getValue().indexOf("  Next"),s.record.model.getValue().indexOf("  Next")+7)')
        folds=self.page.evaluate('()=>s.record.client.request("textDocument/foldingRange",{textDocument:{uri:s.record.uri}})')
        self.assertEqual([(r['startLine'],r['endLine']) for r in folds],[(1,6),(2,5)])
        self.page.evaluate('vb6Studio.command("undo")');self.assertEqual(self.text(),code);self.done()
    def test_confirmation_rejects_edits_after_an_unrelated_document_changes(self):
        self.enable();before=self.text()
        self.page.evaluate(r'''()=>{const c=s.record.client,u=s.record.uri;globalThis.editResult=null;const edit={changes:{[u]:[{range:{start:{line:0,character:0},end:{line:0,character:0}},newText:"'should not apply\n"}]}};r.applyEdit(c,edit,'Test delayed consent',true).then(value=>editResult=value);}''')
        dialog=self.page.get_by_role('dialog',name='Apply Workspace Edit');dialog.wait_for(state='visible')
        self.page.evaluate('()=>{const record=[...r.records.values()].find(x=>x.moduleId==="math");r.setText(record,record.model.getValue()+"\\n");}')
        dialog.get_by_role('button',name='Apply',exact=True).click()
        self.page.wait_for_function('!!editResult')
        self.assertFalse(self.page.evaluate('editResult.applied'));self.assertEqual(self.text(),before);self.done()
    def test_pending_linked_editing_teardown_is_handled_without_disabling_the_feature(self):
        self.enable();self.page.evaluate('s.view.setPosition({lineNumber:4,column:5});s.setSplit(true);s.views[1].view.focus()')
        self.page.wait_for_timeout(800)
        self.assertTrue(self.page.evaluate('s.views.every(v=>v.view.getOption(VB6AdvancedMonaco.monaco.editor.EditorOption.linkedEditing))'))
        self.page.evaluate('s.views[1].view.setPosition({lineNumber:4,column:6});s.views[0].view.focus();s.views[1].view.focus();s.setSplit(false)')
        self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:false})')
        self.page.wait_for_timeout(100);self.done()
    def source_fixture(self,code):
        self.page.evaluate('code=>{const p=structuredClone(vb6Studio.project);p.modules[0].code=code;vb6Studio.loadProject(p);vb6Studio.openDocument("form","code");}',code)
    def test_classic_selection_find_is_global_undoable_and_preserves_scope(self):
        code='Option Explicit\nPrivate Sub Button1_Click()\n  Debug.Print "outside café"\nEnd Sub\nPrivate Sub Second()\n  Debug.Print "café", "café"\nEnd Sub\n'
        self.source_fixture(code)
        scope=self.page.evaluate(r'''()=>{const e=vb6Studio.editor,start=e.text.indexOf('  Debug.Print',e.text.indexOf('Sub Second'));e.selectGlobal(start,e.text.indexOf('\nEnd Sub',start));e.setViewMode('procedure');e.selectGlobal(start,e.text.indexOf('\nEnd Sub',start));const scope=e.selectionBounds();e.showFind(true);return scope;}''')
        bar=self.page.locator('.editor-find:visible');bar.get_by_role('textbox',name='Find what').fill('café');bar.get_by_role('checkbox',name='Find in selection').check()
        self.assertEqual(bar.locator('.find-result').inner_text(),'2 matches')
        bar.get_by_role('button',name='Find next',exact=True).click()
        self.page.evaluate('vb6Studio.editor.showFind(true)')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.findScope'),scope)
        bar.get_by_role('textbox',name='Replace with').fill('changed$1');bar.get_by_role('button',name='All',exact=True).click()
        self.assertEqual(self.text(),code[:scope['start']]+code[scope['start']:scope['end']].replace('café','changed$1')+code[scope['end']:])
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),1)
        self.assertEqual(self.page.evaluate('vb6Studio.editor.findScope.end'),scope['end']+10)
        bar.get_by_role('textbox',name='Find what').press('Escape');self.assertEqual(self.page.locator('.editor-find:visible').count(),0)
        self.page.evaluate('vb6Studio.command("undo")');self.assertEqual(self.text(),code);self.done()
    def test_classic_source_action_menu_extracts_and_undoes_one_transaction(self):
        code='Option Explicit\nPrivate Sub Button1_Click()\n    Debug.Print 42\nEnd Sub\n'
        self.source_fixture(code);self.page.evaluate('()=>{const e=vb6Studio.editor,n=e.text.indexOf("42");e.selectGlobal(n,n+2);e.input.focus();}')
        self.page.keyboard.press('Control+.');self.page.get_by_text('Extract constant NewConstant',exact=True).click()
        self.assertIn('    Const NewConstant As Integer = 42\n',self.text());self.assertIn('Debug.Print NewConstant',self.text())
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),1)
        self.assertEqual(self.page.evaluate('()=>{const e=vb6Studio.editor,s=e.selectionBounds();return e.text.slice(s.start,s.end);}') ,'NewConstant')
        self.page.keyboard.press('Control+z');self.assertEqual(self.text(),code);self.done()
    def test_classic_source_actions_refuse_stale_readonly_composition_and_designer_contexts(self):
        code='Option Explicit\nPrivate Sub Button1_Click()\n    Debug.Print 42\nEnd Sub\n'
        self.source_fixture(code)
        result=self.page.evaluate('''()=>{const i=vb6Studio,e=i.editor,n=e.text.indexOf('42');e.selectGlobal(n,n+2);const a=i.sourceCodeActions().find(a=>a.kind==='refactor.extract.constant'),snap={project:i.project,module:i.activeModule,editor:e};let blocked=0;e.composing=true;const absent=i.sourceCodeActions().length;try{i.applySourceCodeAction(a,snap);}catch{blocked++;}e.composing=false;e.setReadOnly(true);try{i.applySourceCodeAction(a,snap);}catch{blocked++;}e.setReadOnly(false);i.openDocument(i.activeModule.id,'designer');try{i.applySourceCodeAction(a,snap);}catch{blocked++;}i.openDocument(i.activeModule.id,'code');e.replaceGlobal(' ',e.text.length,e.text.length);try{i.applySourceCodeAction(a,snap);}catch{blocked++;}return {absent,blocked};}''')
        self.assertEqual(result,{'absent':0,'blocked':4});self.assertNotIn('NewConstant',self.text());self.done()
    def test_built_in_constant_actions_apply_versioned_workspace_edits_in_monaco(self):
        code='Option Explicit\nPrivate Sub Button1_Click()\n    Debug.Print 42\nEnd Sub\n'
        self.source_fixture(code);self.enable()
        result=self.page.evaluate('''async()=>{const c=s.record.client,d=c.documents.get(s.record.uri),n=d.text.indexOf('42'),actions=await c.request('textDocument/codeAction',{textDocument:{uri:d.uri},range:d.range(n,n+2),context:{only:['refactor.extract'],diagnostics:[]}});const a=actions[0];return {kind:a.kind,version:a.edit.documentChanges[0].textDocument.version,applied:await r.applyEdit(c,a.edit,a.title,false)};}''')
        self.assertEqual(result['kind'],'refactor.extract.constant');self.assertEqual(result['version'],1);self.assertTrue(result['applied']['applied'])
        self.assertIn('Const NewConstant As Integer = 42',self.text());self.assertEqual(self.page.evaluate('s.record.model.getValue()'),self.text())
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'),1);self.page.evaluate('vb6Studio.command("undo")');self.assertEqual(self.text(),code);self.done()
    def test_built_in_workspace_diagnostics_have_stable_results_and_current_versions(self):
        self.enable()
        result=self.page.evaluate('''async()=>{const c=s.record.client,first=await c.request('workspace/diagnostic',{identifier:'vb6-studio',previousResultIds:[]},{workspace:true});const previousResultIds=first.items.map(i=>({uri:i.uri,value:i.resultId})),second=await c.request('workspace/diagnostic',{identifier:'vb6-studio',previousResultIds},{workspace:true});return {count:first.items.length,full:first.items.every(i=>i.kind==='full'&&Array.isArray(i.items)),unchanged:second.items.every(i=>i.kind==='unchanged'),versions:second.items.every(i=>i.version===c.documents.get(i.uri).version),listeners:c.listeners.get('$/progress')?.size||0};}''')
        self.assertGreaterEqual(result['count'],2);self.assertTrue(result['full']);self.assertTrue(result['unchanged']);self.assertTrue(result['versions'])
        self.assertLessEqual(result['listeners'],1);self.done()
    def test_large_document_keeps_dom_and_lexical_scans_bounded(self):
        self.page.evaluate(r'''()=>{const p=VB6StudioAPI.newProject('Large');p.id='large';p.modules[0].code='Option Explicit\nPrivate Sub Main()\nDim value As Long\n'+('    value = 1\n').repeat(99996)+'End Sub\n';vb6Studio.loadProject(p);vb6Studio.openDocument(p.modules[0].id,'code');}''')
        self.enable();metrics=self.page.evaluate('''()=>{const model=s.record.model,doc=s.record.client.documents.get(s.record.uri),before=vb6Studio.editor.metrics.indexedLines,scanned=doc.scannedCharacters,times=[];s.view.setPosition({lineNumber:50000,column:14});
          for(let i=0;i<5;i++){const pos=s.selection().start,t=performance.now();s.replace(' ',pos,pos);times.push(performance.now()-t);}
          return {lines:model.getLineCount(),utf16:model.getValueLength(),indexedLines:vb6Studio.editor.metrics.indexedLines-before,scannedCharacters:doc.scannedCharacters-scanned,editAndSyncMilliseconds:times};}''')
        self.page.wait_for_function('s.view.getVisibleRanges().some(r=>r.startLineNumber<=50000&&r.endLineNumber>=50000)')
        metrics['visibleDomLines']=self.page.locator('.advanced-editor-surface .view-line').count()
        metrics['measurement']='Synchronous programmatic IDE edit and LSP sync wall time; not keystroke latency or FPS.'
        (REPORT/'large-document.json').write_text(json.dumps(metrics,indent=2))
        self.assertEqual(metrics['lines'],100001);self.assertLess(metrics['visibleDomLines'],200)
        self.assertLess(metrics['indexedLines'],30);self.assertLess(metrics['scannedCharacters'],1000)
        self.assertTrue(self.page.evaluate('s.record.model.getValue()===vb6Studio.activeModule.code'))
        self.done()
if __name__=='__main__':unittest.main(verbosity=2,testRunner=AdvancedEditorTestRunner)
