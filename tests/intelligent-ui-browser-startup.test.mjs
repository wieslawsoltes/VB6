import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

// Execute the real loaders without starting their script-level browser/server.
// The fake transport models a load event that never fires after commit, plus
// failures before readiness and during cleanup. No Playwright install is needed.
const probe=String.raw`
import ast,json,sys,tempfile
from pathlib import Path

source=ast.parse(Path(sys.argv[1]).read_text())
nodes=[node for node in source.body if
       isinstance(node,ast.FunctionDef) and node.name=='load' or
       isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='IDE_STARTUP_TIMEOUT_MS' for t in node.targets)]

class Page:
    def __init__(self,mode,scenario):
        self.mode=mode;self.scenario=scenario;self.calls=[];self.events={};self.closed=0
        self.primary=TimeoutError('navigation failed' if scenario=='navigation-error' else 'IDE never ready')
    def set_default_timeout(self,value):self.calls.append(['timeout',value])
    def on(self,event,callback):self.events[event]=callback
    def goto(self,url,**options):
        self.calls.append(['goto',url,options])
        if self.scenario=='navigation-error':raise self.primary
        if self.scenario=='load-stall' and options.get('wait_until','load')=='load':
            raise TimeoutError('load event remained pending after document commit')
        if self.scenario=='page-error':self.events['pageerror']('startup script error')
    def set_content(self,content,**options):self.calls.append(['content',content,options])
    def wait_for_function(self,expression,**options):
        self.calls.append(['ready',expression,options])
        if self.scenario in ['never-ready','close-error']:raise self.primary
    def close(self):
        self.closed+=1
        if self.scenario=='close-error':
            self.events['pageerror']('error during close')
            raise RuntimeError('cleanup failed')

class Browser:
    def __init__(self,page):self.page=page
    def new_page(self,**options):return self.page

results=[]
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);(root/'dist').mkdir()
    (root/'dist/VB6-Studio-Web.html').write_text('<main>standalone fixture</main>')
    namespace={'ROOT':root,'base':'http://127.0.0.1:4123'}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),sys.argv[1],'exec'),namespace)
    cases=[('standalone','load-stall'),('file','load-stall'),('modules','success'),('opaque','success'),
           ('standalone','never-ready'),('file','navigation-error'),('standalone','close-error'),('modules','page-error')]
    for mode,scenario in cases:
        page=Page(mode,scenario);result={'mode':mode,'scenario':scenario,'returned':False}
        try:result['returned']=namespace['load'](Browser(page),mode) is page
        except Exception as error:
            result['error']=str(error);result['originalException']=error is page.primary
        result.update(calls=page.calls,closed=page.closed,pageErrors=page._errors)
        results.append(result)
print(json.dumps(results))
`;

for(const filename of ['intelligent-ui-browser-tests.py','intelligent-ui-workbench-tests.py']){
  test(`${filename}: bounded standalone startup preserves actions, origins and failure cleanup`,t=>{
    const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
    const script=fileURLToPath(new URL('../tools/'+filename,import.meta.url));
    const result=spawnSync(python,['-c',probe,script],{encoding:'utf8',timeout:10000});
    if(result.error?.code==='ENOENT'){t.skip('Python is not installed');return;}
    assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
    const cases=JSON.parse(result.stdout);
    const find=(mode,scenario)=>cases.find(c=>c.mode===mode&&c.scenario===scenario);
    for(const item of cases)assert.deepEqual(item.calls.filter(c=>c[0]==='timeout'),[['timeout',12000]]);

    for(const mode of ['standalone','file']){
      const item=find(mode,'load-stall');
      assert.equal(item.returned,true,item.error);assert.equal(item.closed,0);
      const nav=item.calls.find(c=>c[0]==='goto');
      assert.equal(nav[2].wait_until,'commit');
      if(mode==='standalone')assert.equal(nav[1],'http://127.0.0.1:4123/VB6-Studio-Web.html');
      else assert.match(nav[1],/^file:.*\/dist\/VB6-Studio-Web\.html$/);
      const ready=item.calls.find(c=>c[0]==='ready');
      assert.equal(ready[2].timeout,60000);assert.equal(ready[2].polling,100);
      for(const state of [{},{vb6Studio:{intelligentUI:{}}},{vb6Studio:{root:{isConnected:false},intelligentUI:{}}},{vb6Studio:{root:{isConnected:true}}}]){
        assert.equal(Boolean(runInNewContext(ready[1],state)),false,'A detached or incomplete IDE must not be ready');
      }
      assert.equal(Boolean(runInNewContext(ready[1],{vb6Studio:{root:{isConnected:true},intelligentUI:{}}})),true);
    }

    const modules=find('modules','success'),opaque=find('opaque','success');
    assert.equal(modules.returned,true);assert.equal(opaque.returned,true);
    assert.deepEqual(modules.calls.find(c=>c[0]==='goto'),['goto','http://127.0.0.1:4123/index.html',{wait_until:'commit',timeout:60000}]);
    assert.equal(opaque.calls.filter(c=>c[0]==='goto').length,0);
    assert.equal(opaque.calls.find(c=>c[0]==='content')[2].wait_until,'domcontentloaded');
    for(const item of [modules,opaque]){
      assert.equal(item.calls.find(c=>c[0]==='ready')[2].timeout,60000);
      assert.equal(item.closed,0);
    }

    for(const [mode,scenario] of [['standalone','never-ready'],['file','navigation-error'],['standalone','close-error']]){
      const item=find(mode,scenario);
      assert.equal(item.returned,false);assert.equal(item.originalException,true,item.error);
      assert.equal(item.closed,1);assert.equal(item.calls.filter(c=>c[0]==='goto').length,1);
      assert.equal(item.calls.filter(c=>c[0]==='content').length,0,'A startup failure must not switch origins');
    }
    assert.equal(find('file','navigation-error').calls.filter(c=>c[0]==='ready').length,0);
    assert.deepEqual(find('standalone','close-error').pageErrors,['error during close']);
    assert.deepEqual(find('modules','page-error').pageErrors,['startup script error']);
  });
}
