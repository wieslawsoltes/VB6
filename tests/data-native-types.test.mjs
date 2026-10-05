import test from 'node:test';
import assert from 'node:assert/strict';
import {fieldValue,DisconnectedRecordset} from '../src/data/recordset.js';
import {ProviderRecordset} from '../src/data/provider-recordset.js';
import {DATA_CONSTANTS} from '../src/data/common.js';
import {VBDecimal} from '../src/runtime/values.js';
import {encodeCell,decodeCell} from '../src/data/wire.js';
const overflow=error=>error.number===6;
for(const [Type,min,max]of [[16,-128,127],[18,0,65535],[19,0,4294967295]]){
 test(`native integer width ${Type} preserves range and checks overflow`,()=>{
  for(const value of [min,max,0])assert.equal(fieldValue({Type},String(value)),value);
  assert.equal(fieldValue({Type},2.5),2);assert.equal(fieldValue({Type},3.5),4);
  assert.equal(fieldValue({Type},null),null);
  assert.throws(()=>fieldValue({Type},min-1),overflow);assert.throws(()=>fieldValue({Type},max+1),overflow);
  assert.throws(()=>fieldValue({Type},'invalid'),error=>error.number===13);
  const rs=new DisconnectedRecordset();rs.Fields.Append('value',Type);rs.Open();rs.AddNew('value',max);assert.equal(rs.Fields.Item(0).Value,max);
 });
}
test('native unsigned 64-bit fields remain exact rather than passing through Double',()=>{
 const Type=21,max='18446744073709551615';
 for(const value of [max,BigInt(max),new VBDecimal(max)]){
  const actual=fieldValue({Type},value);assert(actual instanceof VBDecimal);assert.equal(actual.toString(),max);
  assert.equal(fieldValue({Type},decodeCell(JSON.parse(JSON.stringify(encodeCell(actual))))).toString(),max);
 }
 for(const n of [Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER-1])assert.equal(fieldValue({Type},n).toString(),String(n));
 assert.throws(()=>fieldValue({Type},'18446744073709551616'),overflow);
 assert.throws(()=>fieldValue({Type},-1),overflow);
 assert.throws(()=>fieldValue({Type},Number(max)),overflow);
 assert.equal(fieldValue({Type},'2.5').toString(),'2');
 assert.equal(fieldValue({Type},'3.5').toString(),'4');
});
test('ADO publishes the original signed and unsigned integer enumeration values',()=>{
 for(const [name,expected]of Object.entries({adTinyInt:16,adUnsignedTinyInt:17,adUnsignedSmallInt:18,adUnsignedInt:19,adUnsignedBigInt:21}))assert.equal(DATA_CONSTANTS[name],expected);
});
test('native schema rowsets retain provider types and load unsigned metadata atomically',()=>{
 const columns=[{Name:'TABLE_NAME',Type:202},{Name:'ORDINAL_POSITION',Type:19},{Name:'DATA_TYPE',Type:18},{Name:'COLUMN_FLAGS',Type:19},{Name:'LARGE_VALUE',Type:21}];
 const rs=new ProviderRecordset({});rs.load({columns,values:[['fixture',1,205,4294967295,'18446744073709551615']]});
 assert.equal(rs.RecordCount,1);assert.equal(rs.Item('COLUMN_FLAGS'),4294967295);
 assert.equal(rs.Item('LARGE_VALUE').toString(),'18446744073709551615');assert.equal(rs.Fields.Item('DATA_TYPE').Type,18);
 assert.throws(()=>rs.load({columns,values:[['bad',1,65536,0,'1']]}),overflow);
 assert.equal(rs.Item('TABLE_NAME'),'fixture');
});

test('signed 64-bit native fields retain exact min/max and reject rounded Numbers',()=>{
 const Type=20;
 for(const value of ['-9223372036854775808','9223372036854775807','9007199254740993','-9007199254740993']){
  for(const input of [value,BigInt(value),new VBDecimal(value)]){
   const result=fieldValue({Type},input);
   assert(result instanceof VBDecimal);assert.equal(result.toString(),value);
   assert.equal(fieldValue({Type},decodeCell(JSON.parse(JSON.stringify(encodeCell(result))))).toString(),value);
  }
 }
 for(const value of ['-9223372036854775809','9223372036854775808',Number('9223372036854775807')])assert.throws(()=>fieldValue({Type},value),overflow);
 assert.equal(fieldValue({Type},'-2.5').toString(),'-2');
 assert.equal(fieldValue({Type},'-3.5').toString(),'-4');
});
test('all native integer widths leave the previous field value intact on overflow',()=>{
 for(const [Type,valid,invalid]of [[16,127,128],[18,65535,65536],[19,4294967295,4294967296],[20,'9223372036854775807','9223372036854775808'],[21,'18446744073709551615','18446744073709551616']]){
  const rs=new DisconnectedRecordset();rs.Fields.Append('n',Type);rs.Open();rs.AddNew('n',valid);
  assert.throws(()=>{rs.Fields.Item(0).Value=invalid;},overflow);
  assert.equal(String(rs.Fields.Item(0).Value),String(valid));assert.equal(rs.EditMode,0);
 }
});

