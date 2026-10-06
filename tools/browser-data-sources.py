#!/usr/bin/env python3
"""Actual Chromium UI and exported-app data tests. Local HTTP service; no public API dependency."""
from pathlib import Path
import json, os, shutil, subprocess, time, traceback, urllib.request, re, hashlib, base64, html
from playwright.sync_api import sync_playwright, expect
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'reports/data-sources';OUT.mkdir(parents=True,exist_ok=True)
RESULTS=[]
def check(value,message='Assertion failed'):
    if not value: raise AssertionError(message)
def case(name,fn):
    try: fn(); RESULTS.append({'name':name,'passed':True}); print('PASS',name,flush=True)
    except Exception as e: RESULTS.append({'name':name,'passed':False,'error':str(e)}); print('FAIL',name,str(e),flush=True); traceback.print_exc(limit=2)
def page_for(browser,name=None):
    p=browser.new_page(viewport={'width':1440,'height':960});p.set_default_timeout(8000);p.errors=[];p.requests=[]
    p.on('pageerror',lambda e:p.errors.append(str(e)));p.on('request',lambda r:p.requests.append(r.url))
    p.set_content((ROOT/('dist/examples/'+name+'.html' if name else 'dist/VB6-Studio-Web.html')).read_text())
    p.wait_for_function('globalThis.vb6Application?.forms[0]' if name else 'globalThis.vb6Studio')
    return p
