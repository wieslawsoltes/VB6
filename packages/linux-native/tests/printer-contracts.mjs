/** Native service qualification, including real CUPS protocol and GTK print submission. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {inflateSync} from 'node:zlib';
import {createMockCups} from './mock-cups.mjs';

function pdfPages(bytes){
  const raw=bytes.toString('latin1'),objects=[raw];
  // Cairo can place page dictionaries inside compressed PDF object streams.
  // Decode only those bounded streams; image/font payloads are irrelevant.
  for(const match of raw.matchAll(/\/Type\s*\/ObjStm\b/g)){
    const start=raw.lastIndexOf('<<',match.index),end=raw.indexOf('stream\n',match.index);
    assert.ok(start>=0&&end>start&&end-start<4096,'Invalid Cairo PDF object stream');
    const dictionary=raw.slice(start,end),declared=dictionary.match(/\/Length\s+(\d+)\b(?:\s+(\d+)\s+R\b)?/);
    const length=Number(declared?.[2]===undefined?declared?.[1]:raw.match(new RegExp('(?:^|\\n)'+declared[1]+'\\s+'+declared[2]+'\\s+obj\\s+(\\d+)\\s+endobj'))?.[1]);
    assert.ok(Number.isSafeInteger(length)&&length>0&&length<16*1024*1024&&/\/FlateDecode\b/.test(dictionary),'Unexpected Cairo PDF object stream encoding');
    objects.push(inflateSync(bytes.subarray(end+7,end+7+length),{maxOutputLength:16*1024*1024}).toString('latin1'));
  }
  return objects.reduce((total,value)=>total+(value.match(/\/Type\s*\/Page\b/g)||[]).length,0);
}

async function nativeCase(executable,mode,{service,home,prefix=[],emulated=false,onLine=()=>{}}) {
  const env={...process.env,CUPS_SERVER:service.server,HOME:home,GTK_PRINT_BACKENDS:'cups'};
  delete env.DISPLAY;delete env.WAYLAND_DISPLAY;delete env.LPDEST;delete env.PRINTER;
  // QEMU still opens and edits all three real GTK dialogs. Its software CPU
  // needs a larger bounded watchdog; ordinary native qualification is unchanged.
  if(emulated)env.VB6_GTK_TEST_EMULATED='1';else delete env.VB6_GTK_TEST_EMULATED;
  const command=prefix.length?prefix[0]:executable,args=[...prefix.slice(1),...(prefix.length?[executable]:[]),mode];
  const child=spawn(command,args,{env,stdio:['pipe','pipe','pipe']});let stdout='',stderr='',pending='';
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Native printer fixture timed out: '+mode+'\n'+stdout+'\n'+stderr));},emulated?180000:60000);
    child.on('error',error=>{clearTimeout(timeout);reject(error);});
    child.stdout.on('data',bytes=>{
      stdout+=bytes;pending+=bytes;
      while(pending.includes('\n')){const at=pending.indexOf('\n'),line=pending.slice(0,at);pending=pending.slice(at+1);try{onLine(line,child);}catch(error){child.kill('SIGKILL');clearTimeout(timeout);reject(error);}}
    });
    child.stderr.on('data',bytes=>stderr+=bytes);
    child.on('close',(code,signal)=>{
      clearTimeout(timeout);
      // GTK's optional colord integration warns in containers without a system
      // D-Bus. These exact environment diagnostics do not affect CUPS printing.
      const diagnostics=stderr.replace(/^\s*\*\* \([^\n]+\): WARNING \*\*: [^\n]+: (?:Couldn't connect to D-Bus system bus, Could not connect: No such file or directory|failed to contact colord: Could not connect: No such file or directory)\n/gm,'').trim();
      try{assert.equal(code,0,'Native printer fixture failed ('+mode+', '+signal+'):\n'+stdout+'\n'+stderr);assert.equal(diagnostics,'','Native printing emitted unexpected GTK/CUPS warnings');resolve(stdout);}catch(error){reject(error);}
    });
  });
}

export async function qualifyLinuxPrinters(executable,{prefix=[],printPrefix=['xvfb-run','-a'],emulated=false}={}) {
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-cups-contracts-'));const results=[];
  try {
    const empty=await createMockCups({printers:[],defaultPrinter:''});
    try{
      const stdout=await nativeCase(executable,'--empty',{service:empty,home,prefix,emulated});assert.match(stdout,/LINUX_PRINTERS_EMPTY_OK/);
      assert.ok(empty.requests.some(value=>value.operation===0x4002),'Empty inventory did not query CUPS');assert.deepEqual(empty.errors,[]);
      results.push({name:'empty-service',requests:empty.requests.length});
    }finally{await empty.close();}
    for(const print of [false,true]){
      const service=await createMockCups();
      try{
        const stdout=await nativeCase(executable,print?'--print':'--printers',{service,home,emulated,prefix:print?[...printPrefix,...prefix]:prefix,onLine:(line,child)=>{
          if(line==='READY_DEFAULT'){service.defaultPrinter='VB6_A';child.stdin.write('default-changed\n');}
          if(line==='READY_REMOVE'){service.printers=['VB6_A'];child.stdin.write('printer-removed\n');}
          if(line==='READY_REJECT'){service.rejectJobs=true;child.stdin.write('reject-jobs\n');}
        }});
        assert.match(stdout,print?/LINUX_PRINTERS_PRINT_OK/:/LINUX_PRINTERS_NATIVE_OK/);assert.deepEqual(service.errors,[]);
        assert.ok(service.requests.some(value=>value.operation===0x4002),'Inventory was not supplied by CUPS');
        if(print){
          assert.equal(service.documents.length,1,'GTK must submit exactly one document; KillDoc must submit none');
          const document=service.documents[0];assert.ok(document.bytes.length>1000,'GTK print submission omitted document contents');
          assert.match(document.bytes.subarray(0,16).toString(),/^%PDF-|^%!PS-/,'GTK did not render a real PDF/PostScript print document');
          const jobs=service.requests.filter(value=>[2,5].includes(value.operation)&&!value.rejected);assert.equal(jobs.length,1,'EndDoc submitted the wrong number of CUPS jobs');
          assert.match(jobs[0].attributes.get('printer-uri')?.[0]?.value.toString()||'',/\/printers\/VB6_A$/,'Set Printer did not control the submission destination');
          const pages=pdfPages(document.bytes),copies=jobs[0].attributes.get('copies')?.[0]?.value.readInt32BE()||1;
          assert.equal(pages*copies,6,'The two-page, three-copy job did not retain its requested page/copy count');
          assert.ok(service.requests.some(value=>value.rejected),'Rejected jobs did not reach the CUPS service');
          results.push({name:'print-submit-cancel-and-reject',requests:service.requests.length,documentBytes:document.bytes.length,pages,copies,header:document.bytes.subarray(0,8).toString()});
        }else{
          assert.equal(service.documents.length,0,'Enumeration or selection submitted a print job');
          results.push({name:'headless-properties-selection-default-removal',requests:service.requests.length});
        }
      }catch(error){throw new Error(error.message+'\nIPP job requests: '+JSON.stringify(service.requests.filter(value=>[2,5,6].includes(value.operation)).map(value=>({operation:value.operation,rejected:!!value.rejected,documentBytes:value.document.length}))),{cause:error});}
      finally{await service.close();}
    }
    const dialogs=await createMockCups();
    try{
      const stdout=await nativeCase(executable,'--dialogs',{service:dialogs,home,emulated,prefix:[...printPrefix,...prefix]});
      assert.match(stdout,/LINUX_SCREEN_CURSORS_OK/);assert.match(stdout,/LINUX_GTK_PRINTER_DIALOGS_OK/);assert.deepEqual(dialogs.errors,[]);
      assert.equal(dialogs.documents.length,0,'The settings dialog submitted an empty print document');
      assert.equal(dialogs.requests.filter(value=>[2,5,6].includes(value.operation)).length,0,'The settings dialog created a CUPS job');
      results.push({name:'printer-dialog-accept-cancel-and-screen-cursors',requests:dialogs.requests.length});
    }finally{await dialogs.close();}
    return {passed:true,cases:results};
  }finally{await fs.rm(home,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{if(process.argv.length!==3)throw new Error('Usage: node printer-contracts.mjs /absolute/path/to/gtk-services-contracts');console.log(JSON.stringify(await qualifyLinuxPrinters(path.resolve(process.argv[2])),null,2));}
  catch(error){console.error(error);process.exitCode=1;}
}
