#!/usr/bin/env python3
"""Input-mode acceptance against the production IDE and genuine keyboard events.

Run after npm run build. HTTP is the default; BASE can name a served dist
directory or its index.html. VB6_TEST_TRANSPORT=file/memory selects the exact
standalone artifact. Memory cannot validate persistent storage or reload and
records that coverage limit. VB6_TEST_ADVANCED=1 adds real Monaco/XAML/TUI checks;
otherwise advanced coverage is explicitly reported as not run.
"""
import functools
import http.server
import json
import os
from pathlib import Path
import shutil
import threading
import time
import unittest

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[1]
ENGINE = os.environ.get('VB6_BROWSER', 'chromium')
TRANSPORT = os.environ.get('VB6_TEST_TRANSPORT', 'http')
ADVANCED = os.environ.get('VB6_TEST_ADVANCED') == '1'
BASE = os.environ.get('BASE') or os.environ.get('VB6_TEST_BASE')
REPORT = ROOT / 'reports' / 'input-modes' / ENGINE / TRANSPORT
RESULTS = []
SETTINGS_KEY = 'vb6-studio-web.input-mode.v1'
SOURCE = '''Option Explicit
Public total As Long

Private Sub Alpha()
    total = 10
    Debug.Print "alpha"
End Sub

Private Sub Beta()
    total = total + 1
    Debug.Print "beta"
End Sub

Private Sub Gamma()
    Debug.Print "gamma"
End Sub
'''
FIXTURE = r'''source => {
  const A=VB6StudioAPI,p=A.newProject('VimAcceptance'),m=p.modules[0];
  p.id='vim-acceptance';p.settings.xaml=true;p.settings.renderer='canvas2d';
  m.id='form';m.name='Form1';m.form.name='Form1';m.form.properties.Name='Form1';
  const button=A.createControl('CommandButton','Button1',300,300);
  button.id='button';button.properties.Caption='Original';m.form.controls=[button];
  m.code=source;m.bookmarks=[];
  p.modules.push({id:'helpers',name:'Helpers',kind:'module',code:'Option Explicit\nPublic Sub Helper()\n    Debug.Print "helper"\nEnd Sub\n'});
  p.startup='Form1';vb6Studio.loadProject(p);vb6Studio.openDocument('form','code');
  vb6Studio.editor.setViewMode('module');vb6Studio.editor.goToLine(1,1);
  vb6Studio.history.reset();return true;
}'''


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class InputModeTestResult(unittest.TextTestResult):
    """Surface failures immediately while the remaining browser cases run."""
    def addError(self, test, error):
        super().addError(test, error)
        self.stream.writeln(self._exc_info_to_string(error, test))

    def addFailure(self, test, error):
        super().addFailure(test, error)
        self.stream.writeln(self._exc_info_to_string(error, test))


class InputModeTestRunner(unittest.TextTestRunner):
    resultclass = InputModeTestResult


