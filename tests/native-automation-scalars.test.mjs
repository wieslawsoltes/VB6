import test from 'node:test';
import assert from 'node:assert/strict';
import {VBArray,VBScalar,VBCurrency,VBDecimal,Cell,NOTHING,tagScalar,scalarType,unbox} from '../src/runtime/values.js';
import {encodeAutomationValue,decodeAutomationValue} from '../src/runtime/automation-wire.js';
import {NativeAutomationClient} from '../tools/interop/native-automation.mjs';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';

const retained=wire=>decodeAutomationValue(wire,{preserveScalars:true});
for(const [type,vt,value] of [['byte',17,255],['integer',2,-32768],['long',3,2147483647],['single',4,Math.fround(1.6)],['double',5,1.6],['boolean',11,-1]]){
 test('native wire preserves '+type+' and keeps raw public decoding compatible',()=>{
  const wire=encodeAutomationValue(tagScalar(value,type));
  if(vt!==11)assert.equal(wire.vt,vt);else assert.deepEqual(wire,{t:'boolean',v:true});
  const tagged=retained(wire);assert.ok(tagged instanceof VBScalar);assert.equal(tagged.type,type);assert.equal(tagged.variant,true);assert.equal(unbox(tagged),value);
  assert.equal(decodeAutomationValue(wire),value);
 });
}
for(const [type,values] of [['Byte',[0,255]],['Integer',[-32768,32767]],['Long',[-2147483648,2147483647]],['Single',[Math.fround(0.2),Math.fround(1.6)]],['Double',[0.2,1.6]],['Boolean',[-1,0]],['Currency',[new VBCurrency('0.0001'),new VBCurrency('-922337203685477.5808')]],['Decimal',[new VBDecimal('0.0000000000000000000000000001'),new VBDecimal('79228162514264337593543950335')]]]){
 test('native typed array '+type+' retains descriptors, bounds, values and element origin',()=>{
  const array=new VBArray([[-2,-1],[3,4]],type);for(const [i,v] of [values[0],values[1],values[1],values[0]].entries())array.set([Math.floor(i/2)-2,i%2+3],v);
  const wire=encodeAutomationValue(array),again=retained(wire);assert.equal(again.type.toLowerCase(),type.toLowerCase());assert.deepEqual(again.bounds,array.bounds);
  for(const indices of array.indices()){assert.equal(scalarType(again.getScalar(...indices)),type.toLowerCase());assert.equal(String(again.get(...indices)),String(array.get(...indices)));}
  assert.notEqual(again.data,array.data);assert.notEqual(again.scalarData,array.scalarData);
 });
}
test('Variant array keeps Currency distinct from Decimal and integral Double from Integer',()=>{
 const array=VBArray.from([tagScalar(4,'double'),tagScalar(4,'integer'),new VBCurrency('4'),new VBDecimal('4'),NOTHING]);
 const back=retained(encodeAutomationValue(array));assert.deepEqual(back.data.slice(0,2),[4,4]);assert.deepEqual(back.scalarData.slice(0,4).map(s=>s.type),['double','integer','currency','decimal']);assert.equal(back.get(4),NOTHING);
});
test('stale externally mutated array sidecars never resurrect old native subtype',()=>{const a=VBArray.from([tagScalar(1,'integer')]);a.data[0]=2;assert.equal(encodeAutomationValue(a).v[0].vt,5);});
for(const wire of [{t:'number',vt:'4',v:1.6},{t:'number',vt:2,v:32768},{t:'number',vt:17,v:-1},{t:'number',vt:3,v:1.5},{t:'number',vt:4,v:1.6},{t:'number',vt:20,v:1},{t:'array',elementType:'2',bounds:[[0,0]],v:[{t:'number',v:1}]},{t:'array',elementType:12,bounds:[[0,-1],[0,10000]],v:[]}])test('reject malformed typed transport '+JSON.stringify(wire),()=>assert.throws(()=>retained(wire)));
test('native transport bounds aggregate strings in nested values',()=>{const a=VBArray.from(['a'.repeat(260000),'b'.repeat(260000)]);assert.throws(()=>encodeAutomationValue(a),/aggregate string/);assert.throws(()=>retained({t:'array',bounds:[[0,1]],v:a.data.map(v=>({t:'string',v}))}),/aggregate string/);});
test('native transport bounds aggregate nested element count',()=>{const leaf={t:'array',bounds:[[0,9999]],v:Array.from({length:10000},()=>({t:'empty'}))};assert.throws(()=>retained({t:'array',bounds:[[0,1]],v:[leaf,leaf]}),/aggregate node/);});
test('Automation LCID validated and isolated per client',()=>{const options={allowNativeCode:true,allowed:['Scripting.Dictionary']};const a=new NativeAutomationClient({...options,lcid:1045}),b=new NativeAutomationClient(options);assert.equal(a.lcid,1045);assert.equal(b.lcid,1033);for(const lcid of [-1,1.5,'1045',Infinity,0x100000])assert.throws(()=>new NativeAutomationClient({...options,lcid}));});

