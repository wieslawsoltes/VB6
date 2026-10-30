"""TUI acceptance over the real optional Monaco surface and original model."""
import importlib.util
import unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('advanced_acceptance',Path(__file__).with_name('browser-advanced-editor-tests.py'))
advanced=importlib.util.module_from_spec(spec);spec.loader.exec_module(advanced)
advanced.REPORT=advanced.REPORT.parent/('tui-'+advanced.TRANSPORT)
REPORT=advanced.REPORT
class TUIAdvancedAcceptance(advanced.AdvancedEditorAcceptance):
    def tui(self):
        self.page.evaluate("async()=>{vb6Studio.setRenderingPolicy({backend:'html'});await vb6Studio.dosMode.configure({mode:'dos',profile:'commander'});window.tui=vb6Studio.dosMode.sessions.get(document);}")
        self.page.wait_for_function("tui.textViews.entries.size>0&&[...tui.textViews.entries.values()].every(e=>e.buffer)")
    def test_tui_real_editing_shared_undo_and_configuration_restore(self):
        self.enable();before=self.text()
        raw=self.page.evaluate('({fontSize:s.view.getRawOptions().fontSize,lineHeight:s.view.getOption(VB6AdvancedMonaco.monaco.editor.EditorOption.lineHeight)})')
        self.tui()
        self.assertEqual(self.page.evaluate('s.view.getOption(VB6AdvancedMonaco.monaco.editor.EditorOption.lineHeight)'),16)
        self.page.evaluate('s.select(s.record.model.getValueLength())');self.page.keyboard.insert_text("' TUI editing\n")
        self.page.wait_for_function("[...tui.textViews.entries.values()].some(e=>e.buffer?.toText().includes('TUI editing'))")
        self.assertTrue(self.text().endswith("' TUI editing\n"))
        self.page.keyboard.press('Control+z');self.assertEqual(self.text(),before)
        self.page.evaluate("vb6Studio.dosMode.configure({mode:'classic'})")
        self.assertEqual(self.page.locator('.vb-tui-text-view').count(),0)
        self.assertEqual(self.page.evaluate('({fontSize:s.view.getRawOptions().fontSize,lineHeight:s.view.getOption(VB6AdvancedMonaco.monaco.editor.EditorOption.lineHeight)})'),raw)
        self.assertEqual(self.page.evaluate('tui.surfacePixels'),0);self.done()
    def test_tui_folding_selection_breakpoint_and_screen(self):
        self.enable();self.tui()
        self.page.evaluate("()=>{s.select(0,6);vb6Studio.toggleBreakpoint('Form1',4);vb6Studio.editor.setExecution({module:'Form1',line:4});s.decorate();}")
        self.page.wait_for_function("[...tui.textViews.entries.values()].some(e=>e.provider.read().items.some(i=>i.selected)&&e.provider.read().items.some(i=>i.marker))")
        self.assertTrue(self.page.evaluate("tui.screen().toText().includes('Option Explicit')"))
        self.page.evaluate('s.view.getAction("editor.foldAll").run()')
        self.page.wait_for_function("!s.view.getVisibleRanges().some(r=>r.startLineNumber<=4&&r.endLineNumber>=4)")
        self.page.evaluate('s.view.getAction("editor.unfoldAll").run()')
        self.assertEqual(self.page.evaluate('vb6Studio.breakpoints[0].line'),4)
        self.page.screenshot(path=str(REPORT/'tui-source.png'))
        self.assertEqual(self.page.evaluate('tui.metrics.failures'),0);self.done()
    def test_tui_appearance_updates_are_reversible_and_composition_is_native(self):
        self.enable();self.tui();before=self.text()
        self.page.evaluate("s.appearance()")
        self.assertEqual(self.page.evaluate('s.view.getOption(VB6AdvancedMonaco.monaco.editor.EditorOption.lineHeight)'),16)
        # Presentation composition lifecycle only; no OS IME qualification.
        self.page.evaluate("s.composing=true;tui.textViews.invalidate();tui.flush()")
        self.assertEqual(self.page.locator('[data-tui-text-view]').count(),0)
        self.page.evaluate("s.composing=false;tui.textViews.invalidate();tui.flush()")
        self.assertGreater(self.page.locator('[data-tui-text-view]').count(),0)
        self.assertEqual(self.text(),before)
        for profile in ['turbo','win31','monochrome','commander']:
            self.page.evaluate('(profile)=>vb6Studio.dosMode.configure({mode:"dos",profile})',profile)
            self.page.wait_for_function('tui.frame===0&&[...tui.textViews.entries.values()].every(e=>e.buffer)')
            self.assertTrue(self.page.evaluate('tui.surfacePixels===[...tui.controls.values(),...tui.chrome.entries.values(),...tui.textViews.entries.values()].reduce((n,e)=>n+e.pixels,0)'))
        self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:false})')
        self.page.wait_for_function('tui.textViews.entries.size===0')
        self.assertEqual(self.page.locator('.vb-tui-text-view').count(),0);self.done()

    def test_tui_split_views_keep_independent_carets_and_shared_undo(self):
        self.enable();self.tui();before=self.text()
        self.page.evaluate('s.view.setPosition({lineNumber:2,column:1});s.setSplit(true)')
        self.page.wait_for_function('tui.textViews.entries.size===2&&[...tui.textViews.entries.values()].every(e=>e.buffer)')
        self.assertTrue(self.page.evaluate('s.views[0].view.getModel()===s.views[1].view.getModel()'))
        self.page.evaluate('s.views[1].view.setPosition({lineNumber:4,column:1});s.views[1].view.focus()')
        self.page.keyboard.insert_text("'")
        self.assertTrue(self.text().splitlines()[3].startswith("'"))
        self.assertEqual(self.page.evaluate('s.views[0].view.getPosition().lineNumber'),2)
        self.page.keyboard.press('Control+z');self.assertEqual(self.text(),before)
        self.page.evaluate('s.setSplit(false)');self.page.wait_for_function('tui.textViews.entries.size===1')
        self.page.evaluate("vb6Studio.dosMode.configure({mode:'classic'})")
        self.assertEqual(self.page.evaluate('tui.surfacePixels'),0);self.done()

def load_tests(loader,tests,pattern):
    names=[name for name in TUIAdvancedAcceptance.__dict__ if name.startswith('test_tui_')]
    return unittest.TestSuite(TUIAdvancedAcceptance(name) for name in advanced.select_case_names(names,advanced.configured_shard('advanced-editor')))
if __name__=='__main__': unittest.main(verbosity=2)
