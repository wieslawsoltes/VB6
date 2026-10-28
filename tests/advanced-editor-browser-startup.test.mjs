import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {runInNewContext} from 'node:vm';

const script=fileURLToPath(new URL('../tools/browser-advanced-editor-tests.py',import.meta.url));
function pythonProbe(t,source){
  const python=process.env.PYTHON||(process.platform==='win32'?'python':'python3');
  const result=spawnSync(python,['-c',source,script],{encoding:'utf8',timeout:10000});
  if(result.error?.code==='ENOENT'){t.skip('Python is not installed');return;}
  assert.ifError(result.error);assert.equal(result.status,0,result.stdout+result.stderr);
  return JSON.parse(result.stdout);
}

// Run the actual setUp/tearDown/cleanup through unittest, so failed setup and
// multiple failures have the same ownership as the real browser fixture.
const startupProbe=String.raw`
import ast,json,sys,tempfile,time,unittest
from pathlib import Path
from types import SimpleNamespace

source=ast.parse(Path(sys.argv[1]).read_text())
fixture=next(node for node in source.body if isinstance(node,ast.ClassDef) and node.name=='AdvancedEditorAcceptance')
fixture.body=[node for node in fixture.body if isinstance(node,ast.FunctionDef) and node.name in ['setUp','tearDown','close_context']]
nodes=[node for node in source.body if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ['IDE_STARTUP_TIMEOUT_MS','FIXTURE'] for t in node.targets)]+[fixture]

class ScriptError(Exception):
    @property
    def stack(self):return 'script stack: '+str(self)

class Page:
    def __init__(self,context):self.context=context;self.calls=[];self.events={}
    def on(self,event,callback):self.events[event]=callback
    def goto(self,url,**options):
        self.calls.append(['goto',url,options]);self.events['request'](SimpleNamespace(url=url))
        if self.context.scenario=='navigation-error':raise self.context.primary
        if self.context.scenario=='load-stall' and options.get('wait_until','load')=='load':raise self.context.primary
        if self.context.scenario=='script-error':self.events['pageerror'](ScriptError('startup script error'))
    def set_content(self,content,**options):self.calls.append(['content',content,options])
    def wait_for_function(self,expression,**options):
        self.calls.append(['ready',expression,options])
        if self.context.scenario in ['never-ready','close-error']:raise self.context.primary
    def evaluate(self,expression):
        self.calls.append(['fixture'])
        if self.context.scenario=='fixture-error':raise self.context.primary
    def screenshot(self,**options):
        self.calls.append(['screenshot'])
        if self.context.scenario=='screenshot-error':raise RuntimeError('screenshot failed')

class Context:
    def __init__(self,scenario):
        self.scenario=scenario;self.calls=[];self.closed=0;self.page=Page(self)
        self.primary=TimeoutError('load event remained pending after document commit' if scenario=='load-stall' else 'injected primary failure')
    def set_default_timeout(self,value):self.calls.append(['timeout',value])
    def new_page(self):
        if self.scenario=='new-page-error':raise self.primary
        return self.page
    def close(self):
        self.closed+=1
        if self.scenario=='late-error':self.page.events['pageerror'](ScriptError('context close script error'))
        if self.scenario=='close-error':raise RuntimeError('context cleanup failed')

class Browser:
    def __init__(self,context):self.context=context
    def new_context(self,**options):self.context.calls.append(['new_context',options]);return self.context

class Result(unittest.TestResult):
    def __init__(self,context):super().__init__();self.context=context;self.issues=[]
    def addError(self,case,error):
        self.issues.append({'message':str(error[1]),'primary':error[1] is self.context.primary})
        super().addError(case,error)
    def addFailure(self,case,error):
        self.issues.append({'message':str(error[1]),'primary':error[1] is self.context.primary})
        super().addFailure(case,error)

results=[]
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);(root/'dist').mkdir()
    (root/'dist/VB6-Studio-Web-Advanced.html').write_text('<main>offline advanced fixture</main>')
    namespace={'ROOT':root,'REPORT':root,'unittest':unittest,'time':time}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),sys.argv[1],'exec'),namespace)
    class ProbeCase(namespace['AdvancedEditorAcceptance']):
        def runTest(self):
            self.body_ran=True
            if self.context.scenario=='screenshot-error':raise self.context.primary
            self.passed=True
    cases=[('file','load-stall'),('http','success'),('memory','success'),
           ('file','never-ready'),('file','navigation-error'),('file','close-error'),
           ('file','new-page-error'),('file','fixture-error'),('file','script-error'),
           ('file','late-error'),('file','screenshot-error')]
    for transport,scenario in cases:
        namespace['TRANSPORT']=transport;context=Context(scenario);case=ProbeCase()
        case.browser=Browser(context);case.base='http://127.0.0.1:4123';case.results=[];case.body_ran=False
        result=Result(context);case.run(result)
        results.append({'transport':transport,'scenario':scenario,'successful':result.wasSuccessful(),
                        'bodyRan':case.body_ran,'issues':result.issues,'calls':context.page.calls,
                        'contextCalls':context.calls,'closed':context.closed,'records':case.results,
                        'pageErrors':case.errors,'pageErrorStacks':case.errorStacks,'requests':case.requests})
print(json.dumps(results))
`;

