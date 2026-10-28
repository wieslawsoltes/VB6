"""Functional DOS presentation checks against the production bundle.

Screenshots are evidence of the current implementation, not native goldens.
"""
from pathlib import Path
import functools
import http.server
import json
import os
import threading
from playwright.sync_api import sync_playwright, expect
from dos_runtime_checks import run_runtime_checks
from dos_boundary_checks import run_boundary_checks
from dos_extended_checks import run_extended_checks
from dos_fidelity_checks import run_fidelity_checks
from dos_precision_checks import run_precision_checks
from dos_shell_checks import run_shell_checks
from dos_collection_checks import run_collection_checks
from dos_text_focus_checks import run_text_focus_checks
from dos_designer_grid_checks import run_designer_grid_checks

ROOT = Path(__file__).resolve().parents[1]
ENGINE = os.environ.get('VB6_BROWSER', 'chromium')
REPORT = ROOT / 'reports' / ('dos-' + ENGINE)
REPORT.mkdir(parents=True, exist_ok=True)

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(ROOT / 'dist')))
threading.Thread(target=server.serve_forever, daemon=True).start()
errors = []
results = {}
playwright = None
try:
    if ENGINE == 'webkit':
        os.environ.setdefault('DEBUG', 'pw:browser')
    playwright = sync_playwright().start()
    p = playwright
    options = {'executable_path': os.environ['CHROMIUM_PATH']} if ENGINE == 'chromium' and os.environ.get('CHROMIUM_PATH') else {}
    browser = getattr(p, ENGINE).launch(**options)
    page = browser.new_page(viewport={'width': 1600, 'height': 1100}, device_scale_factor=1)
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.add_init_script("try { localStorage.setItem('vb6-studio-web.rendering.v1', JSON.stringify({backend:'html'})); } catch {}")
    url = (ROOT / 'dist/VB6-Studio-Web.html').as_uri() if os.environ.get('VB6_ORIGIN') == 'file' else f'http://127.0.0.1:{server.server_port}/index.html'
    if os.environ.get('VB6_ORIGIN') == 'memory':
        page.set_content((ROOT / 'dist/VB6-Studio-Web.html').read_text(), wait_until='load')
        page.evaluate('vb6Studio.setRenderingPolicy({backend:"html"})')
    else:
        page.goto(url)
    page.wait_for_function('window.vb6Studio?.dosMode')
    page.evaluate('''() => {
      const api=VB6StudioAPI,ide=vb6Studio,p=api.newProject('DOSFixture'),m=p.modules[0];
      m.bookmarks=[]; // SourceEditor initializes the same empty bookmark collection on first open.
      m.form.properties.ClientWidth=12000;m.form.properties.ClientHeight=10500;
      const types=['Label','TextBox','CommandButton','CheckBox','OptionButton','ComboBox','ListBox','HScrollBar','VScrollBar','Timer','DriveListBox','DirListBox','FileListBox','Shape','Line','Data','TreeView','ListView','ProgressBar','Slider','StatusBar','Toolbar','RichTextBox','MSFlexGrid','MSHFlexGrid','DataGrid','DTPicker','MonthView','UpDown','ImageList','CommonDialog','Adodc','Frame','PictureBox','TabStrip','SSTab','Image','MSChart','OLE','WebBrowser'];
      for(let i=0;i<types.length;i++){const type=types[i],c=api.createControl(type,type+'Test',150+(i%5)*2300,150+Math.floor(i/5)*1200);c.properties.Width=2100;c.properties.Height=1050;
        if(type==='TextBox'){c.properties.Text='Edit me';c.properties.Height=315;}
        if(['CheckBox','OptionButton','CommandButton'].includes(type))c.properties.Caption='&'+type;
        if(['ListBox','ComboBox'].includes(type)){c.properties.List=['Alpha','Beta','Gamma'];c.properties.ListIndex=1;}
        m.form.controls.push(c);
      }
      m.code='Option Explicit\\nPrivate Sub CommandButtonTest_Click()\\n  TextBoxTest.Text = "DOS event works"\\nEnd Sub\\n';
      ide.loadProject(p);ide.designer.select([m.form.controls[2].id]);
      window.dosBaseline=JSON.stringify(ide.project);window.dosOriginalControl=document.querySelector('[data-control="CommandButtonTest"]');
    }''')
    page.evaluate("vb6Studio.dosMode.configure({mode:'dos'})")
    page.wait_for_function("document.querySelectorAll('.vb-tui-surface').length >= 25")
    assert page.evaluate('JSON.stringify(vb6Studio.project)===dosBaseline')
    assert page.evaluate('document.querySelector(\'[data-control="CommandButtonTest"]\')===dosOriginalControl')
    for profile in ['turbo', 'commander', 'win31', 'monochrome']:
        page.evaluate('(profile)=>vb6Studio.dosMode.configure({mode:"dos",profile})', profile)
        page.wait_for_function('(profile)=>document.documentElement.getAttribute("data-vb-dos")===profile', arg=profile)
        page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
        page.screenshot(path=str(REPORT / (profile + '.png')), full_page=True)
    results['surfaces'] = page.locator('.vb-tui-surface').count()
    assert page.evaluate('vb6Studio.dosMode.snapshot().length') >= 25
    assert page.evaluate('[...vb6Studio.dosMode.sessions.values()].every(s=>s.metrics.failures===0)')
    # Existing property transactions and undo still own editing.
    page.evaluate("vb6Studio.setProperty('Caption','Changed through canonical inspector')")
    assert page.evaluate("vb6Studio.designer.selected()[0].properties.Caption") == 'Changed through canonical inspector'
    page.evaluate("vb6Studio.command('undo')")
    assert page.evaluate('JSON.stringify(vb6Studio.project)===dosBaseline')
    # Options are staged: cancellation cannot enable/disable a workspace.
    page.evaluate("void vb6Studio.command('options')")
    page.get_by_role('tab', name='General', exact=True).click()
    page.get_by_label('Workspace mode', exact=True).select_option('classic')
    page.get_by_role('button', name='Cancel', exact=True).click()
    assert page.evaluate('vb6Studio.dosMode.enabled')
    # All three presentations share one project and event model.
    page.evaluate("vb6Studio.figmaMode.configure({...vb6Studio.figmaMode.settings,mode:'figma'})")
    assert not page.evaluate('vb6Studio.dosMode.enabled')
    assert page.locator('.vb-tui-surface').count() == 0
    page.evaluate("vb6Studio.dosMode.configure({mode:'dos',profile:'turbo'})")
    assert not page.evaluate('vb6Studio.figmaMode.enabled')
    assert page.evaluate('JSON.stringify(vb6Studio.project)===dosBaseline')
    # The code editor keeps its original virtual-input geometry and history.
    page.evaluate("vb6Studio.command('viewCode')")
    page.wait_for_function("vb6Studio.editor.syntax.querySelector('.vb-tui-chrome-surface')")
    page.evaluate("window.dosSourceInput=vb6Studio.editor.input;window.dosSourceBefore=vb6Studio.editor.input.value")
    source = page.locator('textarea.source-input[data-active-editor="true"]')
    source.focus()
    source.press('Control+Home')
    source.press('Shift+ArrowRight')
    page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert page.evaluate("(() => {const r=vb6Studio.dosMode.sessions.get(document),entry=r.chrome.entries.get(vb6Studio.editor.syntax);return entry.source&&entry.buffer.toText().includes('Option')&&Math.abs(entry.painter.cellWidth-vb6Studio.editor.characterWidth)<0.1;})()")
    assert page.evaluate("vb6Studio.editor.input===dosSourceInput&&vb6Studio.editor.input.selectionEnd-vb6Studio.editor.input.selectionStart===1")
    source.press('End')
    source.press('Space')
    page.wait_for_function('vb6Studio.editor.input.value!==dosSourceBefore')
    page.evaluate("vb6Studio.command('undo')")
    page.wait_for_function('vb6Studio.editor.input.value===dosSourceBefore')
    assert page.evaluate('JSON.stringify(vb6Studio.project)===dosBaseline')
    gutter = page.locator('.source-editor:visible .gutter-line[data-line="3"]')
    gutter.click()
    page.wait_for_function('vb6Studio.breakpoints.some(b=>b.line===3)')
    page.evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
    assert page.evaluate("vb6Studio.dosMode.sessions.get(document).chrome.entries.get(vb6Studio.editor.gutter).buffer.toText().includes('•')")
    page.screenshot(path=str(REPORT / 'source-editor.png'), full_page=True)
    gutter.click()
    page.wait_for_function('!vb6Studio.breakpoints.some(b=>b.line===3)')
    results['source_editor'] = {'identity': True, 'native_pitch': True, 'selection': True, 'undo': True, 'breakpoint': True}
    # Exercise the actual command/download path, not just the serializers.
    results['downloads'] = []
    for command, suffix in [('dosExportJSON','.json'),('dosExportANSI','.ans'),('dosExportText','.txt'),('dosExportB800','.b800')]:
        with page.expect_download() as event:
            page.evaluate('(command)=>vb6Studio.command(command)', command)
        download = event.value
        assert download.suggested_filename.endswith(suffix)
        path = REPORT / download.suggested_filename
        download.save_as(path)
        assert path.stat().st_size > 0
        results['downloads'].append(download.suggested_filename)
    saved = json.loads((REPORT / 'DOS-screen.json').read_text())
    assert saved['format'] == 'vb6-tui-screen' and saved['version'] == 1
    assert (REPORT / 'DOS-screen.b800').stat().st_size == saved['columns'] * saved['rows'] * 2
    assert (REPORT / 'DOS-screen.ans').read_bytes().endswith(b'\x1b[0m')
    page.evaluate("vb6Studio.command('viewForm')")
    # F5 uses the original sandbox and the normal bundled runtime.
    page.evaluate("vb6Studio.command('run')")
    # Pin the actual iframe/frame pair. The all-controls fixture also contains a
    # nested WebBrowser srcdoc: validate identity rather than repeatedly resolving
    # a cross-origin FrameLocator after focus changes.
    owner = page.locator('iframe[title="Running Visual Basic application"]')
    expect(owner).to_have_count(1)
    owner_handle = owner.element_handle()
    frame = owner_handle.content_frame()
    assert frame is not None and frame.parent_frame == page.main_frame
    original_frame = frame

    frame.locator('[data-control="CommandButtonTest"]').wait_for()
    frame.locator('[data-control="CommandButtonTest"] .vb-tui-surface').wait_for()
    assert 'allow-same-origin' not in page.locator('iframe[title="Running Visual Basic application"]').get_attribute('sandbox')
    frame.locator('[data-control="CommandButtonTest"]').click()
    assert owner_handle.is_visible() and owner_handle.content_frame() == original_frame
    assert owner_handle.evaluate('(node)=>node===vb6Studio.runtimeFrame&&node.isConnected')
    expect(frame.locator('[data-control="TextBoxTest"] input')).to_have_value('DOS event works')
    text = frame.locator('[data-control="TextBoxTest"] input')
    text.fill('Native editing and clipboard path')
    assert text.input_value() == 'Native editing and clipboard path'
    page.screenshot(path=str(REPORT / 'runtime.png'), full_page=True)
    page.evaluate('vb6Studio.stop(false)')
    page.evaluate("vb6Studio.dosMode.configure({mode:'classic'})")
    assert page.locator('.vb-tui-surface').count() == 0
    assert page.evaluate('!document.documentElement.hasAttribute("data-vb-dos")')
    results['model_preserved'] = page.evaluate('JSON.stringify(vb6Studio.project)===dosBaseline')
    assert results['model_preserved']
    results['errors'] = errors
    assert not errors, errors
    results['runtime_checks'] = run_runtime_checks(browser, ROOT, REPORT, page.evaluate('vb6Studio.project'))
    results['shell'] = run_shell_checks(browser, ROOT, REPORT)
    results['collection_checks'] = run_collection_checks(browser, ROOT, REPORT, page.evaluate('vb6Studio.project'))
    results['text_focus'] = run_text_focus_checks(browser, ROOT, REPORT, page.evaluate('vb6Studio.project'))
    results['designer_grid'] = run_designer_grid_checks(browser, ROOT, REPORT)
    results['extended_checks'] = run_extended_checks(browser, ROOT, REPORT, page.evaluate('vb6Studio.project'))
    results['boundary_checks'] = run_boundary_checks(browser, ROOT, REPORT, page.evaluate('vb6Studio.project'))
    results['fidelity_matrix'] = run_fidelity_checks(browser, ROOT, REPORT)
    results['precision'] = run_precision_checks(browser, ROOT, REPORT)
    results['passed'] = True
    browser.close()
except Exception:
    # Preserve the opaque-origin frame's DOM through Playwright's frame API;
    # never grant allow-same-origin merely to diagnose a failure.
    try:
        page.screenshot(path=str(REPORT / 'failure.png'), full_page=True)
        results['frames'] = [{
            'url': f.url,
            'state': f.evaluate("() => ({ready:document.readyState,body:document.body?.innerText.slice(0,8000),controls:[...document.querySelectorAll('[data-control]')].map(n=>({name:n.dataset.control,html:n.outerHTML.slice(0,1000)}))})")
        } for f in page.frames]
        results['ide'] = page.evaluate("() => ({state:vb6Studio.runState,output:vb6Studio.output,immediate:vb6Studio.immediateOutput,hasFrame:!!vb6Studio.runtimeFrame})")
    except Exception as error:
        results['capture_error'] = str(error)
    raise
finally:
    if playwright is not None:
        playwright.stop()
    server.shutdown()
    (REPORT / 'results.json').write_text(json.dumps(results | {'errors': errors}, indent=2))
print(json.dumps(results, indent=2))
