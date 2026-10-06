/** Differential checks use retained/fresh Windows API evidence, never a self oracle. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCALAR_TYPES,VBErrorValue,VBCurrency,VBDecimal,tagScalar,scalarType,unbox,coerce,scalarBinary} from '../../src/runtime/values.js';
import {serialToDate,dateToSerial} from '../../src/runtime/calendar.js';
const typeNames=Object.fromEntries(Object.entries(SCALAR_TYPES).map(([n,t])=>[t,n]));
const HRESULT={5:-2147024809,6:-2147352566,11:-2147352558,13:-2147352571,94:-2147352571};
export function operand({type,value}){
  const name=typeNames[type];if(!name)throw Error('Unknown oracle type '+type);
  const raw=type===0?undefined:type===1?null:type===6?new VBCurrency(value):type===7?serialToDate(Number(value)):type===8?value:type===10?new VBErrorValue(Number(value)):type===14?new VBDecimal(value):Number(value);
  return tagScalar(raw,name,true);
}
export function execute(vector){
 try{
  const a=operand(vector.a),b=operand(vector.b);let value;
  if(vector.op==='convert')value=tagScalar(coerce(a,typeNames[vector.b.type]),typeNames[vector.b.type],true);
  else if(vector.op==='cmp'){
    const equal=unbox(scalarBinary('=',a,b));
    if(equal===null)return {type:1,value:'Null',hresult:0};
    return {type:2,value:equal?'0':unbox(scalarBinary('<',a,b))?'-1':'1',hresult:0};
  }else value=scalarBinary(vector.op,a,b);
  const raw=unbox(value),type=SCALAR_TYPES[scalarType(value)];
  return {type,value:type===0?'Empty':type===1?'Null':type===7?String(dateToSerial(raw)):String(raw),hresult:0};
 }catch(error){if(!(error.number in HRESULT))throw error;return {hresult:HRESULT[error.number]};}
}
/** IEEE float comparison uses ULP distance, not decimal relative tolerances. */
function ulps(a,b){
 if(a===b)return 0n;
 if(!Number.isFinite(a)||!Number.isFinite(b))return 1n<<64n;
 const array=new DataView(new ArrayBuffer(8));
 const ordered=n=>{array.setFloat64(0,n);const bits=array.getBigUint64(0);return bits>>63n?~bits:bits|(1n<<63n);};
 const x=ordered(a),y=ordered(b);return x>y?x-y:y-x;
}
export function equivalent(actual,expected){
 if(actual.hresult!==expected.hresult)return false;
 if(expected.hresult<0)return true;
 if(actual.type!==expected.type)return false;
 if(actual.type===1)return true;
 if(actual.type===4)return Object.is(Math.fround(Number(actual.value)),Math.fround(Number(expected.value)))||Number(actual.value)===Number(expected.value);
 if(actual.type===5)return ulps(Number(actual.value),Number(expected.value))<=2n;
 if(actual.type===7)return Math.abs(Number(actual.value)-Number(expected.value))*86400000<=1.001;
 if(actual.type===6||actual.type===14)return new VBDecimal(actual.value).compare(new VBDecimal(expected.value))===0;
 return actual.value===expected.value;
}
/** These APIs are not interchangeable with language operations in these cases.
 * Classifications depend solely on the operation, never on whether a test fails.
 * Every case remains in the report and is not counted as a passing comparison. */
export function distinction(vector){
 if(vector.op==='convert'&&vector.a.type===11&&vector.b.type===8)return 'VariantChangeTypeEx flags=0 uses numeric Boolean text; VB CStr uses alphabetic Boolean text';
 if(vector.op==='cmp'&&[vector.a.type,vector.b.type].sort((a,b)=>a-b).join(',')==='11,17')return 'VarCmp Byte/Boolean unsigned coercion differs from MS-VBAL Integer effective type';
 if(vector.op==='convert'&&vector.a.type===8&&vector.b.type===7&&vector.a.value==='1,2')return 'Yearless date uses the native capture clock';
 return null;
}
export function retainedCorpora(){
 const root=new URL('../../tests/fixtures/scalar/',import.meta.url);
 return ['automation','boundaries'].map(name=>JSON.parse(fs.readFileSync(new URL(name+'.json',root),'utf8')));
}
export function prepare(){
 const operations=[];for(const [corpus,fixture]of retainedCorpora().entries())for(const v of fixture.vectors.operations)operations.push({...v,caseId:v.id,corpus,id:operations.length});
 return {operations,encodings:[]};
}
export function compare(vectors,report){
 if(!Array.isArray(vectors.operations)||!Array.isArray(report.operations)||report.unexpectedErrors!==0)throw Error('Invalid oracle report');
 const results=new Map();for(const result of report.operations){if(results.has(result.id)||!result.result||result.error)throw Error('Duplicate or failed oracle result');results.set(result.id,result.result);}
 const ids=new Set(vectors.operations.map(v=>v.id));if(ids.size!==vectors.operations.length||results.size!==ids.size||[...results.keys()].some(id=>!ids.has(id)))throw Error('Missing/duplicate/unexpected vectors');
 const mismatches=[],excluded=[];let passed=0;
 for(const vector of vectors.operations){const expected=results.get(vector.id),actual=execute(vector),reason=distinction(vector);if(reason){excluded.push({vector,reason,expected,actual});continue;}if(equivalent(actual,expected))passed++;else mismatches.push({vector,expected,actual});}
 return {total:ids.size,compared:ids.size-excluded.length,passed,failed:mismatches.length,excluded,oracle:{name:report.oracle,os:report.os,architecture:report.architecture,oleaut32Version:report.oleaut32Version,oleaut32Sha256:report.oleaut32Sha256},mismatches};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,input,oracle,output]=process.argv.slice(2);
 if(command==='prepare'){
  if(!input)throw Error('Output path is required');fs.mkdirSync(path.dirname(input),{recursive:true});fs.writeFileSync(input,JSON.stringify(prepare(),null,2)+'\n');console.log('Prepared '+prepare().operations.length+' reference operations');
 }else if(command==='check'){
  const parse=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
  const report=compare(parse(input),parse(oracle));
  if(output){fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');}
  console.log(JSON.stringify({...report,mismatches:report.mismatches.slice(0,20)},null,2));if(report.failed)process.exitCode=1;
 }else throw Error('Usage: check-scalars.mjs prepare vectors.json | check vectors.json windows-oracle.json [report.json]');
}
