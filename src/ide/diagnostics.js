import {el,lower} from '../core/core.js';
import {findModule} from '../project/model.js';
import {DiagnosticsScheduler} from '../editor/diagnostics-scheduler.js';

/** Automatic checks never activate a window, change focus, or replace runtime
 * errors. Explicit compilation remains the authority for running/exporting. */
export function installDiagnostics(ide) {
  const indicator=el('button',{class:'status-field status-diagnostics',type:'button',title:'Automatic syntax checking','aria-label':'Syntax check status',onclick:()=>ide.showDebug('Errors')},'Syntax');
  ide.statusbar.insertBefore(indicator,ide.statusMode);
  const updateEditors=()=>{for(const editor of ide.documents.editors.values())editor.setDiagnostics(ide.diagnostics);ide.debuggerWindows?.schedule();};
  const scheduler=ide.syntaxDiagnostics=new DiagnosticsScheduler({
    onState:state=>{indicator.dataset.pending=String(state.pending);indicator.textContent=state.pending?'Checking…':ide.appearance.autoSyntaxCheck?'Syntax'+(ide.diagnostics.length?' ('+ide.diagnostics.length+')':' ✓'):'Syntax: manual';indicator.title=state.pending?'Checking the latest source without executing it':ide.appearance.autoSyntaxCheck?'Automatic syntax check ('+state.mode+'). Open Errors window.':'Auto Syntax Check is disabled. Use Debug → Check Project Syntax.';},
    onResult:result=>{if(ide.runState!=='design'||!ide.appearance.autoSyntaxCheck)return;
      ide.diagnostics=[...ide.diagnostics.filter(d=>d.origin!=='syntax'&&d.severity==='warning'),...result.diagnostics];updateEditors();ide.emit('diagnostics',result);}
  });
  const queue=()=>{if(ide.project&&ide.appearance.autoSyntaxCheck&&ide.runState==='design')scheduler.schedule(ide.project);};
  const dirty=ide.markDirty.bind(ide);ide.markDirty=(...args)=>{const result=dirty(...args);queue();return result;};
  const load=ide.loadProject.bind(ide);ide.loadProject=(...args)=>{scheduler.cancel();const result=load(...args);queue();return result;};
  const appearance=ide.applyAppearance.bind(ide);ide.applyAppearance=(...args)=>{const result=appearance(...args);if(ide.appearance.autoSyntaxCheck)queue();else {scheduler.cancel();ide.diagnostics=ide.diagnostics.filter(d=>d.origin!=='syntax');updateEditors();}return result;};
  const check=ide.checkSyntax.bind(ide);ide.checkSyntax=(...args)=>{scheduler.cancel();const result=check(...args);ide.diagnostics=result.diagnostics.map(d=>({...d,origin:'syntax'}));updateEditors();scheduler.state();return result;};
  const command=ide.command.bind(ide);ide.command=async(id,...args)=>{
    if(id==='nextDiagnostic'||id==='previousDiagnostic') {
      const items=ide.diagnostics.filter(d=>findModule(ide.project,d.source));if(!items.length){ide.status('No source diagnostics.');return;}
      const name=ide.activeModule?.name,line=ide.editor?.cursor().line||0,offset=items.findIndex(d=>lower(d.source)===lower(name)&&d.line>=line);
      const current=items.findIndex(d=>lower(d.source)===lower(name)&&d.line===line),direction=id==='nextDiagnostic'?1:-1;
      const index=current>=0?(current+direction+items.length)%items.length:offset>=0?(direction>0?offset:(offset+items.length-1)%items.length):(direction>0?0:items.length-1),d=items[index];
      ide.openDocument(findModule(ide.project,d.source).id,'code',d.line);ide.editor.goToLine(d.line,d.column||1);ide.editor.input.focus();ide.status(d.message);return;
    }
    return command(id,...args);
  };
  const menu=ide.menu.bind(ide);ide.menu=name=>{const items=menu(name);if(name==='Debug')items.push(null,{id:'nextDiagnostic',label:'Next Source Error',enabled:!!ide.diagnostics.length},{id:'previousDiagnostic',label:'Previous Source Error',enabled:!!ide.diagnostics.length});return items;};
  ide.on('stop',queue);
  // Pane return/late editor events must not restart worker creation in a dying
  // document. A back-forward-cache restoration may resume with fresh source.
  globalThis.addEventListener?.('pagehide',()=>scheduler.suspend());
  globalThis.addEventListener?.('pageshow',()=>{scheduler.resume();queue();});
  return scheduler;
}
