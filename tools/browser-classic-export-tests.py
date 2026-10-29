#!/usr/bin/env python3
"""Classic EXE UI/download regressions using an explicitly synthetic compiler protocol.
No Microsoft compiler is installed or invoked by this browser test.
"""
from __future__ import annotations
import base64
import hashlib
import json
import os
import shutil
import struct
import subprocess
import zipfile
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports' / 'classic-export'
OUT.mkdir(parents=True, exist_ok=True)
ORIGIN = 'http://127.0.0.1:8080'
TOKEN = 'b' * 64
MEMORY = os.environ.get('VB6_CLASSIC_TEST_TRANSPORT') == 'memory'
checks = []

def fixture():
    data = bytearray(1024)
    data[:2] = b'MZ'; struct.pack_into('<I', data, 0x3c, 0x80); data[0x80:0x84] = b'PE\0\0'
    for offset, value in [(0x84, 0x14c), (0x86, 1), (0x94, 224), (0x96, 0x102), (0x98, 0x10b), (0x98 + 68, 2)]: struct.pack_into('<H', data, offset, value)
    for offset, value in [(0x98+60, 512), (0x98+92, 16), (0x98+104, 0x1000), (0x98+108, 40)]: struct.pack_into('<I', data, offset, value)
    section = 0x98 + 224; data[section:section+6] = b'.idata'
    for offset, value in [(8,512),(12,0x1000),(16,512),(20,512)]: struct.pack_into('<I', data, section+offset, value)
    struct.pack_into('<I', data, 524, 0x1050); data[592:605] = b'MSVBVM60.DLL\0'
    return bytes(data)

BINARY = fixture()
def check(name, condition):
    if not condition: raise AssertionError(name)
    checks.append(name); print('PASS', name, flush=True)

