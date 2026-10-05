#!/usr/bin/env python3
"""Integration checks for the compatibility worktrees. Run after npm run build."""
import importlib.util, json, os, shutil, subprocess, sys, time, base64
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('browser_suite',ROOT/'tools/browser-tests.py')
suite=importlib.util.module_from_spec(spec);spec.loader.exec_module(suite)
F=json.loads(subprocess.check_output(['node',str(ROOT/'tools/parity-fixtures.mjs')],text=True))
check=suite.check;case=suite.case

def resource_tests(browser):
    def import_frx():
        page=suite.open_ide(browser)
        payloads=[{'name':name,'mimeType':'application/octet-stream','buffer':base64.b64decode(value['base64']) if isinstance(value,dict) else value.encode()} for name,value in F['resourceFiles'].items()]
        with page.expect_file_chooser() as chooser: page.locator('[data-command="open"]').first.click()
        chooser.value.set_files(payloads)
        # Native imports now expose entry/encoding selection before replacing the
        # workspace. Exercise the actual dialog rather than bypassing that step.
        dialog=page.get_by_role('dialog',name='Open Native / Web Project',exact=True)
        dialog.get_by_label('Project entry',exact=True).select_option('Resources.vbp')
        dialog.get_by_label('Native text encoding',exact=True).select_option('auto')
        dialog.get_by_role('button',name='Open',exact=True).click()
        page.wait_for_function('vb6Studio.project.name === "ResourceIntegration"')
        check(page.evaluate('vb6Studio.diagnostics.length')==0)
        page.locator('.designer-pane [data-control="Image1"] img').wait_for()
        page.wait_for_function('document.querySelector(".designer-pane [data-control=Image1] img").naturalWidth === 1')
        frame=suite.start_ide(page)
        frame.wait_for_function('typeof vb6Application !== "undefined" && vb6Application.forms[0].controlMap.get("picture1").surface?.picture?.naturalWidth === 1')
        check(frame.locator('[data-control="Text1"] textarea').input_value()=='From FRX: €\nSecond line')
        check(frame.locator('[data-control="List1"] option').all_text_contents()==['One','Two','€ Three'])
        check(frame.evaluate('vb6Application.vm.lastError?.message || null') is None)
        frame.wait_for_timeout(80)
        # Canvas contains both the raster and retained graphics/text commands.
        check(frame.evaluate('vb6Application.forms[0].controlMap.get("picture1").surface.commands.some(c=>c.kind==="text")'))
        page.screenshot(path=str(suite.SHOTS/'resources-integration.png'))
        suite.stop_ide(page);suite.healthy(page);page.close()
    case('Native FRX UI import: decoded text/list/image, PictureBox raster plus VB drawing',import_frx)

    def vfs_binary():
        page=suite.open_ide(browser)
        data=bytes([0,255,128,13,10,0,65])
        page.evaluate('b=>{vb6Studio.project.vfs={version:2,files:{"/sample.bin":{encoding:"base64",data:b}}};void vb6Studio.command("virtualFiles");}',base64.b64encode(data).decode())
        page.get_by_text('7 bytes · binary',exact=True).wait_for()
        with page.expect_download() as event: page.get_by_role('button',name='Save',exact=True).click()
        path=ROOT/'reports/binary-roundtrip.bin';event.value.save_as(path);check(path.read_bytes()==data)
        page.get_by_role('button',name='Hex…',exact=True).click()
        field=page.get_by_label('Hex bytes');check(field.input_value()=='00 ff 80 0d 0a 00 41');field.fill('00 01 FE FF')
        page.get_by_role('button',name='OK',exact=True).click()
        page.wait_for_function('vb6Studio.project.vfs.files["/sample.bin"].data === "AAH+/w=="')
        page.get_by_role('dialog',name='Virtual File System',exact=True).get_by_role('button',name='Close',exact=True).click();suite.healthy(page);page.close()
    case('Virtual filesystem UI: exact binary download and validated hexadecimal edits',vfs_binary)

    def binary_dialogs():
        page=suite.new_page(browser)
        page.set_content('<style>'+suite.RUNTIME_CSS+'</style>');page.add_script_tag(content=suite.RUNTIME_JS)
        page.evaluate('p=>{globalThis.vb6Application=new VB6Runtime.RuntimeAPI.ApplicationHost(p,document.body,{persist:false});void vb6Application.start();}',F['binary'])
        page.wait_for_function('typeof vb6Application !== "undefined" && vb6Application.forms.length === 1')
        data=bytes([0,255,128,13,10,0,65])
        with page.expect_file_chooser() as event: page.get_by_role('button',name='Open binary',exact=True).click()
        event.value.set_files({'name':'sample.bin','mimeType':'application/octet-stream','buffer':data})
        page.wait_for_function('vb6Application.forms[0].controlMap.get("lblbytes").Caption === "7:255"')
        page.get_by_role('button',name='Save binary',exact=True).click();page.locator('.vb-modal-shade input').wait_for()
        with page.expect_download() as event: page.locator('.vb-modal-shade').get_by_role('button',name='OK',exact=True).click()
        path=ROOT/'reports/common-dialog-binary.bin';event.value.save_as(path);check(path.read_bytes()==data)
        suite.healthy(page);page.close()
    case('CommonDialog binary open/save: real file chooser, VB Get, exact download bytes',binary_dialogs)

