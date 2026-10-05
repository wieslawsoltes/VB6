#!/usr/bin/env python3
"""Native project import/save integration against shipped HTTP and file:// builds.

Directory tests use a real origin-private filesystem handle, not an OS picker or
mock disk. Set VB6_BROWSER=chromium|firefox|webkit; CHROMIUM_PATH is optional.
"""
import base64
import functools
import http.server
import io
import json
import os
from pathlib import Path
import shutil
import threading
import unittest
import zipfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / 'reports' / 'native-projects'
ENCODING = 'windows-1250'
VBP = ('Type=Exe\r\n\'Preserve this project\r\nForm=ui\\Main.frm\r\n'
       'Module=Utils; code\\Utils.bas\r\nStartup="Main"\r\nName="NativeLab"\r\n'
       'Title="Żółć"\r\nVendorSetting=one\r\nVendorSetting=two\r\n'
       'Reference=*\\G{TEST}#1.0#0#C:\\old\\dependency.dll#Dependency\r\n'
       '[Vendor]\r\nSetting=unchanged')
FRM = ('VERSION 5.00\r\n\'Preserve designer comment\r\nBegin VB.Form Main\r\n'
       '   Caption = "Żółć"\r\n   ClientHeight = 2400\r\n   ClientWidth = 3600\r\n'
       '   Begin VB.CommandButton Button1\r\n      Caption = "OK"\r\n'
       '      Left = 120\r\n      Width = 900\r\n      Vendor.Indexed(0) = 17\r\n'
       '   End\r\nEnd\r\nAttribute VB_Name = "Main"\r\n'
       'Attribute VB_PredeclaredId = True\r\nOption Explicit\r\n'
       'Private Sub Button1_Click()\r\nAttribute Button1_Click.VB_Description = "event"\r\n'
       '    Debug.Print "original"\r\nEnd Sub\r\n')
BAS = ('Attribute VB_Name = "Utils"\r\nOption Explicit\r\nPublic Sub Helper()\r\n'
       'Attribute Helper.VB_Description = "Keep me"\r\nEnd Sub')
FIXTURE = {'app/App.vbp': VBP.encode('cp1250'), 'app/ui/Main.frm': FRM.encode('cp1250'),
           'app/code/Utils.bas': BAS.encode('ascii'), 'app/ui/Main.frx': bytes([0, 1, 255, 128]),
           'app/App.vbw': b'opaque workspace\r\n', 'related/readme.txt': b'opaque companion\x00\xff'}

def payload(entries):
    return [[name, base64.b64encode(data).decode()] for name, data in entries.items()]

def archive(entries):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, data in entries.items(): z.writestr(name, data)
    return output.getvalue()

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

