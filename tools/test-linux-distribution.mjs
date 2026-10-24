/** Independent package tools must extract and execute the exact compiled bytes. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {exportLinuxApplication,unpackLinuxAOTArchive} from '../packages/linux-native/src/aot-export.js';
import {packageLinuxApplication} from '../packages/linux-native/src/distribution.js';
const root=path.resolve(import.meta.dirname,'..');
const project={schema:1,name:'Distribution App',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code:`Option Explicit
Public Sub Main()
    Dim channel As Integer, value As String
    channel = FreeFile
    Open App.Path & "/../Resources/data.txt" For Input As #channel
    Line Input #channel, value
    Close #channel
    Debug.Assert value = "LINUX_PACKAGE_RESOURCE_OK"
    Debug.Print "LINUX_DISTRIBUTION_OK"
End Sub`}]};
export async function testLinuxDistribution({architecture=process.arch,sysroot,reportDirectory=path.join(root,'reports/linux-distribution-'+architecture)}={}) {
  assert.equal(process.platform,'linux','Distribution qualification requires Linux package tools.');
  assert.ok(['x64','arm64'].includes(architecture));
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-linux-distribution-')),checks=[];
  const report={platform:process.platform,architecture,hostArchitecture:process.arch,executionMode:process.arch===architecture?'native':'qemu-user',passed:false,checks};
  const run=(tool,args,options={})=>execFileSync(tool,args,{cwd:work,encoding:'utf8',timeout:60000,maxBuffer:256*1024*1024,env:{...process.env,LC_ALL:'C'},...options});
  const execute=filename=>{
    if(architecture===process.arch)return run(filename,[]);
    assert.ok(sysroot,'Cross-architecture execution needs an explicit sysroot.');
    return run(architecture==='arm64'?'qemu-aarch64':'qemu-x86_64',['-L',path.resolve(sysroot),filename]);
  };
  try {
    const resources={'Resources/data.txt':'LINUX_PACKAGE_RESOURCE_OK\n'};
    const app=await exportLinuxApplication(project,{architecture},{resources});
    const packageName='vb6-distribution-'+architecture;
    for(const format of ['zip','tar.gz','deb','rpm']){
      const exported=await packageLinuxApplication(app,{format,packageName,version:'2.3.4',release:'5',maintainer:'Package Fixture <fixture@example.invalid>',license:'MIT'});
      const file=path.join(work,exported.filename),directory=path.join(work,format.replace('.','-'));await fs.writeFile(file,exported.bytes);await fs.mkdir(directory);
      let executable;
      if(format==='zip'){
        const unpacked=await unpackLinuxAOTArchive(exported.bytes,exported.options);
        for(const [name,bytes]of unpacked.files){const destination=path.join(directory,name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes,{mode:name===app.options.name+'/bin/'+app.options.name?0o755:0o644});}
        executable=path.join(directory,app.options.name,'bin',app.options.name);
      }else if(format==='tar.gz'){
        run('tar',['-xzf',file,'-C',directory]);executable=path.join(directory,app.options.name,'bin',app.options.name);
      }else {
        if(format==='deb'){
          const fields=run('dpkg-deb',['--field',file]);assert.match(fields,/Package: vb6-distribution-/);assert.ok(fields.includes('Architecture: '+(architecture==='arm64'?'arm64':'amd64')));assert.match(fields,/libcups2t64/);
          run('dpkg-deb',['--extract',file,directory]);const control=path.join(work,'deb-control');run('dpkg-deb',['--control',file,control]);
          run('md5sum',['--check',path.join(control,'md5sums')],{cwd:directory});
        }else {
          const dbpath=path.join(work,'rpmdb');
          const digest=run('rpm',['--dbpath',dbpath,'--checksig','--verbose',file]);
          for(const label of ['Header SHA256 digest: OK','Header SHA1 digest: OK','Payload SHA256 digest: OK','MD5 digest: OK'])assert.ok(digest.includes(label),label);
          assert.equal(run('rpm',['--dbpath',dbpath,'--query','--package','--queryformat','%{ARCH}',file]),architecture==='arm64'?'aarch64':'x86_64');
          const requires=run('rpm',['--dbpath',dbpath,'--query','--package','--requires',file]);
          assert.match(requires,/GLIBCXX_3\.4\.32/);assert.match(requires,/CXXABI_1\.3\.13/);assert.match(requires,/gtk3 >= 3\.24/);
          for(const version of architecture==='arm64'?['3.0','4.2.0','4.5.0']:['3.0','4.2.0'])assert.ok(requires.includes('libgcc_s.so.1(GCC_'+version+')(64bit)'),'RPM omits its required GCC_'+version+' capability');
          const scripts=run('rpm',['--dbpath',dbpath,'--query','--package','--scripts',file]);assert.equal(scripts,'');
          const payload=run('rpm2cpio',[file],{encoding:null});run('cpio',['-idm','--quiet','--no-absolute-filenames'],{cwd:directory,input:payload});
          const damaged=exported.bytes.slice();damaged[damaged.length-20]^=1;const invalid=path.join(work,'damaged.rpm');await fs.writeFile(invalid,damaged);
          assert.throws(()=>run('rpm',['--dbpath',dbpath,'--checksig',invalid]));
        }
        const launcher=path.join(directory,'usr/bin',packageName);assert.equal(await fs.readlink(launcher),'../lib/'+packageName+'/bin/'+app.options.name);
        executable=await fs.realpath(launcher);assert.ok(executable.startsWith(directory+path.sep));
        run('desktop-file-validate',[path.join(directory,'usr/share/applications',packageName+'.desktop')]);
        assert.match(await fs.readFile(path.join(directory,'usr/share/doc',packageName,'copyright'),'utf8'),/Permission is hereby granted/);
        assert.match(execute(launcher),/LINUX_DISTRIBUTION_OK/);
      }
      assert.deepEqual(new Uint8Array(await fs.readFile(executable)),app.executable);assert.equal((await fs.stat(executable)).mode&0o777,0o755);
      const versions=run('readelf',['--version-info',executable]);
      const floors={GLIBC:[2,39],GLIBCXX:[3,4,32],CXXABI:[1,3,13],GCC:architecture==='arm64'?[4,5,0]:[4,2,0]};
      for(const match of versions.matchAll(/Name: (GLIBCXX|GLIBC|CXXABI|GCC)_([0-9.]+)/g)){
        const required=match[2].split('.').map(Number),available=floors[match[1]];
        let comparison=0;for(let i=0;i<Math.max(required.length,available.length);i++)if(required[i]!==available[i]){comparison=(required[i]||0)-(available[i]||0);if(comparison)break;}
        assert.ok(comparison<=0,'Runtime symbol '+match[0]+' exceeds the declared package dependency floor');
      }
      assert.match(execute(executable),/LINUX_DISTRIBUTION_OK/);
      checks.push({format,filename:exported.filename,sha256:createHash('sha256').update(exported.bytes).digest('hex'),executableSha256:app.report.executableSha256,resourceExecution:true,permissionsVerified:true});
      console.log('PASS '+architecture+' '+format+': independently extracted executable and resources run successfully');
    }
    const unicodeName='Zażółć '+ '漢'.repeat(60)+' $(literal)',resourcePath='Resources/'+ 'r'.repeat(160)+'/'+ 'é'.repeat(80)+'.txt';
    const unicode=await exportLinuxApplication({...project,name:unicodeName},{architecture,name:unicodeName},{resources:{...resources,[resourcePath]:'Long Unicode resource'}});
    for(const format of ['tar.gz','deb','rpm']){
      const exported=await packageLinuxApplication(unicode,{format,packageName:'unicode-fixture'}),file=path.join(work,exported.filename),directory=path.join(work,'unicode-'+format.replace('.','-'));
      await fs.writeFile(file,exported.bytes);await fs.mkdir(directory);
      if(format==='tar.gz')run('tar',['-xzf',file,'-C',directory]);
      else if(format==='deb')run('dpkg-deb',['--extract',file,directory]);
      else run('cpio',['-idm','--quiet','--no-absolute-filenames'],{cwd:directory,input:run('rpm2cpio',[file],{encoding:null})});
      const application=path.join(directory,format==='tar.gz'?unicodeName:'usr/lib/unicode-fixture');
      assert.equal(await fs.readFile(path.join(application,resourcePath),'utf8'),'Long Unicode resource');
      assert.match(execute(path.join(application,'bin',unicodeName)),/LINUX_DISTRIBUTION_OK/);
      checks.push({format,unicodePaths:true});console.log('PASS '+architecture+' '+format+': long UTF-8 paths and literal shell characters');
    }
    report.passed=true;return report;
  }catch(error){report.error={message:error.message,output:error.stdout?.toString(),stderr:error.stderr?.toString()};throw error;}
  finally {await fs.mkdir(reportDirectory,{recursive:true});await fs.writeFile(path.join(reportDirectory,'validation.json'),JSON.stringify(report,null,2)+'\n');await fs.rm(work,{recursive:true,force:true});}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options={};for(let index=2;index<process.argv.length;index+=2){const flag=process.argv[index];if(!['--architecture','--sysroot','--report'].includes(flag)||!process.argv[index+1])throw new Error('Expected --architecture x64|arm64, --sysroot PATH, or --report PATH');options[flag==='--report'?'reportDirectory':flag.slice(2)]=process.argv[index+1];}
  await testLinuxDistribution(options);
}
