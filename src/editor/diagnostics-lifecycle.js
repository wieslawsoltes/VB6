/** Stop optional diagnostics before document loading is cancelled, not after it.
 * pagehide is too late for an in-flight worker-script request in WebKit. A
 * capture-phase beforeunload handler also runs before persistence/editor hooks
 * that can schedule new checks. No unload prompt or error filtering is added.
 *
 * beforeunload does not tell us whether the user ultimately leaves. After an
 * abandoned navigation, resume on the next trusted interaction, or pageshow
 * after a back-forward-cache restore. A timer must not restart a worker while
 * the outgoing document is waiting for a navigation response.
 */
export function bindDiagnosticsLifecycle(scheduler, {view=globalThis, onResume=()=>{}}={}) {
  if (typeof view.addEventListener !== 'function') return () => {};
  const document=view.document, listeners=[];
  let leaving=false, hidden=false, disposed=false;
  const listen=(target,type,callback,options=false)=>{
    if(typeof target?.addEventListener !== 'function')return;
    target.addEventListener(type,callback,options);
    listeners.push(()=>target.removeEventListener(type,callback,options));
  };
  const suspend=()=>{leaving=true;scheduler.suspend();};
  const resume=()=>{
    if(disposed||hidden||document?.visibilityState==='hidden')return;
    const wasSuspended=scheduler.suspended;
    leaving=false;scheduler.resume();
    if(wasSuspended&&!scheduler.disposed)onResume();
  };
  // Navigation API is optional. beforeunload covers browsers without it.
  listen(view.navigation,'navigate',event=>{if(!event.destination?.sameDocument&&!event.hashChange&&event.downloadRequest==null)suspend();});
  listen(view,'beforeunload',suspend,true);
  listen(view,'pagehide',()=>{hidden=true;suspend();},true);
  listen(view,'pageshow',()=>{hidden=false;resume();});
  const interaction=event=>{if(leaving&&event.isTrusted)resume();};
  listen(view,'pointerdown',interaction,true);
  listen(view,'keydown',interaction,true);
  // Hidden tabs do not spend CPU parsing; the current project is re-snapshotted
  // when visible again. Visibility alone cannot undo a provisional navigation.
  listen(document,'visibilitychange',()=>{
    if(document.visibilityState==='hidden')scheduler.suspend();
    else if(!leaving)resume();
  });
  return ()=>{
    if(disposed)return;
    disposed=true;
    for(const remove of listeners.splice(0))remove();
  };
}
