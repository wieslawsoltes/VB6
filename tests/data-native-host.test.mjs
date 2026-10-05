import test from 'node:test';import assert from 'node:assert/strict';import {oledbHost} from '../tools/data/oledb.mjs';
const system={platform:'win32',env:{SystemRoot:'C:\\Windows'}};
test('OLE DB resolves explicit trusted process bitness without a client-selected executable',()=>{
 assert.equal(oledbHost({architecture:'x86'},system),'C:\\Windows\\SysWOW64\\WindowsPowerShell\\v1.0\\powershell.exe');
 assert.equal(oledbHost({architecture:'x64'},system),'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
 assert.equal(oledbHost({architecture:'x64'},{...system,arch:'ia32'}),'C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe');
 assert.throws(()=>oledbHost({architecture:'invalid'},system));assert.throws(()=>oledbHost({},{platform:'linux'}));assert.throws(()=>oledbHost({},{platform:'win32',env:{}}));
 assert.equal(oledbHost({powershell:'C:\\Trusted\\host.exe'},system),'C:\\Trusted\\host.exe');
});
