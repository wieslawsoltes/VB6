/** Browser CommonDialog save transactions. ShowSave chooses a destination;
 * authored VB code gets the rest of its call stack to write that destination
 * before the browser download is produced. A prewritten source is retained for
 * existing browser projects whose ShowSave itself exported the private file.
 */
const transactions=new WeakMap();

export function queueFileDownload(vm,name,sourceName=''){
  const fs=vm.fs,path=fs.canonical(name),owner=vm.stack?.[0];
  const source=sourceName&&fs.exists(sourceName)?fs.readBytes(sourceName):null;
  const before=fs.metadata.get(path),previous=fs.exists(path)?fs.readBytes(path):null;
  const request={name,path,source,previous,before,errorAtSelection:vm.lastError};
  const download=()=>{
    // Err.Number is sticky and can describe an unrelated earlier operation.
    // Conversely a GoTo handler clears Err when it returns. Compare the actual
    // trapped error identity across this transaction rather than either value.
    if(vm.lastError!==request.errorAtSelection)return;
    const changed=fs.metadata.get(path)!==request.before;
    const bytes=fs.exists(path)&&(changed||fs.canonical(sourceName)===path)?fs.readBytes(path):request.source??request.previous;
    // A dialog alone must never fabricate an empty document.
    if(bytes!==null)return vm.host.saveFile?.(name,bytes);
  };
  if(!owner)return download();
  let pending=transactions.get(vm);
  if(!pending){
    pending=new Map();transactions.set(vm,pending);
    const clear=()=>{offComplete();offState();pending.clear();transactions.delete(vm);};
    const offState=vm.on('state',state=>{if(state==='stopped'||state==='error')clear();});
    const offComplete=vm.on('procedureComplete',({frame,completed})=>{
      const saves=pending.get(frame);if(!saves)return;
      pending.delete(frame);if(!pending.size)clear();
      if(!completed||vm.state==='stopped'||vm.state==='error')return;
      for(const finish of saves.values()){
        // Browser downloads are synchronous. Native desktop bridges may return
        // promises; report rejection instead of losing it as an unhandled task.
        try{const result=finish();if(result?.then)result.catch(error=>vm.reportError(error));}
        catch(error){vm.reportError(error);}
      }
    });
  }
  let saves=pending.get(owner);if(!saves)pending.set(owner,saves=new Map());
  // Repeated saves to one destination in a single handler produce its final
  // bytes once, instead of competing downloads of intermediate versions.
  saves.set(path.toLowerCase(),download);
}
