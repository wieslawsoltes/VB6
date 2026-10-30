import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

// Execute the real fixture lifecycle without importing Playwright or starting
// its server. Model a committed document whose load event never completes,
// and independently inject failures during navigation, readiness and cleanup.
const probe=String.raw`
import ast,json,sys,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace

source=ast.parse(Path(sys.argv[1]).read_text())
fixture=next(node for node in source.body if isinstance(node,ast.ClassDef) and node.name=='WinUI')
fixture.body=[node for node in fixture.body if isinstance(node,ast.FunctionDef) and node.name in ['setUp','load','settle_document','tearDown']]
nodes=[node for node in source.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='IDE_STARTUP_TIMEOUT_MS' for t in node.targets)]+[fixture]

class Page:
    def __init__(self,context):
        self.context=context;self.calls=[];self.events={};self.scenario='success';self.closed=False;self.close_count=0
        self.primary=TimeoutError('injected startup failure')
    def on(self,event,callback):self.events[event]=callback
    def goto(self,url,**options):
        self.calls.append(['goto',url,options])
        self.context.events['request'](SimpleNamespace(url=url))
        if self.scenario=='navigation-error':raise self.primary
        if self.scenario=='load-stall' and options.get('wait_until','load')=='load':
            raise TimeoutError('load event remained pending after document commit')
        if self.scenario=='script-error':self.events['pageerror']('startup script error')
        if self.scenario=='external-request':self.context.events['request'](SimpleNamespace(url='https://external.invalid/script.js'))
    def set_content(self,content,**options):self.calls.append(['content',content,options])
    def wait_for_function(self,expression,**options):
        self.calls.append(['ready',expression,options])
        if expression.startswith('()=>'):
            if self.scenario=='scheduler-stuck':raise self.primary
        elif self.scenario in ['never-ready','close-error']:raise self.primary
    def close(self):
        self.close_count+=1
        if self.scenario=='close-error':
            self.events['pageerror']('failed page close')
            raise RuntimeError('cleanup failed')
        self.closed=True
    def is_closed(self):return self.closed

class Context:
    def __init__(self):self.calls=[];self.events={};self.closed=0;self.page=Page(self)
    def set_default_timeout(self,value):self.calls.append(['timeout',value])
    def on(self,event,callback):self.events[event]=callback
    def new_page(self):
        self.events['page'](self.page)
        return self.page
    def close(self):
        self.closed+=1;self.page.closed=True
        if self.page.scenario=='late-error':self.page.events['pageerror']('context close script error')

class Browser:
    def __init__(self,context):self.context=context
    def new_context(self,**options):
        self.context.calls.append(['new_context',options]);return self.context

results=[]
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);(root/'dist').mkdir();(root/'reports').mkdir()
    standalone=root/'dist/VB6-Studio-Web.html';standalone.write_text('<main>standalone fixture</main>')
    gallery=root/'reports/gallery.html';gallery.write_text('<main>gallery fixture</main>')
    namespace={'ROOT':root,'FIXTURE':gallery,'unittest':unittest}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),sys.argv[1],'exec'),namespace)
    cases=[('http','standalone','load-stall'),('file','standalone','load-stall'),
           ('http','module','success'),('http','gallery','success'),('file','gallery','success'),('memory','standalone','success'),
           ('http','standalone','never-ready'),('file','standalone','navigation-error'),('http','standalone','close-error'),
           ('http','standalone','script-error'),('http','standalone','late-error'),('http','standalone','external-request'),
           ('http','standalone','scheduler-stuck')]
    for transport,kind,scenario in cases:
        namespace.update(TRANSPORT=transport,MEMORY=transport=='memory')
        context=Context();case=namespace['WinUI']();case.browser=Browser(context);case.base='http://127.0.0.1:4123/'
        case.setUp();page=case.page;page.calls=[];page.scenario=scenario
        path=standalone if kind=='standalone' else root/'dist/index.html' if kind=='module' else gallery
        result={'transport':transport,'kind':kind,'scenario':scenario,'loaded':False}
        try:case.load(page,path);result['loaded']=True
        except Exception as error:result.update(error=str(error),originalException=error is page.primary)
        result['loadCalls']=list(page.calls);result['pageClosedAfterLoad']=page.closed
        try:case.tearDown()
        except Exception as error:result.update(teardownError=str(error),originalTeardownException=error is page.primary)
        result.update(teardownCalls=page.calls[len(result['loadCalls']):],contextCalls=context.calls,
                      pageCloseCount=page.close_count,contextCloseCount=context.closed,pageErrors=case.errors)
        results.append(result)
print(json.dumps(results))
`;