with sync_playwright() as pw:
    kind = os.environ.get('VB6_BROWSER', 'chromium')
    browser_type = getattr(pw, kind)
    launch = {'headless': True}
    if kind == 'chromium':
        launch.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), args=['--no-sandbox'])
    browser = browser_type.launch(**launch)
    page = browser.new_page(accept_downloads=True, viewport={'width':1440,'height':1050})
    page.set_default_timeout(20000)
    downloads, errors, pending, requests = [], [], [], []
    mode = {'value':'success'}
    page.on('download', lambda download: downloads.append(download))
    page.on('pageerror', lambda error: errors.append(str(error)))
    headers = {'Access-Control-Allow-Origin':ORIGIN, 'Access-Control-Allow-Headers':'Authorization, Content-Type', 'Access-Control-Allow-Methods':'POST', 'Access-Control-Expose-Headers':'X-VB6-SHA256, X-VB6-Target', 'Access-Control-Allow-Private-Network':'true'}
    def compiler(route):
        request = route.request
        if request.method == 'OPTIONS': route.fulfill(status=204,headers=headers); return
        body = json.loads(request.post_data or '{}'); requests.append(body)
        if request.headers.get('authorization') != 'Bearer ' + TOKEN:
            route.fulfill(status=401,headers={**headers,'content-type':'application/json'},body=json.dumps({'error':{'message':'Bad fixture token'}})); return
        if body.get('method') == 'capabilities':
            route.fulfill(headers={**headers,'content-type':'application/json'},body=json.dumps({'result':{'version':1,'target':'classic-vb6','arch':'x86','runtime':'MSVBVM60.DLL','available':True,'timeout':1000}})); return
        if mode['value'] == 'hold': pending.append(route); return
        if mode['value'] == 'failure':
            route.fulfill(status=400,headers={**headers,'content-type':'application/json'},body=json.dumps({'error':{'message':'VB6 compiler failed (1).','compilerLog':'Fixture: missing registered control'}})); return
        route.fulfill(headers={**headers,'content-type':'application/vnd.microsoft.portable-executable','X-VB6-Target':'classic-vb6','X-VB6-SHA256':hashlib.sha256(BINARY).hexdigest()},body=BINARY)
    page.route(ORIGIN+'/**', lambda route: route.fulfill(content_type='text/html',body=(ROOT/'dist/VB6-Studio-Web.html').read_text()))
    page.route('http://127.0.0.1:8768/classic',compiler)
    try:
        if MEMORY:
            # Restricted local workbench cannot navigate HTTP. The alternate run is
            # labelled; CI keeps real browser fetch/Origin/WebCrypto contracts.
            page.expose_function('__classicTestDigest', lambda data:list(hashlib.sha256(bytes(data)).digest()))
            page.evaluate('''data => {
              globalThis.__classicFixture={mode:'success',pending:[],requests:[]};
              const fixture=globalThis.__classicFixture, nativeFetch=globalThis.fetch;
              if(!crypto.subtle) Object.defineProperty(crypto,'subtle',{value:{digest:async(_algorithm,bytes)=>new Uint8Array(await __classicTestDigest(Array.from(new Uint8Array(bytes.buffer||bytes,bytes.byteOffset||0,bytes.byteLength)))).buffer}});
              globalThis.fetch=async(url,options)=>{
                if(String(url)!=='http://127.0.0.1:8768/classic')return nativeFetch(url,options);
                options.signal?.throwIfAborted();const body=JSON.parse(options.body);fixture.requests.push(body);
                const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
                if(options.headers.Authorization!=='Bearer '+data.token)return json({error:{message:'Bad fixture token'}},401);
                if(body.method==='capabilities')return json({result:{version:1,target:'classic-vb6',arch:'x86',runtime:'MSVBVM60.DLL',available:true,timeout:1000}});
                if(fixture.mode==='failure')return json({error:{message:'VB6 compiler failed (1).',compilerLog:'Fixture: missing registered control'}},400);
                const success=()=>new Response(Uint8Array.from(atob(data.binary),c=>c.charCodeAt(0)),{headers:{'content-type':'application/vnd.microsoft.portable-executable','x-vb6-target':'classic-vb6','x-vb6-sha256':data.sha256}});
                if(fixture.mode==='hold')return new Promise((resolve,reject)=>{fixture.pending.push(()=>resolve(success()));options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});
                return success();
              };
            }''', {'token':TOKEN,'binary':base64.b64encode(BINARY).decode(),'sha256':hashlib.sha256(BINARY).hexdigest()})
            page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text(), wait_until='domcontentloaded', timeout=60000)
        else: page.goto(ORIGIN+'/', wait_until='commit', timeout=60000)
        # The installed export API is the startup oracle; feature actions keep 20 seconds.
        page.wait_for_function('!!globalThis.vb6Studio?.classicExportInstalled', timeout=60000)
        def save_archive(label, source_page=page):
            snapshot=source_page.evaluate('JSON.stringify(vb6Studio.project)')
            source_page.evaluate('void vb6Studio.command("exportClassic")')
            with source_page.expect_download() as downloaded:
                source_page.get_by_role('button',name='Download Build Archive',exact=True).click()
            target=OUT/(label+'-build.zip');downloaded.value.save_as(target)
            with zipfile.ZipFile(target) as zipped:
                check(label+' ZIP preserves exact project bytes and valid checksums',zipped.testzip() is None and zipped.read('project.vb6web').decode()==snapshot)
                manifest=json.loads(zipped.read('classic-build.json'))
                check(label+' ZIP records explicit uncompiled readiness',manifest['compiled'] is False and isinstance(manifest['buildable'],bool))
            check(label+' leaves a visible connected download link',source_page.get_by_role('link',name='Save ZIP: '+downloaded.value.suggested_filename,exact=True).is_visible())
            check(label+' does not mutate the project',source_page.evaluate('JSON.stringify(vb6Studio.project)')==snapshot)
            return target,manifest
        # Do not replace the shipped starter with a blank project before testing.
        starter,manifest=save_archive('starter')
        check('starter archive clearly reports native compilation blockers',manifest['buildable'] is False and any('StatusBar' in d['message'] for d in manifest['diagnostics']))
        # Ignore the automatic click once to simulate a browser declining it;
        # the retained, genuine user-click link must still download exact bytes.
        page.evaluate('''() => {const click=HTMLAnchorElement.prototype.click;HTMLAnchorElement.prototype.click=function(){if(this.download.endsWith('-vb6-build.zip'))return;return click.call(this);};globalThis.restoreArchiveClick=()=>HTMLAnchorElement.prototype.click=click;}''')
        page.get_by_role('button',name='Download Build Archive',exact=True).click()
        with page.expect_download() as retried:page.get_by_role('link',name='Save ZIP:',exact=False).click()
        retry=OUT/'starter-retry.zip';retried.value.save_as(retry)
        with zipfile.ZipFile(starter) as a, zipfile.ZipFile(retry) as b:
            check('visible link retries a suppressed automatic download without rebuilding data',a.namelist()==b.namelist() and all(a.read(n)==b.read(n) for n in a.namelist()))
        page.evaluate('void restoreArchiveClick()')
        page.get_by_label('Executable name',exact=True).focus();page.keyboard.press('Shift+Tab')
        check('Save ZIP link is reachable inside the modal keyboard focus trap',page.evaluate('document.activeElement.matches("[data-classic-download] a[download]")'))
        page.screenshot(path=str(OUT/'starter-archive-download.png'))
        page.get_by_role('button',name='Cancel',exact=True).click()
        for sample in page.evaluate('VB6StudioAPI.EXAMPLES.map(example=>example.id)'):
            page.evaluate('id=>vb6Studio.loadProject(VB6StudioAPI.EXAMPLES.find(example=>example.id===id).create())',sample)
            save_archive('sample-'+sample)
            page.get_by_role('button',name='Cancel',exact=True).click()
        check('all starter/sample archive downloads work without contacting a compiler',not requests and (not MEMORY or page.evaluate('__classicFixture.requests.length')==0))
        page.evaluate('vb6Studio.loadProject(VB6StudioAPI.newProject("RuntimeExport"))')
        check('AOT and Microsoft runtime commands remain independent',page.evaluate('vb6Studio.menu("File").some(i=>i?.id==="exportWin32"&&i.enabled)&&vb6Studio.menu("File").some(i=>i?.id==="exportClassic"&&i.enabled)'))
        before=page.evaluate('JSON.stringify(vb6Studio.project)')
        def dialog():
            page.evaluate('void vb6Studio.command("exportClassic")')
            page.get_by_role('dialog',name='Make Microsoft VB6 Runtime EXE').wait_for()
        dialog()
        page.get_by_label('Compilation mode',exact=True).select_option('pcode')
        page.screenshot(path=str(OUT/'runtime-export-dialog.png'))
        with page.expect_download() as downloaded: page.get_by_role('button',name='Download Build Archive',exact=True).click()
        archive=OUT/downloaded.value.suggested_filename;downloaded.value.save_as(archive)
        with zipfile.ZipFile(archive) as zipped:
            manifest=json.loads(zipped.read('classic-build.json'))
            check('UI P-code archive contains native source and uncompiled manifest',manifest['codegen']=='pcode' and manifest['compiled'] is False and b'CompilationType=1' in zipped.read('source/RuntimeExport.vbp'))
            script=OUT/'extracted-build.mjs';script.write_bytes(zipped.read('build.mjs'))
            check('UI archive build driver parses independently',subprocess.run(['node','--check',str(script)],capture_output=True).returncode==0)
        check('archive does not invoke bridge or edit project',not requests and before==page.evaluate('JSON.stringify(vb6Studio.project)'))
        page.get_by_role('button',name='Cancel',exact=True).click()
        dialog();page.get_by_label('Compiler bridge token',exact=True).fill(TOKEN)
        with page.expect_download() as downloaded:page.get_by_role('button',name='Build EXE',exact=True).click()
        executable=OUT/'fixture-not-runnable.exe';downloaded.value.save_as(executable)
        check('UI downloads verified protocol fixture as EXE',downloaded.value.suggested_filename=='RuntimeExport.exe' and executable.read_bytes()==BINARY)
        check('EXE report records external runtime and hash, not token',page.evaluate('vb6Studio.lastClassicBuild.compiled&&vb6Studio.lastClassicBuild.runtime==="MSVBVM60.DLL"&&vb6Studio.lastClassicBuild.pe.classicRuntimeImport') and TOKEN not in page.evaluate('JSON.stringify(vb6Studio.lastClassicBuild)'))
        check('successful build preserves project',before==page.evaluate('JSON.stringify(vb6Studio.project)'))
        mode['value']='failure'
        if MEMORY:page.evaluate('__classicFixture.mode="failure"')
        dialog();page.get_by_label('Compiler bridge token',exact=True).fill(TOKEN)
        count=len(downloads);page.get_by_role('button',name='Build EXE',exact=True).click()
        page.get_by_role('dialog').get_by_role('status').filter(has_text='Fixture: missing registered control').wait_for()
        check('compiler failure displays bounded log without downloading',len(downloads)==count and page.get_by_label('Compiler bridge token',exact=True).input_value()=='')
        page.get_by_role('button',name='Cancel',exact=True).click()
        mode['value']='hold'
        if MEMORY:page.evaluate('__classicFixture.mode="hold"')
        dialog();page.get_by_label('Compiler bridge token',exact=True).fill(TOKEN)
        page.get_by_role('button',name='Build EXE',exact=True).click()
        page.wait_for_function("""document.querySelector('input[aria-label="Compiler bridge token"]').value === ''""")
        # Wait for the build request (not only the capability response).
        for _ in range(100):
            if (page.evaluate('__classicFixture.pending.length') if MEMORY else len(pending)):break
            page.wait_for_timeout(10)
        check('compiler request is pending before cancellation',bool(page.evaluate('__classicFixture.pending.length') if MEMORY else pending))
        page.get_by_role('button',name='Cancel',exact=True).click()
        page.get_by_role('dialog',name='Make Microsoft VB6 Runtime EXE').wait_for(state='detached')
        try:
            if MEMORY:page.evaluate('__classicFixture.pending.pop()()')
            else:pending.pop().fulfill(headers={**headers,'content-type':'application/vnd.microsoft.portable-executable','X-VB6-Target':'classic-vb6','X-VB6-SHA256':hashlib.sha256(BINARY).hexdigest()},body=BINARY)
        except Exception: pass  # An aborted network request cannot be fulfilled.
        page.wait_for_timeout(100)
        check('Cancel stays usable during compilation and prevents late download',len(downloads)==count)
        dialog();check('reopened dialog does not retain secret',page.get_by_label('Compiler bridge token',exact=True).input_value()=='')
        page.get_by_role('button',name='Cancel',exact=True).click()
        page.evaluate('vb6Studio.runState="running"')
        check('runtime export is disabled while executing',page.evaluate('!vb6Studio.menu("File").find(i=>i?.id==="exportClassic").enabled'))
        page.evaluate('vb6Studio.runState="design";vb6Studio.project.settings.anchoring=true')
        _archive,manifest=save_archive('browser-layout')
        check('unsupported extension saves losslessly but remains blocked for compilation',manifest['buildable'] is False and page.get_by_role('dialog').get_by_role('status').inner_text().find('anchoring/auto-layout')>=0)
        count=len(downloads);page.get_by_role('button',name='Build EXE',exact=True).click()
        check('direct EXE still rejects unsupported layout',len(downloads)==count and page.get_by_role('dialog').get_by_role('status').inner_text().find('anchoring/auto-layout')>=0)
        page.get_by_role('button',name='Cancel',exact=True).click()
        # File-origin ZIP saving uses no fetch/crypto adapter or compiler bridge.
        if not MEMORY:
            local=browser.new_page(accept_downloads=True,viewport={'width':1440,'height':1050})
            local.on('pageerror',lambda error: errors.append(str(error)))
            local.goto((ROOT/'dist/VB6-Studio-Web.html').as_uri(), wait_until='commit', timeout=60000)
            local.wait_for_function('!!globalThis.vb6Studio?.classicExportInstalled', timeout=60000)
            save_archive('file-starter',local)
            local.get_by_role('button',name='Cancel',exact=True).click()
            local.evaluate('vb6Studio.loadProject(VB6StudioAPI.newProject("FileArchive"))')
            save_archive('file-blank',local)
            local.close()
        check('standalone IDE has no JavaScript errors',not errors)
    finally:
        (OUT/('browser-'+kind+'.json')).write_text(json.dumps({'browser':kind,'checks':checks,'errors':errors,'transport':'labelled in-memory fetch/SHA adapter' if MEMORY else 'HTTP origin and browser WebCrypto','compiler':'Synthetic protocol fixture only; no licensed compiler/runtime execution'},indent=2))
        browser.close()