// Stub only the OS transport. Execute actual compiler, VM, session, adapter and
// wire layers, recording the exact arguments the real process would receive.
async function compileWithTransport(body){
 const client=new NativeAutomationClient({allowed:['Test.Typed'],allowNativeCode:true,lcid:1045});let released=0;const seen=[];
 const metadata={defaultMember:'Item',members:[{name:'Echo',modes:[1],params:[{name:'value'}]},{name:'Item',modes:[2,4],params:[{name:'key'}]},{name:'Bump',modes:[1],params:[{name:'value',byRef:true}]}]};let stored={t:'empty'};
 client.request=async message=>{seen.push(message);if(message.op==='create')return {t:'object',id:'o1',metadata};if(message.op==='release'){released++;return {};}
  if(message.member==='Bump')return {value:{t:'empty'},args:[{t:'number',vt:3,v:message.args[0].v+1}]};
  if(message.member==='Item'){if(message.mode===4)stored=message.args.at(-1);return {value:stored,args:message.args};}
  return {value:message.args[0],args:message.args};};
 const program=compileProject({name:'Typed',startup:'Sub Main',modules:[{name:'M',kind:'module',code:'Option Explicit\nSub Main()\nDim d As Object\nSet d = CreateObject("Test.Typed")\n'+body+'\nEnd Sub'}]});assert.deepEqual(program.diagnostics,[]);
 const output=[],vm=new VirtualMachine(program,{automation:client.registry(),print:text=>output.push(text)});try{await vm.start();return {output,seen};}finally{vm.stop();await vm.automationClose;assert.equal(released,1);}
}
test('compiled VB preserves native scalar types through calls, property puts and CallByName',async()=>{
 const {output,seen}=await compileWithTransport('Debug.Print VarType(d.Echo(CByte(2))), VarType(d.Echo(CInt(2))), VarType(d.Echo(CSng(2))), VarType(d.Echo(CDbl(2)))\nDebug.Print d.Echo(True), CInt(d.Echo(True)), VarType(d.Echo(True))\nd.Item("k") = CSng(1.6)\nDebug.Print VarType(d.Item("k")), VarType(CallByName(d, "Item", vbGet, "k"))');
 assert.deepEqual(output,['17 2 4 5','True -1 11','4 4']);assert.ok(seen.filter(m=>m.op==='call').every(m=>m.lcid===1045));
});
test('compiled native ByRef copyback retains subtype and exact receiver count',async()=>{const {output,seen}=await compileWithTransport('Dim n As Long\nn=5\nd.Bump n\nDebug.Print n, VarType(n)');assert.deepEqual(output,['6 3']);assert.deepEqual(seen.find(m=>m.member==='Bump').byRef,[0]);assert.equal(seen.find(m=>m.member==='Bump').args[0].vt,3);});

test('native enumeration retains scalar tags and the client LCID in compiled For Each',async()=>{
 const client=new NativeAutomationClient({allowed:['Test.Typed'],allowNativeCode:true,lcid:1045}),seen=[];
 const values=[{t:'currency',v:'1.2345'},{t:'decimal',v:'2.0000000000000000000000000001'},{t:'number',vt:2,v:7},{t:'number',vt:4,v:Math.fround(1.6)},{t:'boolean',v:true}];
 client.request=async message=>{seen.push(message);if(message.op==='create')return {t:'object',id:'o1',metadata:{enumerable:true,members:[]}};if(message.op==='enumerate')return values;if(message.op==='release')return {};throw Error('Unexpected request');};
 const program=compileProject({name:'Enum',startup:'Sub Main',modules:[{name:'M',kind:'module',code:'Sub Main()\nDim d As Object, v As Variant\nSet d = CreateObject("Test.Typed")\nFor Each v In d\nDebug.Print VarType(v)\nNext\nEnd Sub'}]});assert.deepEqual(program.diagnostics,[]);
 const output=[],vm=new VirtualMachine(program,{automation:client.registry(),print:s=>output.push(s)});
 try{await vm.start();assert.deepEqual(output,['6','14','2','4','11']);assert.equal(seen.find(m=>m.op==='enumerate').lcid,1045);}
 finally{vm.stop();await vm.automationClose;assert.equal(seen.filter(m=>m.op==='release').length,1);}
});
