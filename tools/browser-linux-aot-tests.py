#!/usr/bin/env python3
"""Exercise actual offline Linux AOT downloads and export-session lifecycle."""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import zipfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports' / 'linux-aot-browser'
OUT.mkdir(parents=True, exist_ok=True)
ENGINE = os.environ.get('VB6_BROWSER', 'chromium')
ORIGIN = 'http://127.0.0.1:8080'
fixtures = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', '''
import {linuxBrowserProject} from './tests/linux-browser-fixture.mjs';
console.log(JSON.stringify(Object.fromEntries(['gtk3','gtk4'].map(toolkit=>[toolkit,Object.fromEntries(['x64','arm64'].map(architecture=>[architecture,linuxBrowserProject(architecture,toolkit)]))]))));
'''], cwd=ROOT))
fixture = fixtures['gtk3']['x64']
checks, errors, outputs = [], [], []

def check(name, condition):
    if not condition:
        raise AssertionError(name)
    checks.append(name)
    print('PASS', name, flush=True)

def verify(file, architecture='x64', format='zip', toolkit='gtk3'):
    subprocess.run(['node', '--input-type=module', '-e', '''
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {exportLinuxDistribution,verifyLinuxAOTArchive} from './packages/linux-native/src/index.js';
import {linuxBrowserProject} from './tests/linux-browser-fixture.mjs';
const actual = fs.readFileSync(process.argv[1]);
const architecture=process.argv[2],format=process.argv[3],toolkit=process.argv[4];
const expected = await exportLinuxDistribution(linuxBrowserProject(architecture,toolkit),{architecture,toolkit},{format});
assert.deepEqual(new Uint8Array(actual),expected.bytes);
if(format==='zip')await verifyLinuxAOTArchive(actual,{name:'LinuxBrowser',architecture,toolkit});
''', str(file), architecture, format, toolkit], cwd=ROOT, check=True, timeout=90)
    if format != 'zip':
        check(file.name + ': exact offline package bytes', True)
        return
    with zipfile.ZipFile(file) as archive:
        info = archive.getinfo('LinuxBrowser/bin/LinuxBrowser')
        elf = archive.read(info)
        check(file.name + ': ELF64 ' + architecture + ' and executable permissions',
              elf[:5] == b'\x7fELF\x02' and int.from_bytes(elf[18:20], 'little') == (183 if architecture == 'arm64' else 62)
              and ((info.external_attr >> 16) & 0o111) == 0o111)

with sync_playwright() as pw:
    launch = {'headless': True}
    if ENGINE == 'chromium':
        launch.update(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), args=['--no-sandbox'])
    browser = getattr(pw, ENGINE).launch(**launch)
    try:
        for origin in ('http', 'file'):
            context = browser.new_context(accept_downloads=True, viewport={'width': 1365, 'height': 1000})
            page = context.new_page()
            page.set_default_timeout(60000)
            downloads, requests = [], []
            page.on('download', lambda item: downloads.append(item))
            page.on('pageerror', lambda error: errors.append(str(error)))
            if origin == 'http':
                page.route(ORIGIN + '/**', lambda route: route.fulfill(content_type='text/html', body=(ROOT/'dist/VB6-Studio-Web.html').read_text()))
            # Use actual IDE readiness for both origins; WebKit file navigation
            # can keep its load event pending after the application is usable.
            page.goto(ORIGIN + '/' if origin == 'http' else (ROOT/'dist/VB6-Studio-Web.html').as_uri(), wait_until='commit')
            page.wait_for_function('!!globalThis.vb6Studio?.linuxExportInstalled')
            page.evaluate('project => vb6Studio.loadProject(VB6StudioAPI.normalizeProject(project))', fixture)
            before = page.evaluate('JSON.stringify(vb6Studio.project)')
            page.on('request', lambda request: requests.append(request.url) if request.url.startswith(('http:', 'https:')) else None)
            check(origin + ': native compiler API and File menu target installed', page.evaluate('''() =>
              typeof VB6StudioAPI.compileLinuxAOT === 'function' &&
              typeof VB6StudioAPI.exportLinuxApplication === 'function' &&
              vb6Studio.menu('File').some(item => item?.id === 'exportLinux' && item.enabled)
            '''))

            def open_dialog():
                page.evaluate('void vb6Studio.command("exportLinux")')
                page.get_by_role('dialog', name='Make Linux GTK Application').wait_for()

            def close_dialog():
                page.get_by_role('button', name='Close', exact=True).click()
                page.get_by_role('dialog', name='Make Linux GTK Application').wait_for(state='detached')

            page.evaluate('vb6Studio.project.name = "x".repeat(300)')
            open_dialog()
            check(origin + ': an invalid initial name leaves the dialog usable', 'Invalid Linux application name' in page.get_by_role('dialog', name='Make Linux GTK Application').get_by_role('status').inner_text())
            close_dialog()
            page.evaluate('project => vb6Studio.loadProject(VB6StudioAPI.normalizeProject(project))', fixture)

            open_dialog()
            page.get_by_role('button', name='Export Linux Application', exact=True).click()
            page.wait_for_function('vb6Studio.lastLinuxBuild?.compiled === true || vb6Studio.lastLinuxBuild?.success === false', timeout=90000)
            state = page.evaluate('vb6Studio.lastLinuxBuild')
            check(origin + ': direct native export succeeded', state.get('compiled') is True and state.get('codegen') == 'x86_64-aot')
            page.get_by_role('status').filter(has_text='Native Linux zip ready').wait_for()
            if downloads:
                downloaded = downloads[-1]
            else:
                with page.expect_download(timeout=30000) as item:
                    page.get_by_role('link', name='Save ZIP: LinuxBrowser-linux-x64.zip').click()
                downloaded = item.value
            file = OUT / (ENGINE + '-' + origin + '.zip')
            downloaded.save_as(file)
            check(origin + ': application archive filename', downloaded.suggested_filename == 'LinuxBrowser-linux-x64.zip')
            verify(file)
            outputs.append({'file': file.name, 'architecture': 'x64', 'toolkit': 'gtk3', 'format': 'zip', 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
            check(origin + ': export preserves project and uses no network', page.evaluate('JSON.stringify(vb6Studio.project)') == before and not requests)
            page.screenshot(path=str(OUT/(ENGINE+'-'+origin+'.png')))

            page.get_by_label('Linux application name', exact=True).fill('../invalid')
            page.get_by_label('Linux application name', exact=True).dispatch_event('change')
            count = len(downloads)
            page.get_by_role('button', name='Export Linux Application', exact=True).click()
            page.wait_for_function('vb6Studio.lastLinuxBuild?.success === false')
            check(origin + ': invalid name has diagnostics and no stale download', len(downloads) == count and page.locator('[data-linux-download] a').count() == 0)
            close_dialog()

            for toolkit in ('gtk3', 'gtk4'):
                for architecture in ('x64', 'arm64'):
                    page.evaluate('project => vb6Studio.loadProject(VB6StudioAPI.normalizeProject(project))', fixtures[toolkit][architecture])
                    open_dialog()
                    page.get_by_label('Linux architecture', exact=True).select_option(architecture)
                    page.get_by_label('Linux GTK toolkit', exact=True).select_option(toolkit)
                    for format in ('zip', 'tar.gz', 'deb', 'rpm'):
                        if toolkit == 'gtk3' and architecture == 'x64' and format == 'zip':
                            continue
                        page.get_by_label('Linux package format', exact=True).select_option(format)
                        page.evaluate('delete vb6Studio.lastLinuxBuild')
                        count = len(downloads)
                        page.get_by_role('button', name='Export Linux Application', exact=True).click()
                        page.wait_for_function('vb6Studio.lastLinuxBuild?.compiled === true || vb6Studio.lastLinuxBuild?.success === false', timeout=90000)
                        state = page.evaluate('vb6Studio.lastLinuxBuild')
                        check(origin + ': ' + toolkit + ' ' + architecture + ' ' + format + ' native export', state.get('compiled') is True and state.get('toolkit') == toolkit and state.get('codegen') == ('arm64-aot' if architecture == 'arm64' else 'x86_64-aot') and state.get('distribution', {}).get('format') == format)
                        if len(downloads) > count:
                            downloaded = downloads[-1]
                        else:
                            with page.expect_download(timeout=30000) as item:
                                page.locator('[data-linux-download] a').click()
                            downloaded = item.value
                        file = OUT / (ENGINE + '-' + origin + '-' + architecture + ('-gtk4' if toolkit == 'gtk4' else '') + '.' + format)
                        downloaded.save_as(file)
                        expected = ('LinuxBrowser-linux-' + architecture + ('-gtk4' if toolkit == 'gtk4' else '') + '.' + format) if format in ('zip', 'tar.gz') else (
                            'linuxbrowser_1.0.0-1_' + ('arm64' if architecture == 'arm64' else 'amd64') + '.deb' if format == 'deb' else
                            'linuxbrowser-1.0.0-1.' + ('aarch64' if architecture == 'arm64' else 'x86_64') + '.rpm')
                        check(origin + ': ' + toolkit + ' ' + architecture + ' ' + format + ' filename', downloaded.suggested_filename == expected)
                        verify(file, architecture, format, toolkit)
                        outputs.append({'file': file.name, 'architecture': architecture, 'toolkit': toolkit, 'format': format, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
                    close_dialog()
            page.evaluate('project => vb6Studio.loadProject(VB6StudioAPI.normalizeProject(project))', fixture)
            check(origin + ': all toolkit, architecture and package exports remain offline', not requests)

            # Delay an actual digest, keeping the real algorithm and output intact.
            # This makes close and stale-revision races reproducible in every engine.
            page.evaluate('''() => {
              const subtle = crypto.subtle, digest = subtle.digest.bind(subtle);
              globalThis.__linuxDigest = {hold: false, pending: null};
              subtle.digest = (...args) => {
                if (!__linuxDigest.hold) return digest(...args);
                __linuxDigest.hold = false;
                return new Promise((resolve, reject) => {
                  __linuxDigest.pending = () => {__linuxDigest.pending = null; digest(...args).then(resolve, reject);};
                });
              };
            }''')
            for action in ('change', 'close'):
                open_dialog()
                page.evaluate('delete vb6Studio.lastLinuxBuild; __linuxDigest.hold = true')
                count = len(downloads)
                page.get_by_role('button', name='Export Linux Application', exact=True).click()
                page.wait_for_function('!!__linuxDigest.pending')
                if action == 'change':
                    page.evaluate('vb6Studio.project.modules[0].code += "\\n\'changed during export"')
                else:
                    close_dialog()
                page.evaluate('__linuxDigest.pending()')
                if action == 'change':
                    page.wait_for_function('vb6Studio.lastLinuxBuild?.success === false')
                    check(origin + ': stale project rejected', 'changed' in page.get_by_role('dialog', name='Make Linux GTK Application').get_by_role('status').inner_text().lower())
                    close_dialog()
                else:
                    # A microtask and two frames cover publication after the digest.
                    page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                check(origin + ': ' + action + ' prevents artifact publication', len(downloads) == count and page.locator('[data-linux-download] a').count() == 0)
                page.evaluate('project => vb6Studio.loadProject(VB6StudioAPI.normalizeProject(project))', fixture)

            page.evaluate('vb6Studio.runState="running"; void vb6Studio.command("exportLinux")')
            check(origin + ': export disabled while running', page.get_by_role('dialog', name='Make Linux GTK Application').count() == 0 and page.evaluate('vb6Studio.menu("File").find(item=>item?.id==="exportLinux").enabled') is False)
            page.evaluate('vb6Studio.runState="design"')
            context.close()
        check('no browser exceptions', not errors)
    finally:
        browser.close()
        (OUT/(ENGINE+'-validation.json')).write_text(json.dumps({'browser': ENGINE, 'checks': checks, 'errors': errors, 'outputs': outputs}, indent=2) + '\n')
