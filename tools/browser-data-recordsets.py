#!/usr/bin/env python3
"""Run compatibility VB code through the actual bundled/exported browser runtime."""
import argparse
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'reports/data-sources'
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument('--browser', choices=['chromium', 'firefox', 'webkit'], default='chromium')
args = parser.parse_args()
code = '''Option Explicit
Sub Main()
 Dim cn As New ADODB.Connection, rs As New ADODB.Recordset, other As ADODB.Recordset
 cn.Open "Provider=SQLite;Data Source=:memory:"
 cn.Execute "CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT)"
 cn.Execute "INSERT INTO t VALUES(1,'Old'),(2,'Second')"
 rs.Open "t", cn, adOpenStatic, adLockBatchOptimistic, adCmdTable
 rs.Fields("name").Value = "New"
 rs.Update
 Debug.Print rs.Fields("name").OriginalValue
 Set other = rs.Clone(adLockReadOnly)
 Debug.Print other.Fields("name").Value
 rs.UpdateBatch
 Debug.Print rs.Status
 rs.MoveNext
 rs.Delete
 Debug.Print rs.Status
 rs.CancelBatch
 rs.MoveLast
 Debug.Print rs.Fields("name").Value
 rs.Close
 Debug.Print other.Fields("name").Value
 cn.Close
End Sub'''
with sync_playwright() as pw:
    launch = {'headless': True}
    if args.browser == 'chromium':
        launch['args'] = ['--no-sandbox']
        if os.environ.get('CHROMIUM_PATH'):
            launch['executable_path'] = os.environ['CHROMIUM_PATH']
    browser = getattr(pw, args.browser).launch(**launch)
    try:
        page = browser.new_page()
        errors, requests = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('request', lambda request: requests.append(request.url))
        page.set_content((ROOT/'dist/examples/sqlite-customers.html').read_text())
        page.wait_for_function('globalThis.vb6Application?.forms.length && vb6Application.vm.data')
        output = page.evaluate('''async code => {
          const api=VB6Runtime.RuntimeAPI;
          const project={schema:1,name:'BatchBrowser',startup:'Sub Main',modules:[{id:'module',name:'MainModule',kind:'module',code}]};
          const program=api.compileProject(project);
          if(program.diagnostics.length)throw new Error(JSON.stringify(program.diagnostics));
          const output=[],vm=new api.VirtualMachine(program,{print:value=>output.push(value)});
          try{await vm.start();return output;}finally{await vm.data.close();}
        }''', code)
        assert output == ['Old','New','0','4','Second','New'], output
        dao_output = page.evaluate('''async code => {
          const api=VB6Runtime.RuntimeAPI,project={schema:1,name:'DaoBrowser',startup:'Sub Main',modules:[{id:'module',name:'MainModule',kind:'module',code}]};
          const program=api.compileProject(project);if(program.diagnostics.length)throw new Error(JSON.stringify(program.diagnostics));
          const output=[],vm=new api.VirtualMachine(program,{print:value=>output.push(value)});
          try{await vm.start();return output;}finally{await vm.data.close();}
        }''', (ROOT/'tests/fixtures/dao-compat.bas').read_text())
        assert dao_output == ['2','Original','Changed','Changed','Changed'], dao_output
        assert not errors, errors
        assert not requests, requests
        result={'browser':args.browser,'passed':True,'output':output,'daoOutput':dao_output,'networkRequests':len(requests)}
        (OUT/f'recordsets-{args.browser}.json').write_text(json.dumps(result,indent=2))
        print('PASS exported ADO/DAO runtime, batch/clones, explicit Edit, QueryDefs, default/bang syntax:', args.browser)
    finally:
        browser.close()