def count(p): return p.evaluate('vb6Application.forms[0].controlMap.get("data1").Recordset.RecordCount')
def ready(p,n): p.wait_for_function('(n)=>vb6Application.forms[0].controlMap.get("data1").Recordset.State===1 && vb6Application.forms[0].controlMap.get("data1").Recordset.RecordCount===n',arg=n)
def healthy(p): check(not p.errors,str(p.errors))
def button(p,name): return p.locator('[data-control="'+name+'"]')
server=subprocess.Popen(['node',str(ROOT/'tools/data-example-server.mjs')],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
try:
    for i in range(100):
        try:
            urllib.request.urlopen('http://127.0.0.1:4286/customers',timeout=.2).close();break
        except Exception: time.sleep(.05)
    else: raise RuntimeError('Example HTTP server did not start')
    with sync_playwright() as pw:
        exe=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or pw.chromium.executable_path
        browser=pw.chromium.launch(executable_path=exe,args=['--no-sandbox'])
        def sqlite():
            p=page_for(browser,'sqlite-customers');ready(p,2)
            p.locator('[data-control="txtName"] input').fill('Saved from textbox');button(p,'cmdSave').click();button(p,'cmdLoad').click()
            p.wait_for_function('vb6Application.forms[0].controlMap.get("txtname").Text==="Saved from textbox"')
            button(p,'cmdNew').click();ready(p,3)
            # RecordCount changes before the queued control repaint. Assert the
            # actual visible value with polling, not a snapshot of the old frame.
            expect(p.locator('[data-control="txtName"] input')).to_have_value('New customer')
            button(p,'cmdDelete').click();ready(p,2)
            p.get_by_role('button',name='MoveFirst',exact=True).click();p.wait_for_function('vb6Application.forms[0].controlMap.get("txtname").Text==="Saved from textbox"')
            # A new app host reopens the real SQLite bytes, not a cached recordset.
            result=p.evaluate('''async()=>{const api=VB6Runtime.RuntimeAPI;const data=new api.DataContext({vfs:vb6Application.vm.fs.snapshot()});const cn=data.connection();await cn.Open('Provider=SQLite;Data Source=/customers.sqlite');const rs=await cn.Execute('SELECT name FROM customers ORDER BY id');const value=rs.Item('name');await data.close();return value;}''')
            check(result=='Saved from textbox',result);check(not p.requests,'Offline app requested a network resource: '+str(p.requests));healthy(p);p.screenshot(path=str(OUT/'sqlite-app.png'));p.close()
        case('Offline exported SQLite app: bound edit, save, reload, add, delete and binary database reopen',sqlite)
        def strict_csp():
            source=(ROOT/'dist/examples/sqlite-customers.html').read_text()
            scripts=re.findall(r'<script\b[^>]*>([\s\S]*?)</script\s*>',source,re.I)
            hashes=' '.join("'sha256-"+base64.b64encode(hashlib.sha256(code.encode()).digest()).decode()+"'" for code in scripts)
            policy=subprocess.check_output(['node','-e',"process.stdout.write(require('./desktop/policy.cjs').dataCSP())"],cwd=ROOT,text=True)
            policy=policy.replace("script-src 'self'", "script-src 'self' "+hashes)
            source=source.replace('<head>','<head><meta http-equiv="Content-Security-Policy" content="'+html.escape(policy,quote=True)+'">',1)
            p=browser.new_page();p.set_content(source)
            # Playwright wait_for_function uses eval, which this CSP intentionally rejects.
            for _ in range(100):
                if p.evaluate('globalThis.vb6Application?.forms[0]?.controlMap.get("data1").Recordset.RecordCount===2'): break
                time.sleep(.05)
            else: raise AssertionError('SQLite app did not start under strict CSP')
            check(p.evaluate('vb6Application.forms[0].controlMap.get("txtname").Text')=='Ada Lovelace')
            p.close()
        case('SQLite executes under packaged-app CSP without JavaScript unsafe-eval',strict_csp)

        def rest():
            p=page_for(browser,'rest-customers');button(p,'cmdLoad').click();ready(p,3)
            p.locator('[data-control="txtName"] input').fill('HTTP saved');button(p,'cmdSave').click();p.wait_for_timeout(100);button(p,'cmdLoad').click();ready(p,3)
            p.wait_for_function('vb6Application.forms[0].controlMap.get("txtname").Text==="HTTP saved"')
            button(p,'cmdNew').click();ready(p,4);button(p,'cmdDelete').click();ready(p,3)
            check(any('/customers?' in u for u in p.requests),'Paging requests missing')
            p.get_by_role('button',name='MoveFirst',exact=True).click()
            row=json.load(urllib.request.urlopen('http://127.0.0.1:4286/customers/1'))
            req=urllib.request.Request('http://127.0.0.1:4286/customers/1',method='PATCH',data=json.dumps({'name':'External writer'}).encode(),headers={'Content-Type':'application/json','If-Match':row['etag']})
            urllib.request.urlopen(req).close()
            p.locator('[data-control="txtName"] input').fill('Stale edit');button(p,'cmdSave').click();p.locator('.vb-modal-shade').wait_for()
            # The modal can appear before the deferred label repaint completes.
            # Keep the exact error contract, but wait for its visible rendering.
            expect(button(p,'lblStatus')).to_contain_text('3197')
            check(json.load(urllib.request.urlopen('http://127.0.0.1:4286/customers/1'))['name']=='External writer')
            p.locator('.vb-modal-shade button').last.click();healthy(p);p.screenshot(path=str(OUT/'rest-app.png'));p.close()
        case('Exported REST app: real HTTP paging, writes, delete and ETag conflict rejects lost updates',rest)
        def graph():
            p=page_for(browser,'graphql-customers');button(p,'cmdLoad').click();ready(p,2)
            button(p,'cmdLoad').click();ready(p,2)
            result=p.evaluate('''async()=>{const cn=vb6Application.vm.data.connection();await cn.Open('OData');const rs=await cn.Execute('');const count=rs.RecordCount;await cn.Close();return count;}''')
            check(result==3,result);healthy(p);p.close()
        case('Exported GraphQL command: typed variables, repeat execution and live OData next-link paging',graph)
        def public_mapping():
            p=browser.new_page();p.route('https://jsonplaceholder.typicode.com/users',lambda route:route.fulfill(json=[{'id':7,'name':'Fixture user','email':'fixture@example.test','address':{'city':'Warsaw'},'company':{'name':'Fixture company'}}],headers={'Access-Control-Allow-Origin':'*'}))
            p.set_content((ROOT/'dist/examples/rest-public-users.html').read_text());p.wait_for_function('globalThis.vb6Application?.forms[0]');button(p,'cmdLoad').click();ready(p,1)
            row=p.evaluate('vb6Application.forms[0].controlMap.get("data1").Recordset.Item("city")');check(row=='Warsaw');check(p.locator('[data-control="txtName"] input').get_attribute('readonly') is not None);p.close()
        case('Public REST example: nested field mapping against deterministic browser HTTP fixture',public_mapping)
        def designer():
            p=page_for(browser);p.evaluate('vb6Studio.command("dataEnvironment")')
            root=p.locator('.data-environment');root.get_by_role('button',name='Add Connection',exact=True).click()
            modal=p.locator('.modal-shade').last if p.locator('.modal-shade').count() else p.locator('[role=dialog]').last
            p.get_by_role('tab',name='Connection',exact=True).click();p.get_by_label('Connection name',exact=True).fill('UITest');p.get_by_label('Data source',exact=True).fill('/ui.sqlite')
            p.get_by_role('tab',name='All',exact=True).click();check('UITest' in p.locator('textarea[readonly]').last.input_value())
            p.get_by_role('button',name='OK',exact=True).last.click();p.wait_for_function('vb6Studio.project.dataSources.connections.some(c=>c.name==="UITest")')
            for sql,expected in [('CREATE TABLE checks(id INTEGER PRIMARY KEY, name TEXT)','0 records'),("INSERT INTO checks VALUES(1,'Classic UI')",'1 affected'),('SELECT * FROM checks','1 records')]:
                root.get_by_label('SQL statement or REST resource',exact=True).fill(sql);root.get_by_role('button',name='Execute',exact=True).click();p.wait_for_function('(text)=>document.querySelector(".data-environment .tool-status").textContent.includes(text)',arg=expected)
            check('Classic UI' in root.get_by_label('Data preview',exact=True).inner_text())
            root.get_by_role('button',name='Add Command',exact=True).click();p.get_by_label('Command name',exact=True).fill('GetChecks');p.get_by_label('Command text',exact=True).fill('SELECT * FROM checks');p.get_by_role('button',name='OK',exact=True).last.click();p.wait_for_function('vb6Studio.project.dataSources.commands.some(c=>c.name==="GetChecks")')
            root.get_by_role('button',name='Add Connection',exact=True).click();p.get_by_role('tab',name='Advanced',exact=True).click();p.get_by_label('Public HTTP headers',exact=True).fill('{"Authorization":"not-a-real-token"}');p.get_by_role('button',name='OK',exact=True).last.click();p.wait_for_timeout(100)
            check('not-a-real-token' not in p.evaluate('JSON.stringify(vb6Studio.project)'));p.get_by_role('button',name='OK',exact=True).last.click();p.get_by_role('button',name='Cancel',exact=True).last.click()
            root.get_by_role('treeitem',name='UITest',exact=True).click();root.get_by_role('button',name='Properties',exact=True).click();p.screenshot(path=str(OUT/'data-link-properties.png'));p.get_by_role('button',name='Cancel',exact=True).last.click();healthy(p);p.close()
        case('Classic Data Environment: add connection, SQL preview, command properties, credential rejection and Cancel',designer)
        browser.close()
finally:
    server.terminate()
    try:server.wait(timeout=5)
    except subprocess.TimeoutExpired:server.kill();server.wait()
    (OUT/'browser-results.json').write_text(json.dumps({'tests':RESULTS,'passed':sum(r['passed'] for r in RESULTS),'total':len(RESULTS)},indent=2))
raise SystemExit(0 if RESULTS and all(r['passed'] for r in RESULTS) else 1)
