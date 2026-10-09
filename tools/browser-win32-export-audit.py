#!/usr/bin/env python3
"""Audit every catalog sample through source, SDK, worker and actual IDE export.

This runs Chromium, never a generated EXE. An unsupported sample is recorded as
an export FAILURE even when all compiler interfaces agree on its diagnostic.
Exit 0 requires every sample to export; exit 1 includes unsupported samples;
exit 2 indicates an audit failure (mismatch, missing download, browser error).
Run `npm run build` first. Uses the repository's existing Playwright dependency.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NODE_CASES = r'''
import fs from 'node:fs/promises';
import {EXAMPLES} from './src/project/examples.js';
import {compileWin32} from './src/native/compiler.js';
import {nativeOptimizationLevel} from './src/native/optimizer.js';
import {nativeControlFixtures} from './tools/win32-control-fixtures.mjs';
import {createHash} from 'node:crypto';
const cases=[];
for(const item of EXAMPLES)cases.push({id:item.id,kind:'sample',project:JSON.parse(await fs.readFile('examples/'+item.id+'.vb6web','utf8'))});
for(const name of ['AotControlMath','AotControlRichErrors']){
 const fixture=nativeControlFixtures().find(f=>f.project.name===name);
 if(!fixture)throw new Error('Missing required native fixture: '+name);
 cases.push({id:name,kind:'fixture',project:fixture.project});
}
for(const item of cases){
 item.expected=[];
 for(const optimization of [0,1,2]){
  const before=JSON.stringify(item.project);
  try{
   const {bytes,report}=compileWin32(item.project,{optimization});
   item.expected.push({optimization,success:true,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),target:report.target,extraction:report.extraction});
  }catch(error){item.expected.push({optimization,success:false,error:error.message,diagnostics:error.diagnostics||[{severity:'error',message:error.message}]});}
  if(JSON.stringify(item.project)!==before)throw new Error('Source compiler mutated '+item.id);
 }
}
console.log(JSON.stringify({defaultOptimization:nativeOptimizationLevel(),cases}));
'''
COMPILE_JS = r'''({project,optimization})=>{
 const before=JSON.stringify(project);
 try{const {bytes,report}=VB6Native.compileWin32(project,{optimization});
  return {success:true,bytes:Array.from(bytes),target:report.target,extraction:report.extraction,mutated:before!==JSON.stringify(project)};
 }catch(error){return {success:false,error:error.message,diagnostics:error.diagnostics||[{severity:'error',message:error.message}],mutated:before!==JSON.stringify(project)};}
}'''
WORKER_JS = r'''async ({sdk,project,optimization,compile})=>{
 const source=sdk+'\nself.onmessage=e=>self.postMessage(('+compile+')(e.data));';
 const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url);
 try{return await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Native compiler worker timeout')),30000);
  worker.onmessage=e=>{clearTimeout(timer);resolve(e.data);};
  worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};
  worker.postMessage({project,optimization});
 });}finally{worker.terminate();URL.revokeObjectURL(url);}
}'''

def compare(actual: dict, expected: dict, label: str) -> dict:
    if actual.get('mutated'):
        raise AssertionError(label + ': compiler mutated project source')
    if actual.get('success') != expected['success']:
        raise AssertionError(label + ': compiler result differs from source compiler: ' + json.dumps(actual)[:1000])
    if not expected['success']:
        if actual.get('error') != expected['error'] or actual.get('diagnostics') != expected['diagnostics']:
            raise AssertionError(label + ': compiler diagnostics differ from source compiler')
        return {'success': False, 'error': actual['error'], 'matchesSource': True}
    data = bytes(actual['bytes'])
    digest = hashlib.sha256(data).hexdigest()
    if len(data) != expected['bytes'] or digest != expected['sha256'] or not data.startswith(b'MZ'):
        raise AssertionError(label + ': generated PE bytes differ from source compiler')
    if actual.get('target') != 'win32-aot' or actual.get('extraction') is not False:
        raise AssertionError(label + ': generated output is not no-extraction Win32 AOT')
    return {'success': True, 'bytes': len(data), 'sha256': digest, 'matchesSource': True}

def summarize(report: dict) -> int:
    """Only a complete parity matrix may be summarized; unsupported stays red."""
    samples = [r for r in report['cases'] if r['kind'] == 'sample']
    if not samples:
        raise AssertionError('Missing sample inventory')
    for case in report['cases']:
        if [e.get('optimization') for e in case['source']] != [0,1,2]:
            raise AssertionError('Incomplete or duplicated source optimization matrix')
        if any(len(case.get(interface, [])) != 3 for interface in ('sdk', 'worker')) or 'ide' not in case:
            raise AssertionError('Incomplete browser interface matrix')
        for interface in ('sdk', 'worker'):
            if any(not e.get('matchesSource') or e.get('success') != source['success']
                   for e, source in zip(case[interface], case['source'])):
                raise AssertionError('Compiler interfaces disagree')
        if not case['ide'].get('matchesSource') or case['ide'].get('success') != case['source'][report['defaultOptimization']]['success']:
            raise AssertionError('IDE export differs from source compiler')
    supported = sum(all(e['success'] for e in r['source']) for r in samples)
    report['samples'] = {'total':len(samples), 'exportable':supported, 'unsupported':len(samples)-supported}
    report['interfacesAgree'] = True
    report['allSamplesExport'] = supported == len(samples)
    return 0 if report['allSamplesExport'] else 1

def audit(output: Path) -> tuple[dict, int]:
    output.mkdir(parents=True, exist_ok=True)
    subprocess.run(['node', 'tools/ide-artifacts.mjs'], cwd=ROOT, check=True, capture_output=True, text=True)
    prepared = subprocess.run(['node', '--input-type=module', '-e', NODE_CASES], cwd=ROOT,
                              check=True, capture_output=True, text=True, timeout=180)
    plan = json.loads(prepared.stdout)
    sdk = (ROOT / 'dist/vb6-native.js').read_text()
    html = (ROOT / 'dist/VB6-Studio-Web.html').read_text()
    report = {'nativeExecution': False, 'defaultOptimization': plan['defaultOptimization'],
              'interfacesAgree': False, 'allSamplesExport': False, 'cases': [], 'pageErrors': [], 'networkRequests': []}
    try:
        from playwright.sync_api import sync_playwright
        downloads_directory = Path(tempfile.mkdtemp(prefix='downloads-', dir=output))
        report['downloadDirectory'] = downloads_directory.name
        with sync_playwright() as pw:
            browser = pw.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'),
                                         args=['--no-sandbox', '--disable-dev-shm-usage'])
            report['browser'] = browser.version
            context = browser.new_context(accept_downloads=True, offline=True, viewport={'width':1440,'height':960})
            context.on('page', lambda p: p.on('pageerror', lambda e: report['pageErrors'].append(str(e))))
            context.on('request', lambda r: report['networkRequests'].append(r.url) if r.url.startswith(('http:', 'https:')) else None)
            page = context.new_page()
            page.set_default_timeout(30000)
            page.add_script_tag(content=sdk)
            for case in plan['cases']:
                result = {'id': case['id'], 'kind': case['kind'], 'source': case['expected'], 'sdk': [], 'worker': []}
                report['cases'].append(result)
                print(datetime.now(timezone.utc).isoformat()+' CHECK '+case['id'], flush=True)
                for expected in case['expected']:
                    args = {'project':case['project'], 'optimization':expected['optimization']}
                    result['sdk'].append(compare(page.evaluate(COMPILE_JS, args), expected, f"{case['id']} SDK O{expected['optimization']}"))
                    result['worker'].append(compare(page.evaluate(WORKER_JS, {**args, 'sdk':sdk, 'compile':COMPILE_JS}), expected, f"{case['id']} worker O{expected['optimization']}"))
                # A fresh page avoids download throttling across repeated scripted
                # exports. Each action below is the real File-menu item click.
                ide = context.new_page()
                ide.set_default_timeout(30000)
                ide.set_content(html, wait_until='domcontentloaded')
                ide.wait_for_function('!!globalThis.vb6Studio?.project')
                ide.evaluate('p=>vb6Studio.loadProject(p)', case['project'])
                before = ide.evaluate('JSON.stringify(vb6Studio.project.modules)')
                downloads = []
                ide.on('download', lambda d: downloads.append(d))
                expected = case['expected'][plan['defaultOptimization']]
                ide.get_by_role('menubar', name='Main menu').get_by_role('menuitem', name='File', exact=True).click()
                if expected['success']:
                    with ide.expect_download() as pending:
                        ide.locator('.classic-menu [data-command="exportWin32"]').click()
                    downloaded = pending.value
                    filename = downloads_directory / (case['id'] + '.exe')
                    downloaded.save_as(filename)
                    build = ide.evaluate('vb6Studio.lastNativeBuild')
                    data = filename.read_bytes()
                    result['ide'] = compare({'success':True,'bytes':list(data),'target':build.get('target'),
                                             'extraction':build.get('extraction')}, expected, case['id']+' IDE')
                    result['ide']['downloadName'] = downloaded.suggested_filename
                    if len(downloads) != 1 or not downloaded.suggested_filename.lower().endswith('.exe'):
                        raise AssertionError(case['id'] + ': missing, extra or incorrectly named download')
                else:
                    ide.locator('.classic-menu [data-command="exportWin32"]').click()
                    ide.wait_for_function('Array.isArray(vb6Studio.lastNativeBuild?.diagnostics)')
                    # Flush browser tasks before asserting that no download was initiated.
                    ide.evaluate('()=>new Promise(resolve=>setTimeout(resolve,100))')
                    diagnostics = ide.evaluate('vb6Studio.lastNativeBuild.diagnostics')
                    if downloads or diagnostics != expected['diagnostics']:
                        raise AssertionError(case['id'] + ': failed build downloaded bytes or changed its diagnostics')
                    result['ide'] = {'success':False,'error':expected['error'],'matchesSource':True,'downloads':0}
                if ide.evaluate('JSON.stringify(vb6Studio.project.modules)') != before:
                    raise AssertionError(case['id'] + ': IDE export changed authored modules')
                ide.close()
                (output/'audit.json').write_text(json.dumps(report, indent=2)+'\n')
                print(('EXPORT' if expected['success'] else 'UNSUPPORTED')+' '+case['id']+': source, SDK, worker and IDE agree', flush=True)
            context.close()
            browser.close()
        if report['pageErrors'] or report['networkRequests']:
            raise AssertionError('Browser audit produced page errors or attempted external network requests')
        status = summarize(report)
        return report, status
    except Exception as error:
        report['auditError'] = str(error)
        return report, 2
    finally:
        (output/'audit.json').write_text(json.dumps(report, indent=2)+'\n')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT/'reports/native-export-browser')
    args = parser.parse_args()
    try:
        result, status = audit(args.output.resolve())
    except Exception as error:
        result, status = {'nativeExecution':False,'interfacesAgree':False,'allSamplesExport':False,'auditError':str(error)}, 2
    print(json.dumps({k:v for k,v in result.items() if k not in ('cases',)}, indent=2), flush=True)
    raise SystemExit(status)
