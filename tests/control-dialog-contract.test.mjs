import test from 'node:test';
import assert from 'node:assert/strict';
import {dialogCancelled,dialogColor,dialogFont} from '../src/controls/common-dialog-contract.js';
const error=n=>e=>e.number===n;
test('CommonDialog RGB input converts into OLE BGR numbers and rejects malformed values',()=>{
 assert.equal(dialogColor('#123456'),0x563412);assert.equal(dialogColor('#000000'),0);assert.equal(dialogColor('#FFFFFF'),16777215);for(const value of ['',null,'#fff','#12345678','red','123456','#12gg56'])assert.throws(()=>dialogColor(value),error(380));
});
test('CommonDialog cancellation honors CancelError without mutating fields or rejecting disposal',()=>{
 const c={props:{CancelError:0,FileName:'old',Color:123}};assert.equal(dialogCancelled(c),false);c.props.CancelError=-1;assert.throws(()=>dialogCancelled(c),error(32755));assert.equal(c.props.FileName,'old');assert.equal(c.props.Color,123);c.disposed=true;assert.equal(dialogCancelled(c),false);
});
test('CommonDialog font fields are validated atomically and effects normalize to VB Boolean',()=>{
 const input={FontName:' Arial ',FontSize:'12.25',FontBold:true,FontItalic:0,FontUnderline:-1,FontStrikethru:false};assert.deepEqual(dialogFont(input),{FontName:'Arial',FontSize:12.25,FontBold:-1,FontItalic:0,FontUnderline:-1,FontStrikethru:0});assert.equal(input.FontName,' Arial ');
 for(const size of [-1,0,NaN,Infinity,1639])assert.throws(()=>dialogFont({...input,FontSize:size}),error(380));for(const name of ['',null,'line\nbreak','x'.repeat(256)])assert.throws(()=>dialogFont({...input,FontName:name}),error(380));assert.throws(()=>dialogFont({...input,Min:20}),error(380));assert.throws(()=>dialogFont({...input,Max:10}),error(380));
});
