#!/usr/bin/env python3
"""Exercise compiler changes in the shipped runtime and actual IDE bundles.
No server or external requests. Run npm run build before this test.
"""
from __future__ import annotations
import json, os, shutil, subprocess, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]

def main():
    fixtures=json.loads(subprocess.check_output(['node',str(ROOT/'tools/language-browser-fixtures.mjs')],text=True))
    results=[]
    with sync_playwright() as p:
        executable=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium-browser')
        kwargs={'headless':True,'args':['--no-sandbox','--disable-dev-shm-usage']}
        if executable: kwargs['executable_path']=executable
        browser=p.chromium.launch(**kwargs)
        for mode in ['runtime','ide']:
            page=browser.new_page(viewport={'width':1280,'height':900})
            page.set_default_timeout(6000)
            errors=[];requests=[]
            page.on('pageerror',lambda error: errors.append(str(error)))
            page.route('**/*',lambda route:(requests.append(route.request.url),route.abort()))
            if mode=='runtime':
                page.set_content('<!doctype html><title>VB6 language validation</title>')
                page.add_script_tag(content=(ROOT/'dist/vb6-runtime.js').read_text())
            else:
                page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text())
                page.wait_for_function('typeof vb6Studio !== "undefined"')
            for fixture in fixtures:
                start=time.perf_counter()
                try:
                    if 'diagnostics' in fixture:
                        if mode=='runtime':
                            result=page.evaluate('project=>({diagnostics:VB6Runtime.RuntimeAPI.compileProject(project).diagnostics})',fixture['project'])
                        else:
                            page.evaluate('p=>vb6Studio.loadProject(p)',fixture['project'])
                            page.locator('[data-command="run"]').first.click()
                            page.wait_for_function("vb6Studio.statusMessage.textContent.includes('Build failed')")
                            result=page.evaluate("()=>({diagnostics:vb6Studio.diagnostics,state:vb6Studio.runState,output:vb6Studio.output,frame:!!vb6Studio.runtimeFrame?.isConnected})")
                            if result['state']!='design' or result['output'] or result['frame']: raise AssertionError(repr(result))
                        if len(result['diagnostics'])!=len(fixture['diagnostics']): raise AssertionError(repr(result))
                        for actual,expected in zip(result['diagnostics'],fixture['diagnostics']):
                            if any(actual.get(key)!=expected[key] for key in ['source','line','number']): raise AssertionError(repr(result))
                            if expected['message'] not in actual['message']: raise AssertionError(repr(result))
                            if 'code' in expected and actual.get('code')!=expected['code']: raise AssertionError(repr(result))
                    elif mode=='runtime' and fixture.get('host'):
                        result=page.evaluate('''async project=>{
                          const output=[],container=document.createElement('div');document.body.append(container);
                          const host=new VB6Runtime.RuntimeAPI.ApplicationHost(project,container,{persist:false,rendering:false,onMessage:m=>{if(m.type==='output')output.push(m.text);}});
                          try{await host.start();return {output,error:host.vm.lastError?.number??null};}
                          finally{host.dispose();container.remove();}
                        }''',fixture['project'])
                    elif mode=='runtime':
                        result=page.evaluate('''async project=>{
                          const api=VB6Runtime.RuntimeAPI,p=api.compileProject(project),output=[];
                          if(p.diagnostics.length)throw new Error(JSON.stringify(p.diagnostics));
                          const vm=new api.VirtualMachine(p,{print:s=>output.push(s)});await vm.start();
                          return {output,error:vm.lastError?.number??null};
                        }''',fixture['project'])
                    else:
                        # Compile/run the actual IDE project, not a second copy
                        # of the VM imported directly by this test harness.
                        page.evaluate('p=>vb6Studio.loadProject(p)',fixture['project'])
                        page.locator('[data-command="run"]').first.click()
                        page.wait_for_function('vb6Studio.runState !== "design"')
                        page.wait_for_function("vb6Studio.statusMessage.textContent.includes('startup instructions')")
                        frame=next((f for f in page.frames[1:] if f.evaluate('typeof vb6Application !== "undefined"')),None)
                        if frame is None: raise AssertionError('IDE runtime frame did not start')
                        result=frame.evaluate('''()=>({error:vb6Application.vm.lastError?.number??null})''')
                        # IDE debug output is forwarded to its Output tool.
                        result['output']=page.evaluate('vb6Studio.output')
                        page.locator('[data-command="stop"]').first.click()
                        page.wait_for_function('vb6Studio.runState === "design"')
                    if 'diagnostics' not in fixture:
                        if result['output']!=fixture['expected']: raise AssertionError(repr(result))
                        if result['error']!=fixture['error']: raise AssertionError(repr(result))
                    if errors or requests: raise AssertionError(repr({'errors':errors,'requests':requests}))
                    results.append({'name':mode+': '+fixture['name'],'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)})
                except Exception as error:
                    results.append({'name':mode+': '+fixture['name'],'passed':False,'error':str(error)})
                print(('PASS' if results[-1]['passed'] else 'FAIL')+' '+results[-1]['name'],flush=True)
            if mode=='ide':
                for backend in ['worker','fallback']:
                    name=backend+': semantic reuse, dependency invalidation and repair in actual IDE'
                    start=time.perf_counter()
                    try:
                        result=page.evaluate(r'''async backend=>{
                          const ide=vb6Studio,scheduler=ide.syntaxDiagnostics;
                          scheduler.cancel();scheduler.workerUnavailable=backend==='fallback';
                          ide.appearance.autoSyntaxCheck=true;
                          const project={...structuredClone(ide.project),name:'WorkerBounds',startup:'Sub Main',modules:[
                            {id:'consumer',name:'Consumer',kind:'module',code:'Sub Main()\nDim a(Size) As Long\nDebug.Print "must not run"\nEnd Sub'},
                            {id:'provider',name:'Provider',kind:'module',code:'Public Const Size = 3'}]};
                          const next=change=>new Promise((resolve,reject)=>{
                            const timeout=setTimeout(()=>{off();reject(new Error('No diagnostic response'));},5000);
                            const off=ide.on('diagnostics',r=>{clearTimeout(timeout);off();resolve(r);});
                            try{change();}catch(e){clearTimeout(timeout);off();reject(e);}
                          });
                          const responses=[];
                          responses.push(await next(()=>ide.loadProject(project)));
                          responses.push(await next(()=>scheduler.schedule(ide.project,0)));
                          responses.push(await next(()=>{ide.project.modules[1].code='Public Const Size = -1';scheduler.schedule(ide.project,0);}));
                          responses.push(await next(()=>{ide.project.modules[1].code='Public Const Size = 6';scheduler.schedule(ide.project,0);}));
                          responses.push(await next(()=>scheduler.schedule(ide.project,0)));
                          return {responses,state:ide.runState,output:ide.output};
                        }''',backend)
                        expected_valid=[True,True,False,True,True]
                        expected_hit=[False,True,False,False,True]
                        expected_parses=[2,0,1,1,0]
                        for i,response in enumerate(result['responses']):
                            if response['mode']!=backend or response['valid']!=expected_valid[i] or response['semanticCacheHit']!=expected_hit[i] or response['stats']['compiledModules']!=expected_parses[i]: raise AssertionError(repr(result))
                        diagnostic=result['responses'][2]['diagnostics'][0]
                        if diagnostic['source']!='Consumer' or diagnostic['line']!=2 or 'lower bound' not in diagnostic['message']: raise AssertionError(repr(result))
                        if result['state']!='design' or result['output'] or errors or requests: raise AssertionError(repr(result))
                        results.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)})
                    except Exception as error:
                        results.append({'name':name,'passed':False,'error':str(error)})
                    print(('PASS' if results[-1]['passed'] else 'FAIL')+' '+name,flush=True)
                for backend in ['worker','fallback']:
                    name=backend+': control metadata and source signatures invalidate semantic cache'
                    start=time.perf_counter()
                    try:
                        fixture=next(f for f in fixtures if f['name']=='Form control names bind from designer metadata')
                        result=page.evaluate(r'''async ({backend,project})=>{
                          const ide=vb6Studio,scheduler=ide.syntaxDiagnostics;
                          scheduler.cancel();scheduler.workerUnavailable=backend==='fallback';ide.appearance.autoSyntaxCheck=true;
                          const next=change=>new Promise((resolve,reject)=>{
                            const timeout=setTimeout(()=>{off();reject(new Error('No binding diagnostic response'));},5000);
                            const off=ide.on('diagnostics',r=>{clearTimeout(timeout);off();resolve(r);});
                            try{change();}catch(error){clearTimeout(timeout);off();reject(error);}
                          });
                          const responses=[];
                          responses.push(await next(()=>ide.loadProject(project)));
                          responses.push(await next(()=>scheduler.schedule(ide.project,0)));
                          responses.push(await next(()=>{ide.project.modules[0].form.controls[0].name='Renamed';scheduler.schedule(ide.project,0);}));
                          responses.push(await next(()=>{ide.project.modules[0].form.controls[0].name='Command1';scheduler.schedule(ide.project,0);}));
                          const source={...project,startup:'Sub Main',modules:[
                            {id:'caller',name:'Caller',kind:'module',code:'Option Explicit\nSub Main()\nHelper.Work\nEnd Sub'},
                            {id:'helper',name:'Helper',kind:'module',code:'Public Sub Work(Optional ByVal value As Long = 1)\nEnd Sub'}]};
                          responses.push(await next(()=>ide.loadProject(source)));
                          responses.push(await next(()=>{ide.project.modules[1].code='Public Sub Work(ByVal value As Long)\nEnd Sub';scheduler.schedule(ide.project,0);}));
                          responses.push(await next(()=>{ide.project.modules[1].code='Public Sub Work(Optional ByVal value As Long = 1)\nEnd Sub';scheduler.schedule(ide.project,0);}));
                          return {responses,state:ide.runState,output:ide.output};
                        }''',{'backend':backend,'project':fixture['project']})
                        expected_valid=[True,True,False,True,True,False,True]
                        expected_parses=[1,0,0,0,2,1,1]
                        for i,response in enumerate(result['responses']):
                            if response['mode']!=backend or response['valid']!=expected_valid[i] or response['stats']['compiledModules']!=expected_parses[i]: raise AssertionError(repr(result))
                            if response['semanticCacheHit']!=(i==1): raise AssertionError(repr(result))
                        for i,source,code in [(2,'Form1','VB_UNDEFINED_NAME'),(5,'Caller','VB_ARGUMENT_REQUIRED')]:
                            diagnostics=result['responses'][i]['diagnostics']
                            if len(diagnostics)!=1 or diagnostics[0]['source']!=source or diagnostics[0]['line']!=3 or diagnostics[0].get('code')!=code: raise AssertionError(repr(result))
                        if result['state']!='design' or result['output'] or errors or requests: raise AssertionError(repr(result))
                        results.append({'name':name,'passed':True,'milliseconds':round((time.perf_counter()-start)*1000,2)})
                    except Exception as error:
                        results.append({'name':name,'passed':False,'error':str(error)})
                    print(('PASS' if results[-1]['passed'] else 'FAIL')+' '+name,flush=True)
            page.close()
        version=browser.version;browser.close()
    report={'browser':version,'passed':sum(r['passed'] for r in results),'failed':sum(not r['passed'] for r in results),'tests':results}
    (ROOT/'reports').mkdir(exist_ok=True);(ROOT/'reports/browser-language-parity.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2));return int(report['failed']!=0)
if __name__=='__main__': sys.exit(main())
