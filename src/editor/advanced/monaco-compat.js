const guarded=new WeakSet();

/** Monaco 0.57.0's linked-editing contribution stores two Delayer promises
 * without rejection handlers. Disposing or replacing its provider while a
 * cursor/synchronization task is scheduled rejects them with CancellationError.
 *
 * Observe only those owned promises, preserving their identity and rejection
 * semantics. No global error listener, timer delay, vendor mutation or disabled
 * linked-editing feature is involved. The pinned contribution contract is
 * checked here and exercised with the real editor by browser acceptance.
 * Remove/review this shim when updating the pinned Monaco dependency.
 */
export function guardLinkedEditingCancellation(editor,onError) {
  const contribution=editor.getContribution('editor.contrib.linkedEditing');
  if(!contribution)throw new Error('The pinned linked-editing contribution is unavailable.');
  if(guarded.has(contribution))return;
  for(const key of ['_rangeUpdateTriggerPromise','_rangeSyncTriggerPromise']) {
    const descriptor=Object.getOwnPropertyDescriptor(contribution,key);
    if(!descriptor?.configurable||!descriptor.writable)throw new Error('Monaco linked-editing lifecycle changed; review the pinned compatibility adapter.');
    const observe=value=>{
      if(value?.catch)value.catch(error=>{
        if(error?.name!=='Canceled'||error?.message!=='Canceled')onError(error);
      });
      return value;
    };
    let value=observe(descriptor.value);
    Object.defineProperty(contribution,key,{configurable:true,enumerable:descriptor.enumerable,get:()=>value,set:next=>{value=observe(next);}});
  }
  guarded.add(contribution);
}
