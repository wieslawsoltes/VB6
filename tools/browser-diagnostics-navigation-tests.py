#!/usr/bin/env python3
"""Real worker-start/navigation lifecycle checks using the existing IDE fixture.
The original export regression remains independently owned by the auto-layout
suite. This suite adds a same-task worker startup/navigation race and recovery
from a cancelled navigation; it never filters page errors or retries assertions.
"""
import importlib.util
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('auto_layout_browser',Path(__file__).with_name('auto-layout-browser-tests.py'))
base=importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
base.REPORT=base.ROOT/'reports'/'diagnostics-navigation'/base.ENGINE
MEMORY=base.MEMORY

class DiagnosticsNavigation(base.AutoLayout):
    def test_diagnostics_navigation_cancels_startup_before_persistence_hooks(self):
        if MEMORY:self.skipTest('Requires a real cross-document HTTP navigation')
        # Create and navigate in the same task, so no worker ready response can
        # hide the startup race. A later unload observer simulates persistence
        # reentrancy and records state in this test context's isolated storage.
        destination=self.base+'/tests/fixtures/layout-runtime.html'
        self.page.evaluate("""url=>{
            const s=vb6Studio.syntaxDiagnostics;
            addEventListener('beforeunload',()=>{
                s.schedule(vb6Studio.project,0);s.start();
                localStorage.setItem('diagnostics-navigation-state',JSON.stringify({
                    suspended:s.suspended,pending:s.pending,worker:s.worker!==null,
                    timer:s.timer!==null,busy:s.busy!==null
                }));
            },{once:true});
            s.cancel();s.schedule(vb6Studio.project,0);s.start();location.assign(url);
        }""",destination)
        self.page.wait_for_url(destination)
        self.assertEqual(self.page.evaluate("JSON.parse(localStorage.getItem('diagnostics-navigation-state'))"),
                         {'suspended':True,'pending':False,'worker':False,'timer':False,'busy':False})
        self.page.wait_for_load_state('load');self.done()
    def test_diagnostics_abandoned_navigation_recovers_on_real_keyboard_input(self):
        self.page.evaluate("""()=>{
            dispatchEvent(new Event('beforeunload'));
            const s=vb6Studio.syntaxDiagnostics;s.schedule(vb6Studio.project,0);s.start();
        }""")
        self.assertTrue(self.page.evaluate('vb6Studio.syntaxDiagnostics.suspended'))
        before=self.page.evaluate('vb6Studio.syntaxDiagnostics.metrics.responses')
        self.page.keyboard.press('Shift')
        self.page.wait_for_function('n=>vb6Studio.syntaxDiagnostics.metrics.responses>n',arg=before)
        self.assertEqual(self.page.evaluate('vb6Studio.syntaxDiagnostics.mode'),'worker')
        self.assertFalse(self.page.evaluate('vb6Studio.syntaxDiagnostics.suspended'));self.done()

if __name__=='__main__':
    # Do not rerun the unrelated auto-layout gestures inherited with the shared
    # fixture. Explicit command-line test names still use unittest's standard UI.
    unittest.main(verbosity=2,defaultTest=[
        'DiagnosticsNavigation.test_diagnostics_worker_uses_owned_source_and_completes',
        'DiagnosticsNavigation.test_diagnostics_navigation_cancels_startup_before_persistence_hooks',
        'DiagnosticsNavigation.test_diagnostics_abandoned_navigation_recovers_on_real_keyboard_input'
    ])
