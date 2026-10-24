import test from 'node:test';
import assert from 'node:assert/strict';
import {appImageIsoNamespaceCommand} from '../tools/linux-appimage-iso-namespace.mjs';

const fixture={emptyDirectory:'/tmp/iso mask',filename:'/tmp/literal $(touch should-not-exist); image.AppImage',uid:1001,gid:1002};

test('unprivileged ISO proof creates a private user and mount namespace with literal paths',()=>{
  const plan=appImageIsoNamespaceCommand({...fixture,mode:'user'});
  assert.equal(plan.command,'/usr/bin/unshare');assert.deepEqual(plan.args.slice(0,4),['--user','--map-root-user','--mount','--fork']);
  const script=plan.args[6];assert.match(script,/^\/usr\/bin\/mount --make-rprivate \/;/);
  assert.match(script,/test ! -e \/usr\/share\/xml\/iso-codes\/iso_639\.xml/);
  assert.match(script,/test ! -e \/usr\/share\/xml\/iso-codes\/iso_639_3\.xml/);
  assert.ok(!script.includes(fixture.filename));assert.deepEqual(plan.args.slice(-3),[fixture.emptyDirectory,fixture.filename,'--appimage-extract-and-run']);
});

test('privileged ISO proof drops and checks the original identity before restoring selected session variables',()=>{
  const environment={HOME:'/home/runner',DISPLAY:':99',XAUTHORITY:'/tmp/display auth',XDG_RUNTIME_DIR:'/run/user/1001',
    DBUS_SESSION_BUS_ADDRESS:'unix:path=/tmp/session-bus',TMPDIR:'/tmp/private runtime',GSK_RENDERER:'cairo',GTK_A11Y:'test',
    PATH:'/untrusted/bin',LD_PRELOAD:'/untrusted/preload.so',BASH_ENV:'/untrusted/shell',UNRELATED_SECRET:'not inherited'};
  const plan=appImageIsoNamespaceCommand({...fixture,mode:'privileged',environment});
  assert.equal(plan.command,'/usr/bin/sudo');assert.deepEqual(plan.args.slice(0,5),['-n','--','/usr/bin/unshare','--mount','--fork']);
  const drop=plan.args.indexOf('/usr/bin/setpriv'),restore=plan.args.indexOf('/usr/bin/env');
  assert.ok(drop>0&&restore>drop);assert.deepEqual(plan.args.slice(drop,restore),['/usr/bin/setpriv','--reuid=1001','--regid=1002','--clear-groups','--no-new-privs']);
  assert.deepEqual(plan.args.slice(restore,restore+3),['/usr/bin/env','-i','PATH=/usr/bin:/bin']);
  for(const name of ['HOME','DISPLAY','XAUTHORITY','XDG_RUNTIME_DIR','DBUS_SESSION_BUS_ADDRESS','TMPDIR','GSK_RENDERER','GTK_A11Y'])assert.ok(plan.args.includes(name+'='+environment[name]));
  assert.ok(!plan.args.some(value=>value.includes('/untrusted/')||value.includes('UNRELATED_SECRET')));
  const script=plan.args.at(-6);assert.match(script,/\/usr\/bin\/id -u/);assert.match(script,/\/usr\/bin\/id -g/);
  assert.deepEqual(plan.args.slice(-4),['1001','1002',fixture.filename,'--appimage-extract-and-run']);
});

test('ISO fixture rejects invalid modes, identities, paths and environment values before privilege setup',()=>{
  for(const options of [{mode:'off'},{uid:-1},{gid:1.5},{filename:'relative.AppImage'},{emptyDirectory:'/tmp/a\0b'},
    {mode:'privileged',environment:{DISPLAY:':99\0bad'}}])assert.throws(()=>appImageIsoNamespaceCommand({...fixture,...options}));
});