class NativeProjects(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        REPORT.mkdir(parents=True, exist_ok=True)
        cls.server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(QuietHandler, directory=str(ROOT)))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.http_url = f'http://127.0.0.1:{cls.server.server_port}/dist/index.html'
        cls.pw = sync_playwright().start()
        cls.engine = os.environ.get('VB6_BROWSER', 'chromium')
        options = {}
        if cls.engine == 'chromium':
            path = os.environ.get('CHROMIUM_PATH') or shutil.which('chromium')
            if path: options['executable_path'] = path
            options['args'] = ['--no-sandbox']
        cls.browser = getattr(cls.pw, cls.engine).launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop(); cls.server.shutdown(); cls.server.server_close()

    def setUp(self):
        self.context = self.browser.new_context(viewport={'width': 1400, 'height': 1000}, accept_downloads=True)
        self.context.set_default_timeout(6000)
        self.page = self.context.new_page(); self.errors = []
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.mode = 'memory' if os.environ.get('VB6_TEST_TRANSPORT') == 'memory' else 'file' if self._testMethodName.endswith('_file') else 'http'
        if self.mode == 'memory':
            self.page.set_content((ROOT / 'dist' / 'VB6-Studio-Web.html').read_text())
        else:
            self.page.goto((ROOT / 'dist' / 'VB6-Studio-Web.html').as_uri() if self.mode == 'file' else self.http_url)
        self.page.wait_for_function('typeof vb6Studio === "object" && typeof vb6Studio.importProjectEntries === "function"')

    def tearDown(self):
        if self.errors: (REPORT / f'{self.engine}-{self._testMethodName}-errors.json').write_text(json.dumps(self.errors, indent=2))
        errors = self.errors[:]; self.context.close()
        self.assertEqual(errors, [], 'Uncaught browser errors')

    def js(self, code, arg=None): return self.page.evaluate(code, arg)
    def start(self, expression):
        self.js('() => { globalThis.operationResult = undefined; globalThis.operation = (' + expression + ').then(result => globalThis.operationResult = result); }')
    def button(self, name): self.page.locator('.ide-modal-cover').last.get_by_role('button', name=name, exact=True).click()
    def result(self, expected):
        self.page.wait_for_function('globalThis.operationResult !== undefined')
        self.assertEqual(self.js('globalThis.operationResult'), expected)
    def load(self, entries=FIXTURE, entry='app/App.vbp', encoding=ENCODING):
        self.assertTrue(self.js('''async arg => {
          vb6Studio.dirty = false;
          const entries = new Map(arg.files.map(([p,b])=>[p,Uint8Array.from(atob(b),c=>c.charCodeAt(0))]));
          return await vb6Studio.importProjectEntries(entries,{interactive:false,entryPath:arg.entry,encoding:arg.encoding});
        }''', {'files': payload(entries), 'entry': entry, 'encoding': encoding}))
    def export(self):
        result = self.js('''() => Object.fromEntries(Object.entries(VB6Studio.StudioAPI.sourceFiles(vb6Studio.project)).map(([p,v]) =>
          [p,Array.from(typeof v === 'string' ? new TextEncoder().encode(v) : v)]))''')
        return {path: bytes(data) for path, data in result.items()}
    def native_download(self, expression='vb6Studio.command("saveNative")'):
        with self.page.expect_download() as event: self.start(expression)
        download = event.value; path = download.path(); self.result(True)
        self.assertTrue(download.suggested_filename.endswith('.zip'))
        with zipfile.ZipFile(path) as z: return {name: z.read(name) for name in z.namelist()}
    def edit(self, script):
        self.js('() => {const before=structuredClone(vb6Studio.project);' + script + ';vb6Studio.record(before,"Test edit");}')

    def case_picker_zip_noop(self):
        self.page.locator('input[type=file]').first.set_input_files({'name': 'Original.zip', 'mimeType': 'application/zip', 'buffer': archive(FIXTURE)})
        self.page.get_by_label('Project entry', exact=True).select_option('app/App.vbp')
        self.page.get_by_label('Native text encoding', exact=True).select_option(ENCODING)
        self.button('Open'); self.page.wait_for_function('vb6Studio.project.name === "NativeLab"')
        self.assertEqual(self.js('vb6Studio.project.modules[0].form.properties.Caption'), 'Żółć')
        self.assertEqual(self.native_download('vb6Studio.command("save")'), FIXTURE)
        self.assertFalse(self.js('vb6Studio.dirty'))
        self.page.screenshot(path=str(REPORT / f'{self.engine}-{self.mode}-native-project.png'))

    def case_actual_code_edit_and_designer(self):
        self.load()
        self.js('''() => {vb6Studio.openDocument(vb6Studio.project.modules[0].id,'code');vb6Studio.editor.input.setAttribute('data-native-editor','true');}''')
        editor = self.page.locator('[data-native-editor=true]')
        editor.fill(editor.input_value().replace('"original"', '"edited"'))
        self.page.wait_for_function('vb6Studio.project.modules[0].code.includes("edited")')
        self.edit('vb6Studio.project.modules[0].form.controls[0].properties.Caption="Changed"')
        files = self.native_download(); result = files['app/ui/Main.frm'].decode('cp1250')
        self.assertIn('"edited"', result); self.assertIn('Caption = "Changed"', result)
        self.assertIn('Vendor.Indexed(0) = 17', result)
        self.assertIn('Attribute Button1_Click.VB_Description = "event"', result)
        self.assertEqual(files['app/ui/Main.frx'], FIXTURE['app/ui/Main.frx'])
        self.load(files)
        self.assertEqual(self.js('vb6Studio.project.modules[0].form.controls[0].properties.Caption'), 'Changed')

    def case_save_as_web_and_reopen(self):
        self.load(); self.start('vb6Studio.command("saveAs")')
        self.page.get_by_label('Save project format', exact=True).select_option('web')
        with self.page.expect_download() as event: self.button('OK')
        self.result(True); download = event.value
        self.assertEqual(download.suggested_filename, 'NativeLab.vb6web')
        data = Path(download.path()).read_bytes(); self.load({'Browser.vb6web': data}, 'Browser.vb6web')
        self.assertEqual(self.js('vb6Studio.project.storageFormat'), 'web')
        self.assertEqual(self.export(), FIXTURE); self.assertEqual(self.native_download(), FIXTURE)

    def case_group_switch_and_history(self):
        group = {'Suite.vbg': b'VBGROUP 5.0\r\nStartupProject=A.vbp\r\nProject=B.vbp\r\n',
                 'A.vbp': b'Type=Exe\r\nName="A"\r\nModule=M; A.bas\r\nStartup="Sub Main"\r\n',
                 'B.vbp': b'Type=Exe\r\nName="B"\r\nModule=N; B.bas\r\nStartup="Sub Main"\r\n',
                 'A.bas': b'Attribute VB_Name = "M"\r\nPublic Sub Main()\r\nEnd Sub\r\n',
                 'B.bas': b'Attribute VB_Name = "N"\r\nPublic Sub Main()\r\nEnd Sub\r\n'}
        self.load(group, 'Suite.vbg'); self.edit('vb6Studio.project.modules[0].code+="\\n\'edit A"')
        self.page.get_by_label('Active project in group', exact=True).select_option('B.vbp')
        self.edit('vb6Studio.project.modules[0].code+="\\n\'edit B"')
        self.page.get_by_label('Active project in group', exact=True).select_option('A.vbp')
        self.js('() => vb6Studio.command("undo")')
        self.assertNotIn(b'edit A', self.export()['A.bas']); self.assertIn(b'edit B', self.export()['B.bas'])
        self.js('() => vb6Studio.command("redo")'); files = self.native_download()
        self.assertIn(b'edit A', files['A.bas']); self.assertIn(b'edit B', files['B.bas'])
        self.assertEqual(files['Suite.vbg'], group['Suite.vbg'])

    def case_failed_save_prevents_discard(self):
        self.load(); self.edit('vb6Studio.project.modules[1].code+="\\n\' 日本語"')
        self.start('vb6Studio.confirmDiscard()'); self.button('Save')
        self.page.get_by_text('not representable', exact=False).wait_for(); self.button('OK'); self.result(False)
        self.assertTrue(self.js('vb6Studio.dirty')); self.assertEqual(self.js('vb6Studio.project.name'), 'NativeLab')

    def case_cancel_import_keeps_project(self):
        self.load(); before = self.js('JSON.stringify(vb6Studio.project)')
        self.page.locator('input[type=file]').first.set_input_files({'name': 'Original.zip', 'mimeType': 'application/zip', 'buffer': archive(FIXTURE)})
        self.page.get_by_label('Project entry', exact=True).wait_for(); self.button('Cancel')
        self.assertEqual(self.js('JSON.stringify(vb6Studio.project)'), before)

    def case_duplicate_files_no_partial_import(self):
        self.load(); before = self.js('JSON.stringify(vb6Studio.project)')
        self.js('''() => {globalThis.operationResult=undefined;const a=new File(['first'],'X.bas'),b=new File(['second'],'x.bas');
          vb6Studio.importBrowserFiles([a,b],{interactive:false}).then(r=>globalThis.operationResult=r);}''')
        self.page.get_by_text('Duplicate', exact=False).last.wait_for(); self.button('OK'); self.result(False)
        self.assertEqual(self.js('JSON.stringify(vb6Studio.project)'), before)

    def case_edits_during_read_preserved(self):
        self.load()
        self.js('''() => {globalThis.operationResult=undefined;
          const file={name:'M.bas',size:4,arrayBuffer:()=>new Promise(resolve=>globalThis.finishRead=()=>resolve(new TextEncoder().encode('Attribute VB_Name = "M"\\r\\nOption Explicit').buffer))};
          vb6Studio.importBrowserFiles([file],{interactive:false}).then(r=>globalThis.operationResult=r);
          const before=structuredClone(vb6Studio.project);vb6Studio.project.description='Newer edit';vb6Studio.record(before,'Newer edit');finishRead();}''')
        self.page.get_by_text('The project changed while files were being read.', exact=False).wait_for()
        self.button('OK'); self.result(False)
        self.assertEqual(self.js('vb6Studio.project.description'), 'Newer edit'); self.assertTrue(self.js('vb6Studio.dirty'))

    def case_missing_project_kept_without_fake_sources(self):
        entries = {'Missing.vbp': b'Type=Exe\r\nForm=Missing.frm\r\nName="Missing"\r\nStartup="Missing"'}
        self.load(entries, 'Missing.vbp'); self.assertEqual(self.js('vb6Studio.project.modules.length'), 0)
        self.page.get_by_text('Missing.frm (missing)', exact=True).wait_for()
        self.assertEqual(self.native_download(), entries)

    def case_opaque_designer_preview(self):
        entries = {'P.vbp': b'Type=Exe\r\nDesigner=Report.dsr\r\nName="Reports"\r\nStartup="Sub Main"',
                   'Report.dsr': b'VERSION 5.00\r\nBegin {GUID} Report\r\nPrivate opaque data', 'Report.dsx': b'\x01\xff\x00'}
        self.load(entries, 'P.vbp'); self.page.get_by_text('Report.dsr (read-only)', exact=True).dblclick()
        preview = self.page.get_by_label('Read-only native file', exact=True)
        self.assertTrue(preview.get_attribute('readonly') is not None); self.assertIn('Private opaque data', preview.input_value())
        with self.page.expect_download() as event: self.button('Download Original')
        self.assertEqual(Path(event.value.path()).read_bytes(), entries['Report.dsr'])
        if self.page.locator('.ide-modal-cover').count(): self.button('Close')
        self.assertEqual(self.export(), entries)

    def case_native_settings_ui(self):
        self.load(); self.start('vb6Studio.command("nativeSettings")')
        settings = self.page.get_by_label('Native project settings', exact=True)
        settings.fill(settings.input_value().replace('VendorSetting=two', 'VendorSetting=changed'))
        self.button('OK'); self.result(True); files = self.native_download()
        expected = FIXTURE['app/App.vbp'].replace(b'VendorSetting=two', b'VendorSetting=changed')
        self.assertEqual(files['app/App.vbp'], expected)

    def case_add_collision_is_atomic(self):
        self.load(); before = self.js('JSON.stringify(vb6Studio.project)')
        self.js('''() => {globalThis.operationResult=undefined;
          vb6Studio.importProjectEntries(new Map([['Other.bas','Attribute VB_Name = "NewModule"\\nOption Explicit'],
            ['Utils.bas','Attribute VB_Name = "Utils"\\nOption Explicit']]),{interactive:false,add:true}).then(r=>globalThis.operationResult=r);}''')
        self.page.get_by_text('A module named Utils already exists.', exact=True).wait_for(); self.button('OK'); self.result(False)
        self.assertEqual(self.js('JSON.stringify(vb6Studio.project)'), before)

    def case_save_cancel_keeps_dirty(self):
        self.load(); self.edit('vb6Studio.project.description="Unsaved"'); self.start('vb6Studio.command("saveAs")')
        self.page.get_by_label('Save project format', exact=True).select_option('native'); self.button('Cancel'); self.result(False)
        self.assertTrue(self.js('vb6Studio.dirty'))
        self.js('() => {vb6Studio.addingFiles=true;vb6Studio.fileInput.dispatchEvent(new Event("cancel"));}')
        self.assertFalse(self.js('vb6Studio.addingFiles'))

    def case_directory_real_handle(self):
        if self.mode != 'http': self.skipTest('OPFS is tested over HTTP; other import/download coverage is separate.')
        self.load()
        available = self.js('async () => {try {globalThis.nativeRoot=await navigator.storage.getDirectory();const f=await nativeRoot.getFileHandle("capability-probe",{create:true});const ok=typeof f.createWritable==="function";await nativeRoot.removeEntry("capability-probe");return ok;}catch{return false;}}')
        if not available: self.skipTest('This browser does not expose writable origin-private filesystem directory handles.')
        self.assertTrue(self.js('async () => await vb6Studio.saveProject({format:"folder",directoryHandle:nativeRoot})'))
        actual = self.js('''async () => {async function walk(dir,prefix=''){const result={};for await(const h of dir.values()){
          if(h.kind==='directory')Object.assign(result,await walk(h,prefix+h.name+'/'));else result[prefix+h.name]=Array.from(new Uint8Array(await(await h.getFile()).arrayBuffer()));}return result;}return await walk(nativeRoot);}''')
        self.assertEqual({path: bytes(data) for path, data in actual.items()}, FIXTURE)
        self.edit('vb6Studio.project.description="Changed"'); self.start('vb6Studio.saveProject({format:"folder",directoryHandle:nativeRoot})')
        self.page.get_by_text('Replace Native Project Files', exact=True).wait_for(); self.button('Cancel'); self.result(False)
        self.assertTrue(self.js('vb6Studio.dirty')); self.start('vb6Studio.saveProject({format:"folder",directoryHandle:nativeRoot})')
        self.page.get_by_text('Replace Native Project Files', exact=True).wait_for()
        self.js('''async () => {const dir=await nativeRoot.getDirectoryHandle('app');const f=await dir.getFileHandle('App.vbp');const w=await f.createWritable();await w.write('external edit');await w.close();}''')
        self.button('Save Files'); self.page.get_by_text('File changed since save confirmation:', exact=False).wait_for()
        self.button('OK'); self.result(False)
        actual = self.js('async () => await(await(await nativeRoot.getDirectoryHandle("app")).getFileHandle("App.vbp")).getFile().then(f=>f.text())')
        self.assertEqual(actual, 'external edit'); self.assertTrue(self.js('vb6Studio.dirty'))

for name in [n for n in vars(NativeProjects) if n.startswith('case_')]:
    for transport in (['memory'] if os.environ.get('VB6_TEST_TRANSPORT') == 'memory' else ['http', 'file']):
        setattr(NativeProjects, 'test_' + name[5:] + '_' + transport, getattr(NativeProjects, name))
if __name__ == '__main__': unittest.main(verbosity=2)
