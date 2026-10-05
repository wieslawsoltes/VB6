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