test('connected native integer fields expose their real byte widths',async()=>{
 const {ConnectedRecordset}=await import('../src/data/connected-recordset.js');
 const widths=[[16,1],[17,1],[18,2],[19,4],[20,8],[21,8]],rs=new ConnectedRecordset({});
 rs.load({columns:widths.map(([Type])=>({Name:'n'+Type,Type})),values:[widths.map(()=>1)]});
 for(const [Type,size]of widths)assert.equal(rs.Fields.Item('n'+Type).ActualSize,size);
});
test('compiled VB accesses native widths and catches overflow without corrupting a field',async()=>{
 const {compileProject}=await import('../src/language/compiler.js');
 const {VirtualMachine}=await import('../src/runtime/vm.js');
 const code=`Option Explicit
Sub Main()
 Dim rs As New ADODB.Recordset
 rs.Fields.Append "Flags", adUnsignedInt
 rs.Fields.Append "Big", adUnsignedBigInt
 rs.Open
 rs.AddNew
 rs.Fields("Flags").Value = "4294967295"
 rs.Fields("Big").Value = CDec("18446744073709551615")
 rs.Update
 Debug.Print rs.Fields("Flags").Value
 Debug.Print rs.Fields("Big").Value
 Debug.Print rs.Fields("Big").ActualSize
 On Error Resume Next
 rs.Fields("Big").Value = CDec("18446744073709551616")
 Debug.Print Err.Number
 Debug.Print rs.Fields("Big").Value
 rs.Close
End Sub`;
 const project={schema:1,name:'NativeWidths',startup:'Sub Main',modules:[{id:'module',name:'MainModule',kind:'module',code}]};
 const program=compileProject(project);assert.deepEqual(program.diagnostics,[]);const output=[];
 const vm=new VirtualMachine(program,{print:value=>output.push(value)});
 try{await vm.start();assert.deepEqual(output,['4294967295','18446744073709551615','8','6','18446744073709551615']);}finally{await vm.data.close();}
});

test('native 64-bit cursor sorting does not collapse adjacent values above 2^53',async()=>{
 const {ConnectedRecordset}=await import('../src/data/connected-recordset.js');
 for(const C of [DisconnectedRecordset,ConnectedRecordset]){
  const rs=new C({});rs.Fields.Append('n',21);rs.Open();
  for(const n of ['18446744073709551615','18446744073709551613','18446744073709551614'])rs.AddNew('n',n);
  rs.Sort='n ASC';assert.deepEqual(rs.view().map(row=>row.n.toString()),['18446744073709551613','18446744073709551614','18446744073709551615']);
  rs.Sort='n DESC';assert.equal(rs.view()[0].n.toString(),'18446744073709551615');
 }
});
test('native Decimal equality and DAO integer criteria preserve every bit',async()=>{
 const {sameValue}=await import('../src/data/common.js');
 const {compileCriteria,compareData}=await import('../src/data/criteria.js');
 const lo=new VBDecimal('18446744073709551614'),hi=new VBDecimal('18446744073709551615');
 assert(sameValue(lo,new VBDecimal(lo.toString())));assert(!sameValue(lo,hi));assert.equal(compareData(lo,hi),-1);
 const matches=compileCriteria('n = 18446744073709551615',[{Name:'n',Type:21}]);
 assert.equal(matches({n:lo}),false);assert.equal(matches({n:hi}),true);
});

test('Decimal criteria preserve sixteen-digit safe integers as well as wider literals',async()=>{
 const {compileCriteria,compareData}=await import('../src/data/criteria.js');
 for(const literal of ['9007199254740991','9007199254740990','1000000000000001','-9007199254740991']){
  const n=new VBDecimal(literal),neighbor=n.subtract(1);
  assert.equal(compareData(n,Number(literal)),0);
  assert.equal(compareData(Number(literal),n),0);
  for(const text of ['n = '+literal,'n IN ('+literal+')','n BETWEEN '+literal+' AND '+literal]){
   const matches=compileCriteria(text,[{Name:'n',Type:20}]);
   assert.equal(matches({n}),true,text);
   assert.equal(matches({n:neighbor}),false,text);
  }
 }
});

test('mixed Variant cursor sorting retains the newer remote Decimal comparison behavior',async()=>{
 const {ConnectedRecordset}=await import('../src/data/connected-recordset.js');
 for(const C of [ProviderRecordset,ConnectedRecordset]){
  const rs=new C({});rs.load({columns:[{Name:'n',Type:12}],values:[[new VBDecimal('9007199254740992')],[9007199254740991],[new VBDecimal('9007199254740990')],[null]]});
  rs.Sort='n ASC';assert.deepEqual(rs.view().map(row=>row.n===null?null:String(row.n)),[null,'9007199254740990','9007199254740991','9007199254740992']);
 }
});