test('Advanced offline startup keeps real readiness, action deadlines and failure cleanup',t=>{
  const cases=pythonProbe(t,startupProbe);if(!cases)return;
  const find=scenario=>cases.find(c=>c.scenario===scenario);
  const offline=find('load-stall');
  assert.equal(offline.successful,true,JSON.stringify(offline.issues));assert.equal(offline.bodyRan,true);
  for(const item of cases){
    assert.deepEqual(item.contextCalls.filter(c=>c[0]==='timeout'),[['timeout',15000]]);
    assert.equal(item.closed,1,'Every allocated context must close, including failed setup');
    assert.equal(item.records.length,1,'Failed setup must retain a failed result row');
    assert.equal(item.records[0].passed,item.successful);
  }
  assert.deepEqual(offline.calls.map(c=>c[0]),['goto','ready','fixture']);
  assert.match(offline.calls[0][1],/^file:.*\/dist\/VB6-Studio-Web-Advanced\.html$/);
  assert.deepEqual(offline.calls[0][2],{wait_until:'commit'});
  const ready=offline.calls[1];assert.deepEqual(ready[2],{polling:100,timeout:60000});
  for(const state of [{},{vb6Studio:{advancedEditor:{}},VB6StudioAPI:{}},
    {vb6Studio:{root:{isConnected:false},advancedEditor:{}},VB6StudioAPI:{}},
    {vb6Studio:{root:{isConnected:true}},VB6StudioAPI:{}},
    {vb6Studio:{root:{isConnected:true},advancedEditor:{}}}]){
    assert.equal(Boolean(runInNewContext(ready[1],state)),false,'Detached or incomplete IDE must not be ready');
  }
  assert.equal(Boolean(runInNewContext(ready[1],{vb6Studio:{root:{isConnected:true},advancedEditor:{}},VB6StudioAPI:{}})),true);
  const http=cases.find(c=>c.transport==='http'),memory=cases.find(c=>c.transport==='memory');
  assert.deepEqual(http.calls[0],['goto','http://127.0.0.1:4123/dist/index.html',{}]);
  assert.deepEqual(http.requests,['http://127.0.0.1:4123/dist/index.html']);
  assert.deepEqual(memory.calls[0],['content','<main>offline advanced fixture</main>',{}]);
  assert.deepEqual(memory.requests,[]);
  for(const item of [http,memory]){
    assert.equal(item.successful,true);assert.equal(item.calls[1][2].timeout,15000);
  }
  for(const scenario of ['never-ready','navigation-error','close-error','new-page-error','fixture-error']){
    const item=find(scenario);
    assert.equal(item.successful,false);assert.equal(item.bodyRan,false);
    assert.ok(item.issues.some(i=>i.primary),'The original setup exception must survive cleanup');
    assert.equal(item.calls.filter(c=>c[0]==='content').length,0,'Startup failure must not change origin');
    assert.ok(item.calls.filter(c=>c[0]==='goto').length<=1,'Startup failure must not retry navigation');
  }
  assert.ok(find('close-error').issues.some(i=>i.message==='context cleanup failed'));
  assert.equal(find('navigation-error').calls.some(c=>c[0]==='ready'),false);
  for(const [scenario,message] of [['script-error','startup script error'],['late-error','context close script error']]){
    const item=find(scenario);
    assert.equal(item.bodyRan,true);assert.deepEqual(item.pageErrors,[message]);
    assert.deepEqual(item.pageErrorStacks,['script stack: '+message]);
    assert.ok(item.issues.some(i=>i.message.includes(message)));
    assert.equal(item.records[0].passed,false,'Pageerrors during close must fail the recorded result');
  }
  const screenshot=find('screenshot-error');
  assert.equal(screenshot.successful,false);assert.ok(screenshot.issues.some(i=>i.primary));
  assert.ok(screenshot.issues.some(i=>i.message==='screenshot failed'));
});