test('WinUI startup preserves transport, interaction deadlines and teardown assertions',t=>{
  const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
  const script=fileURLToPath(new URL('../tools/browser-winui-tests.py',import.meta.url));
  const result=spawnSync(python,['-c',probe,script],{encoding:'utf8',timeout:10000});
  if(result.error?.code==='ENOENT'){t.skip('Python is not installed');return;}
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
  const cases=JSON.parse(result.stdout);
  const find=(transport,kind,scenario)=>cases.find(c=>c.transport===transport&&c.kind===kind&&c.scenario===scenario);
  for(const item of cases){
    assert.deepEqual(item.contextCalls.filter(c=>c[0]==='timeout'),[['timeout',10000]]);
    assert.equal(item.contextCalls[0][1].reduced_motion,'reduce');
    assert.equal(item.contextCloseCount,1);
  }

  for(const transport of ['http','file']){
    const item=find(transport,'standalone','load-stall');
    assert.equal(item.loaded,true,item.error);assert.equal(item.pageClosedAfterLoad,false);
    assert.equal(item.pageCloseCount,0);assert.equal(item.teardownError,undefined);
    const nav=item.loadCalls.find(c=>c[0]==='goto');
    assert.deepEqual(nav[2],{wait_until:'commit'});
    if(transport==='http')assert.equal(nav[1],'http://127.0.0.1:4123/dist/VB6-Studio-Web.html');
    else assert.match(nav[1],/^file:.*\/dist\/VB6-Studio-Web\.html$/);
    const ready=item.loadCalls.find(c=>c[0]==='ready');
    assert.equal(ready[2].timeout,60000);assert.equal(ready[2].polling,100);
    const api={applyAppearance(){},command(){}};
    for(const state of [{},{vb6Studio:api},{vb6Studio:{...api,root:{isConnected:false}}},
      {vb6Studio:{root:{isConnected:true},command(){}}},{vb6Studio:{root:{isConnected:true},applyAppearance(){}}}]){
      assert.equal(Boolean(runInNewContext(ready[1],state)),false,'Incomplete or detached IDE must not be ready');
    }
    assert.equal(Boolean(runInNewContext(ready[1],{vb6Studio:{...api,root:{isConnected:true}}})),true);
    assert.equal(item.teardownCalls.length,1,'A successfully loaded document must still settle before close');
    assert.match(item.teardownCalls[0][1],/syntaxDiagnostics/);
    assert.deepEqual(item.teardownCalls[0][2],{},'Scheduler settling retains the context action timeout');
  }

  for(const [transport,kind] of [['http','module'],['http','gallery'],['file','gallery']]){
    const item=find(transport,kind,'success');
    assert.equal(item.loaded,true);assert.equal(item.teardownError,undefined);
    assert.deepEqual(item.loadCalls.map(c=>c[0]),['goto']);
    assert.deepEqual(item.loadCalls[0][2],{},'Small documents retain default navigation behavior');
    if(kind==='module')assert.equal(item.loadCalls[0][1],'http://127.0.0.1:4123/dist/index.html');
    else if(transport==='http')assert.equal(item.loadCalls[0][1],'http://127.0.0.1:4123/reports/gallery.html');
    else assert.match(item.loadCalls[0][1],/^file:.*\/reports\/gallery\.html$/);
  }
  const memory=find('memory','standalone','success');
  assert.equal(memory.loaded,true);
  assert.deepEqual(memory.loadCalls[0],['content','<main>standalone fixture</main>',{}]);
  assert.equal(memory.loadCalls.filter(c=>c[0]==='goto').length,0);
  assert.equal(memory.loadCalls.find(c=>c[0]==='ready')[2].timeout,10000);

  for(const [transport,scenario] of [['http','never-ready'],['file','navigation-error'],['http','close-error']]){
    const item=find(transport,'standalone',scenario);
    assert.equal(item.loaded,false);assert.equal(item.originalException,true,item.error);
    assert.equal(item.pageCloseCount,1);
    assert.equal(item.loadCalls.filter(c=>c[0]==='goto').length,1);
    assert.equal(item.loadCalls.filter(c=>c[0]==='content').length,0,'A failed launch must not switch origins');
    if(scenario!=='close-error'){
      assert.equal(item.pageClosedAfterLoad,true);assert.deepEqual(item.teardownCalls,[]);
      assert.equal(item.teardownError,undefined,'A failed, closed page must not cause a second scheduler timeout');
    }
  }
  assert.equal(find('file','standalone','navigation-error').loadCalls.filter(c=>c[0]==='ready').length,0);
  for(const [scenario,error] of [['close-error','failed page close'],['script-error','startup script error'],['late-error','context close script error']]){
    const item=find('http','standalone',scenario);
    assert.deepEqual(item.pageErrors,[error]);assert.ok(item.teardownError?.includes(error));
  }
  assert.match(find('http','standalone','external-request').teardownError,/https:\/\/external\.invalid/);
  const stuck=find('http','standalone','scheduler-stuck');
  assert.equal(stuck.loaded,true);assert.equal(stuck.originalTeardownException,true,'A stuck syntax scheduler must still fail');
});
