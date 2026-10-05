/** Native provider conformance only against files created by this process in a new temp directory. */
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {randomBytes} from 'node:crypto';
import {createNativeDriver} from './data/drivers.mjs';import {createDataGateway} from './data-gateway.mjs';import {oledbHost} from './data/oledb.mjs';import {DataContext} from '../src/data/context.js';import {runProviderChecks} from './data/provider-validation.mjs';
const run=promisify(execFile),kind=process.argv[2];assert(['odbc','windows'].includes(kind),'Choose odbc or windows');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-provider-')),report={platform:process.platform,arch:process.arch,passed:false,providers:[],checks:[],inventoryErrors:[]};
const out=path.resolve('reports/data-providers');await fs.mkdir(out,{recursive:true});
async function testProvider(label,profile){
 const details={provider:label,passed:false};report.checks.push(details);
 const access=profile.driver==='oledb',token=randomBytes(32).toString('hex');let gateway,context;
 try {
  const native=await createNativeDriver(profile);try{details.runtime=native.info||{driver:profile.driver};}finally{await native.close();}
  gateway=createDataGateway({token,profiles:{Fixture:{...profile,allowAdHoc:true}}});await new Promise(resolve=>gateway.server.listen(0,'127.0.0.1',resolve));
  context=new DataContext({dataSources:{version:1,connections:[{name:'NativeFixture',provider:'gateway',profile:'Fixture',url:`http://127.0.0.1:${gateway.server.address().port}/data`,credentialRef:'ephemeral'}],commands:[]}},{credentialProvider:()=>token});
  const cn=context.connection();await cn.Open('NativeFixture');
  await cn.query(`CREATE TABLE fixture(id INTEGER PRIMARY KEY, label ${access?'VARCHAR(100)':'TEXT'}, payload ${access?'LONGBINARY':'BLOB'}, optional_value VARCHAR(50))`);
  const labelValue="O'Brien ?; π",binary=new Uint8Array([0,127,128,255]);
  await cn.query('INSERT INTO fixture(id,label,payload,optional_value) VALUES(?,?,?,?)',[1,labelValue,binary,null],1,30,'odbc');
  const rs=await cn.Execute('SELECT id,label,payload,optional_value FROM fixture ORDER BY id');
  assert.equal(rs.RecordCount,1);assert.equal(Number(rs.Item('id')),1);assert.equal(rs.Item('label'),labelValue);assert.deepEqual([...rs.Item('payload')],[...binary]);assert.equal(rs.Item('optional_value'),null);
  const empty=await cn.Execute('SELECT id,label FROM fixture WHERE id < 0');assert.equal(empty.State,1);assert.equal(empty.RecordCount,0);assert.equal(empty.Fields.Count,2);
  await cn.BeginTrans();await cn.query('UPDATE fixture SET label=? WHERE id=?',['rolled back',1],1,30,'odbc');await cn.RollbackTrans();assert.equal((await cn.Execute('SELECT label FROM fixture')).Item(0),labelValue);
  await cn.BeginTrans();await cn.query('UPDATE fixture SET label=? WHERE id=?',['committed',1],1,30,'odbc');await cn.CommitTrans();
  await cn.BeginTrans();await cn.query('DELETE FROM fixture');await cn.Close();await cn.Open('NativeFixture');assert.equal((await cn.Execute('SELECT label FROM fixture')).Item(0),'committed');
  assert((await cn.OpenSchema(20)).RecordCount>0);assert((await cn.OpenSchema(4)).RecordCount>=4);
  await assert.rejects(()=>cn.query('INSERT INTO fixture(id) VALUES(1)'));assert.equal((await cn.Execute('SELECT count(*) AS n FROM fixture')).Item(0),1);
  const db=await context.createObject('DAO.DBEngine.36').OpenDatabase('NativeFixture');const q=db.CreateQueryDef('','PARAMETERS p Long; SELECT label FROM fixture WHERE id=[p]');q.Parameters.Item(0).Value=1;assert.equal((await q.OpenRecordset(4)).Item(0),'committed');await db.Close();
  const rdo=context.createObject('RDO.rdoEngine'),rcn=await rdo.rdoEnvironments.Item(0).OpenConnection('Legacy',1,false,'NativeFixture');const rq=rcn.CreateQuery('Read','SELECT label FROM fixture WHERE id=?');rq.Item(0).Type=4;rq.Item(0).Value=1;assert.equal((await rq.OpenResultset(3,1)).Item(0).Value,'committed');await rcn.Close();
  await cn.query('DROP TABLE fixture');details.passed=true;details.tests=['actual installed provider','prepared Unicode/injection-shaped input','binary and Null','empty schema-bearing SELECT','commit','rollback','close rollback','schema','provider failure recovery','DAO typed parameter','RDO positional query'];
 }catch(error){details.error={name:error.name,message:error.message,number:error.number};throw error;}finally{
  // A failed context cleanup must not prevent gateway/worker cleanup.
  const failures=[];
  for(const cleanup of [()=>context?.close(),()=>gateway?.close()]){try{await cleanup();}catch(error){failures.push(error);}}
  if(failures.length){details.passed=false;details.cleanupErrors=failures.map(error=>String(error?.message||error));throw new AggregateError(failures,'Native provider cleanup failed');}
 }
 console.log('PASS native data provider:',label);
}
try {
 if(kind==='odbc'){
  assert.equal(process.platform,'linux');const filename=path.join(dir,'odbc.sqlite');await testProvider('unixODBC / SQLite3',{driver:'odbc',options:{connectionString:`Driver=SQLite3;Database=${filename};Timeout=10000;`}});
 }else{
  assert.equal(process.platform,'win32');
  const cases=[];
  for(const architecture of ['x86','x64']){
   try{
    const output=path.join(dir,`inventory-${architecture}.json`),powershell=oledbHost({architecture});
    await run(powershell,['-NoLogo','-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./data/windows-fixtures.ps1',import.meta.url)),'-Directory',dir,'-Output',output],{windowsHide:true,timeout:45000});
    const providers=JSON.parse((await fs.readFile(output,'utf8')).replace(/^\uFEFF/,''));assert(Array.isArray(providers),'Invalid provider inventory');
    for(const entry of providers){
     report.providers.push({...entry,architecture});
     if(entry.available)cases.push({label:entry.provider+' / '+architecture,profile:{driver:'oledb',architecture,options:{connectionString:`Provider=${entry.provider};Data Source=${entry.filename};`}}});
    }
   }catch(error){report.inventoryErrors.push({architecture,name:error.name,message:error.message});}
  }
  const jet=report.providers.find(p=>p.provider==='Microsoft.Jet.OLEDB.4.0'&&p.bits===32&&p.available);
  // MSDASQL is the installed OLE DB to ODBC bridge, not an emulated Access file reader.
  if(jet){
   // Keep the bridge independent of a failed Jet case leaving a table behind.
   const bridgeFile=path.join(dir,'access-odbc-fixture.mdb');
   await fs.copyFile(jet.filename,bridgeFile,fs.constants.COPYFILE_EXCL);
   cases.push({label:'MSDASQL / Access ODBC / x86',profile:{driver:'oledb',architecture:'x86',options:{connectionString:`Provider=MSDASQL;Driver={Microsoft Access Driver (*.mdb)};DBQ=${bridgeFile};`}}});
  }
  const outcomes=await runProviderChecks(cases,testProvider);report.outcomes=outcomes;
  assert(jet,'Required 32-bit Jet provider could not create a real MDB fixture');
  assert.equal(report.inventoryErrors.length,0,'Provider inventory failed; see windows.json');
  assert(outcomes.length>0&&outcomes.every(result=>result.passed),'Installed provider validation failed; see windows.json');
 }
 report.passed=true;
}finally{
 try{await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch(error){report.passed=false;report.cleanupError={name:error.name,message:error.message};throw error;}finally{await fs.writeFile(path.join(out,kind+'.json'),JSON.stringify(report,null,2));}
}