def richtext_tests(browser):
    def open_rich():
        page=suite.open_example(browser,'richtext')
        page.wait_for_function('vb6Application.forms[0].controlMap.get("rtbdocument").Text.includes("Browser-native")')
        page.evaluate('globalThis.r = vb6Application.forms[0].controlMap.get("rtbdocument")')
        check(page.evaluate('vb6Application.vm.lastError?.message || null') is None)
        return page

    def rich_format():
        page=open_rich()
        page.evaluate('''() => {r.Text="Alpha Beta\\r\\nGamma Delta";r.SelStart=6;r.SelLength=4;r.SelBold=-1;r.SelBold=-1;r.SelItalic=-1;r.SelColor=255;}''')
        check(page.evaluate('r.SelBold')==-1)
        check(page.evaluate('r.SelText')=='Beta')
        span=page.locator('[data-control="rtbDocument"] span').filter(has_text='Beta')
        check(span.evaluate('n=>getComputedStyle(n).fontWeight')=='700')
        check(span.evaluate('n=>getComputedStyle(n).color')=='rgb(255, 0, 0)')
        check(page.evaluate('''() => {r.SelStart=0;r.SelLength=10;return r.SelBold;}''') is None)
        # Real compiled VB event toggles a mixed selection to bold, rather than JS-only formatting.
        page.get_by_role('button',name='Bold',exact=True).click()
        page.wait_for_function('r.rich.document.selectionStyle(0,10,"bold") === true')
        page.get_by_role('button',name='Center',exact=True).click()
        page.wait_for_function('r.rich.document.styleAt(0).alignment === 2')
        check(page.evaluate('r.rich.document.styleAt(12).alignment')==0)
        page.evaluate('''() => {r.SelStart=0;r.SelLength=3;r.SelIndent=720;r.SelHangingIndent=360;}''')
        check(page.evaluate('[r.SelIndent,r.SelHangingIndent,r.rich.document.styleAt(0).leftIndent,r.rich.document.styleAt(0).firstIndent]')==[720,360,1080,-360])
        check(page.locator('[data-control="rtbDocument"] .vb-rich-paragraph').first.evaluate('n=>[n.style.marginLeft,n.style.textIndent]')==['72px','-24px'])
        # Parent ScaleMode conversion: 48 pixels == 720 twips.
        page.evaluate('r.form.ScaleMode=3')
        check(page.evaluate('r.SelIndent')==48)
        page.evaluate('r.SelIndent=32')
        check(page.evaluate('r.rich.document.styleAt(0).leftIndent+r.rich.document.styleAt(0).firstIndent')==480)
        suite.healthy(page);page.close()
    case('RichTextBox: idempotent and mixed formatting, compiled VB handlers, paragraph units',rich_format)

    def rich_keyboard():
        page=open_rich();field=page.get_by_role('textbox',name='rtbDocument',exact=True)
        page.evaluate('r.Text="A😀\\r\\nB\\r\\n";r.SetFocus();r.SelStart=3')
        field.press('Backspace')
        check(page.evaluate('r.Text')=='A\r\nB\r\n')
        page.evaluate('r.SelStart=3')
        field.press('Backspace')
        check(page.evaluate('r.Text')=='AB\r\n')
        field.press('Control+z');check(page.evaluate('r.Text')=='A\r\nB\r\n')
        field.press('Control+y');check(page.evaluate('r.Text')=='AB\r\n')
        page.evaluate('r.SelStart=2')
        field.press('Enter');field.press('X')
        check(page.evaluate('r.Text')=='AB\r\nX\r\n')
        page.evaluate('r.SelStart=0;r.SelLength=2');field.press('Control+b')
        check(page.evaluate('r.SelBold')==-1)
        page.evaluate('r.Locked=-1');field.press('Q')
        check(page.evaluate('r.Text')=='AB\r\nX\r\n')
        page.evaluate('r.Locked=0;r.SelStart=4;r.SelLength=1;r.SelRTF="{\\\\rtf1\\\\i Italic}"')
        check(page.evaluate('r.Text')=='AB\r\nItalic\r\n')
        check(page.evaluate('r.rich.document.styleAt(4).italic'))
        suite.healthy(page);page.close()
    case('RichTextBox: keyboard editing, atomic CRLF/surrogate deletion, undo/redo, readonly, SelRTF',rich_keyboard)

    def rich_files():
        page=open_rich();page.evaluate('r.SelStart=0;r.SelLength=14;r.SelColor=255')
        original=page.evaluate('r.Text')
        page.get_by_role('button',name='Save…',exact=True).click()
        page.locator('.vb-modal-shade input').wait_for()
        with page.expect_download() as event:page.locator('.vb-modal-shade').get_by_role('button',name='OK',exact=True).click()
        path=ROOT/'reports/richtext-roundtrip.rtf';event.value.save_as(path)
        check(path.read_text().startswith('{\\rtf1'))
        page.evaluate('r.Text="Temporary"')
        with page.expect_file_chooser() as event:page.get_by_role('button',name='Open…',exact=True).click()
        event.value.set_files(str(path))
        page.wait_for_function('text=>r.Text===text',arg=original)
        check(page.evaluate('r.rich.document.styleAt(0).color')=='#ff0000')
        page.screenshot(path=str(suite.SHOTS/'richtext-editor.png'))
        suite.healthy(page);page.close()
    case('RichTextBox: real RTF download, native file chooser and formatted file round-trip',rich_files)

    def rich_safety():
        page=open_rich()
        source=r'{\rtf1 Before {\object\objdata <script>globalThis.injected=1</script>}{\*\unknown secret}after}'
        page.evaluate('s=>r.TextRTF=s',source)
        check(page.evaluate('r.Text')=='Before after')
        check(page.evaluate('r.TextRTF')==source)
        check(page.locator('[data-control="rtbDocument"] script').count()==0)
        check(page.evaluate('typeof injected')=='undefined')
        result=page.evaluate('''() => {let error;try{r.TextRTF="{\\\\rtf1 bad";}catch(e){error=e.message;}return {error,text:r.Text};}''')
        check('unclosed' in result['error']);check(result['text']=='Before after')
        page.evaluate('r.SelStart=0;r.SelLength=6;r.SelBold=-1')
        check(page.evaluate('''() => {try{r.SaveFile("/unsafe.rtf",0);return false;}catch(e){return /unsupported/.test(e.message)&&!r.vm.fs.exists("/unsafe.rtf");}}'''))
        page.evaluate('r.Text=r.Text;r.SaveFile("/flattened.rtf",0)')
        check(page.evaluate('r.vm.fs.read("/flattened.rtf").includes("objdata")') is False)
        suite.healthy(page);page.close()
    case('RichTextBox: inactive OLE/unknown content, atomic malformed loads and explicit-loss prevention',rich_safety)

    def rich_find_ime():
        page=open_rich()
        page.evaluate('r.Text="Cat scatter cat\\r\\n終\\r\\n";r.SetFocus()')
        check(page.evaluate('r.Find("cat",0,-1,2)')==0)
        check(page.evaluate('r.Find("cat",0,-1,6)')==12)
        before=page.evaluate('[r.SelStart,r.SelLength]')
        check(page.evaluate('r.Find("Cat",0,-1,12)')==0)
        check(page.evaluate('[r.SelStart,r.SelLength]')==before)
        check(page.evaluate('r.GetLineFromChar(17)')==1)
        # Exercise the native-composition synchronization path without fabricating keyboard IME support.
        result=page.evaluate('''() => {r.SelStart=19;r.input.dispatchEvent(new CompositionEvent('compositionstart'));const p=r.input.children[1],t=p.firstChild.firstChild;t.data='終わり';const range=document.createRange();range.setStart(t,3);range.collapse(true);getSelection().removeAllRanges();getSelection().addRange(range);r.input.dispatchEvent(new CompositionEvent('compositionend'));return {text:r.Text,start:r.SelStart};}''')
        check(result['text']=='Cat scatter cat\r\n終わり\r\n')
        check(result['start']==20)
        page.evaluate('r.Undo()');check(page.evaluate('r.Text')=='Cat scatter cat\r\n終\r\n')
        suite.healthy(page);page.close()
    case('RichTextBox: Find flags, UTF-16 line indices, composition synchronization and trailing paragraphs',rich_find_ime)

    def rich_rejected_input():
        page=open_rich();page.evaluate('r.Text="1234";r.MaxLength=4;r.SetFocus();r.SelStart=4')
        page.keyboard.type('5')
        check(page.evaluate('r.Text')=='1234')
        check('MaxLength' in page.evaluate('r.input.dataset.inputError'))
        page.evaluate('''() => {const clipboard=new DataTransfer();clipboard.setData('text/rtf','not an RTF document');r.input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:clipboard,bubbles:true,cancelable:true}));}''')
        check(page.evaluate('r.Text')=='1234')
        check('RTF' in page.evaluate('r.input.dataset.inputError'))
        page.evaluate('r.MaxLength=0;r.input.dispatchEvent(new InputEvent("beforeinput",{inputType:"insertText",data:"X",bubbles:true,cancelable:true}))')
        check(page.evaluate('r.Text')=='1234X')
        suite.healthy(page);page.close()
    case('RichTextBox: MaxLength and malformed clipboard data reject safely without page errors',rich_rejected_input)

    def rich_large():
        page=open_rich()
        metrics=page.evaluate('''() => {const t=performance.now();r.Text=Array.from({length:4000},(_,i)=>"Paragraph "+i).join("\\r\\n");const rendered=performance.now()-t;r.SelStart=r.Text.length-4;r.SelLength=4;r.SelBold=-1;return {paragraphs:r.input.children.length,positions:r.rich.positions.length,rendered,format:performance.now()-t-rendered};}''')
        check(metrics['paragraphs']==4000)
        check(metrics['positions']==4001)
        check(metrics['rendered']<10000,'Rendering exceeded the 10-second regression ceiling: '+str(metrics))
        suite.healthy(page);page.close();return metrics
    case('RichTextBox: 4,000-paragraph construction and late-document formatting',rich_large)