class BrowserHarness:
    advanced_artifact = False

    @classmethod
    def setUpClass(cls):
        if TRANSPORT not in ('http', 'file', 'memory'):
            raise ValueError('VB6_TEST_TRANSPORT must be http, file, or memory')
        REPORT.mkdir(parents=True, exist_ok=True)
        cls.server = None
        if BASE:
            cls.url = BASE if BASE.rstrip('/').endswith('.html') else BASE.rstrip('/') + '/index.html'
        else:
            cls.server = http.server.ThreadingHTTPServer(
                ('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT / 'dist')))
            threading.Thread(target=cls.server.serve_forever, daemon=True).start()
            cls.url = f'http://127.0.0.1:{cls.server.server_port}/index.html'
        cls.pw = sync_playwright().start()
        options = {'headless': True}
        if ENGINE == 'chromium':
            executable = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if executable:
                options['executable_path'] = executable
            options.update(args=['--no-sandbox'], ignore_default_args=['--disable-popup-blocking'])
        cls.browser = getattr(cls.pw, ENGINE).launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        if cls.server:
            cls.server.shutdown()
            cls.server.server_close()
        (REPORT / 'results.json').write_text(json.dumps({
            'browser': ENGINE, 'transport': TRANSPORT, 'url': cls.url if TRANSPORT == 'http' else None,
            'advanced': 'requested' if ADVANCED else 'not-run (set VB6_TEST_ADVANCED=1)',
            'results': RESULTS
        }, indent=2))

    def setUp(self):
        self.started = time.perf_counter()
        self.errors, self.requests, self.notes = [], [], []
        self.passed = False
        self.context = self.browser.new_context(viewport={'width': 1560, 'height': 1060})
        self.addCleanup(self.context.close)
        self.addCleanup(self.record_result)
        self.context.set_default_timeout(15000)
        # The standalone IDE can take longer to parse on contended CI workers;
        # interaction and assertion waits retain their shorter deadline.
        self.context.set_default_navigation_timeout(60000)
        self.context.on('page', self.observe_page)
        self.page = self.context.new_page()
        artifact = ROOT / 'dist' / ('VB6-Studio-Web-Advanced.html' if self.advanced_artifact else 'VB6-Studio-Web.html')
        if TRANSPORT == 'memory':
            self.page.set_content(artifact.read_text(), wait_until='load')
        elif TRANSPORT == 'file':
            self.page.goto(artifact.as_uri())
        else:
            self.page.goto(self.url)
        self.page.wait_for_function('globalThis.vb6Studio?.inputModes && globalThis.VB6StudioAPI')
        self.page.evaluate(FIXTURE, SOURCE)

    def observe_page(self, page):
        page.on('pageerror', lambda error: self.errors.append({'message': str(error), 'stack': error.stack}))
        page.on('request', lambda request: self.requests.append(request.url))

    def tearDown(self):
        self.assertEqual(self.errors, [], 'Uncaught page errors')

    def record_result(self):
        if not self.passed or self.errors:
            try:
                self.page.screenshot(path=str(REPORT / (self._testMethodName + '.png')), full_page=True, timeout=10000)
            except Exception as error:
                self.notes.append('Failure screenshot unavailable: ' + str(error))
        outcome = self._outcome.result
        failures = [trace for test, trace in outcome.errors + outcome.failures if test is self]
        RESULTS.append({
            'name': self._testMethodName, 'suite': 'advanced' if self.advanced_artifact else 'core',
            'passed': self.passed and not self.errors and not failures,
            'pageErrors': self.errors, 'failures': failures, 'coverageNotes': self.notes,
            'milliseconds': round((time.perf_counter() - self.started) * 1000, 2)
        })

    def done(self):
        self.passed = True

    def text(self, module='form'):
        return self.page.evaluate('id => vb6Studio.project.modules.find(m=>m.id===id).code', module)

    def buffer(self, text, module='form'):
        self.page.evaluate(r'''({text,id}) => {
          const i=vb6Studio;i.openDocument(id,'code');i.editor.setViewMode('module');
          i.editor.setValue(text);i.history.reset();i.lastTyped=0;i.lastTypingModule=null;
          i.editor.goToLine(1,1);i.editor.input.focus();
        }''', {'text': text, 'id': module})

    def vim(self):
        self.assertTrue(self.page.evaluate('vb6Studio.inputModes.configure({mode:"vim"})'))
        self.page.evaluate('vb6Studio.editor.input.focus()')

    def state(self):
        return self.page.evaluate('String(vb6Studio.inputModes.snapshot().state).toLowerCase()')

    def type(self, keys, page=None):
        (page or self.page).keyboard.type(keys)

    def press(self, key, page=None):
        (page or self.page).keyboard.press(key)

    def window_key(self, key):
        self.press('Control+w')
        self.type(key)

    def check_window_keyboard(self, advanced=False):
        self.page.evaluate(r'''advanced => {
          const e=vb6Studio.editor,s=advanced?as:null;
          globalThis.windowTest={
            count:()=>s?s.views.length:e.panes.length,
            active:()=>s?s.views.findIndex(v=>v.view===s.view):e.panes.indexOf(e.activePane),
            offset:()=>s?s.record.model.getOffsetAt(s.view.getPosition()):e.cursor().offset,
            choose(index,offset){
              if(s){s.views[index].view.focus();s.select(offset);s.focus();}
              else{e.activatePane(e.panes[index]);e.selectGlobal(offset);e.input.focus();}
            }
          };
        }''', advanced)
        original = self.text()
        for command, backward, forward, orthogonal in [('vsplit', 'h', 'l', 'j'), ('split', 'k', 'j', 'h')]:
            with self.subTest(command=command):
                self.ex(command)
                self.assertEqual(self.page.evaluate('windowTest.count()'), 2)
                self.page.evaluate('windowTest.choose(1,12);windowTest.choose(0,2)')
                for key, expected in [(backward, 0), (forward, 1), (forward, 1), (orthogonal, 1), (backward, 0), ('b', 1), ('t', 0)]:
                    self.window_key(key)
                    self.assertEqual(self.page.evaluate('windowTest.active()'), expected, key)
                self.ex('q')
                self.assertEqual(self.page.evaluate('windowTest.count()'), 1)
                self.assertEqual(self.page.evaluate('windowTest.offset()'), 12)
                self.assertEqual(self.text(), original)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 0)

    def ex(self, command, page=None):
        page = page or self.page
        page.keyboard.type(':')
        page.locator('.input-mode-command-input:visible').wait_for()
        page.keyboard.type(command)
        page.keyboard.press('Enter')

    def search(self, pattern, backward=False, page=None):
        page = page or self.page
        page.keyboard.type('?' if backward else '/')
        page.locator('.input-mode-command-input:visible').wait_for()
        page.keyboard.type(pattern)
        page.keyboard.press('Enter')

    def wait_search_matches(self, count, root='vb6Studio.editor.root'):
        self.page.wait_for_function('count => {const markers=[...' + root + r'''.querySelectorAll('.input-mode-search-match')];
          return count===0?markers.length===0:markers.filter(node=>{const r=node.getBoundingClientRect();return r.width>0&&r.height>0;}).length===count;
        }''', arg=count)

    def options(self, page=None):
        page = page or self.page
        page.get_by_role('menuitem', name='Tools', exact=True).click()
        page.locator('[role="menu"] [data-command="options"]').click()
        dialog = page.get_by_role('dialog', name='Options', exact=True)
        dialog.get_by_role('tab', name='Editor', exact=True).click()
        return dialog

    def menu_mode(self, mode, page=None):
        page = page or self.page
        page.get_by_role('menuitem', name='Tools', exact=True).click()
        page.get_by_role('menuitem', name='Input Mode', exact=True).click()
        page.locator('[role="menu"] [data-command="inputMode:' + mode + '"]').click()

    def enable_advanced(self):
        self.assertTrue(self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:true})'))
        self.page.evaluate(r'''() => {
          globalThis.ar=vb6Studio.advancedEditor.runtime;
          globalThis.as=ar.surfaces.get(vb6Studio.editor);as.focus();
        }''')
        self.page.wait_for_function('as.view.getLayoutInfo().width>100')


