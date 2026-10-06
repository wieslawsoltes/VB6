from pathlib import Path
import re
import subprocess

MAIN='72dae4fa89e165f6f0dc0ba0aad5cb7615508ea3'
subprocess.run(['git','update-ref','refs/remotes/integration/main',MAIN],check=True)
result=subprocess.run(['git','-c','user.name=OpenAI','-c','user.email=noreply@openai.com','merge','--no-commit','--no-ff','refs/remotes/integration/main'])
if result.returncode not in (0,1):
    raise RuntimeError('Unable to prepare three-way merge')
pattern=r'<<<<<<< HEAD\n(.*?)=======\n(.*?)>>>>>>> refs/remotes/integration/main\n'
def resolve(path,choose):
    p=Path(path);s=p.read_text();i=iter(choose)
    s,n=re.subn(pattern,lambda m:next(i)(m.group(1),m.group(2)),s,flags=re.S)
    assert n==len(choose) and '<<<<<<<' not in s,path
    p.write_text(s)
resolve('src/runtime/automation.js',[
 lambda a,b:"import {Ref,Cell,MISSING,unbox,readScalar} from './values.js';\n",
 lambda a,b:b.replace('  const result=await invoke.call(s.adapter,m.name,mode,values,refs.map(([i])=>i));','  let result;s.session.invocations++;\n  try{result=await invoke.call(s.adapter,m.name,mode,values,refs.map(([i])=>i));}finally{s.session.invocations--;}'),
 lambda a,b:b+'\n'+a[a.index('/** Subscribe'):]
])
p=Path('src/runtime/automation.js');s=p.read_text().replace('event.params[i].byRef?a.ref.get():values[i]',"event.params[i].byRef?(typeof s.adapter.invokeScalar==='function'?readScalar(a.ref):a.ref.get()):values[i]");p.write_text(s)
resolve('src/runtime/entry.js',[lambda a,b:b.replace('{AutomationRegistry,','{OcxPropertyBag,OcxControlSite,ocxControlSite,automationSubscribe,AutomationRegistry,')])
resolve('tools/interop/AutomationHost.cs',[lambda a,b:a])
resolve('tools/interop/automation-host.ps1',[lambda a,b:b.replace("(Join-Path $PSScriptRoot 'NativeEnumeration.cs')","(Join-Path $PSScriptRoot 'NativeEnumeration.cs'), (Join-Path $PSScriptRoot 'OcxSupport.cs')").replace('System.Drawing\n','System.Drawing,System.Core\n')])
resolve('tools/interop/native-automation.mjs',[
 lambda a,b:a.replace('allowNativeCode=false,licenseKeys','lcid=1033,allowNativeCode=false,licenseKeys').replace('    this.licenseKeys=',"    if(!Number.isInteger(lcid)||lcid<0||lcid>0xfffff)throw Error('Invalid Automation locale identifier');\n    this.lcid=lcid;this.licenseKeys="),
 lambda a,b:b.replace('const reply=JSON.parse(line);','const reply=JSON.parse(line);if(reply?.event){this.receiveEvent(reply.event);continue;}'),
 lambda a,b:b.replace('const adapter={metadata:wire.metadata,','const adapter={metadata:wire.metadata,subscribe(handler){client.eventHandlers.set(wire.id,{handler,decode:value=>decode(value,true)});return ()=>client.eventHandlers.delete(wire.id);},').replace('async release(){if(!client.closed)','async release(){client.eventHandlers.delete(wire.id);if(!client.closed)')
])
p=Path('tools/interop/OcxSupport.cs');s=p.read_text().replace('response=D("id",id,"error",D("message",error.Message,"hresult",hr,"number",number));','var native=error as NativeDispatchException;response=D("id",id,"error",D("message",error.Message,"hresult",hr,"number",number,"source",native==null?null:native.Source,"helpFile",native==null?null:native.NativeHelpFile,"helpContext",native==null?0:native.NativeHelpContext));');p.write_text(s)
p=Path('tests/ocx-components.test.mjs');s=p.read_text().replace('NOTHING,VBErrorValue}','NOTHING,VBErrorValue,tagScalar,scalarType}').replace("import {declarationTargets,handlerEdit}","import {encodeAutomationValue} from '../src/runtime/automation-wire.js';\nimport {declarationTargets,handlerEdit}")
s=s.replace('for(const [k,v] of Object.entries(entries))assert.deepEqual(restored.ReadProperty(k.toLowerCase()),v);','for(const [k,v] of Object.entries(entries)){const value=restored.ReadProperty(k.toLowerCase());if(v instanceof VBArray){assert.deepEqual(value.bounds,v.bounds);assert.deepEqual(value.data,v.data);assert.equal(value.type,v.type);assert.deepEqual(encodeAutomationValue(value),encodeAutomationValue(v));}else assert.deepEqual(value,v);}')
s+='''
test('property bags retain every numeric subtype through explicit scalar reads',()=>{
 const bag=new OcxPropertyBag();for(const type of ['byte','integer','long','single','double','boolean'])bag.WriteProperty(type,tagScalar(type==='boolean'?-1:7,type));
 const copy=new OcxPropertyBag(JSON.parse(JSON.stringify(bag.Contents)));
 for(const type of ['byte','integer','long','single','double','boolean']){assert.equal(scalarType(copy.ReadPropertyScalar(type)),type);assert.equal(typeof copy.ReadProperty(type),'number');}
 assert.deepEqual(copy.Contents,bag.Contents);assert.equal(copy.ReadPropertyScalar('Missing',null),null);
});
''';p.write_text(s)
p=Path('src/controls/ocx-site.js');s=p.read_text().replace('  WriteProperty(name,value,defaultValue=undefined){','  /** Scalar-aware counterpart for compiled/adapted controls; raw embedding reads remain compatible. */\n  ReadPropertyScalar(name,defaultValue=undefined){const item=this.#entries.get(checkedName(name));return item?decodeAutomationValue(copy(item.value),{preserveScalars:true}):defaultValue;}\n  WriteProperty(name,value,defaultValue=undefined){');p.write_text(s)
p=Path('tests/ocx-events.test.mjs');s=p.read_text()+'''

test('scalar-aware event adapters preserve Boolean cancellation and numeric Variant subtypes',async()=>{
 const {tagScalar,readScalar,scalarType,unbox}=await import('../src/runtime/values.js');
 let fire;const adapter={metadata:{members:[],events:[{name:'Changing',params:[{name:'Reading'},{name:'Cancel',byRef:true}]}]},invoke(){},invokeScalar(){},release(){},subscribe(sink){fire=sink;return ()=>{};}};
 const session=new AutomationRegistry().createSession(),object=session.adopt(adapter),seen=[];
 const disconnect=automationSubscribe(object,async(name,args)=>{seen.push(scalarType(args[0]),scalarType(await readScalar(args[1].ref)));await args[1].ref.set(tagScalar(-1,'boolean'));});
 try{const changed=await fire('Changing',[tagScalar(4,'single'),tagScalar(0,'boolean')]);assert.deepEqual(seen,['single','boolean']);assert.equal(scalarType(changed.args[0]),'single');assert.equal(scalarType(changed.args[1]),'boolean');assert.equal(unbox(changed.args[1]),-1);disconnect();const untouched=await fire('Changing',[tagScalar(4,'long'),tagScalar(0,'boolean')]);assert.equal(scalarType(untouched.args[0]),'long');assert.equal(scalarType(untouched.args[1]),'boolean');}
 finally{await session.close();}
});
''';p.write_text(s)
p=Path('tools/interop/test-ocx.mjs');s=p.read_text().replace('const architecture=',"import {unbox,tagScalar,readScalar,scalarType} from '../../src/runtime/values.js';\nconst architecture=").replace('await args[6].ref.set(-1);',"assert.equal(scalarType(await readScalar(args[6].ref)),'boolean');await args[6].ref.set(tagScalar(-1,'boolean'));").replace("assert.equal(typeof ready,'number');","assert.equal(typeof unbox(ready),'number');assert.ok(['integer','long'].includes(scalarType(ready)));");p.write_text(s)
p=Path('docs/OCX-SUPPORT.md');s=p.read_text()+'''
### Scalar-Variant interoperability

The OCX integration retains typed native Automation from PR #44. Scalar-aware
adapters carry Byte, Integer, Long, Single, Double and Boolean tags through event
arguments and ByRef copyback; native HRESULT source/help information and per-client
LCID are retained on reentrant calls. `OcxPropertyBag.ReadProperty` keeps the raw
JavaScript embedding contract; `ReadPropertyScalar` returns preserved Variant
subtypes for compiler-aware adapters. Wire snapshots retain those tags without
changing opaque native FRX data.
''';p.write_text(s)
# Only generated conflicts are reset, then regenerated from all merged source.
subprocess.run(['git','checkout','--ours','--','dist','src/exporter/runtime-payload.js'],check=True)
subprocess.run(['npm','run','build'],check=True,shell=False)
subprocess.run(['git','add','-u'],check=True)
assert not subprocess.check_output(['git','diff','--name-only','--diff-filter=U']).strip()
# Compare each tracked blob to the independently tested complete local tree.
# Ignore only this temporary script and staging workflow, removed before merge.
import hashlib
entries=subprocess.check_output(['git','ls-files','-s'],text=True)
actual='\n'.join(line for line in entries.splitlines() if not line.endswith('\t.ocx-integrate.py') and not line.endswith('\t.github/workflows/ocx-integration.yml'))+'\n'
Path('ocx-integration-index.txt').write_text(actual)
print('SOURCE_INDEX_SHA256',hashlib.sha256(actual.encode()).hexdigest())
