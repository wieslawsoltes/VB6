/** Reserved native-window transport for the existing live-DOM IDE window host.
 * The root renderer alone owns the bridge; child renderers receive no IPC authority.
 */
export function createNativeWindowTransport(owner, bridge, onError = () => {}) {
  const records = new Map();
  const command = (id, name, value) => bridge.windowCommand(id,name,value).catch(onError);
  const unsubscribe = bridge.onWindowEvent(event => {
    const record = records.get(event.id);
    if (record && (event.type === 'close-request' || event.type === 'closed')) record.onClose?.();
  });
  return {
    open(bounds, title) {
      const id = bridge.prepareWindow({kind:'tool',title:String(title || 'VB6 Studio'),x:bounds.left,y:bounds.top,width:bounds.width,height:bounds.height,borderStyle:2});
      const popup = owner.open('about:blank',id,'popup');
      if (!popup) { command(id,'cancel-reservation'); throw new Error('Native IDE window creation was denied'); }
      const record = {
        popup, native:true, id, onClose:null,
        show:() => command(id,'show'),
        title:value => command(id,'title',value),
        close:() => { records.delete(id); return command(id,'destroy'); }
      };
      records.set(id,record); return record;
    },
    dispose() { for (const record of [...records.values()]) record.close(); unsubscribe(); }
  };
}
