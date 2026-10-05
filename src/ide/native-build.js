import {compileWin32} from '../native/compiler.js';
import {download,safeName} from '../core/core.js';
/** Browser-local native build; no compiler service, Node, or binary template is used. */
export function installNativeBuild(ide) {
  const menu = ide.menu.bind(ide), command = ide.command.bind(ide);
  ide.menu = name => {
    const items = menu(name);
    if (name === 'File') { const index = items.findIndex(item => item?.id === 'exportHTML'); items.splice(index + 1,0,{id:'exportWin32',label:'Make '+ide.project.name+'.exe (Win32 AOT)…',icon:'export',enabled:ide.runState === 'design'}); }
    return items;
  };
  ide.command = async (id,...args) => {
    if (id !== 'exportWin32') return command(id,...args);
    if (ide.runState !== 'design') { ide.status('Stop execution before building an executable.'); return; }
    try {
      const result = compileWin32(ide.project);
      download(safeName(ide.project.name)+'.exe',result.bytes,'application/vnd.microsoft.portable-executable');
      ide.lastNativeBuild = result.report;
      ide.status('Made '+ide.project.name+'.exe — '+result.bytes.length+' bytes, x86 native controls/GDI, no extraction.');
      ide.emit('export',{kind:'win32',report:result.report});
    } catch(error) { ide.lastNativeBuild = {diagnostics:error.diagnostics || [{severity:'error',message:error.message}]}; ide.status('Win32 build failed: '+error.message); }
  };
}