// Exercise each real load_tests adapter, with inherited base cases present, to
// prove that partitioning cannot duplicate inherited tests or silently omit one.
const partitionProbe=String.raw`
import ast,importlib.util,json,os,sys,unittest
from pathlib import Path
from types import SimpleNamespace

root=Path(sys.argv[1]).parent
spec=importlib.util.spec_from_file_location('partition',root/'ci/browser_partition.py')
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
shared=SimpleNamespace(configured_shard=helper.configured_shard,select_case_names=helper.select_case_names)
parent=unittest.TestCase;results=[]
for filename,owner in [('browser-advanced-editor-tests.py','AdvancedEditorAcceptance'),('browser-tui-advanced-tests.py','TUIAdvancedAcceptance'),('figma-advanced-editor-browser-tests.py','FigmaAdvancedEditor')]:
    source=ast.parse((root/filename).read_text())
    fixture=next(node for node in source.body if isinstance(node,ast.ClassDef) and node.name==owner)
    names=sorted(node.name for node in fixture.body if isinstance(node,ast.FunctionDef) and node.name.startswith('test_'))
    klass=type(owner,(parent,),{name:lambda self:None for name in names})
    if owner=='AdvancedEditorAcceptance':parent=klass
    loader=next(node for node in source.body if isinstance(node,ast.FunctionDef) and node.name=='load_tests')
    namespace={'unittest':unittest,owner:klass,'base':shared,'advanced':shared,
               'configured_shard':helper.configured_shard,'select_case_names':helper.select_case_names}
    exec(compile(ast.Module(body=[loader],type_ignores=[]),filename,'exec'),namespace)
    selections=[]
    for engine in ['chromium','firefox','webkit']:
        for transport in ['http','file']:
            for shard in ['', '1','2','3'] if engine=='webkit' else ['']:
                os.environ.update(VB6_BROWSER=engine,VB6_TEST_TRANSPORT=transport,VB6_BROWSER_SHARD=shard)
                selection={'engine':engine,'transport':transport,'shard':shard}
                try:selection['names']=[case._testMethodName for case in namespace['load_tests'](unittest.TestLoader(),unittest.TestSuite(),None)]
                except ValueError as error:selection['error']=str(error)
                selections.append(selection)
    results.append({'owner':owner,'names':names,'selections':selections})
print(json.dumps(results))
`;

test('Advanced adapters partition every owned case once while preserving unsharded engines',t=>{
  const owners=pythonProbe(t,partitionProbe);if(!owners)return;
  assert.deepEqual(owners.map(o=>o.names.length),[31,4,1]);
  for(const owner of owners){
    for(const selection of owner.selections.filter(s=>!s.shard)){
      assert.equal(selection.error,undefined);assert.deepEqual(selection.names,owner.names);
    }
    for(const transport of ['http','file']){
      const shards=owner.selections.filter(s=>s.engine==='webkit'&&s.transport===transport&&s.shard);
      assert.equal(shards.length,3);
      const names=shards.flatMap(s=>s.names??[]);
      assert.equal(new Set(names).size,names.length,'Each origin/case belongs to exactly one shard');
      assert.deepEqual(names.sort(),owner.names,'Every owned case must execute');
      const sizes=shards.map(s=>s.names?.length??0);
      assert.deepEqual(sizes,owner.names.length===31?[11,10,10]:owner.names.length===4?[2,1,1]:[1,0,0]);
      if(owner.names.length===1)for(const shard of shards.slice(1))assert.match(shard.error,/without owned cases/);
      else for(const shard of shards)assert.equal(shard.error,undefined);
    }
  }
});