class InputModeAcceptance(BrowserHarness, unittest.TestCase):
    def test_default_typing_shortcuts_and_lazy_sessions(self):
        self.buffer('alpha beta\ngamma delta\n')
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'default')
        self.assertTrue(self.page.evaluate('[...vb6Studio.inputModes.records.values()].every(r=>!r.session)'))
        self.type('h')
        self.assertEqual(self.text(), 'halpha beta\ngamma delta\n')
        self.press('Control+z')
        self.assertEqual(self.text(), 'alpha beta\ngamma delta\n')
        self.press('Control+f')
        self.assertTrue(self.page.evaluate('!vb6Studio.editor.findBar.hidden'))
        self.press('Escape')
        self.assertFalse(any('/advanced-editor/' in url or '/input-modes/' in url or 'codemirror' in url for url in self.requests))
        self.assertEqual(self.page.locator('.input-mode-overlay').count(), 0)
        self.done()

    def test_options_stage_cancel_accept_and_persist_without_project_input_settings(self):
        before = self.page.evaluate('JSON.stringify(vb6Studio.project)')
        dialog = self.options()
        dialog.get_by_label('Editor input mode', exact=True).select_option('vim')
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'default')
        self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'), before)
        dialog = self.options()
        dialog.get_by_label('Editor input mode', exact=True).select_option('vim')
        dialog.get_by_role('button', name='OK', exact=True).click()
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'vim')
        self.assertTrue(self.page.evaluate('!Object.hasOwn(vb6Studio.project.settings,"inputMode")&&!Object.hasOwn(vb6Studio.project.settings,"vim")'))
        if TRANSPORT == 'memory':
            self.notes.append('Opaque-origin memory transport: staged UI verified; storage and reload require an HTTP/file run.')
        else:
            saved = self.page.evaluate('key=>JSON.parse(localStorage.getItem(key))', SETTINGS_KEY)
            self.assertEqual(saved['mode'], 'vim')
            self.page.reload()
            self.page.wait_for_function('globalThis.vb6Studio?.inputModes')
            self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'vim')
        self.done()

    def test_tools_status_help_and_dynamic_mode_registration(self):
        before = self.page.evaluate('JSON.stringify(vb6Studio.project)')
        self.menu_mode('vim')
        self.assertIn('NORMAL', self.page.locator('[data-input-mode-status]').inner_text())
        self.assertTrue(self.page.evaluate('document.activeElement===vb6Studio.editor.input'))
        self.type('l')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().offset'), 1)
        self.page.locator('[data-input-mode-status]').press('Enter')
        self.page.get_by_role('menuitemcheckbox', name='Default', exact=True).click()
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'default')
        self.assertTrue(self.page.evaluate('document.activeElement===vb6Studio.editor.input'))
        self.page.evaluate(r'''() => {globalThis.removeTestMode=vb6Studio.inputModes.registerMode({
          id:'test-pass',label:'Test pass',description:'A registered pass-through mode.',
          createSession:()=>({state:{mode:'normal'},handleKey:()=>false,dispose(){}})});}''')
        self.menu_mode('test-pass')
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'test-pass')
        self.assertIn('TEST PASS', self.page.locator('[data-input-mode-status]').inner_text())
        self.page.evaluate('removeTestMode()')
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'default')
        self.page.evaluate('()=>{void vb6Studio.command("inputModeHelp");}')
        dialog = self.page.get_by_role('dialog', name='Vim Key Reference', exact=True)
        self.assertGreater(dialog.locator('.input-mode-reference tbody tr').count(), 40)
        dialog.get_by_role('button', name='Close', exact=True).click()
        self.assertEqual(self.page.evaluate('JSON.stringify(vb6Studio.project)'), before)
        self.page.evaluate('vb6Studio.openDocument("form","form")')
        self.menu_mode('vim')
        self.assertEqual(self.page.evaluate('vb6Studio.activeDoc.view'), 'form')
        self.assertFalse(self.page.evaluate('document.activeElement===vb6Studio.editor.input'))
        self.done()

    def test_normal_motions_counts_and_line_navigation_do_not_edit(self):
        source = 'alpha beta gamma\n    delta epsilon\nzeta eta\n'
        self.buffer(source)
        self.vim()
        self.type('w')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().offset'), source.index('beta'))
        self.type('2w')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().offset'), source.index('delta'))
        self.type('0')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().column'), 1)
        self.type('^')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().column'), 5)
        self.type('gg3l')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().offset'), 3)
        self.type('2G$')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().offset'), source.index('epsilon') + len('epsilon') - 1)
        self.assertEqual(self.text(), source)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 0)
        self.done()

    def test_counted_delete_text_object_insert_repeat_and_atomic_undo_redo(self):
        source = 'one two three\nfour five six\nseven eight nine\n'
        self.buffer(source)
        self.vim()
        self.type('2dd')
        self.assertEqual(self.text(), 'seven eight nine\n')
        self.type('u')
        self.assertEqual(self.text(), source)
        self.press('Control+r')
        self.assertEqual(self.text(), 'seven eight nine\n')
        self.type('uggciwONE')
        self.press('Escape')
        self.assertEqual(self.text(), source.replace('one', 'ONE', 1))
        self.assertEqual(self.state(), 'normal')
        self.type('w.')
        self.assertEqual(self.text(), source.replace('one two', 'ONE ONE', 1))
        self.type('u')
        self.assertEqual(self.text(), source.replace('one', 'ONE', 1))
        self.press('Control+r')
        self.assertEqual(self.text(), source.replace('one two', 'ONE ONE', 1))
        self.done()

    def test_named_line_registers_are_shared_across_source_documents(self):
        self.buffer('alpha\nbeta\n')
        self.buffer('destination\n', 'helpers')
        self.page.evaluate('vb6Studio.openDocument("form","code");vb6Studio.editor.goToLine(1,1)')
        self.vim()
        self.type('"ayy')
        self.ex('bn')
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.id'), 'helpers')
        self.type('"ap')
        self.assertEqual(self.text('helpers'), 'destination\nalpha\n')
        self.ex('bp')
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.id'), 'form')
        self.type('"ap')
        self.assertEqual(self.text(), 'alpha\nalpha\nbeta\n')
        self.assertEqual(self.text('helpers'), 'destination\nalpha\n')
        self.done()

    def test_recorded_macros_replay_insertions_and_motions_with_counts(self):
        self.buffer('one\ntwo\nthree\n')
        self.vim()
        self.type('qaI>')
        self.press('Escape')
        self.type('jq')
        self.assertEqual(self.text(), '>one\ntwo\nthree\n')
        self.type('2@a')
        complete = '>one\n>two\n>three\n'
        self.assertEqual(self.text(), complete)
        self.type('u')
        self.assertNotEqual(self.text(), complete)
        self.press('Control+r')
        self.assertEqual(self.text(), complete)
        self.done()

    def test_visual_character_line_block_and_replace_modes(self):
        source = 'abcd\nefgh\nijkl\n'
        self.buffer(source)
        self.vim()
        self.type('v2ld')
        self.assertEqual(self.text(), 'd\nefgh\nijkl\n')
        self.type('uggVjd')
        self.assertEqual(self.text(), 'ijkl\n')
        self.type('ugg')
        self.press('Control+v')
        self.type('jld')
        self.assertEqual(self.text(), 'cd\ngh\nijkl\n')
        self.type('uggRXY')
        self.press('Escape')
        self.assertEqual(self.text(), 'XYcd\nefgh\nijkl\n')
        self.assertEqual(self.state(), 'normal')
        self.done()

    def test_search_ex_substitute_sort_and_undo_operate_on_canonical_text(self):
        source = 'delta beta\nalpha beta\ncharlie beta\n'
        self.buffer(source)
        self.vim()
        self.type('/alpha')
        self.press('Escape')
        self.assertEqual(self.text(), source)
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().offset'), 0)
        self.search('beta')
        first = source.index('beta')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().offset'), first)
        selection = self.page.evaluate('vb6Studio.inputModes.records.get(vb6Studio.editor).host.getSelections()')
        self.wait_search_matches(3)
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.records.get(vb6Studio.editor).host.getSelections()'), selection)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 0)
        self.type('n')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().offset'), source.index('beta', first + 1))
        self.type('N')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().offset'), first)
        self.ex('nohlsearch')
        self.wait_search_matches(0)
        self.search('beta')
        self.wait_search_matches(3)
        self.ex('%s/beta/BETA/g')
        self.assertEqual(self.text(), source.replace('beta', 'BETA'))
        self.type('u')
        self.assertEqual(self.text(), source)
        self.press('Control+r')
        # Sort the authored rows; the final empty editor row stays in place.
        self.ex('1,3sort')
        self.assertEqual(self.text(), 'alpha BETA\ncharlie BETA\ndelta BETA\n')
        self.ex('%s/BETA/omega/gc')
        self.page.locator('.input-mode-notification:visible,.input-mode-commandline:visible').first.wait_for()
        self.type('a')
        self.assertEqual(self.text(), 'alpha omega\ncharlie omega\ndelta omega\n')
        self.assertEqual(self.state(), 'normal')
        self.search('omega')
        self.wait_search_matches(3)
        self.page.evaluate('vb6Studio.inputModes.configure({mode:"default"})')
        self.wait_search_matches(0)
        self.assertEqual(self.page.locator('.input-mode-search-overlay').count(), 0)
        self.done()

    def test_ide_ex_buffers_splits_and_close_preserve_the_project(self):
        self.page.evaluate('vb6Studio.openDocument("helpers","code");vb6Studio.openDocument("form","code")')
        self.vim()
        self.ex('split')
        self.assertTrue(self.page.evaluate('!!vb6Studio.editor.secondary'))
        self.ex('only')
        self.assertFalse(self.page.evaluate('!!vb6Studio.editor.secondary'))
        self.ex('buffer MissingBuffer')
        self.assertIn('No source buffer named MissingBuffer', self.page.locator('.input-mode-notification').inner_text())
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.id'), 'form')
        self.assertEqual(self.text(), SOURCE)
        self.ex('vsplit')
        self.assertTrue(self.page.evaluate('!!vb6Studio.editor.secondary'))
        self.ex('only')
        self.ex('buffer Helpers')
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.id'), 'helpers')
        self.ex('bp')
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.id'), 'form')
        self.ex('q')
        self.assertFalse(self.page.evaluate('vb6Studio.docs.some(d=>d.key==="form:code")'))
        self.assertEqual(self.page.evaluate('vb6Studio.project.modules.length'), 2)
        self.assertEqual(self.text(), SOURCE)
        self.done()

    def test_window_keys_follow_layout_and_close_preserves_other_cursor(self):
        self.buffer('alpha beta\nsecond line\nthird line\n')
        self.vim()
        self.check_window_keyboard()
        self.done()

    def test_procedure_projection_and_split_selections_use_global_offsets(self):
        self.vim()
        self.page.evaluate(r'''() => {
          const e=vb6Studio.editor,line=e.text.slice(0,e.text.indexOf('Private Sub Beta')).split('\n').length;
          e.goToLine(line+1,5);e.setViewMode('procedure');e.input.focus();
        }''')
        self.assertGreater(self.page.evaluate('vb6Studio.editor.activePane.range.start'), 0)
        self.type('ciwvalue')
        self.press('Escape')
        expected = SOURCE.replace('    total = total + 1', '    value = total + 1')
        self.assertEqual(self.text(), expected)
        self.ex('split')
        self.page.evaluate(r'''() => {
          const e=vb6Studio.editor;globalThis.primarySelection={...e.selectionBounds(e.primary)};
          e.activatePane(e.secondary);e.input.focus();
        }''')
        self.type('l')
        self.assertTrue(self.page.evaluate('JSON.stringify(vb6Studio.editor.selectionBounds(vb6Studio.editor.primary))===JSON.stringify(primarySelection)'))
        self.type('u')
        self.assertEqual(self.text(), SOURCE)
        self.done()

    def test_one_hundred_thousand_lines_remain_virtualized_during_vim_edits(self):
        self.page.evaluate(r'''() => {
          const e=vb6Studio.editor;e.setValue(Array.from({length:100000},(_,i)=>"' row "+String(i+1).padStart(6,'0')).join('\n')+'\n');
          vb6Studio.history.reset();e.setViewMode('module');e.goToLine(1,1);
        }''')
        self.vim()
        self.type('50000G0x')
        result = self.page.evaluate(r'''() => {
          const e=vb6Studio.editor,lines=e.text.split('\n');return {
            before:lines[49998],edited:lines[49999],after:lines[50000],
            virtual:e.activePane.virtualizer.active,nativeLength:e.input.value.length,
            rendered:e.syntax.querySelectorAll('.syntax-line').length};
        }''')
        self.assertEqual(result['before'], "' row 049999")
        self.assertEqual(result['edited'], ' row 050000')
        self.assertEqual(result['after'], "' row 050001")
        self.assertTrue(result['virtual'])
        self.assertLess(result['nativeLength'], 20000)
        self.assertLess(result['rendered'], 200)
        self.type('u99999Gj')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().line'), 100000)
        self.type('gg')
        self.assertEqual(self.page.evaluate('vb6Studio.editor.cursor().line'), 1)
        self.assertEqual(self.text().splitlines()[49999], "' row 050000")
        self.done()

    def test_xaml_keyboard_edit_and_undo_update_the_real_form_model(self):
        self.vim()
        self.page.evaluate(r'''() => {
          globalThis.xt=vb6Studio.xaml.open('form');const at=xt.editor.text.indexOf('Caption="Original"')+9;
          xt.editor.reveal(at);
        }''')
        self.type('ci"Changed')
        self.press('Escape')
        caption = 'vb6Studio.project.modules.find(m=>m.id==="form").form.controls.find(c=>c.id==="button").properties.Caption'
        self.assertEqual(self.page.evaluate(caption), 'Changed')
        self.assertIn('Caption="Changed"', self.page.evaluate('xt.editor.text'))
        self.type('u')
        self.assertEqual(self.page.evaluate(caption), 'Original')
        self.press('Control+r')
        self.assertEqual(self.page.evaluate(caption), 'Changed')
        self.assertEqual(self.text(), SOURCE)
        self.done()

    def test_dos_presentation_and_input_modes_switch_independently(self):
        self.buffer('alpha beta\n')
        self.vim()
        self.page.evaluate('globalThis.originalEditor=vb6Studio.editor;vb6Studio.dosMode.configure({mode:"dos",editing:"cells"})')
        self.page.wait_for_function('vb6Studio.dosMode.enabled&&vb6Studio.dosMode.snapshot().length>0')
        self.page.evaluate('vb6Studio.editor.input.focus()')
        self.type('iDOS_')
        self.press('Escape')
        self.assertEqual(self.text(), 'DOS_alpha beta\n')
        self.assertEqual(self.state(), 'normal')
        self.assertTrue(self.page.evaluate('vb6Studio.editor===originalEditor'))
        self.assertTrue(self.page.evaluate('[...vb6Studio.dosMode.sessions.values()].every(s=>s.metrics.failures===0)'))
        self.page.wait_for_function(r'''[...vb6Studio.dosMode.sessions.values()].some(session=>{
          const cells=session.chrome.entries.get(vb6Studio.statusbar)?.buffer?.glyphs;
          return cells&&String.fromCodePoint(...cells).includes('VIM NORMAL');
        })''')
        self.page.screenshot(path=str(REPORT / 'dos-vim.png'))
        self.page.evaluate('vb6Studio.dosMode.configure({mode:"classic"})')
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'vim')
        self.page.evaluate('vb6Studio.inputModes.configure({mode:"default"})')
        self.page.evaluate('vb6Studio.dosMode.configure({mode:"dos"})')
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'default')
        self.assertEqual(self.text(), 'DOS_alpha beta\n')
        self.done()

    def test_detached_editor_and_popup_options_return_without_stale_sessions(self):
        self.buffer('alpha\nbeta\n')
        self.vim()
        self.page.evaluate('globalThis.originalInputRecord=vb6Studio.inputModes.records.get(vb6Studio.editor)')
        with self.page.expect_popup() as opened:
            self.page.locator('.mdi-active').get_by_label('Float document in Browser Window', exact=True).click()
        popup = opened.value
        popup.wait_for_selector('.browser-window-root[data-ready="true"]')
        popup.locator('textarea.source-input').first.focus()
        self.type('diw', popup)
        self.assertEqual(self.text(), '\nbeta\n')
        self.type('u', popup)
        self.assertEqual(self.text(), 'alpha\nbeta\n')
        self.assertTrue(self.page.evaluate('vb6Studio.inputModes.records.get(vb6Studio.editor)===originalInputRecord'))
        dialog = self.options(popup)
        dialog.get_by_label('Editor input mode', exact=True).select_option('default')
        dialog.get_by_role('button', name='Cancel', exact=True).click()
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'vim')
        dialog = self.options(popup)
        dialog.get_by_label('Editor input mode', exact=True).select_option('default')
        dialog.get_by_role('button', name='OK', exact=True).click()
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'default')
        popup.locator('textarea.source-input').first.focus()
        self.type('h', popup)
        self.assertEqual(self.text(), 'halpha\nbeta\n')
        popup.close()
        self.page.wait_for_function('vb6Studio.browserWindows.windows.size===0&&vb6Studio.editor.input.ownerDocument===document')
        self.vim()
        self.type('ggx')
        self.assertEqual(self.text(), 'alpha\nbeta\n')
        self.assertTrue(self.page.evaluate('[...vb6Studio.inputModes.records.keys()].every(e=>!e.root.ownerDocument.defaultView.closed)'))
        self.done()

    def test_readonly_source_and_property_dialog_inputs_keep_their_semantics(self):
        self.buffer('alpha beta\n')
        self.vim()
        self.page.evaluate('vb6Studio.editor.setReadOnly(true)')
        self.type('ddxiBLOCKED')
        self.press('Escape')
        self.assertEqual(self.text(), 'alpha beta\n')
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 0)
        self.page.evaluate(r'''() => {
          vb6Studio.editor.setReadOnly(false);vb6Studio.openDocument('form','form');
          vb6Studio.designer.select(['button']);vb6Studio.togglePanel('properties',true);
        }''')
        field = self.page.locator('input[data-property="Caption"]')
        field.focus()
        self.press('Control+a')
        self.type('hjkl')
        self.press('Enter')
        caption = 'vb6Studio.project.modules[0].form.controls[0].properties.Caption'
        self.assertEqual(self.page.evaluate(caption), 'hjkl')
        self.page.get_by_role('button', name='Edit Caption', exact=True).click()
        self.page.get_by_label('Property text', exact=True).focus()
        self.press('Control+a')
        self.type('hjkldd')
        self.assertEqual(self.page.get_by_label('Property text', exact=True).input_value(), 'hjkldd')
        self.press('Escape')
        self.assertEqual(self.page.evaluate(caption), 'hjkl')
        self.assertEqual(self.text(), 'alpha beta\n')
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'vim')
        self.done()

    def test_composition_and_unicode_insert_are_one_undoable_change(self):
        self.buffer('alpha\nbeta\n')
        self.vim()
        self.type('i')
        self.page.evaluate(r'''() => {
          const input=vb6Studio.editor.input,view=input.ownerDocument.defaultView;
          input.dispatchEvent(new view.CompositionEvent('compositionstart',{bubbles:true}));
          input.setRangeText('Zażółć 😀',input.selectionStart,input.selectionEnd,'end');
          input.dispatchEvent(new view.InputEvent('input',{bubbles:true,inputType:'insertCompositionText',data:'Zażółć 😀',isComposing:true}));
          input.dispatchEvent(new view.CompositionEvent('compositionend',{bubbles:true,data:'Zażółć 😀'}));
        }''')
        self.press('Escape')
        self.assertEqual(self.text(), 'Zażółć 😀alpha\nbeta\n')
        self.assertEqual(self.state(), 'normal')
        self.type('x')
        self.assertEqual(self.text(), 'Zażółć alpha\nbeta\n')
        self.assertTrue(self.page.evaluate('vb6Studio.editor.text.isWellFormed()'))
        self.type('u')
        self.assertEqual(self.text(), 'Zażółć 😀alpha\nbeta\n')
        self.type('u')
        self.assertEqual(self.text(), 'alpha\nbeta\n')
        self.done()

    def test_replace_backspace_repeat_and_normal_native_input_ownership(self):
        self.buffer('abcd wxyz\n')
        self.vim()
        self.type('RXY')
        self.press('Backspace')
        self.type('Z')
        self.press('Escape')
        self.type('w.')
        self.assertEqual(self.text(), 'XZcd XZyz\n')
        self.type('u')
        self.assertEqual(self.text(), 'XZcd wxyz\n')
        self.type('u')
        self.assertEqual(self.text(), 'abcd wxyz\n')
        result = self.page.evaluate(r'''() => {
          const e=vb6Studio.editor,input=e.input,view=input.ownerDocument.defaultView;
          e.overwrite=true;
          const event=new view.InputEvent('beforeinput',{bubbles:true,cancelable:true,inputType:'insertText',data:'X'});
          const dispatched=input.dispatchEvent(event);
          return {dispatched,prevented:event.defaultPrevented,text:e.text};
        }''')
        self.assertFalse(result['dispatched'])
        self.assertTrue(result['prevented'])
        self.assertEqual(result['text'], 'abcd wxyz\n')
        self.done()

    def test_switching_pending_modes_and_project_replacement_releases_sessions(self):
        self.buffer('one two\nthree four\n')
        self.vim()
        self.type('d')
        self.page.evaluate('vb6Studio.inputModes.configure({mode:"default"})')
        self.type('h')
        self.assertEqual(self.text(), 'hone two\nthree four\n')
        self.vim()
        self.type('iZ')
        self.page.evaluate('vb6Studio.inputModes.configure({mode:"default"})')
        self.assertEqual(self.page.evaluate('vb6Studio.history.transactionDepth'), 0)
        self.assertTrue(self.page.evaluate('[...vb6Studio.inputModes.records.values()].every(r=>!r.session)'))
        self.vim()
        self.page.evaluate(r'''() => {
          globalThis.retiredEditor=vb6Studio.editor;const p=VB6StudioAPI.newProject('Replacement');
          p.modules[0].code='alpha\n';vb6Studio.loadProject(p);vb6Studio.openDocument(p.modules[0].id,'code');
          vb6Studio.editor.goToLine(1,1);
        }''')
        self.assertFalse(self.page.evaluate('vb6Studio.inputModes.records.has(retiredEditor)'))
        self.type('iFresh_')
        self.press('Escape')
        self.assertEqual(self.page.evaluate('vb6Studio.activeModule.code'), 'Fresh_alpha\n')
        self.done()


