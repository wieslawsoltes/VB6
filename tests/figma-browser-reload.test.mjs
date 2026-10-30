import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url));
const probe=spawnSync(process.env.PYTHON||(process.platform==='win32'?'python':'python3'),['-c',String.raw`
import ast,json,time,unittest
from contextlib import contextmanager
from pathlib import Path
source=ast.parse(Path('tools/figma-browser-tests.py').read_text())
owner=next(node for node in source.body if isinstance(node,ast.ClassDef) and node.name=='FigmaWorkspace')
methods=[node for node in owner.body if isinstance(node,ast.FunctionDef) and node.name in ('phase','reload_workspace')]
namespace={'contextmanager':contextmanager,'time':time,'IDE_STARTUP_TIMEOUT_MS':60000}
exec(compile(ast.Module(body=methods,type_ignores=[]),'tools/figma-browser-tests.py','exec'),namespace)
class Probe:
    phase=namespace['phase'];reload_workspace=namespace['reload_workspace']
rows=[]
for figma in (False,True):
    for failure in (None,'navigation','readiness'):
        calls=[];original=RuntimeError('original '+str(failure))
        class Page:
            def reload(self,**options):
                calls.append(['reload',options])
                if failure=='navigation' or options.get('wait_until','load')=='load':raise original
            def wait_for_function(self,predicate,**options):
                calls.append(['ready',predicate,options])
                if failure=='readiness':raise original
        case=Probe();case.page=Page();case.phases={};error=None
        try:case.reload_workspace(figma=figma)
        except Exception as caught:
            assert caught is original
            error=str(caught)
        rows.append({'figma':figma,'failure':failure,'error':error,'calls':calls,'phases':list(case.phases)})
# Read the actual acceptance bodies, not duplicate simulated call sites. Both
# classic/Figma persistence and service leases must use the shared boundary.
uses=[]
for filename,method in [('figma-browser-tests.py','test_13_preferences_and_independent_dock_profiles_survive_reload'),
                        ('figma-services-browser-tests.py','test_service_dock_profiles_reload_without_authority_or_eager_connection')]:
    tree=ast.parse((Path('tools')/filename).read_text())
    node=next(node for node in ast.walk(tree) if isinstance(node,ast.FunctionDef) and node.name==method)
    calls=[node for node in ast.walk(node) if isinstance(node,ast.Call)]
    assert not any(isinstance(node.func,ast.Attribute) and node.func.attr=='reload' for node in calls)
    uses.append({'method':method,'reloads':[ast.unparse(node) for node in calls if isinstance(node.func,ast.Attribute) and node.func.attr=='reload_workspace']})
print(json.dumps({'rows':rows,'uses':uses}))
`],{cwd:root,encoding:'utf8',timeout:10000});

test('Figma reload fixture is executable without Playwright or an installed browser',()=>{
  assert.ifError(probe.error);assert.equal(probe.status,0,probe.stderr);
});
const {rows=[],uses=[]}=probe.status===0?JSON.parse(probe.stdout):{};
for(const figma of [false,true])test(`Figma reload preserves a real reload and requires the connected ${figma?'enabled':'installed'} workspace`,()=>{
  const row=rows.find(row=>row.figma===figma&&!row.failure);
  assert.equal(row.error,null);
  assert.deepEqual(row.calls.map(call=>call[0]),['reload','ready']);
  assert.deepEqual(row.calls[0][1],{wait_until:'commit',timeout:60000});
  assert.deepEqual(row.calls[1][2],{polling:100,timeout:60000});
  assert.deepEqual(row.phases,['reload-navigation','reload-readiness']);
  const predicate=row.calls[1][1];
  for(const state of [{},{vb6Studio:{}},{vb6Studio:{root:{isConnected:true}}},
    {vb6Studio:{root:{isConnected:false},figmaMode:{enabled:true}}}])
    assert.equal(Boolean(runInNewContext(predicate,state)),false);
  assert.equal(Boolean(runInNewContext(predicate,{vb6Studio:{root:{isConnected:true},figmaMode:{enabled:false}}})),!figma);
  assert.equal(Boolean(runInNewContext(predicate,{vb6Studio:{root:{isConnected:true},figmaMode:{enabled:true}}})),true);
});
for(const failure of ['navigation','readiness'])test(`Figma reload propagates ${failure} failures without retries, replacement navigation or fixture injection`,()=>{
  for(const row of rows.filter(row=>row.failure===failure)){
    assert.equal(row.error,'original '+failure);
    assert.equal(row.calls.filter(call=>call[0]==='reload').length,1);
    assert.deepEqual(row.phases,failure==='navigation'?['reload-navigation']:['reload-navigation','reload-readiness']);
    assert.equal(row.calls.length,failure==='navigation'?1:2);
  }
});
test('both persistence acceptance paths share the reload boundary',()=>{
  assert.deepEqual(uses.map(use=>use.reloads),[
    ['self.reload_workspace(figma=True)','self.reload_workspace()'],['self.reload_workspace(figma=True)']]);
});
