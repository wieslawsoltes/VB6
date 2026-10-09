import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('browser native export audit keeps unsupported samples red and rejects mismatched or partial matrices',()=>{
 const python=process.env.PYTHON||'python';
 const result=spawnSync(python,['-c',String.raw`
import copy, hashlib, importlib.util
from pathlib import Path
spec=importlib.util.spec_from_file_location('audit',Path('tools/browser-win32-export-audit.py'))
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)
data=b'MZ\x00\x00'
expected={'optimization':0,'success':True,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
actual={'success':True,'bytes':list(data),'target':'win32-aot','extraction':False}
assert audit.compare(actual,expected,'test')['matchesSource']
for delta in [{'bytes':[77,90,1,0]},{'target':'electron'},{'extraction':True},{'mutated':True},{'success':False}]:
 try:audit.compare({**actual,**delta},expected,'bad')
 except AssertionError:pass
 else:raise AssertionError('mismatch accepted: '+str(delta))
bad={'success':False,'error':'unsupported','diagnostics':[{'severity':'error','message':'unsupported'}]}
assert not audit.compare(bad,bad,'unsupported')['success']
try:audit.compare({**bad,'error':'different'},bad,'wrong diagnostic')
except AssertionError:pass
else:raise AssertionError('diagnostic mismatch accepted')

def report(success):
 outcomes=[{'success':success,'matchesSource':True} for _ in range(3)]
 return {'defaultOptimization':1,'cases':[{'kind':'sample','id':'sample',
   'source':[{'optimization':level,'success':success} for level in range(3)],
   'sdk':copy.deepcopy(outcomes),'worker':copy.deepcopy(outcomes),'ide':outcomes[1]}]}
r=report(True);assert audit.summarize(r)==0 and r['allSamplesExport']
r=report(False);assert audit.summarize(r)==1 and r['interfacesAgree'] and not r['allSamplesExport']
assert r['samples']=={'total':1,'exportable':0,'unsupported':1}
for kind in ['empty','optimization','sdk','worker','ide','wrongSuccess']:
 r=report(True)
 if kind=='empty':r['cases']=[]
 elif kind=='optimization':r['cases'][0]['source'][2]['optimization']=1
 elif kind=='wrongSuccess':r['cases'][0]['sdk'][0]['success']=False
 else:r['cases'][0].pop(kind)
 try:audit.summarize(r)
 except AssertionError:pass
 else:raise AssertionError('incomplete/mismatched matrix accepted: '+kind)
print('export audit failure and inventory contracts passed')
`],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:10000});
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 assert.match(result.stdout,/export audit failure and inventory contracts passed/);
});