class AdvancedInputModeAcceptance(BrowserHarness, unittest.TestCase):
    advanced_artifact = True

    def test_real_monaco_window_keys_follow_layout_and_preserve_other_cursor(self):
        self.buffer('alpha beta\nsecond line\nthird line\n')
        self.enable_advanced()
        self.vim()
        self.page.evaluate('as.focus()')
        self.check_window_keyboard(advanced=True)
        self.done()

    def test_real_monaco_search_highlights_xaml_backend_switches_and_dos_cells(self):
        source = 'alpha beta\nbeta alpha\nalpha beta\n'
        self.buffer(source)
        self.enable_advanced()
        self.vim()
        self.page.evaluate('as.focus()')
        self.search('alpha')
        selection = self.page.evaluate('vb6Studio.inputModes.records.get(vb6Studio.editor).host.getSelections()')
        self.wait_search_matches(3)
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.records.get(vb6Studio.editor).host.getSelections()'), selection)
        self.ex('nohlsearch')
        self.wait_search_matches(0)
        self.search('beta')
        self.wait_search_matches(3)
        self.page.evaluate(r'''async () => {
          vb6Studio.dosMode.configure({mode:'dos',editing:'cells',profile:'turbo'});
          await vb6Studio.dosMode.ready;
          globalThis.searchDosSession=[...vb6Studio.dosMode.sessions.values()].find(s=>s.document===document);
          globalThis.searchCellText=backend=>{
            const entry=backend==='monaco'?searchDosSession.textViews.entries.get(as.views.find(s=>s.view===as.view).pane):
              searchDosSession.chrome.entries.get(vb6Studio.editor.syntax),buffer=entry?.buffer;
            return buffer?Array.from(buffer.glyphs,(glyph,i)=>buffer.colors[i]>>4===14?String.fromCodePoint(glyph):'').join(''):null;
          };
          vb6Studio.statusbar.querySelector('[data-input-mode-status]').focus();
        }''')
        # Read the pixels' source cell attributes, not hidden Monaco DOM or an
        # overlay rectangle: the exact matched glyphs must use the EGA paper.
        self.page.wait_for_function('searchCellText("monaco")==="betabetabeta"')
        self.assertTrue(self.page.evaluate('searchDosSession.textViews.entries.get(as.views[0].pane).visible'))
        self.page.screenshot(path=str(REPORT / 'dos-monaco-vim-search.png'))
        self.page.evaluate('as.focus()')
        self.search('^')
        self.page.evaluate('vb6Studio.statusbar.querySelector("[data-input-mode-status]").focus()')
        self.page.wait_for_function('searchCellText("monaco")==="aba "')
        self.page.evaluate('as.focus()')
        self.search('$')
        self.page.evaluate('vb6Studio.statusbar.querySelector("[data-input-mode-status]").focus()')
        self.page.wait_for_function('searchCellText("monaco")==="    "')
        self.page.evaluate('as.focus()')
        self.ex('nohlsearch')
        self.wait_search_matches(0)
        self.page.evaluate('vb6Studio.statusbar.querySelector("[data-input-mode-status]").focus()')
        self.page.wait_for_function('searchCellText("monaco")===""')
        self.page.evaluate('as.focus()')
        self.search('beta')
        self.wait_search_matches(3)
        self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:false});vb6Studio.statusbar.querySelector("[data-input-mode-status]").focus()')
        self.wait_search_matches(3)
        self.page.wait_for_function('searchCellText("classic")==="betabetabeta"')
        self.assertEqual(self.page.locator('.monaco-editor').count(), 0)
        self.page.screenshot(path=str(REPORT / 'dos-classic-vim-search.png'))
        self.page.evaluate('vb6Studio.editor.input.focus()')
        self.ex('nohlsearch')
        self.wait_search_matches(0)
        self.page.wait_for_function('searchCellText("classic")===""')
        self.search('beta')
        self.wait_search_matches(3)
        self.enable_advanced()
        self.wait_search_matches(3)
        self.page.evaluate('vb6Studio.statusbar.querySelector("[data-input-mode-status]").focus()')
        self.page.wait_for_function('searchCellText("monaco")==="betabetabeta"')
        self.page.evaluate('vb6Studio.inputModes.configure({mode:"default"})')
        self.wait_search_matches(0)
        self.page.wait_for_function('searchCellText("monaco")===""')
        self.assertEqual(self.page.locator('.input-mode-search-overlay').count(), 0)
        self.assertEqual(self.page.evaluate('as.record.model.getAllDecorations().filter(d=>d.options.className==="input-mode-search-match").length'), 0)
        self.assertEqual(self.text(), source)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 0)
        self.assertTrue(self.page.evaluate('[...vb6Studio.dosMode.sessions.values()].every(s=>s.metrics.failures===0)'))
        self.page.evaluate('vb6Studio.dosMode.configure({mode:"classic"})')
        self.vim()
        self.page.evaluate(r'''() => {
          const tool=vb6Studio.xaml.open('form');globalThis.searchXamlEditor=tool.editor;
          ar.surfaces.get(searchXamlEditor).focus();
        }''')
        self.search('Original')
        self.wait_search_matches(1, 'searchXamlEditor.root')
        self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:false});searchXamlEditor.input.focus()')
        self.wait_search_matches(1, 'searchXamlEditor.root')
        self.ex('nohlsearch')
        self.wait_search_matches(0, 'searchXamlEditor.root')
        self.search('Original')
        self.wait_search_matches(1, 'searchXamlEditor.root')
        self.page.evaluate('vb6Studio.inputModes.configure({mode:"default"})')
        self.wait_search_matches(0, 'searchXamlEditor.root')
        self.assertEqual(self.page.locator('.input-mode-search-overlay').count(), 0)
        self.assertEqual(self.text(), source)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 0)
        self.done()

    def test_real_monaco_visual_rows_and_folded_line_navigation(self):
        wrapped = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\nsecond line\n'
        self.buffer(wrapped)
        self.enable_advanced()
        self.vim()
        self.page.evaluate(r'''() => {
          as.view.updateOptions({wordWrap:'wordWrapColumn',wordWrapColumn:24,
            wrappingIndent:'none',lineNumbers:'off',glyphMargin:false,minimap:{enabled:false}});
          as.select(4);as.focus();
        }''')
        # Establish actual rendered rows before using Vim; a logical-line
        # implementation must not accidentally satisfy the motion assertions.
        self.page.wait_for_function(r'''() => {
          const a=as.view.getScrolledVisiblePosition({lineNumber:1,column:5}),
            b=as.view.getScrolledVisiblePosition({lineNumber:1,column:29}),
            c=as.view.getScrolledVisiblePosition({lineNumber:1,column:53});
          return a&&b&&c&&a.top<b.top&&b.top<c.top&&Math.abs(a.left-b.left)<1;
        }''')
        position = '({line:as.view.getPosition().lineNumber,column:as.view.getPosition().column})'
        self.type('2gj')
        self.assertEqual(self.page.evaluate(position), {'line': 1, 'column': 53})
        self.type('gk')
        self.assertEqual(self.page.evaluate(position), {'line': 1, 'column': 29})
        self.type('gk')
        self.assertEqual(self.page.evaluate(position), {'line': 1, 'column': 5})
        self.assertEqual(self.text(), wrapped)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 0)
        self.type('vgj')
        self.assertEqual(self.state(), 'visual')
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.records.get(vb6Studio.editor).host.getSelections()'),
                         [{'anchor': 4, 'head': 29}])
        self.press('Escape')
        self.page.evaluate('as.select(4);as.focus()')
        self.type('dgj')
        deleted = wrapped[:4] + wrapped[28:]
        self.assertEqual(self.text(), deleted)
        self.assertEqual(self.page.evaluate('as.record.model.getValue()'), deleted)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 1)
        self.type('u')
        self.assertEqual(self.text(), wrapped)
        self.press('Control+r')
        self.assertEqual(self.text(), deleted)
        self.type('u')
        # :normal stages edits and motions in one transaction. Geometry must
        # follow the edited line before the final source change is published.
        self.page.evaluate('as.select(0);as.focus()')
        self.ex('normal! xgjx')
        self.assertEqual(self.text(), wrapped[1:25] + wrapped[26:])
        self.assertEqual(self.page.evaluate('as.record.model.getValue()'), self.text())
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 1)
        self.type('u')
        self.assertEqual(self.text(), wrapped)

        folded = ("' lead\n"
                  'Private Sub FoldedProcedureWithLongName(ByVal value As Long)\n'
                  '    total = 10\n'
                  '    Debug.Print "hidden"\n'
                  'End Sub\n'
                  'afterValue = 99\n'
                  'tailValue = 1\n')
        self.buffer(folded)
        self.page.evaluate(r'''() => {
          as.select(7);as.focus();return as.view.getAction('editor.foldAll').run();
        }''')
        self.page.wait_for_function(r'''() => {
          const ranges=as.view.getVisibleRanges(),visible=line=>ranges.some(r=>r.startLineNumber<=line&&r.endLineNumber>=line),
            start=as.view.getScrolledVisiblePosition({lineNumber:2,column:1}),
            end=as.view.getScrolledVisiblePosition({lineNumber:2,column:50});
          return visible(2)&&!visible(3)&&!visible(5)&&visible(6)&&start&&end&&end.top>start.top;
        }''')
        self.type('gj')
        display_position = self.page.evaluate(position)
        self.assertEqual(display_position['line'], 2)
        self.assertGreater(display_position['column'], 1)
        self.type('gk')
        self.assertEqual(self.page.evaluate(position), {'line': 2, 'column': 1})
        self.type('j')
        self.assertEqual(self.page.evaluate(position), {'line': 6, 'column': 1})
        self.type('k')
        self.assertEqual(self.page.evaluate(position), {'line': 2, 'column': 1})
        self.type('gg2j')
        self.assertEqual(self.page.evaluate(position), {'line': 6, 'column': 1})
        self.assertEqual(self.text(), folded)
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 0)
        self.type('ggjdj')
        self.assertEqual(self.text(), "' lead\ntailValue = 1\n")
        self.assertEqual(self.page.evaluate('as.record.model.getValue()'), self.text())
        self.assertEqual(self.page.evaluate('vb6Studio.history.undoStack.length'), 1)
        self.type('u')
        self.assertEqual(self.text(), folded)
        self.press('Control+r')
        self.assertEqual(self.text(), "' lead\ntailValue = 1\n")
        self.done()

    def test_real_monaco_modes_undo_splits_and_backend_switches(self):
        self.buffer('alpha beta\nsecond line\n')
        self.enable_advanced()
        self.vim()
        self.page.evaluate('as.focus()')
        self.type('ciwomega')
        self.press('Escape')
        self.assertEqual(self.text(), 'omega beta\nsecond line\n')
        self.type('u')
        self.assertEqual(self.text(), 'alpha beta\nsecond line\n')
        self.press('Control+r')
        self.ex('vsplit')
        self.assertEqual(self.page.evaluate('as.views.length'), 2)
        self.assertTrue(self.page.evaluate('as.views.every(v=>v.view.getModel()===as.record.model)'))
        self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:false})')
        self.assertEqual(self.page.evaluate('vb6Studio.inputModes.settings.mode'), 'vim')
        self.page.evaluate('vb6Studio.editor.goToLine(1,1);vb6Studio.editor.input.focus()')
        self.type('x')
        self.assertEqual(self.text(), 'mega beta\nsecond line\n')
        self.enable_advanced()
        self.assertEqual(self.page.evaluate('as.record.model.getValue()'), self.text())
        self.type('iO')
        self.press('Escape')
        self.assertEqual(self.text(), 'Omega beta\nsecond line\n')
        self.assertTrue(self.page.evaluate('as.record.model.getValue()===vb6Studio.editor.text'))
        self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:false})')
        self.buffer('alpha\nbeta\ngamma\n')
        self.type('gg0ll')
        self.press('Control+v')
        self.type('jh')
        selection = 'vb6Studio.inputModes.records.get(vb6Studio.editor).host.getSelections()'
        backward_block = self.page.evaluate(selection)
        self.assertEqual(len(backward_block), 2)
        self.assertTrue(all(value['anchor'] > value['head'] for value in backward_block))
        self.enable_advanced()
        self.assertEqual(self.page.evaluate(selection), backward_block)
        self.assertEqual(self.state(), 'visual-block')
        self.page.evaluate('vb6Studio.advancedEditor.configure({enabled:false})')
        self.page.evaluate('vb6Studio.editor.input.focus()')
        self.assertEqual(self.page.evaluate(selection), backward_block)
        self.assertEqual(self.state(), 'visual-block')
        self.type('x')
        self.assertEqual(self.text(), 'aha\nba\ngamma\n')
        self.done()

    def test_real_monaco_xaml_and_dos_cell_projection_keep_vim_state(self):
        self.enable_advanced()
        self.vim()
        self.page.evaluate(r'''() => {
          const tool=vb6Studio.xaml.open('form');globalThis.ax=ar.surfaces.get(tool.editor);
          const at=ax.record.model.getValue().indexOf('Caption="Original"')+9;ax.select(at);ax.focus();
        }''')
        self.type('ci"Changed')
        self.press('Escape')
        caption = 'vb6Studio.project.modules[0].form.controls[0].properties.Caption'
        self.assertEqual(self.page.evaluate(caption), 'Changed')
        self.page.evaluate('vb6Studio.dosMode.configure({mode:"dos",editing:"cells"})')
        self.page.wait_for_selector('.vb-tui-text-view')
        self.page.evaluate('ax.focus()')
        self.type('u')
        self.assertEqual(self.page.evaluate(caption), 'Original')
        self.assertEqual(self.state(), 'normal')
        self.assertTrue(self.page.evaluate('[...vb6Studio.dosMode.sessions.values()].every(s=>s.metrics.failures===0)'))
        self.page.evaluate(r'''() => {vb6Studio.openDocument('form','code');globalThis.as=ar.surfaces.get(vb6Studio.editor);as.select(0);as.focus();}''')
        self.type('iDOS_')
        self.press('Escape')
        self.assertTrue(self.text().startswith('DOS_Option Explicit'))
        self.assertEqual(self.page.evaluate('as.record.model.getValue()'), self.text())
        self.page.screenshot(path=str(REPORT / 'dos-monaco-vim.png'))
        self.done()


def load_tests(loader, standard_tests, pattern):
    suite = unittest.TestSuite(loader.loadTestsFromTestCase(InputModeAcceptance))
    if ADVANCED:
        suite.addTests(loader.loadTestsFromTestCase(AdvancedInputModeAcceptance))
    else:
        print('Advanced input-mode acceptance: NOT RUN (set VB6_TEST_ADVANCED=1).', flush=True)
    print(f'Input-mode acceptance transport: {TRANSPORT}; browser: {ENGINE}.', flush=True)
    return suite


if __name__ == '__main__':
    unittest.main(verbosity=2, testRunner=InputModeTestRunner)
