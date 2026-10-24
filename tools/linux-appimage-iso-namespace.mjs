/** Fixed, test-only isolation for proving bundled GTK language data. */
import assert from 'node:assert/strict';

const mountScript='/usr/bin/mount --make-rprivate /; /usr/bin/mount --bind "$1" /usr/share/xml/iso-codes; test ! -e /usr/share/xml/iso-codes/iso_639.xml; test ! -e /usr/share/xml/iso-codes/iso_639_3.xml; shift; exec "$@"';
const identityScript='test "$(/usr/bin/id -u)" = "$1"; test "$(/usr/bin/id -g)" = "$2"; shift 2; exec "$@"';
const sessionVariables=['HOME','DISPLAY','XAUTHORITY','WAYLAND_DISPLAY','DBUS_SESSION_BUS_ADDRESS',
  'XDG_RUNTIME_DIR','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_DATA_DIRS','XDG_SESSION_TYPE','XDG_CURRENT_DESKTOP',
  'LANG','LC_ALL','GDK_BACKEND','GDK_DEBUG','GDK_DISABLE','GSK_RENDERER','GTK_A11Y','TMPDIR'];

export function appImageIsoNamespaceCommand({emptyDirectory,filename,environment=process.env,mode='user',uid=process.getuid(),gid=process.getgid()}) {
  assert.ok(['user','privileged'].includes(mode),'ISO mount namespace must be user or privileged');
  for(const value of [emptyDirectory,filename])assert.ok(typeof value==='string'&&value.startsWith('/')&&!value.includes('\0'),'ISO fixture paths must be absolute');
  for(const value of [uid,gid])assert.ok(Number.isInteger(value)&&value>=0&&value<0xffffffff,'ISO fixture identity must be a Linux UID/GID');
  const args=['--mount','--fork','/bin/sh','-ec',mountScript,'vb6-native-iso-fixture',emptyDirectory];
  if(mode==='user')return {command:'/usr/bin/unshare',args:['--user','--map-root-user',...args,filename,'--appimage-extract-and-run']};

  // Only the mount preparation runs as root. Restore a bounded display/session
  // environment after setpriv, then verify the application's original identity.
  // All commands executed with privilege have fixed absolute system paths.
  const restored=['PATH=/usr/bin:/bin'];
  for(const name of sessionVariables){
    const value=environment[name];
    if(value!==undefined){assert.ok(typeof value==='string'&&!value.includes('\0'),'Invalid ISO fixture environment');restored.push(name+'='+value);}
  }
  return {command:'/usr/bin/sudo',args:['-n','--','/usr/bin/unshare',...args,
    '/usr/bin/setpriv','--reuid='+uid,'--regid='+gid,'--clear-groups','--no-new-privs',
    '/usr/bin/env','-i',...restored,'/bin/sh','-ec',identityScript,'vb6-native-iso-user-fixture',String(uid),String(gid),filename,'--appimage-extract-and-run']};
}
