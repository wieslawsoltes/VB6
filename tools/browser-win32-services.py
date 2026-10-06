#!/usr/bin/env python3
"""Exercise six actual VB6 samples through exports, IDE, SDK and worker packages."""
import json, os, threading
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
REPORT=ROOT/'reports/win32-services'
REPORT.mkdir(parents=True,exist_ok=True)
OFFLINE=os.environ.get('VB6_OFFLINE')=='1'
BROWSER=os.environ.get('BROWSER','chromium')
SAMPLES={
 'win32-files':['File: sample.txt','Size: 5','Matches: 1'],
 'win32-text':['UTF-16 units: 3','Base64: QcOp4oKs','ANSI: Aé€'],
 'win32-sync':['Wait-any: 1','Before release: 258','Wait-all: 0'],
 'win32-registry':['Values: 1','Name: Caption','Bytes: 5'],
 'win32-guid':['Parsed: {00112233-4455-6677-8899-AABBCCDDEEFF}','Version: 4'],
 'win32-properties':['Atom: VB6.Services.Tag','Stored: 42','Removed: 42']}
class Quiet(SimpleHTTPRequestHandler):
 def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(Quiet,directory=str(ROOT)))
threading.Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}'
results=[]
PROBE="""async library=>{
 const w=library.createWin32(),m=w.memory,k=(name,...args)=>w.invoke('kernel32',name,args);
 try{
 const source=m.alloc(5);m.bytes(source,5).set([65,240,159,152,128]);
 const size=k('MultiByteToWideChar',65001,8,source,5,0,0);
 const event=k('CreateEventA',0,0,0,'Browser.Ready'),pending=k('WaitForSingleObject',event,1000);
 let yielded=false;setTimeout(()=>{yielded=true;k('SetEvent',event);},0);
 const wait=await pending,reset=k('WaitForSingleObject',event,0);k('CloseHandle',event);
 const guid=m.alloc(16),created=w.invoke('ole32','CoCreateGuid',[guid]),version=m.bytes(guid,16)[7]>>4;
 m.free(guid);m.free(source);return {size,wait,reset,yielded,created,version,memory:m.used};
 }finally{w.dispose();}
}"""
def check(condition,message):
 if not condition: raise AssertionError(message)
def verify(page,sample):
 page.wait_for_function('globalThis.vb6Application?.vm?.state === "running"')
 page.wait_for_function("()=>document.querySelector('[data-control=lblStatus]')?.textContent.includes('Ready') && !vb6Application.vm.processing")
 before=page.evaluate('({memory:vb6Application.vm.win32.api.memory.used,handles:vb6Application.vm.win32.api.handles.entries.size})')
 for iteration in range(2):
  page.locator('[data-control="cmdRun"]').click()
  page.wait_for_function("n=>{const v=vb6Application.vm;return document.querySelector('[data-control=lblStatus]')?.textContent.includes('Completed '+n)&&!v.processing&&v.stack.length===0&&v.eventQueue.length===0;}",arg=iteration+1)
  output=page.locator('[data-control="txtOutput"] textarea').input_value()
  check(all(part in output for part in SAMPLES[sample]),f'{sample}: {output}')
  state=page.evaluate('({memory:vb6Application.vm.win32.api.memory.used,handles:vb6Application.vm.win32.api.handles.entries.size})')
  check(state==before,f'{sample}: leaked resources {before} -> {state}')
 check(page.evaluate('vb6Application.vm.lastError?.message||null') is None,'Unexpected VM error')
 return output
try:
 with sync_playwright() as p:
  engine=getattr(p,BROWSER);options={'headless':True}
  if BROWSER=='chromium':
   if os.environ.get('CHROMIUM_PATH'):options['executable_path']=os.environ['CHROMIUM_PATH']
   options['args']=['--no-sandbox']
  browser=engine.launch(**options)
  context=browser.new_context(viewport={'width':1080,'height':760});page=context.new_page();page.set_default_timeout(10000)
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  for origin in ['http','file']:
   for sample in SAMPLES:
    case=f'{origin}-export-{sample}'
    if OFFLINE and origin=='file':results.append({'case':case,'skipped':True,'reason':'Local navigation unavailable'});continue
    if OFFLINE:page.set_content((ROOT/f'dist/examples/{sample}.html').read_text());case=f'inline-export-{sample}'
    else:page.goto(base+f'/dist/examples/{sample}.html' if origin=='http' else (ROOT/f'dist/examples/{sample}.html').as_uri())
    output=verify(page,sample)
    if origin=='http':page.screenshot(path=str(REPORT/f'{sample}.png'))
    results.append({'case':case,'passed':True,'output':output})
  for sample in SAMPLES:
   if OFFLINE:page.set_content((ROOT/'dist/VB6-Studio-Web.html').read_text())
   else:page.goto(base+'/dist/index.html')
   page.wait_for_function('globalThis.vb6Studio')
   page.evaluate('project=>vb6Studio.loadProject(project)',json.loads((ROOT/f'examples/{sample}.vb6web').read_text()))
   page.locator('[data-command="run"]').first.click();page.wait_for_function('vb6Studio.runState !== "design"')
   output=verify(page.frames[1],sample)
   page.locator('[data-command="stop"]').first.click();page.wait_for_function('vb6Studio.runState === "design"')
   results.append({'case':('inline-' if OFFLINE else '')+f'ide-run-stop-{sample}','passed':True,'output':output})
  if OFFLINE:page.set_content('<!doctype html><html><body></body></html>');page.add_script_tag(content=(ROOT/'dist/win32-browser.js').read_text())
  else:page.goto(base+'/dist/index.html');page.add_script_tag(url=base+'/dist/win32-browser.js')
  expected={'size':3,'wait':0,'reset':258,'yielded':True,'created':0,'version':4,'memory':0}
  check(page.evaluate('('+PROBE+')(Win32Compat)')==expected,'Global library probe failed')
  results.append({'case':'independent-global-services','passed':True})
  if OFFLINE:
   results.extend([{'case':case,'skipped':True,'reason':'Local navigation unavailable'} for case in ['module-worker-services','runtime-sdk-services']])
  else:
   result=page.evaluate('''probe=>new Promise((resolve,reject)=>{const source="import * as api from '"+location.origin+"/packages/win32-browser/src/index.js';("+probe+")(api).then(result=>postMessage(result));";const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'})),worker=new Worker(url,{type:'module'});const finish=()=>{worker.terminate();URL.revokeObjectURL(url);};worker.onmessage=e=>{finish();resolve(e.data);};worker.onerror=e=>{finish();reject(new Error(e.message));};})''',PROBE)
   check(result==expected,'Module worker probe failed');results.append({'case':'module-worker-services','passed':True})
   result=page.evaluate('''async()=>{const api=await import('/src/runtime/entry.js'),project=await(await fetch('/examples/win32-text.vb6web')).json();document.body.replaceChildren();const host=await api.mountApplication(project,document.body,{persist:false});try{await host.vm.dispatch(host.forms[0].instance,'cmdRun_Click',[]);return document.querySelector('[data-control="txtOutput"] textarea').value;}finally{host.dispose();}}''')
   check(all(part in result for part in SAMPLES['win32-text']),'SDK sample failed');results.append({'case':'runtime-sdk-services','passed':True})
  check(not errors,str(errors));browser.close()
except Exception as error:
 results.append({'case':'execution','passed':False,'error':str(error)})
 raise
finally:
 server.shutdown();(REPORT/'results.json').write_text(json.dumps({'browser':BROWSER,'inline':OFFLINE,'results':results},indent=2)+'\n')
print(json.dumps(results,indent=2))
