import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderRecordset} from '../src/data/provider-recordset.js';
function rows(Type, values) {
 const rs=new ProviderRecordset({});
 rs.load({columns:[{Name:'value',Type},{Name:'ordinal',Type:3}],values:values.map((value,i)=>[value,i])});
 return rs;
}
const values=rs=>rs.view().map(row=>row.value===null?null:row.value.toString());
test('native unsigned 64-bit sorting distinguishes adjacent values beyond Double precision',()=>{
 const input=['18446744073709551615','18446744073709551614','18446744073709551613'];
 const rs=rows(21,input);rs.Sort='value ASC';assert.deepEqual(values(rs),input.toReversed());
 rs.Sort='value DESC';assert.deepEqual(values(rs),input);
 rs.Filter='value = 18446744073709551614';assert.deepEqual(values(rs),[input[1]]);
 rs.Filter='value < 18446744073709551615';assert.deepEqual(values(rs),input.slice(1));
});
test('Decimal and Numeric sorting retains fractional precision and stable ties',()=>{
 for(const Type of [14,131]){
  const input=['0.1000000000000000000000000002','0.1000000000000000000000000001','0.1000000000000000000000000002'];
  const rs=rows(Type,input);rs.Sort='value ASC';assert.deepEqual(rs.view().map(r=>r.ordinal),[1,0,2]);
  rs.Sort='value DESC, ordinal DESC';assert.deepEqual(rs.view().map(r=>r.ordinal),[2,0,1]);
 }
});
test('exact numeric sorting preserves Null order and signed Decimal values',()=>{
 const rs=rows(14,['-0.1000000000000000000000000001',null,'-0.1000000000000000000000000002','0']);
 rs.Sort='value ASC';assert.deepEqual(rs.view().map(r=>r.ordinal),[1,2,0,3]);
 rs.Sort='value DESC';assert.deepEqual(rs.view().map(r=>r.ordinal),[3,0,2,1]);
});