def data_tests(browser):
    def open_data():
        page=suite.new_page(browser,(1100,760))
        page.set_content('<!doctype html><html><head><style>'+suite.RUNTIME_CSS+'</style></head><body></body></html>')
        page.add_script_tag(content=suite.RUNTIME_JS)
        page.evaluate('p=>{globalThis.vb6Application=new VB6Runtime.RuntimeAPI.ApplicationHost(p,document.body,{persist:false});globalThis.startPromise=vb6Application.start();}',F['binding'])
        page.wait_for_function('vb6Application.vm.state === "running"')
        page.evaluate('globalThis.g=[...vb6Application.forms.values()][0].Controls.Item("Grid1");globalThis.rs=g.DataSource')
        page.wait_for_function('g.table.querySelectorAll("td[data-row]").length===6')
        return page
    def edit(page,row,col,value):
        cell=page.locator(f'td[data-row="{row}"][data-col="{col}"]')
        cell.dblclick();cell.locator('input').fill(value);cell.locator('input').press('Enter')
        page.wait_for_function('g.gridEditor===null')

    def data_write():
        page=open_data();edit(page,1,2,'123.4567')
        check(page.evaluate('rs.rows[0].Amount.toString()')=='123.4567')
        check(page.evaluate('g.Tag')=='updated')
        page.evaluate('rs.MoveFirst();rs.Update("Customer","Renamed")')
        page.wait_for_function('g.table.querySelector(\'td[data-row="1"][data-col="1"]\').textContent==="Renamed"')
        page.evaluate('rs.AddNew();rs.Fields.Item("ID").Value=3;rs.Fields.Item("Customer").Value="New";rs.Update()')
        page.wait_for_function('g.Rows===4')
        page.evaluate('rs.Delete()');page.wait_for_function('g.Rows===3')
        page.screenshot(path=str(suite.SHOTS/'bound-grid-editor.png'))
        suite.healthy(page);page.close()
    case('Bound grids: real VB validation handlers, typed writeback and live provider updates',data_write)

    def data_reject():
        page=open_data();edit(page,1,0,'not-a-number')
        check(page.evaluate('rs.rows[0].ID')==1)
        check('Type mismatch' in page.evaluate('g.LastDataError'))
        page.evaluate('g.Tag="cancel"');edit(page,1,1,'Rejected')
        check(page.evaluate('rs.rows[0].Customer')=='Ada')
        page.evaluate('g.Tag=""')
        cell=page.locator('td[data-row="1"][data-col="1"]');cell.dblclick();cell.locator('input').fill('Lost update')
        page.evaluate('rs.MoveFirst();rs.Update("Customer","Changed elsewhere")')
        cell.locator('input').press('Enter');page.wait_for_function('g.gridEditor===null')
        check(page.evaluate('rs.rows[0].Customer')=='Changed elsewhere')
        check('changed' in page.evaluate('g.LastDataError').lower())
        suite.healthy(page);page.close()
    case('Bound grids: type rejection, ByRef cancellation and stale-edit protection',data_reject)

    def data_navigation():
        page=open_data();page.locator('td[data-row="2"][data-col="0"]').click()
        check(page.evaluate('rs.Fields.Item("ID").Value')==2)
        page.evaluate('rs.Sort="Customer DESC"');page.wait_for_function('g.table.querySelector(\'td[data-row="1"][data-col="1"]\').textContent==="Grace"')
        page.evaluate('rs.Filter="ID = 1"');page.wait_for_function('g.Rows===2')
        check(page.evaluate('g.TextMatrix(1,1)')=='Ada')
        page.evaluate('rs.Close()');page.wait_for_function('g.Rows===1')
        page.evaluate('g.DataSource=null');check(page.evaluate('rs._observers.size')==0)
        page.evaluate('rs.Open();rs.AddNew("ID",3)');check(page.evaluate('g.Rows')==2)
        suite.healthy(page);page.close()
    case('Bound grids: cursor synchronization, sort/filter, close and subscription cleanup',data_navigation)

    def data_large():
        page=open_data()
        metrics=page.evaluate('''() => {g.DataSource=null;const t=performance.now();for(let i=3;i<=10000;i++){rs.AddNew();rs.Fields.Item("ID").Value=i;rs.Update();}const insert=performance.now()-t;g.DataSource=rs;g.viewport.scrollTop=9999*21;g.paintGridRows();return {insert,rows:g.Rows,rendered:g.table.querySelectorAll("td[data-row]").length,copied:g.gridData.length,last:g.TextMatrix(10000,0)};}''')
        check(metrics['rows']==10001);check(metrics['last']=='10000');check(metrics['rendered']<100);check(metrics['copied']==0)
        check(metrics['insert']<10000,'10,000 row insertion exceeded the regression ceiling: '+str(metrics))
        page.evaluate('g.dispose()');check(page.evaluate('rs._observers.size')==0)
        suite.healthy(page);page.close();return metrics
    case('Bound grids: 10,000 rows, cached read-through view and bounded rendered cells',data_large)

def main():
    suite.REPORTS.mkdir(exist_ok=True);suite.SHOTS.mkdir(exist_ok=True);started=time.perf_counter()
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
        version=browser.version;resource_tests(browser);richtext_tests(browser);data_tests(browser);browser.close()
    failed=sum(not r['passed'] for r in suite.RESULTS)
    result={'browser':version,'passed':len(suite.RESULTS)-failed,'failed':failed,'seconds':round(time.perf_counter()-started,2),'tests':suite.RESULTS}
    (suite.REPORTS/'browser-parity-tests.json').write_text(json.dumps(result,indent=2))
    (suite.REPORTS/'browser-parity-tests.md').write_text('# Compatibility browser tests\n\n'+f"{result['passed']} passed; {failed} failed. Chromium {version}.\n\n"+'\n'.join(f"- {'PASS' if r['passed'] else 'FAIL'}: {r['name']}"+(f" — {r['error']}" if not r['passed'] else '') for r in suite.RESULTS)+'\n')
    print(f"{result['passed']} passed; {failed} failed.");return bool(failed)
if __name__=='__main__':sys.exit(main())
